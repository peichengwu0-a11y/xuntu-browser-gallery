importScripts('./vision-core.js','./lightglue-core.js');
let records=[], lookup, cancelled=false,sharedRecords=[],sharedVersion='',neuralRecords=[],neuralLookup,neuralVersion='';
const featureCache=new Map();
let configuredShared=null,lastQuick=null;
const ready=(async()=>{importScripts('./vendor/opencv.js');return await self.cv;})();
async function feature(blob) {
  const cv=await ready,bitmap=await createImageBitmap(blob);
  try {
    if(bitmap.width*bitmap.height>35000000) throw new Error('图片超过 3500 万像素，请缩小后重试。');
    const ratio=Math.min(1,640/Math.max(bitmap.width,bitmap.height));
    const width=Math.max(1,Math.round(bitmap.width*ratio)),height=Math.max(1,Math.round(bitmap.height*ratio));
    const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.drawImage(bitmap,0,0,width,height);
    return Vision.extract(cv,ctx.getImageData(0,0,width,height).data,width,height);
  } finally {bitmap.close();}
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function unpack(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let offset=8;
  if(new TextDecoder().decode(bytes.subarray(0,4))!=='TJI1')throw new Error('共享图库索引无效。');
  const count=view.getUint32(4,true),result=[];
  for(let i=0;i<count;i++){
    const length=view.getUint16(offset,true);offset+=2;const id=new TextDecoder().decode(bytes.subarray(offset,offset+length));offset+=length;
    const width=view.getUint16(offset,true),height=view.getUint16(offset+2,true),rows=view.getUint16(offset+4,true),variance=view.getFloat32(offset+6,true);offset+=10;
    const hash=new Uint8Array(bytes.slice(offset,offset+64));offset+=64;const pixels=new Uint8Array(bytes.slice(offset,offset+256));offset+=256;
    const points=new Float32Array(rows*2);for(let p=0;p<points.length;p++){points[p]=view.getFloat32(offset,true);offset+=4;}
    const descriptors=new Uint8Array(bytes.slice(offset,offset+rows*32));offset+=rows*32;
    result.push({id,features:{version:1,width,height,rows,variance,hash,pixels,points,descriptors}});
  }
  if(offset!==bytes.length)throw new Error('共享图库索引长度不一致。');return result;
}
async function onlineIndices(shared,id){
  if(!shared)return [];
  if(shared.version===sharedVersion)return sharedRecords;
  const loaded=[];
  for(let i=0;i<shared.shards.length;i++){
    const response=await fetch(shared.shards[i].url);if(!response.ok)throw new Error('共享图库索引下载失败。');
    const stream=response.body.pipeThrough(new DecompressionStream('gzip')),bytes=new Uint8Array(await new Response(stream).arrayBuffer());
    loaded.push(...unpack(bytes));self.postMessage({id,progress:(i+1)/shared.shards.length*100,note:`正在加载共享检索索引 ${i+1} / ${shared.shards.length}`});await tick();
  }
  sharedRecords=loaded;sharedVersion=shared.version;return sharedRecords;
}
async function neuralIndex(shared,id){
  if(!shared?.lightglue)return;
  if(shared.lightglue.version===neuralVersion)return;
  self.postMessage({id,progress:0,note:'正在加载 LightGlue 神经特征索引…'});
  const response=await fetch(shared.lightglue.url);if(!response.ok)throw new Error('LightGlue 索引下载失败。');
  const bytes=new Uint8Array(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  neuralRecords=LightGlue.unpack(bytes);neuralLookup=LightGlue.buildLookup(neuralRecords);neuralVersion=shared.lightglue.version;
}
async function neuralFeature(record){
  if(featureCache.has(record.id))return featureCache.get(record.id);
  let blob=record.blob;if(!blob){const response=await fetch(record.imageUrl);if(!response.ok)throw new Error('素材缩略图下载失败。');blob=await response.blob();}
  const features=await LightGlue.extract(blob);featureCache.set(record.id,features);
  if(featureCache.size>40)featureCache.delete(featureCache.keys().next().value);
  return features;
}
self.onmessage=async({data})=>{
  if(data.type==='cancel'){cancelled=true;return;}
  const {id,type}=data;
  try {
    if(type==='init'){featureCache.clear();lastQuick=null;configuredShared=data.shared;await ready;const online=await onlineIndices(data.shared,id),wanted=new Set(data.records.map(r=>r.id)),merged=new Map(online.filter(r=>wanted.has(r.id)).map(r=>[r.id,r]));for(const r of data.records){if(r.features?.descriptors)merged.set(r.id,r);const target=merged.get(r.id);if(target)Object.assign(target,{blob:r.blob,imageUrl:r.imageUrl});}records=[...merged.values()];lookup=Vision.buildLookup(records);self.postMessage({id,result:true});}
    if(type==='features') self.postMessage({id,result:await feature(data.blob)});
    if(type==='search') {
      cancelled=false;const cv=await ready,start=performance.now(),cached=lastQuick?.key===data.queryKey?lastQuick:null,query=cached?.query||await feature(data.blob);
      if(query.variance<30){self.postMessage({id,result:{results:[],seconds:0,candidates:0,reason:'图片缺少可识别的细节，请使用包含素材画面的截图。'}});return;}
      const orbCandidates=cached?[]:Vision.shortlist(query,records,lookup),coarse=cached?.coarse||[];
      for(let i=0;i<orbCandidates.length;i++) {
        if(cancelled) throw new Error('检索已取消。');
        const record=orbCandidates[i],evidence=Vision.compare(cv,query,record.features);coarse.push({id:record.id,...evidence});
        if(i%8===0){self.postMessage({id,progress:(i+1)/orbCandidates.length*100,note:`快速匹配 ${i+1} / ${orbCandidates.length}`});await tick();}
      }
      coarse.sort((a,b)=>b.score-a.score);
      lastQuick={key:data.queryKey,query,coarse};
      if(data.mode==='quick'){
        self.postMessage({id,result:{results:coarse.filter(x=>x.accepted).slice(0,20).map(x=>({...x,engine:'ORB'})),seconds:(performance.now()-start)/1000,candidates:coarse.length,total:records.length,engine:'ORB'}});return;
      }
      await neuralIndex(configuredShared,id);
      if(cancelled)throw new Error('检索已取消。');
      self.postMessage({id,progress:0,note:'正在准备 LightGlue 模型并提取查询特征…'});
      const learned=await LightGlue.extract(data.blob);
      const neuralIds=neuralLookup?LightGlue.shortlist(LightGlue.fingerprint(learned),neuralLookup,16):[];
      const ids=new Set([...neuralIds,...coarse.slice(0,8).map(x=>x.id)]);
      // Local additions have no published neural index. They must remain searchable.
      for(const record of records)if(record.blob)ids.add(record.id);
      const byId=new Map(records.map(r=>[r.id,r])),candidates=data.full?records:[...ids].map(id=>byId.get(id)).filter(Boolean),results=[];
      for(let i=0;i<candidates.length;i++){
        if(cancelled)throw new Error('检索已取消。');const record=candidates[i];
        self.postMessage({id,progress:15+i/candidates.length*85,note:`LightGlue 精细匹配 ${i+1} / ${candidates.length} · ${LightGlue.provider}`});
        const reference=await neuralFeature(record),evidence=await LightGlue.match(cv,learned,reference);
        if(evidence.accepted)results.push({id:record.id,...evidence});await tick();
      }
      results.sort((a,b)=>b.score-a.score);
      self.postMessage({id,result:{results:results.slice(0,20),seconds:(performance.now()-start)/1000,candidates:candidates.length,total:records.length,engine:'LightGlue-ONNX',provider:LightGlue.provider}});
    }
  } catch(error){self.postMessage({id,error:error.message||'图片处理失败。'});}
};
