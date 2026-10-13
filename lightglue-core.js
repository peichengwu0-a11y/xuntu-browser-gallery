/* DISK and LightGlue official ONNX models, run entirely in this worker. */
(function(scope){
  const DIM=128,MAX_POINTS=2048;
  let sessionsPromise,provider='WebAssembly';
  const projection=new Int8Array(DIM*64);let seed=20261013;
  for(let i=0;i<projection.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;projection[i]=(seed&1)?1:-1;}
  async function sessions(){
    if(!sessionsPromise)sessionsPromise=(async()=>{
      importScripts('./vendor/onnxruntime/ort.webgpu.min.js');
      ort.env.wasm.wasmPaths=new URL('./vendor/onnxruntime/',self.location.href).href;ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;
      const create=async executionProviders=>({extractor:await ort.InferenceSession.create('./vendor/lightglue/disk-web.onnx',{executionProviders}),matcher:await ort.InferenceSession.create('./vendor/lightglue/disk_lightglue_fused_cpu.onnx',{executionProviders})});
      if(self.navigator.gpu&&!new URL(self.location.href).searchParams.has('wasm')){try{const result=await create(['webgpu','wasm']);provider='WebGPU';return result;}catch(error){console.warn('LightGlue WebGPU initialization failed; using WebAssembly.',error.message);}}
      return await create(['wasm']);
    })().catch(error=>{sessionsPromise=null;throw new Error('LightGlue 模型加载失败：'+error.message);});
    return sessionsPromise;
  }
  async function extract(blob){
    const {extractor}=await sessions(),bitmap=await createImageBitmap(blob);
    try{
      if(bitmap.width*bitmap.height>35000000)throw new Error('图片超过 3500 万像素。');
      const ratio=480/Math.max(bitmap.width,bitmap.height),w=Math.max(1,Math.round(bitmap.width*ratio)),h=Math.max(1,Math.round(bitmap.height*ratio));
      const canvas=new OffscreenCanvas(512,512),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,512,512);ctx.drawImage(bitmap,Math.floor((512-w)/2),Math.floor((512-h)/2),w,h);
      const rgba=ctx.getImageData(0,0,512,512).data,input=new Float32Array(3*512*512);const plane=512*512;
      for(let i=0;i<plane;i++)for(let c=0;c<3;c++)input[c*plane+i]=rgba[i*4+c]/255;
      const tensor=new ort.Tensor('float32',input,[1,3,512,512]);let outputs;
      try{outputs=await extractor.run({image:tensor});}finally{tensor.dispose();}
      try{
        const ids=Array.from({length:outputs.scores.data.length},(_,i)=>i).sort((a,b)=>outputs.scores.data[b]-outputs.scores.data[a]||a-b).slice(0,MAX_POINTS);
        const points=new Float32Array(ids.length*2),descriptors=new Float32Array(ids.length*DIM);
        for(let i=0;i<ids.length;i++){points[i*2]=Number(outputs.keypoints.data[ids[i]*2]);points[i*2+1]=Number(outputs.keypoints.data[ids[i]*2+1]);descriptors.set(outputs.descriptors.data.subarray(ids[i]*DIM,(ids[i]+1)*DIM),i*DIM);}
        return {points,descriptors,rows:ids.length,width:bitmap.width,height:bitmap.height};
      }finally{Object.values(outputs).forEach(t=>t.dispose());}
    }finally{bitmap.close();}
  }
  function fingerprint(features){
    const codes=new Uint8Array(features.rows*8),d=features.descriptors;
    for(let p=0;p<features.rows;p++)for(let b=0;b<64;b++){let v=0;for(let c=0;c<DIM;c++)v+=d[p*DIM+c]*projection[c*64+b];if(v>0)codes[p*8+(b>>>3)]|=1<<(b&7);}
    return codes;
  }
  function buildLookup(records){
    const offsets=new Uint32Array(262145);let count=0;
    for(const r of records)for(let p=0;p<r.codes.length;p+=8)for(let b=0;b<4;b++){offsets[1+(b<<16)+(r.codes[p+b*2]|r.codes[p+b*2+1]<<8)]++;count++;}
    for(let i=1;i<offsets.length;i++)offsets[i]+=offsets[i-1];
    const positions=offsets.slice(),postings=new Uint32Array(count);
    records.forEach((r,i)=>{for(let p=0;p<r.codes.length;p+=8)for(let b=0;b<4;b++){const word=(b<<16)|(r.codes[p+b*2]|r.codes[p+b*2+1]<<8);postings[positions[word]++]=i*MAX_POINTS+p/8;}});
    return {records,offsets,postings};
  }
  function popcount(x){x-=x>>>1&0x55555555;x=(x&0x33333333)+(x>>>2&0x33333333);return ((x+(x>>>4)&0x0f0f0f0f)*0x01010101)>>>24;}
  function shortlist(codes,lookup,limit=32){
    const {records,offsets,postings}=lookup,votes=new Float64Array(records.length),best=new Uint8Array(records.length),touched=[];
    const views=records.map(r=>new DataView(r.codes.buffer,r.codes.byteOffset,r.codes.byteLength)),query=new DataView(codes.buffer,codes.byteOffset,codes.byteLength);
    for(let p=0;p<codes.length;p+=8){const a=query.getUint32(p,true),b=query.getUint32(p+4,true);
      for(let band=0;band<4;band++){const word=(band<<16)|query.getUint16(p+band*2,true);
        for(let k=offsets[word];k<offsets[word+1];k++){const encoded=postings[k],i=Math.floor(encoded/MAX_POINTS),point=(encoded%MAX_POINTS)*8,view=views[i];
          const distance=popcount(a^view.getUint32(point,true))+popcount(b^view.getUint32(point+4,true));
          if(distance>12)continue;const weight=13-distance;if(!best[i])touched.push(i);if(weight>best[i])best[i]=weight;
        }
      }
      for(const i of touched){votes[i]+=best[i]*best[i];best[i]=0;}touched.length=0;
    }
    return records.map((r,i)=>({id:r.id,score:votes[i]/Math.sqrt(Math.max(1,r.codes.length/8))})).sort((a,b)=>b.score-a.score).slice(0,limit).map(x=>x.id);
  }
  async function match(cv,query,reference){
    if(query.rows<4||reference.rows<4)return {inliers:0,matches:0,accepted:false,score:0};
    const {matcher}=await sessions();const normalize=points=>Float32Array.from(points,x=>(x-256)/256);
    const feeds={kpts0:new ort.Tensor('float32',normalize(query.points),[1,query.rows,2]),kpts1:new ort.Tensor('float32',normalize(reference.points),[1,reference.rows,2]),desc0:new ort.Tensor('float32',query.descriptors,[1,query.rows,DIM]),desc1:new ort.Tensor('float32',reference.descriptors,[1,reference.rows,DIM])};let output;
    try{output=await matcher.run(feeds);}finally{Object.values(feeds).forEach(t=>t.dispose());}
    try{
      const pairs=output.matches0.data,src=[],dst=[];
      for(let i=0;i<pairs.length;i+=2){const a=Number(pairs[i]),b=Number(pairs[i+1]);src.push(query.points[a*2],query.points[a*2+1]);dst.push(reference.points[b*2],reference.points[b*2+1]);}
      const matches=src.length/2;let inliers=0,a,b,mask,h;
      try{if(matches>=4){a=cv.matFromArray(matches,1,cv.CV_32FC2,src);b=cv.matFromArray(matches,1,cv.CV_32FC2,dst);mask=new cv.Mat();h=cv.findHomography(a,b,cv.RANSAC,4,mask);if(!h.empty())inliers=mask.data.reduce((x,y)=>x+y,0);}}
      finally{[a,b,mask,h].filter(Boolean).forEach(x=>x.delete());}
      return {inliers,matches,accepted:inliers>=40&&inliers/matches>=.3,score:inliers,engine:'LightGlue-ONNX',provider};
    }finally{Object.values(output).forEach(t=>t.dispose());}
  }
  function unpack(bytes){const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(new TextDecoder().decode(bytes.subarray(0,4))!=='LGI1')throw new Error('LightGlue 索引无效。');let offset=8;const result=[],count=view.getUint32(4,true);for(let i=0;i<count;i++){const length=view.getUint16(offset,true),rows=view.getUint16(offset+2,true);offset+=4;const id=new TextDecoder().decode(bytes.subarray(offset,offset+length));offset+=length;const codes=bytes.slice(offset,offset+rows*8);offset+=rows*8;result.push({id,codes});}if(offset!==bytes.length)throw new Error('LightGlue 索引长度错误。');return result;}
  scope.LightGlue={extract,fingerprint,buildLookup,shortlist,match,unpack,sessions,get provider(){return provider;},MAX_POINTS};
})(globalThis);
