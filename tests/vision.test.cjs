const assert=require('node:assert/strict');
require('../vision-core.js');
function fixture(seed,width=420,height=360){
  let value=seed;const random=()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;};
  const rgba=new Uint8Array(width*height*4),shapes=[];
  for(let i=0;i<100;i++)shapes.push({x:random()*width,y:random()*height,w:10+random()*65,h:10+random()*65,color:[random()*255,random()*255,random()*255]});
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=(y*width+x)*4;rgba[p]=235;rgba[p+1]=235;rgba[p+2]=235;rgba[p+3]=255;for(const s of shapes)if(x>=s.x&&x<s.x+s.w&&y>=s.y&&y<s.y+s.h){rgba[p]=s.color[0];rgba[p+1]=s.color[1];rgba[p+2]=s.color[2];}}
  return {rgba,width,height};
}
function region(source,left,top,width,height,scale=1){
  const w=Math.round(width*scale),h=Math.round(height*scale),rgba=new Uint8Array(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const sx=Math.min(source.width-1,left+Math.floor(x/scale)),sy=Math.min(source.height-1,top+Math.floor(y/scale));rgba.set(source.rgba.subarray((sy*source.width+sx)*4,(sy*source.width+sx)*4+4),(y*w+x)*4);}
  return {rgba,width:w,height:h};
}
(async()=>{
  const cv=await require('../vendor/opencv.js'),images=[fixture(13),fixture(29),fixture(45)],extract=image=>Vision.extract(cv,image.rgba,image.width,image.height),references=images.map(extract);
  for(const [label,image] of [['same',images[0]],['scaled',region(images[0],0,0,420,360,.7)],['cropped',region(images[0],70,60,280,240)]]){
    const query=extract(image),scores=references.map((reference,index)=>({index,...Vision.compare(cv,query,reference)})).sort((a,b)=>b.score-a.score);
    assert.equal(scores[0].index,0,label+' should rank the source first');assert.ok(scores[0].accepted,label+' should be accepted');assert.ok(scores[0].inliers>=8,label+' should have geometric evidence');console.log(label,JSON.stringify(scores));
  }
  const empty=extract({rgba:new Uint8Array(100*100*4).fill(255),width:100,height:100});assert.equal(empty.rows,0);assert.equal(empty.variance,0);assert.equal(Vision.compare(cv,empty,empty).accepted,false);
  const records=Array.from({length:220},(_,i)=>({id:String(i),features:references[i%3]}));const selected=Vision.shortlist(references[0],records,Vision.buildLookup(records));assert.ok(selected.some(a=>a.id==='0'));assert.ok(selected.length<=220);
  console.log('PASS: same image, resized image, crop, unrelated images, blank rejection and candidate retrieval.');
})().catch(error=>{console.error(error);process.exitCode=1;});
