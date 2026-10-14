import './vendor/fflate.js';
import {assignBundleFolders,validFolders,cleanFolderNames} from './folders.js?v=20261014-fluid';
const MAX_BUNDLE=200*1024*1024,MAX_UNPACKED=512*1024*1024;
export async function identity(path) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(path.replaceAll('/','\\').toLowerCase()));
  return 'asset-'+[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);
}
function validateZipHeaders(bytes) {
  // Read central-directory sizes before inflating. ZIP64/encrypted archives are not supported.
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let end=-1;
  for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--) if(view.getUint32(p,true)===0x06054b50){end=p;break;}
  if(end<0) throw new Error('ZIP 结构无效。');
  const count=view.getUint16(end+10,true),offset=view.getUint32(end+16,true);
  if(count>20002 || count===65535 || view.getUint16(end+4,true)!==0 || view.getUint16(end+6,true)!==0) throw new Error('不支持分卷或超大 ZIP，请分批导入。');
  let p=offset,total=0;const names=new Set();
  for(let i=0;i<count;i++) {
    if(p+46>bytes.length || view.getUint32(p,true)!==0x02014b50) throw new Error('ZIP 目录损坏。');
    const flags=view.getUint16(p+8,true),size=view.getUint32(p+24,true),len=view.getUint16(p+28,true),extra=view.getUint16(p+30,true),comment=view.getUint16(p+32,true);
    if(flags&1 || size===0xffffffff) throw new Error('不支持加密或 ZIP64 素材包。');
    if(p+46+len+extra+comment>bytes.length) throw new Error('ZIP 目录不完整。');
    const name=new TextDecoder().decode(bytes.subarray(p+46,p+46+len));
    if(names.has(name)) throw new Error('ZIP 包含重复文件名。');names.add(name);
    total+=size;if(total>MAX_UNPACKED) throw new Error('解压后超过 512 MB，请分批导入。');
    if(name==='manifest.json' && size>20*1024*1024) throw new Error('素材清单超过 20 MB。');
    if(name.startsWith('thumbnails/') && size>15*1024*1024) throw new Error('单张缩略图超过 15 MB。');
    p+=46+len+extra+comment;
  }
}
export async function readBundle(file) {
  if(file.size>MAX_BUNDLE) throw new Error('素材包超过 200 MB，请分批导入。');
  const bytes=new Uint8Array(await file.arrayBuffer());validateZipHeaders(bytes);
  const files=await new Promise((resolve,reject)=>fflate.unzip(bytes,{filter:entry=>entry.name==='manifest.json'||entry.name.startsWith('thumbnails/')},(error,result)=>error?reject(error):resolve(result)));
  if(!files['manifest.json']) throw new Error('ZIP 根目录缺少 manifest.json，请选择拾盘素材包或图迹备份包。');
  const manifest=JSON.parse(new TextDecoder().decode(files['manifest.json']));
  if(manifest.schema_version!==1 || !Array.isArray(manifest.assets)) throw new Error('不支持的素材清单格式。');
  if(manifest.assets.length>10000) throw new Error('每次最多导入 10000 张素材，请分批导入。');
  let skipped=0;const records=[];
  for(const row of manifest.assets) {
    if(!row || row.status!=='缩略图就绪' || !row.thumbnail){skipped++;continue;}
    if(typeof row.path!=='string'||!row.path||row.path.length>4096||typeof row.name!=='string'||!row.name||row.name.length>1024) throw new Error('素材名称或路径无效。');
    if(typeof row.thumbnail!=='string'||!row.thumbnail.startsWith('thumbnails/')||row.thumbnail.includes('\\')||row.thumbnail.split('/').includes('..')) throw new Error('素材缩略图路径无效。');
    const content=files[row.thumbnail];if(!content)throw new Error('缺少缩略图：'+row.name);
    const backup=manifest.source==='tuji-browser-backup';
    records.push({id:backup&&/^asset-[0-9a-f]{32}$/.test(row.id)?row.id:await identity(row.path),name:row.name,path:row.path,shared:String(row.folder_path||row.shared||''),cch:validCch(row.cch),folders:backup&&validFolders(row.folders)?row.folders:undefined,imported:backup?Boolean(row.imported):true,blob:new Blob([content],{type:'image/jpeg'}),size:content.length});
  }
  const folderName=assignBundleFolders(file.name,records,manifest.source==='tuji-browser-backup');
  return {records,skipped,partial:Boolean(manifest.partial),folderName,folderNames:manifest.source==='tuji-browser-backup'?cleanFolderNames(manifest.folder_names):{}};
}
export function validCch(value) {
  if(!value)return '';try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:'';}catch{return '';}
}
export async function exportBundle(records,onProgress,folderNames={}) {
  if(records.length>10000) throw new Error('单个备份包最多 10000 张，请先分批管理图库。');
  const files={},assets=[];let total=0;
  for(let i=0;i<records.length;i++) {
    const a=records[i],thumbnail=`thumbnails/${a.id}.jpg`,bytes=new Uint8Array(await a.blob.arrayBuffer());
    total+=bytes.length;if(total>190*1024*1024)throw new Error('备份超过 190 MB，请分批管理素材后导出。');
    files[thumbnail]=bytes;
    assets.push({id:a.id,name:a.name,path:a.path,shared:a.shared,folder_path:a.shared,folders:a.folders,cch:a.cch,imported:a.imported,extension:'.jpg',thumbnail,status:'缩略图就绪'});
    onProgress?.((i+1)/records.length*100);
  }
  files['manifest.json']=new TextEncoder().encode(JSON.stringify({schema_version:1,source:'tuji-browser-backup',folder_names:cleanFolderNames(folderNames),exported_at:new Date().toISOString(),assets},null,2));
  const bytes=await new Promise((resolve,reject)=>fflate.zip(files,{level:0},(error,data)=>error?reject(error):resolve(data)));
  return new Blob([bytes],{type:'application/zip'});
}
export async function imageRecord(file) {
  if(file.size>15*1024*1024) throw new Error(file.name+' 超过 15 MB。');
  const bitmap=await createImageBitmap(file);
  try {
    if(bitmap.width*bitmap.height>35000000)throw new Error('图片超过 3500 万像素。');
    const ratio=Math.min(1,640/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9));if(!blob)throw new Error('图片解码失败。');
    const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer()),key=[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
    return {id:await identity('local:'+file.name+':'+key),name:file.name,path:'本地图片 / '+file.name,shared:'',cch:'',imported:false,blob,size:blob.size};
  } finally {bitmap.close();}
}
