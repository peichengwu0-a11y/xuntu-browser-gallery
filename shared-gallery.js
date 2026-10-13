export async function fetchSharedGallery(){
  const url=new URL('./shared-gallery/manifest.json',import.meta.url);
  const response=await fetch(url,{cache:'no-cache'});
  if(response.status===404)return null;
  if(!response.ok)throw new Error('共享图库清单读取失败：'+response.status);
  const manifest=await response.json();
  if(manifest.schema_version!==1||manifest.source!=='shared-online-gallery'||!Array.isArray(manifest.assets)||!Array.isArray(manifest.feature_shards))throw new Error('共享图库格式无效。');
  return {...manifest,lightglue:manifest.lightglue?{...manifest.lightglue,url:new URL(manifest.lightglue.retrieval,url).href}:null,assets:manifest.assets.map(a=>({...a,online:true,imageUrl:new URL(a.image,url).href,features:{width:a.width,height:a.height}})),shards:manifest.feature_shards.map(s=>({...s,url:new URL(s.url,url).href}))};
}
export async function assetBlob(asset){
  if(asset.blob)return asset.blob;
  const response=await fetch(asset.imageUrl);
  if(!response.ok)throw new Error('无法读取素材图片：'+asset.name);
  return await response.blob();
}
