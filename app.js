import {allAssets,putAssets,removeAssets,hiddenIds} from './db.js';
import {readBundle,exportBundle,imageRecord,validCch} from './bundle.js?v=20261014-fluid';
import {fetchSharedGallery,assetBlob} from './shared-gallery.js';
import {buildFolders,folderKey,inFolder,assetFolders,commonDirectory,folderName,cleanFolderNames,validFolders} from './folders.js?v=20261014-fluid';
const $=id=>document.getElementById(id),state={assets:[],results:[],view:'all',manage:false,page:1,selected:new Set(),query:null,queryKey:0,quickReady:false,busy:false,ready:false,cancelled:false,detail:null};
const pageSize=36,worker=new Worker(new URL('./search-worker.js?v=20261014-fluid',import.meta.url)),pending=new Map();
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
function filtered(){const q=$('filter').value.trim().toLowerCase();const list=state.view==='results'?state.results.map(r=>{const a=state.assets.find(a=>a.id===r.id);return a?{...a,evidence:r}:null;}).filter(Boolean):state.assets;return list.filter(a=>(state.view==='results'||inFolder(a,selectedFolder,folderModel.base))&&(a.name+' '+a.path+' '+a.shared).toLowerCase().includes(q));}
function renderFolders(){
  folderModel=buildFolders(state.assets,commonDirectory(sharedGallery?.assets||[]));const container=$('folderTree');container.replaceChildren();
  const choose=parts=>{if(state.busy)return;selectedFolder=parts;state.view='all';state.page=1;state.selected.clear();$('filter').value='';render();};
  const row=(name,parts,count,depth,node)=>{
    if(parts.length)name=folderName(parts,folderNames);
    const line=document.createElement('div');line.className='folder-row';line.style.setProperty('--depth',depth);
    const key=folderKey(parts),open=expandedFolders.has(key),toggle=document.createElement('button');toggle.className='folder-toggle';toggle.disabled=state.busy||!node?.children.size;toggle.textContent=node?.children.size?(open?'▾':'▸'):'';
    if(node?.children.size){toggle.setAttribute('aria-label',(open?'收起 ':'展开 ')+name);toggle.setAttribute('aria-expanded',String(open));toggle.onclick=()=>{open?expandedFolders.delete(key):expandedFolders.add(key);renderFolders();};}
    else toggle.setAttribute('aria-hidden','true');
    const button=document.createElement('button');button.className='folder-item';button.disabled=state.busy;button.classList.toggle('active',folderKey(selectedFolder)===key);button.setAttribute('aria-current',folderKey(selectedFolder)===key?'true':'false');button.title=displayFolderPath(parts)||name;
    const label=document.createElement('span');label.className='folder-label';label.textContent=name;const amount=document.createElement('span');amount.className='folder-count';amount.textContent=count.toLocaleString();button.append(label,amount);button.onclick=()=>choose(parts);line.append(toggle,button);container.append(line);
    if(state.manage&&parts.length){const edit=document.createElement('button');edit.className='folder-edit';edit.textContent='编辑';edit.disabled=state.busy;edit.setAttribute('aria-label','重命名 '+name);edit.onclick=()=>openFolderRename(parts);line.append(edit);}
    if(open&&node)for(const child of [...node.children.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true})))row(child.name,child.parts,child.count,depth+1,child);
  };
  row('全部素材',[],state.assets.length,0,null);
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
  $('count').textContent=state.assets.length.toLocaleString();$('resultCount').textContent=state.results.length;
  $('libraryTab').classList.toggle('active',!state.manage);$('manageTab').classList.toggle('active',state.manage);
  $('management').hidden=!state.manage;$('importActions').hidden=!state.manage;$('viewTitle').textContent=state.manage?'素材管理':state.view==='results'?'查找结果':folderName(selectedFolder,folderNames);
  $('viewKicker').textContent=state.manage?`${list.length} 张素材 · 管理当前浏览器的素材与链接`:state.view==='results'?`${state.results.length} 个候选 · 搜索全部图库 · 请核对画面与文字版本`:selectedFolder.length?`${displayFolderPath(selectedFolder)} · ${list.length} 张图片`:`${state.assets.length} 张图片 · 点击图片查看原图与链接`;
  $('allView').classList.toggle('active',state.view==='all');$('resultsView').classList.toggle('active',state.view==='results');
  $('allView').setAttribute('aria-selected',String(state.view==='all'));$('resultsView').setAttribute('aria-selected',String(state.view==='results'));
  $('grid').replaceChildren();
  for(const a of current){
    const card=document.createElement('article');card.className='card';
    if(state.manage){const check=document.createElement('input');check.type='checkbox';check.className='select-box';check.checked=state.selected.has(a.id);check.setAttribute('aria-label','选择 '+a.name);check.onchange=()=>{check.checked?state.selected.add(a.id):state.selected.delete(a.id);updateSelection(current);};card.append(check);}
    const imageButton=document.createElement('button');imageButton.className='card-image';imageButton.setAttribute('aria-label','查看 '+a.name);
    const img=new Image();img.src=a.blob?URL.createObjectURL(a.blob):a.imageUrl;if(a.blob)objectUrls.push(img.src);img.alt=a.name;img.loading='lazy';imageButton.append(img);imageButton.onclick=()=>openDetail(a.id);
    const body=document.createElement('div');body.className='card-body';const name=document.createElement('button');name.className='card-title';name.textContent=a.name;name.title=a.name;name.onclick=()=>openDetail(a.id);
    const heading=document.createElement('div');heading.className='card-heading';const edit=document.createElement('button');edit.className='card-edit';edit.textContent='编辑';edit.setAttribute('aria-label','编辑'+a.name+'的链接');edit.onclick=()=>openDetail(a.id);heading.append(name,edit);body.append(heading);
    const meta=document.createElement('p');meta.className='meta';meta.textContent=`${a.features.width} × ${a.features.height} · ${Math.round(a.size/1024)} KB`;body.append(meta);
    if(a.evidence){const evidence=document.createElement('div');evidence.className='evidence';evidence.textContent=`${a.evidence.engine==='ORB'?'快速匹配':'LightGlue'} · 几何验证 ${a.evidence.inliers} 个点`;body.append(evidence);}
    const locations=document.createElement('div');locations.className='card-locations';locations.append(locationRow(a,'CCH 链接',a.cch,'cchInput'),locationRow(a,'公盘路径',a.shared,'sharedInput'));body.append(locations);card.append(imageButton,body);$('grid').append(card);
  }
  $('empty').hidden=list.length>0;
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
async function reloadAssets(){const overrides=await allAssets(),hidden=await hiddenIds(),merged=new Map((sharedGallery?.assets||[]).map(a=>[a.id,a]));for(const a of overrides)merged.set(a.id,{...merged.get(a.id),...a});state.assets=sortAssets([...merged.values()].filter(a=>!hidden.has(a.id)));}
async function load(){sharedGallery=await fetchSharedGallery();await reloadAssets();render();if(sharedGallery){beginTask('准备共享素材库','首次访问正在加载预先生成的检索索引…');$('cancelTask').hidden=true;}try{await syncIndex();state.ready=true;}finally{endTask();}render();}
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
  try{const result=await rpc('search',{blob:state.query,queryKey:state.queryKey,mode,full},progress);state.results=result.results;state.quickReady=!result.reason;state.view='results';state.page=1;$('filter').value='';render();
    notice(result.reason||(mode==='quick'?`快速匹配：比对 ${result.candidates} / ${result.total} 张素材，用时 ${result.seconds.toFixed(1)} 秒，找到 ${result.results.length} 个候选。没有找到或结果不满意，可点击“LightGlue 精细匹配”。`:`LightGlue-ONNX · ${result.provider}：比对 ${result.candidates} / ${result.total} 张素材，用时 ${result.seconds.toFixed(1)} 秒，找到 ${result.results.length} 个候选。${full?'':'可进行全库精细匹配以核对未进入候选集的图片。'}`));
    $('fullSearch').hidden=mode==='quick'||full||Boolean(result.reason);
  }catch(error){notice(error.message,true);}finally{endTask();}
}
function useQuery(file){if(!file)return;if(file.size>15*1024*1024){notice('查询图片不能超过 15 MB。',true);return;}if(!['image/jpeg','image/png','image/webp'].includes(file.type)){notice('请选择 JPG、PNG 或 WebP 图片。',true);return;}if(!state.ready){waitingQuery=file;notice('截图已接收，图库准备好后会自动查找。');return;}if(state.busy){notice('正在处理素材，请稍后重新粘贴图片。',true);return;}
  state.query=file;state.queryKey++;state.quickReady=false;state.results=[];$('fullSearch').hidden=true;if(queryUrl)URL.revokeObjectURL(queryUrl);queryUrl=URL.createObjectURL(file);$('queryPreview').src=queryUrl;$('queryName').textContent=file.name||'粘贴的截图';$('queryBox').hidden=false;$('dropzone').hidden=true;updateButtons();search();
}
function openDetail(id){state.detail=state.assets.find(a=>a.id===id);const a=state.detail;if(!a)return;if(detailUrl)URL.revokeObjectURL(detailUrl);detailUrl=a.blob?URL.createObjectURL(a.blob):null;const image=detailUrl||a.imageUrl;$('detailTitle').textContent=a.name;$('detailImage').src=image;$('detailMeta').textContent=`${a.features.width} × ${a.features.height} · ${a.online?'共享图库缩略图':a.imported?'素材包缩略图':'本地图片预览'}`;$('download').href=image;$('download').download=a.name.replace(/\.[^.]+$/,'')+'.jpg';$('download').textContent='下载缩略图';$('originalPath').textContent=a.path;$('sharedInput').value=a.shared;$('cchInput').value=a.cch;updateCch(a.cch);$('detail').showModal();}
function updateCch(value){const url=validCch(value);$('openCch').hidden=!url;$('openCch').href=url||'#';}
$('linksForm').onsubmit=async e=>{e.preventDefault();if(!state.detail)return;const raw=$('cchInput').value.trim(),cch=validCch(raw);if(raw&&!cch){toast('CCH 链接需要使用 http 或 https。');return;}const updated={...state.detail,cch,shared:$('sharedInput').value.trim()};try{await putAssets([updated]);state.assets=state.assets.map(a=>a.id===updated.id?updated:a);state.detail=updated;updateCch(cch);render();toast('素材位置已保存。');}catch(error){toast('保存失败：'+error.message);}};
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
$('refresh').onclick=async()=>{if(state.busy)return;beginTask('刷新素材库');try{sharedGallery=await fetchSharedGallery();await reloadAssets();await syncIndex();state.page=1;render();notice(sharedGallery?'共享图库已更新。':'已重新读取当前浏览器的素材库。');}catch(error){notice(error.message,true);}finally{endTask();}};
$('allView').onclick=()=>{state.view='all';state.page=1;render();};$('resultsView').onclick=()=>{state.view='results';state.page=1;render();};
$('filter').oninput=()=>{state.page=1;state.selected.clear();render();};$('prev').onclick=()=>{state.page--;render();};$('next').onclick=()=>{state.page++;render();};
$('selectPage').onchange=()=>{for(const a of filtered().slice((state.page-1)*pageSize,state.page*pageSize))$('selectPage').checked?state.selected.add(a.id):state.selected.delete(a.id);render();};$('selectAll').onclick=()=>{state.selected=new Set(filtered().map(a=>a.id));render();};
$('deleteSelected').onclick=()=>{$('deleteNote').textContent=`将从此浏览器中移除 ${state.selected.size} 张素材。`; $('deleteDialog').showModal();};$('cancelDelete').onclick=()=>$('deleteDialog').close();
$('confirmDelete').onclick=async()=>{if(state.busy)return;beginTask('删除所选素材');$('cancelTask').hidden=true;try{await removeAssets([...state.selected]);state.assets=state.assets.filter(a=>!state.selected.has(a.id));state.results=state.results.filter(a=>!state.selected.has(a.id));state.selected.clear();await syncIndex();$('deleteDialog').close();render();notice('所选素材已从当前浏览器移除。');}catch(error){toast(error.message);}finally{endTask();}};
$('exportButton').onclick=async()=>{if(state.busy)return;beginTask('导出完整备份','备份包含图片、名称、路径和 CCH 链接。');$('cancelTask').hidden=true;try{const records=[];for(let i=0;i<state.assets.length;i++){const a=state.assets[i];records.push({...a,blob:await assetBlob(a)});progress(i/state.assets.length*100,`读取图片 ${i+1} / ${state.assets.length}`);}const blob=await exportBundle(records.map(a=>({...a,folders:assetFolders(a,folderModel.base)})),progress,folderNames),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='图迹备份-'+new Date().toISOString().slice(0,10)+'.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);notice('备份包已生成。请保存到安全位置，以便迁移和恢复。');}catch(error){notice(error.message,true);}finally{endTask();}};
$('cancelTask').onclick=()=>{state.cancelled=true;worker.postMessage({type:'cancel'});$('cancelTask').disabled=true;$('taskNote').textContent='正在取消，请稍候…';};
window.addEventListener('beforeunload',event=>{if(state.busy){event.preventDefault();event.returnValue='';}});
notice('正在准备本机素材库与检索引擎…');load().then(()=>{const queued=waitingQuery;waitingQuery=null;if(queued)useQuery(queued);else notice('');}).catch(error=>notice('启动失败：'+error.message,true));
