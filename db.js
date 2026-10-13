const NAME = 'tuji-browser-pages-v1';
let connection;
export async function openDB() {
  if (connection) return connection;
  connection = await new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 2);
    request.onupgradeneeded = () => {if(!request.result.objectStoreNames.contains('assets'))request.result.createObjectStore('assets', { keyPath: 'id' });if(!request.result.objectStoreNames.contains('hidden'))request.result.createObjectStore('hidden',{keyPath:'id'});};
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('请关闭其他图迹标签页后重试。'));
  });
  return connection;
}
async function transact(mode, action) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('assets', mode);
    const store = tx.objectStore('assets');
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('浏览器存储失败。'));
    tx.onabort = () => reject(tx.error || new Error('存储已取消。'));
    try { result = action(store); } catch (error) { tx.abort(); reject(error); }
  });
}
export async function allAssets() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction('assets').objectStore('assets').getAll();
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
async function write(assets,ids){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(['assets','hidden'],'readwrite'),store=tx.objectStore('assets'),hidden=tx.objectStore('hidden');for(const asset of assets){store.put(asset);hidden.delete(asset.id);}for(const id of ids){store.delete(id);hidden.put({id});}tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error||new Error('浏览器存储失败。'));});}
export const putAssets=assets=>write(assets,[]);
export const removeAssets=ids=>write([],ids);
export async function hiddenIds(){const db=await openDB();return new Promise((resolve,reject)=>{const r=db.transaction('hidden').objectStore('hidden').getAllKeys();r.onsuccess=()=>resolve(new Set(r.result));r.onerror=()=>reject(r.error);});}
