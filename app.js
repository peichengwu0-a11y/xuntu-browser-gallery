import {allAssets,putAssets,removeAssets,hiddenIds} from './db.js';
import {readBundle,exportBundle,imageRecord,validCch} from './bundle.js?v=20261014-fluid';
import {fetchSharedGallery,assetBlob} from './shared-gallery.js';
import {createCosGallery,fetchCosSnapshot} from './cos-gallery.js?v=20261125-site-thumbs';
import {buildFolders,folderKey,inFolder,assetFolders,commonDirectory,folderName,cleanFolderNames,validFolders} from './folders.js?v=20261014-fluid';
const $=id=>document.getElementById(id),state={assets:[],results:[],view:'all',manage:false,page:1,selected:new Set(),query:null,queryKey:0,quickReady:false,busy:false,ready:false,cancelled:false,detail:null};
const pageSize=36,worker=new Worker(new URL('./search-worker.js?v=20261014-fluid',import.meta.url)),pending=new Map();
let cloudGallery=null, cloudAssets=[], cloudExpires=0, cloudIndexAbort=null;
let cloudPhotoshop=false;
let cloudCanSync=false;
let usingSnapshot=false;
let libraryLoading=true;
const cloudFeatures=new Map();
let requestId=0,objectUrls=[],queryUrl,detailUrl,toastTimer,sharedGallery=null,waitingQuery=null,folderModel={base:[],root:{children:new Map()}},selectedFolder=[],expandedFolders=new Set();
const FOLDER_NAMES_KEY='tuji-folder-names-v1';let folderNames={},renamingFolder=null;
try{folderNames=cleanFolderNames(JSON.parse(localStorage.getItem(FOLDER_NAMES_KEY)||'{}'));}catch{}
function saveFolderNames(names){const clean=cleanFolderNames(names);localStorage.setItem(FOLDER_NAMES_KEY,JSON.stringify(clean));folderNames=clean;}
const displayFolderPath=parts=>parts.map((_,i)=>folderName(parts.slice(0,i+1),folderNames)).join(' / ');
function openFolderRename(parts){if(state.busy)return;renamingFolder=parts.slice();$('folderNameInput').value=folderName(parts,folderNames);$('folderOriginalName').textContent='原分类名称：'+parts.at(-1);$('folderRenameError').textContent='';$('renameFolderDialog').showModal();$('folderNameInput').focus();$('folderNameInput').select();}
function rpc(type,data={},progress) {return new Promise((resolve,reject)=>{const id=++requestId;pending.set(id,{resolve,reject,progress});worker.postMessage({id,type,...data});});}
worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;if(data.progress!==undefined){p.progress?.(data.progress,data.note);return;}pending.delete(data.id);data.error?p.reject(new Error(data.error)):p.resolve(data.result);};
worker.onerror=()=>{state.ready=false;for(const p of pending.values())p.reject(new Error('检索引擎加载失败，请刷新页面。'));pending.clear();notice('检索引擎加载失败，请检查浏览器是否支持 WebAssembly 和 Web Worker。',true);};
function notice(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);$('status').hidden=!text;}
function toast(text){const el=$('toast');($('detail').open?$('detail'):document.body).append(el);el.textContent=text;el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,3500);}
function progress(value,note){$('progress').value=value;if(note)$('taskNote').textContent=note;}
function beginTask(title,note=''){state.busy=true;state.cancelled=false;$('task').hidden=false;$('taskTitle').textContent=title;$('taskNote').textContent=note;progress(0);$('cancelTask').hidden=false;$('cancelTask').disabled=false;updateButtons();}
function endTask(){state.busy=false;$('task').hidden=true;updateButtons();}
function updateButtons(){for(const id of ['importButton','addImages','emptyImport','searchAgain','refineSearch','fullSearch','exportButton','deleteSelected','confirmDelete','allView','resultsView','refresh'])$(id).disabled=state.busy||(!state.ready&&['searchAgain','refineSearch','fullSearch'].includes(id))||(id==='resultsView'&&!state.query)||(id==='deleteSelected'&&!state.selected.size);$('refineSearch').hidden=!state.quickReady;for(const button of document.querySelectorAll('#folderTree button'))button.disabled=state.busy||button.getAttribute('aria-hidden')==='true';}
async function copy(text){if(!text){toast('此素材尚未填写路径。');return;}try{await navigator.clipboard.writeText(text);toast('路径已复制。');}catch{notice('自动复制失败，请在素材详情中选中路径手动复制。',true);}}
const visibleAssets=()=>state.manage?state.assets.filter(asset=>!asset.cloud):state.assets;
function filtered(){const q=$('filter').value.trim().toLowerCase();const list=state.view==='results'?state.results.map(r=>{const a=state.assets.find(a=>a.id===r.id);return a?{...a,evidence:r}:null;}).filter(Boolean):visibleAssets();return list.filter(a=>(state.view==='results'||inFolder(a,selectedFolder,folderModel.base))&&(a.name+' '+a.path+' '+a.shared).toLowerCase().includes(q));}
function renderFolders(){
  folderModel=buildFolders(visibleAssets(),commonDirectory(sharedGallery?.assets||[]));const container=$('folderTree');container.replaceChildren();
  const choose=parts=>{if(state.busy)return;selectedFolder=parts;state.view='all';state.page=1;state.selected.clear();$('filter').value='';render();};
  const row=(name,parts,count,depth,node)=>{
    if(parts.length)name=folderName(parts,folderNames);
    const line=document.createElement('div');line.className='folder-row';line.style.setProperty('--depth',depth);
    const key=folderKey(parts),open=expandedFolders.has(key),toggle=document.createElement('button');toggle.className='folder-toggle';toggle.disabled=state.busy||!node?.children.size;
    if(node?.children.size){toggle.setAttribute('aria-label',(open?'收起 ':'展开 ')+name);toggle.setAttribute('aria-expanded',String(open));toggle.onclick=()=>{open?expandedFolders.delete(key):expandedFolders.add(key);renderFolders();};}
    else toggle.setAttribute('aria-hidden','true');
    const button=document.createElement('button');button.className='folder-item';button.disabled=state.busy;button.classList.toggle('active',folderKey(selectedFolder)===key);button.setAttribute('aria-current',folderKey(selectedFolder)===key?'true':'false');button.title=displayFolderPath(parts)||name;
    const label=document.createElement('span');label.className='folder-label';label.textContent=name;const amount=document.createElement('span');amount.className='folder-count';amount.textContent=count.toLocaleString();button.append(label,amount);button.onclick=()=>choose(parts);line.append(toggle,button);container.append(line);
    if(state.manage&&parts.length){const edit=document.createElement('button');edit.className='folder-edit';edit.textContent='编辑';edit.disabled=state.busy;edit.setAttribute('aria-label','重命名 '+name);edit.onclick=()=>openFolderRename(parts);line.append(edit);}
    if(open&&node)for(const child of [...node.children.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true})))row(child.name,child.parts,child.count,depth+1,child);
  };
  row('全部素材',[],visibleAssets().length,0,null);
  for(const node of [...folderModel.root.children.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true})))row(node.name,node.parts,node.count,0,node);
}
function locationRow(asset,label,value,focusId){
  const row=document.createElement('div');row.className='location-row';
  const field=document.createElement('label');field.className='location-field';
  const caption=document.createElement('span');caption.textContent=label;
  const input=document.createElement('input');input.type='text';input.readOnly=true;input.value=value||'';input.placeholder='未填写';input.title=value||label+'未填写，点击编辑添加';input.setAttribute('aria-label',asset.name+'的'+label);
  input.onclick=()=>{if(value)input.select();else{openDetail(asset.id);$(focusId).focus();}};
  const copyButton=document.createElement('button');copyButton.className='location-copy';copyButton.textContent='复制';copyButton.disabled=!value;copyButton.setAttribute('aria-label','复制'+asset.name+'的'+label);copyButton.onclick=()=>copy(value);
  field.append(caption,input);row.append(field,copyButton);return row;
}
function render(){
  renderFolders();
  objectUrls.forEach(url=>URL.revokeObjectURL(url));objectUrls=[];
  const list=filtered(),pages=Math.max(1,Math.ceil(list.length/pageSize));state.page=Math.min(state.page,pages);
  const current=list.slice((state.page-1)*pageSize,state.page*pageSize);
  $('count').textContent=visibleAssets().length.toLocaleString();$('resultCount').textContent=state.results.length;
  $('cloudAccess').hidden=state.manage||!cloudGallery;
  $('cloudAccess').textContent=usingSnapshot&&!cloudGallery?.local
    ?(cloudGallery?.connected?'原图访问已连接':'连接原图服务')
    :cloudGallery?.connected?`COS 素材库 · ${cloudAssets.length.toLocaleString()} 张`:'连接 COS 素材库';
  $('cloudAccess').classList.toggle('is-connected',Boolean(cloudGallery?.connected));
  $('libraryTab').classList.toggle('active',!state.manage);$('manageTab').classList.toggle('active',state.manage);
  $('libraryTab').setAttribute('aria-pressed',String(!state.manage));$('manageTab').setAttribute('aria-pressed',String(state.manage));
  $('management').hidden=!state.manage;$('importActions').hidden=!state.manage;$('viewTitle').textContent=state.manage?'素材管理':state.view==='results'?'查找结果':folderName(selectedFolder,folderNames);
  $('viewKicker').textContent=libraryLoading&&!list.length?'正在读取素材库…':state.manage?`${list.length} 张素材 · 仅管理当前浏览器`:state.view==='results'?`${list.length} 个候选 · 请核对画面与文字版本`:selectedFolder.length?`${displayFolderPath(selectedFolder)} · ${list.length} 张图片`:`${list.length.toLocaleString()} 张图片`;
  $('allView').classList.toggle('active',state.view==='all');$('resultsView').classList.toggle('active',state.view==='results');
  $('allView').setAttribute('aria-selected',String(state.view==='all'));$('resultsView').setAttribute('aria-selected',String(state.view==='results'));
  $('grid').replaceChildren();
  for(const a of current){
    const card=document.createElement('article');card.className='card';
    if(state.manage){const check=document.createElement('input');check.type='checkbox';check.className='select-box';check.checked=state.selected.has(a.id);check.setAttribute('aria-label','选择 '+a.name);check.onchange=()=>{check.checked?state.selected.add(a.id):state.selected.delete(a.id);updateSelection(current);};card.append(check);}
    const imageButton=document.createElement('button');imageButton.className='card-image';imageButton.setAttribute('aria-label','查看 '+a.name);
    const img=new Image();
    img.loading='lazy';img.referrerPolicy='no-referrer';img.alt=a.name;
    img.addEventListener('error',()=>{
      const fallback=document.createElement('span');
      fallback.className='preview-unavailable';
      fallback.textContent='预览暂不可用';
      img.replaceWith(fallback);
    },{once:true});
    img.src=a.blob?URL.createObjectURL(a.blob):a.imageUrl;
    if(a.blob)objectUrls.push(img.src);
    imageButton.append(img);imageButton.onclick=()=>openDetail(a.id);
    const body=document.createElement('div');body.className='card-body';const name=document.createElement('button');name.className='card-title';name.textContent=a.name;name.title=a.name;name.onclick=()=>openDetail(a.id);
    const heading=document.createElement('div');heading.className='card-heading';const edit=document.createElement('button');edit.className='card-edit';edit.textContent='编辑';edit.setAttribute('aria-label','编辑'+a.name+'的链接');edit.onclick=()=>openDetail(a.id);heading.append(name,edit);body.append(heading);
    const meta=document.createElement('p');meta.className='meta';meta.textContent=a.cloud?`COS 原图 · ${Math.round(a.size/1024)} KB`:`${a.features.width} × ${a.features.height} · ${Math.round(a.size/1024)} KB`;body.append(meta);
    if(a.evidence){const evidence=document.createElement('div');evidence.className='evidence';evidence.textContent=`${a.evidence.engine==='ORB'?'快速匹配':'LightGlue'} · 几何验证 ${a.evidence.inliers} 个点`;body.append(evidence);}
    if(a.cloud){
      edit.hidden=true;
      if(cloudGallery){
        const actions=document.createElement('div');
        actions.className='cos-asset-actions';
        if(cloudPhotoshop)actions.append(cloudActionButton(a,'导入 PS','photoshop'));
        actions.append(cloudActionButton(a,'下载原图','download'));
        body.append(actions);
      }
    }
    else {const locations=document.createElement('div');locations.className='card-locations';locations.append(locationRow(a,'CCH 链接',a.cch,'cchInput'),locationRow(a,'公盘路径',a.shared,'sharedInput'));body.append(locations);}
    card.append(imageButton,body);$('grid').append(card);
  }
  $('skeleton').hidden=!libraryLoading||list.length>0;
  $('grid').setAttribute('aria-busy',String(libraryLoading));
  $('empty').hidden=libraryLoading||list.length>0;
  $('pagination').hidden=!list.length;
  $('emptyImport').hidden=state.assets.length>0;
  $('emptyTitle').textContent=!state.assets.length?'建立你的第一份素材库':state.view==='results'?'没有找到足够匹配的素材':'没有匹配的素材';
  $('emptyNote').textContent=!state.assets.length?'导入拾盘 ZIP 素材包，或添加本地图片。之后就能用截图找回素材。':state.view==='results'?'点击“LightGlue 精细匹配”继续查找，或换一张更清晰的截图。':'换一个名称或路径试试。';
  $('summary').textContent=`共 ${state.assets.length.toLocaleString()} 张 · 当前视图 ${list.length.toLocaleString()} 张`;
  $('pageInfo').textContent=`${state.page} / ${pages}`;$('prev').disabled=state.page===1;$('next').disabled=state.page===pages;
  updateSelection(current);updateButtons();
}
function updateSelection(current=filtered().slice((state.page-1)*pageSize,state.page*pageSize)){
  const n=current.filter(a=>state.selected.has(a.id)).length;$('selectPage').checked=current.length>0&&n===current.length;$('selectPage').indeterminate=n>0&&n<current.length;$('selectPage').disabled=!current.length||state.busy;$('selectedCount').textContent=`已选 ${state.selected.size} 张`;$('deleteSelected').disabled=!state.selected.size||state.busy;
}
async function syncIndex(){await rpc('init',{records:state.assets.map(a=>({id:a.id,features:a.features,imageUrl:a.imageUrl,blob:a.blob})),shared:sharedGallery?{version:sharedGallery.version,shards:sharedGallery.shards,lightglue:sharedGallery.lightglue}:null},progress);}
function sortAssets(assets){return assets.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true})||a.path.localeCompare(b.path));}
async function reloadAssets(){const overrides=await allAssets(),hidden=await hiddenIds(),merged=new Map((sharedGallery?.assets||[]).map(a=>[a.id,a]));for(const a of overrides)merged.set(a.id,{...merged.get(a.id),...a});state.assets=sortAssets([...merged.values()].filter(a=>!hidden.has(a.id)).concat(cloudAssets));}
async function load(){
  [sharedGallery,cloudGallery]=await Promise.all([
    fetchSharedGallery(),
    createCosGallery().catch(error=>{console.warn(error.message);return null;})
  ]);
  const reconnect=cloudGallery?.local&&cloudGallery.canResume;
  let message='';
  if(reconnect||sharedGallery){
    beginTask(reconnect?'正在恢复 COS 素材库':'准备共享素材库');
    $('cancelTask').hidden=true;
  }
  try{
    let catalog;
    if(reconnect){
      try{catalog=await cloudGallery.catalog();}
      catch(error){message='COS 未能自动连接。'+error.message;}
    }
    if(!catalog){
      try{catalog=await fetchCosSnapshot();}
      catch(error){message=[message,error.message].filter(Boolean).join(' ');}
    }
    await updateCloudCatalog(catalog||{assets:[],expires:0});
    state.ready=true;
  }finally{endTask();}
  return message;
}

async function updateCloudCatalog(catalog) {
  usingSnapshot=Boolean(catalog.snapshot);
  cloudExpires=catalog.expires;
  cloudAssets=catalog.assets;
  cloudPhotoshop=Boolean(catalog.photoshop);
  cloudCanSync=Boolean(catalog.canSync);
  const versions=new Map(cloudAssets.map(asset=>[asset.id,asset.version]));
  for(const [id,entry] of cloudFeatures)if(versions.get(id)!==entry.version)cloudFeatures.delete(id);
  for(const asset of cloudAssets)asset.features=cloudFeatures.get(asset.id)?.features;
  await reloadAssets();
  await syncIndex();
}

async function prepareCloudIndex() {
  if(!cloudAssets.length)return 0;
  if(!usingSnapshot&&cloudExpires-Date.now()<60_000)await updateCloudCatalog(await cloudGallery.catalog());
  const remaining=cloudAssets.filter(asset=>!asset.features);
  if(!remaining.length)return 0;

  const controller=new AbortController();
  cloudIndexAbort=controller;
  let cursor=0, done=0, skipped=0;
  progress(0,`建立 COS 缩略图索引 0 / ${remaining.length}`);
  async function indexBatch() {
    while(cursor<remaining.length&&!state.cancelled){
      const asset=remaining[cursor++];
      try{
        const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(60000)]);
        const response=await fetch(asset.imageUrl,{signal,referrerPolicy:'no-referrer',mode:'cors'});
        if(!response.ok)throw new Error('缩略图读取失败');
        const features=await rpc('features',{blob:await response.blob()});
        cloudFeatures.set(asset.id,{version:asset.version,features});
        asset.features=features;
      }catch{skipped++;}
      done++;
      progress(done/remaining.length*100,`建立 COS 缩略图索引 ${done} / ${remaining.length}`);
    }
  }
  try{
    await Promise.all([indexBatch(),indexBatch(),indexBatch()]);
  }finally{
    cloudIndexAbort=null;
    await syncIndex();
  }
  if(state.cancelled)throw new Error('检索已取消。');
  return skipped;
}

async function renewVisibleCloudGallery(){
  if(usingSnapshot||document.hidden||state.busy||!state.ready||!cloudGallery?.connected||cloudExpires-Date.now()>60_000)return;
  beginTask('正在恢复 COS 素材库');
  $('cancelTask').hidden=true;
  try{
    await updateCloudCatalog(await cloudGallery.catalog());
    render();
  }catch(error){notice('COS 素材库暂时无法更新。'+error.message,true);}
  finally{endTask();}
}
window.addEventListener('focus',renewVisibleCloudGallery);
document.addEventListener('visibilitychange',renewVisibleCloudGallery);

const cloudDialog=$('cloudDialog'), cloudForm=$('cloudForm'), cloudMessage=$('cloudMessage');
function updateCloudDialog() {
  const connected=cloudGallery?.connected;
  for(const id of ['cloudCode','cloudLabel','cloudConnect'])$(id).hidden=connected;
  for(const id of ['cloudUsage','cloudDisconnect'])$(id).hidden=!connected;
  cloudMessage.textContent=usingSnapshot&&!cloudGallery?.local
    ?(connected?'原图服务已连接。':'请输入团队访问码以下载原图。')
    :connected?`已连接，共 ${cloudAssets.length.toLocaleString()} 张素材。`:'请输入团队图库访问码。';
}
$('cloudAccess').onclick=()=>{
  if(state.busy||!cloudGallery)return;
  updateCloudDialog();
  cloudDialog.showModal();
};
$('cloudClose').onclick=()=>cloudDialog.close();
let pendingCloudAction=null;
cloudDialog.addEventListener('close',()=>{cloudForm.reset();pendingCloudAction=null;});
cloudForm.onsubmit=async event=>{
  event.preventDefault();
  if(state.busy||cloudGallery.connected)return;
  $('cloudConnect').disabled=true;
  const originalsOnly=usingSnapshot&&!cloudGallery.local;
  cloudMessage.textContent=originalsOnly?'正在验证原图访问权限…':'正在读取 COS 素材目录…';
  beginTask('正在连接 COS 素材库');
  $('cancelTask').hidden=true;
  try{
    const access=$('cloudCode').value.trim();
    if(originalsOnly)await cloudGallery.authorize(access);
    else await updateCloudCatalog(await cloudGallery.catalog(access));
    const requested=pendingCloudAction;
    cloudDialog.close();
    if(!originalsOnly){
      selectedFolder=[];
      state.view='all';
      state.page=1;
    }
    render();
    notice(originalsOnly?'原图服务已连接。':`已连接 COS 素材库 · ${cloudAssets.length} 张图片。`);
    if(requested)await runCloudAction(requested.asset,requested.action,requested.label,requested.button);
  }catch(error){cloudMessage.textContent=error.message;}
  finally{
    $('cloudConnect').disabled=false;
    endTask();
  }
};
$('cloudUsage').onclick=async()=>{
  try{
    const usage=await cloudGallery.usage();
    const since=new Date(usage.startedAt).toLocaleString('zh-CN');
    const imported=Number.isInteger(usage.psOriginalReads)?`，为导入 PS 读取原图 ${usage.psOriginalReads} 次`:'';
    cloudMessage.textContent=`${since} 起，尝试读取目录 ${usage.list} 次，尝试读取缩略图来源 ${usage.thumbnail} 次，签发原图链接 ${usage.originalLinks} 次${imported}。实际计费用量见腾讯云控制台。`;
  }catch(error){cloudMessage.textContent=error.message;}
};
$('cloudDisconnect').onclick=async()=>{
  if(state.busy)return;
  beginTask('正在断开 COS 素材库');
  $('cancelTask').hidden=true;
  try{
    cloudGallery.disconnect();
    if(!usingSnapshot){
      const snapshot=await fetchCosSnapshot();
      await updateCloudCatalog(snapshot||{assets:[],expires:0});
      state.results=state.results.filter(result=>state.assets.some(asset=>asset.id===result.id));
      state.view='all';
      selectedFolder=[];
      state.page=1;
    }
    cloudDialog.close();
    render();
    notice('');
  }catch(error){cloudMessage.textContent=error.message;}
  finally{endTask();}
};
async function importRecords(records,skipped=0,partial=false){
  const existing=new Map(state.assets.map(a=>[a.id,a])),prepared=new Map();let damaged=0;
  for(let i=0;i<records.length;i++){
    if(state.cancelled)throw new Error('导入已取消，图库未写入。');
    const record=records[i];
    progress(i/records.length*100,`建立图片索引 ${i+1} / ${records.length}`);
    try{record.features=await rpc('features',{blob:record.blob});const old=existing.get(record.id);if(old)record.cch=record.cch||old.cch;prepared.set(record.id,record);}catch(error){damaged++;console.warn('跳过无效图片',record.name,error.message);}
  }
  if(state.cancelled)throw new Error('导入已取消，图库未写入。');
  if(!prepared.size)throw new Error(`没有可导入的有效图片。跳过 ${skipped+damaged} 条。`);
  progress(100,'保存到当前浏览器…');$('cancelTask').hidden=true;
  await putAssets([...prepared.values()]);
  const added=[...prepared.keys()].filter(id=>!existing.has(id)).length;
  await reloadAssets();await syncIndex();state.page=1;state.view='all';render();
  navigator.storage?.persist?.().catch(()=>{});
  notice(`导入完成：新增 ${added} 张，更新 ${prepared.size-added} 张，跳过 ${skipped+damaged} 条。${partial?'素材包是中途停止扫描的部分结果。':''}`);
}
async function importZip(file){if(!file||state.busy)return;beginTask('导入素材包','正在读取清单和缩略图…');notice('');try{const bundle=await readBundle(file);await importRecords(bundle.records,bundle.skipped,bundle.partial);if(Object.keys(bundle.folderNames).length)saveFolderNames({...folderNames,...bundle.folderNames});selectedFolder=bundle.records[0]?.folders?.slice(0,1)||[];state.view='all';state.page=1;render();}catch(error){notice(error.message,true);}finally{endTask();renderFolders();$('bundleInput').value='';}}
async function importImages(files){if(!files.length||state.busy)return;beginTask('添加本地图片');try{const records=[];for(const file of files){if(state.cancelled)throw new Error('导入已取消。');records.push(await imageRecord(file));}await importRecords(records);}catch(error){notice(error.message,true);}finally{endTask();$('imagesInput').value='';}}
async function search(mode='quick'){
  if(!state.query||state.busy)return;if(!state.assets.length){notice('请先导入素材。',true);return;}if(!state.ready){notice('检索引擎正在准备，请稍候。');return;}
  const full=mode==='full';if(mode==='quick'){$('fullSearch').hidden=true;state.quickReady=false;}
  beginTask(full?'全库精细匹配':mode==='quick'?'快速查找素材':'LightGlue 精细匹配','图片在当前浏览器中比对…');notice('');
  try{const skipped=await prepareCloudIndex();const result=await rpc('search',{blob:state.query,queryKey:state.queryKey,mode,full},progress);state.results=result.results;state.quickReady=!result.reason;state.view='results';state.page=1;$('filter').value='';render();
    notice(result.reason||(mode==='quick'?`快速匹配：比对 ${result.candidates} / ${result.total} 张素材，用时 ${result.seconds.toFixed(1)} 秒，找到 ${result.results.length} 个候选。没有找到或结果不满意，可点击“LightGlue 精细匹配”。`:`LightGlue-ONNX · ${result.provider}：比对 ${result.candidates} / ${result.total} 张素材，用时 ${result.seconds.toFixed(1)} 秒，找到 ${result.results.length} 个候选。${full?'':'可进行全库精细匹配以核对未进入候选集的图片。'}`));
    $('fullSearch').hidden=mode==='quick'||full||Boolean(result.reason);
    if(skipped)$('status').textContent+=` · ${skipped} 张 COS 缩略图读取失败，本次已跳过。`;
  }catch(error){notice(error.message,true);}finally{endTask();}
}
function useQuery(file){if(!file)return;if(file.size>15*1024*1024){notice('查询图片不能超过 15 MB。',true);return;}if(!['image/jpeg','image/png','image/webp'].includes(file.type)){notice('请选择 JPG、PNG 或 WebP 图片。',true);return;}if(!state.ready){waitingQuery=file;notice('截图已接收，图库准备好后会自动查找。');return;}if(state.busy){notice('正在处理素材，请稍后重新粘贴图片。',true);return;}
  state.query=file;state.queryKey++;state.quickReady=false;state.results=[];$('fullSearch').hidden=true;if(queryUrl)URL.revokeObjectURL(queryUrl);queryUrl=URL.createObjectURL(file);$('queryPreview').src=queryUrl;$('queryName').textContent=file.name||'粘贴的截图';$('queryBox').hidden=false;$('dropzone').hidden=true;updateButtons();search();
}
function openDetail(id){
  state.detail=state.assets.find(a=>a.id===id);
  const asset=state.detail;
  if(!asset)return;
  if(detailUrl)URL.revokeObjectURL(detailUrl);
  detailUrl=asset.blob?URL.createObjectURL(asset.blob):null;
  const image=detailUrl||asset.imageUrl;
  $('detailTitle').textContent=asset.name;
  $('detailImage').referrerPolicy='no-referrer';
  $('detailImage').src=image;
  $('detailMeta').textContent=asset.cloud?'COS 缩略图':`${asset.features.width} × ${asset.features.height} · ${asset.online?'共享图库缩略图':asset.imported?'素材包缩略图':'本地图片预览'}`;
  const download=$('download');
  download.hidden=Boolean(asset.cloud);
  const actions=$('detailCloudActions');
  actions.replaceChildren();
  actions.hidden=!asset.cloud||!cloudGallery;
  if(asset.cloud&&cloudGallery){
    if(cloudPhotoshop)actions.append(cloudActionButton(asset,'导入 PS','photoshop'));
    actions.append(cloudActionButton(asset,'下载原图','download'));
  }else if(!asset.cloud){
    download.href=image;
    download.download=asset.name.replace(/\.[^.]+$/,'')+'.jpg';
    download.textContent='下载缩略图';
  }
  $('linksForm').hidden=Boolean(asset.cloud);
  const catalogPath=asset.cloud&&usingSnapshot;
  $('originalPath').parentElement.querySelector('label').textContent=catalogPath?'图库内路径':'原文件路径';
  $('copyOriginal').textContent=catalogPath?'复制图库内路径':'复制原文件地址';
  $('originalPath').textContent=asset.path;
  $('sharedInput').value=asset.shared;
  $('cchInput').value=asset.cch;
  updateCch(asset.cch);
  $('detail').showModal();
}
const activeCloudActions=new Set();
function cloudActionButton(asset,label,action){
  const button=document.createElement('button');
  button.type='button';
  button.className=action==='photoshop'?'primary':'secondary';
  button.textContent=label;
  button.setAttribute('aria-label',label+' '+asset.name);
  if(!cloudGallery){
    button.textContent='原图暂未接入';
    button.disabled=true;
    button.title='网站尚未配置原图下载服务';
    return button;
  }
  button.onclick=()=>runCloudAction(asset,action,label,button);
  return button;
}
async function runCloudAction(asset,action,label,button){
  if(!cloudGallery.connected){
    pendingCloudAction={asset,action,label,button};
    updateCloudDialog();
    cloudDialog.showModal();
    return;
  }
  const key=action==='photoshop'?'photoshop':asset.cloudId;
  if(activeCloudActions.has(key)){
    toast(action==='photoshop'?'已有素材在导入 PS，请稍候。':'正在准备这张原图，请稍候。');
    return;
  }
  activeCloudActions.add(key);
  button.disabled=true;
  button.textContent=action==='photoshop'?'正在导入…':'正在获取…';
  try{
    if(action==='photoshop'){
      const result=await cloudGallery.importToPs(asset.cloudId);
      toast('已导入 PS：'+result.documentName+' / '+result.boardName);
      return;
    }
    const url=await cloudGallery.original(asset.cloudId);
    const link=document.createElement('a');
    link.href=url;
    link.download=asset.name;
    link.rel='noreferrer';
    document.body.append(link);
    link.click();
    link.remove();
  }catch(error){toast(error.message);}
  finally{
    activeCloudActions.delete(key);
    button.disabled=false;
    button.textContent=label;
  }
}
function updateCch(value){const url=validCch(value);$('openCch').hidden=!url;$('openCch').href=url||'#';}
$('linksForm').onsubmit=async e=>{e.preventDefault();if(!state.detail||state.detail.cloud)return;const raw=$('cchInput').value.trim(),cch=validCch(raw);if(raw&&!cch){toast('CCH 链接需要使用 http 或 https。');return;}const updated={...state.detail,cch,shared:$('sharedInput').value.trim()};try{await putAssets([updated]);state.assets=state.assets.map(a=>a.id===updated.id?updated:a);state.detail=updated;updateCch(cch);render();toast('素材位置已保存。');}catch(error){toast('保存失败：'+error.message);}};
$('copyOriginal').onclick=()=>copy(state.detail?.path);$('copyShared').onclick=()=>copy($('sharedInput').value.trim());$('closeDetail').onclick=()=>$('detail').close();
$('detail').addEventListener('close',()=>{if(detailUrl)URL.revokeObjectURL(detailUrl);detailUrl=null;state.detail=null;});
$('importButton').onclick=$('emptyImport').onclick=()=>$('bundleInput').click();$('bundleInput').onchange=()=>importZip($('bundleInput').files[0]);
$('addImages').onclick=()=>$('imagesInput').click();$('imagesInput').onchange=()=>importImages([...$('imagesInput').files]);
$('dropzone').onclick=$('replaceQuery').onclick=()=>$('queryInput').click();$('queryInput').onchange=()=>{useQuery($('queryInput').files[0]);$('queryInput').value='';};
$('searchAgain').onclick=()=>search();
const refineSearch=document.createElement('button');refineSearch.id='refineSearch';refineSearch.className='primary';refineSearch.textContent='LightGlue 精细匹配';refineSearch.hidden=true;refineSearch.onclick=()=>search('fine');$('status').after(refineSearch);
const fullSearch=document.createElement('button');fullSearch.id='fullSearch';fullSearch.className='secondary';fullSearch.textContent='全库精细匹配';fullSearch.hidden=true;fullSearch.onclick=()=>search('full');refineSearch.after(fullSearch);
$('clearQuery').onclick=()=>{if(state.busy)return;state.query=null;state.quickReady=false;state.results=[];state.view='all';$('queryBox').hidden=true;$('dropzone').hidden=false;$('fullSearch').hidden=true;if(queryUrl)URL.revokeObjectURL(queryUrl);queryUrl=null;notice('');render();};
for(const event of ['dragenter','dragover'])$('dropzone').addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.add('drag');});
$('dropzone').ondragleave=()=>$('dropzone').classList.remove('drag');$('dropzone').ondrop=e=>{e.preventDefault();$('dropzone').classList.remove('drag');if(e.dataTransfer.files[0])useQuery(e.dataTransfer.files[0]);};
document.addEventListener('paste',e=>{if(document.querySelector('dialog[open]'))return;const image=[...(e.clipboardData?.items||[])].find(i=>i.type.startsWith('image/'))?.getAsFile()||[...(e.clipboardData?.files||[])].find(f=>f.type.startsWith('image/'));if(image){e.preventDefault();useQuery(image);}});
$('pasteQuery').onclick=async()=>{if(!navigator.clipboard?.read){notice('请按 Ctrl+V 粘贴，或点击上方选择图片。',true);return;}try{const items=await navigator.clipboard.read();for(const item of items){const type=['image/png','image/jpeg','image/webp'].find(t=>item.types.includes(t));if(type){const blob=await item.getType(type);useQuery(new File([blob],'粘贴的截图.'+type.split('/')[1],{type}));return;}}notice('剪贴板中没有图片。请先复制图片，或点击上方选择图片。',true);}catch{notice('浏览器未允许读取剪贴板。请按 Ctrl+V 粘贴，或点击上方选择图片。',true);}};
$('libraryTab').onclick=()=>{state.manage=false;render();};$('manageTab').onclick=()=>{state.manage=true;state.view='all';render();};
$('folderDisclosure').onclick=event=>{
  const button=event.currentTarget;
  button.setAttribute('aria-expanded',String(button.getAttribute('aria-expanded')!=='true'));
};
$('cancelFolderRename').onclick=()=>$('renameFolderDialog').close();
$('renameFolderDialog').addEventListener('close',()=>{renamingFolder=null;});
$('renameFolderForm').onsubmit=e=>{
  e.preventDefault();if(!renamingFolder||state.busy)return;const name=$('folderNameInput').value.trim();
  if(!validFolders([name])){$('folderRenameError').textContent='请输入 1–255 个字符，名称不能含 /、\\，也不能是 . 或 ..。';return;}
  let parent=folderModel.root;for(const part of renamingFolder.slice(0,-1))parent=parent.children.get(part);
  if([...parent.children.values()].some(node=>folderKey(node.parts)!==folderKey(renamingFolder)&&folderName(node.parts,folderNames).toLowerCase()===name.toLowerCase())){$('folderRenameError').textContent='同一层已有这个名称，请换一个名称。';return;}
  const names={...folderNames},key=folderKey(renamingFolder);if(name===renamingFolder.at(-1))delete names[key];else names[key]=name;
  try{saveFolderNames(names);$('renameFolderDialog').close();render();toast('文件夹名称已保存。');}catch{$('folderRenameError').textContent='保存失败，请检查浏览器是否允许本地存储。';}
};
$('refresh').onclick=async()=>{if(state.busy)return;beginTask('刷新素材库');$('cancelTask').hidden=true;try{
  sharedGallery=await fetchSharedGallery();
  const sync=cloudGallery?.connected&&cloudCanSync;
  if(usingSnapshot||!cloudGallery?.connected){
    const snapshot=await fetchCosSnapshot();
    if(usingSnapshot&&!snapshot)throw new Error('网站缩略图库暂时无法读取，请稍后重试。');
    await updateCloudCatalog(snapshot||{assets:[],expires:0});
  }
  else await updateCloudCatalog(await cloudGallery.catalog(undefined,{refresh:sync}));
  state.page=1;render();
  if(usingSnapshot)notice(`网站缩略图库已更新 · ${cloudAssets.length.toLocaleString()} 张图片。`);
  else if(cloudGallery?.connected)notice(sync
    ?`已从 COS 同步目录 · ${cloudAssets.length.toLocaleString()} 张图片。新增缩略图将在后台生成。`
    :`已读取图库缓存 · ${cloudAssets.length.toLocaleString()} 张图片。`);
  else notice(sharedGallery?'共享图库已更新。':'已重新读取当前浏览器的素材库。');
}catch(error){notice(error.message,true);}finally{endTask();}};
$('allView').onclick=()=>{state.view='all';state.page=1;render();};$('resultsView').onclick=()=>{state.view='results';state.page=1;render();};
$('filter').oninput=()=>{state.page=1;state.selected.clear();render();};$('prev').onclick=()=>{state.page--;render();};$('next').onclick=()=>{state.page++;render();};
$('selectPage').onchange=()=>{for(const a of filtered().slice((state.page-1)*pageSize,state.page*pageSize))$('selectPage').checked?state.selected.add(a.id):state.selected.delete(a.id);render();};$('selectAll').onclick=()=>{state.selected=new Set(filtered().map(a=>a.id));render();};
$('deleteSelected').onclick=()=>{$('deleteNote').textContent=`将从此浏览器中移除 ${state.selected.size} 张素材。`; $('deleteDialog').showModal();};$('cancelDelete').onclick=()=>$('deleteDialog').close();
$('confirmDelete').onclick=async()=>{if(state.busy)return;beginTask('删除所选素材');$('cancelTask').hidden=true;try{await removeAssets([...state.selected]);state.assets=state.assets.filter(a=>!state.selected.has(a.id));state.results=state.results.filter(a=>!state.selected.has(a.id));state.selected.clear();await syncIndex();$('deleteDialog').close();render();notice('所选素材已从当前浏览器移除。');}catch(error){toast(error.message);}finally{endTask();}};
$('exportButton').onclick=async()=>{if(state.busy)return;beginTask('导出完整备份','备份包含图片、名称、路径和 CCH 链接。');$('cancelTask').hidden=true;try{const records=[],assets=visibleAssets();for(let i=0;i<assets.length;i++){const a=assets[i];records.push({...a,blob:await assetBlob(a)});progress(i/assets.length*100,`读取图片 ${i+1} / ${assets.length}`);}const blob=await exportBundle(records.map(a=>({...a,folders:assetFolders(a,folderModel.base)})),progress,folderNames),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='图迹备份-'+new Date().toISOString().slice(0,10)+'.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);notice('备份包已生成。请保存到安全位置，以便迁移和恢复。');}catch(error){notice(error.message,true);}finally{endTask();}};
$('cancelTask').onclick=()=>{state.cancelled=true;cloudIndexAbort?.abort();worker.postMessage({type:'cancel'});$('cancelTask').disabled=true;$('taskNote').textContent='正在取消，请稍候…';};
window.addEventListener('beforeunload',event=>{if(state.busy){event.preventDefault();event.returnValue='';}});
notice('正在准备本机素材库与检索引擎…');
load().finally(()=>{
  libraryLoading=false;
  render();
}).then(message=>{
  const queued=waitingQuery;
  waitingQuery=null;
  if(queued)useQuery(queued);
  else notice(message,Boolean(message));
}).catch(error=>notice('启动失败：'+error.message,true));
