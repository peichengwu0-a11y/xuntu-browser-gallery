export const folderKey=parts=>JSON.stringify(parts);
export function folderName(parts,names={}){return names[folderKey(parts)]||parts.at(-1)||'全部素材';}
export function cleanFolderNames(names){
  const clean={};if(!names||typeof names!=='object'||Array.isArray(names))return clean;
  for(const [key,name] of Object.entries(names).slice(0,10000)){try{const parts=JSON.parse(key);if(validFolders(parts)&&typeof name==='string'&&validFolders([name.trim()]))clean[folderKey(parts)]=name.trim();}catch{}}
  return clean;
}
const split=value=>String(value||'').split(/[\\/]+/).filter(Boolean);
const directory=asset=>asset.shared?split(asset.shared):split(asset.path).slice(0,-1);
export function commonDirectory(assets){
  const paths=assets.filter(a=>a.shared||!String(a.path).startsWith('本地图片')).map(directory).filter(p=>p.length);
  if(!paths.length)return [];const common=paths[0].slice();
  for(const path of paths){let i=0;while(i<common.length&&path[i]?.toLowerCase()===common[i].toLowerCase())i++;common.length=i;}
  return common;
}
export function validFolders(parts){return Array.isArray(parts)&&parts.length>0&&parts.length<=64&&parts.every(p=>typeof p==='string'&&p.length>0&&p.length<=255&&!['.','..'].includes(p)&&!/[\\/]/.test(p));}
export function assetFolders(asset,base=[]){
  if(validFolders(asset.folders))return asset.folders;
  if(!asset.shared&&String(asset.path).startsWith('本地图片'))return ['本地图片'];
  const parts=directory(asset);let i=0;while(i<base.length&&parts[i]?.toLowerCase()===base[i].toLowerCase())i++;
  const relative=(i===base.length?parts.slice(i):parts).slice(0,64).filter(p=>p.length<=255);return relative.length?relative:['未分类'];
}
export function assignBundleFolders(name,records,backup=false){
  const root=String(name||'导入素材').replace(/\.zip$/i,'').replace(/[\\/]/g,'_').trim().slice(0,255)||'导入素材';
  const base=commonDirectory(records);
  for(const record of records){if(backup&&validFolders(record.folders))continue;const children=assetFolders(record,base);record.folders=[root,...(children[0]==='未分类'||children[0]==='本地图片'?[]:children)].slice(0,64);}
  return root;
}
export function buildFolders(assets,base=commonDirectory(assets.filter(a=>a.online))){
  const root={children:new Map(),count:assets.length,parts:[]};
  for(const asset of assets){let node=root;for(const part of assetFolders(asset,base)){let child=node.children.get(part);if(!child)node.children.set(part,child={name:part,parts:[...node.parts,part],count:0,children:new Map()});child.count++;node=child;}}
  return {root,base};
}
export function inFolder(asset,parts,base){const path=assetFolders(asset,base);return parts.every((part,i)=>path[i]===part);}
