const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let extracts=0,matches=0,quickComparisons=0;const messages=[];
const context={console,performance,setTimeout,Uint8Array,Float32Array,DataView,TextDecoder,Map,Set,
  importScripts(){},createImageBitmap:async()=>({width:10,height:10,close(){}}),
  OffscreenCanvas:class{getContext(){return {fillRect(){},drawImage(){},getImageData(){return {data:[]};}};}},
  Vision:{extract:()=>({variance:100}),buildLookup:()=>new Map(),shortlist:(_q,r)=>r,compare:()=>{quickComparisons++;return {accepted:true,score:10,inliers:10};}},
  LightGlue:{extract:async()=>{extracts++;return {};},match:async()=>{matches++;return {accepted:true,score:100,inliers:100,engine:'LightGlue-ONNX'};},provider:'test'},
  self:{cv:Promise.resolve({}),postMessage:m=>messages.push(m)}};
vm.createContext(context);vm.runInContext(fs.readFileSync('search-worker.js','utf8'),context);
const call=async data=>{messages.length=0;await context.self.onmessage({data:{id:1,...data}});const response=messages.at(-1);assert.ok(!response.error,response.error);return response.result;};
(async()=>{
  await call({type:'init',records:[{id:'one',features:{descriptors:[]},blob:{}}]});
  const quick=await call({type:'search',mode:'quick',queryKey:1,blob:{}});
  assert.equal(quick.engine,'ORB');assert.equal(quick.results.length,1);assert.equal(extracts,0);assert.equal(matches,0);
  await call({type:'search',mode:'fine',queryKey:1,blob:{}});
  assert.equal(quickComparisons,1,'Fine search reuses the quick candidate pass');assert.equal(matches,1);
  await call({type:'search',mode:'quick',queryKey:2,blob:{}});
  assert.equal(quickComparisons,2,'A replacement query gets new quick results');assert.equal(matches,1,'Quick search never invokes LightGlue');
  console.log('PASS: quick results stop before LightGlue; manual refinement reuses candidates; replacement queries reset the pass.');
})().catch(error=>{console.error(error);process.exitCode=1;});
