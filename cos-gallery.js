const localHosts = ['127.0.0.1', 'localhost'];

function cloudAsset(item, imageUrl) {
  return {
    id: 'cos:' + item.id, cloudId: item.id, version: item.version, cloud: true,
    name: item.name, path: item.path, size: item.size, cch: '', shared: '',
    folders: item.path.split('/').slice(0, -1).filter(Boolean),
    imageUrl, features: null
  };
}

export async function fetchCosSnapshot() {
  const url = new URL('./cos-snapshot/manifest.json', import.meta.url);
  const response = await fetch(url, {cache:'no-cache', redirect:'error'});
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('网站缩略图库读取失败（' + response.status + '）。');
  const manifest = await response.json();
  if (manifest.schema !== 1 || !Array.isArray(manifest.assets)) throw new Error('网站缩略图库格式无效。');
  const assets = manifest.assets.map(item => {
    if (!/^[a-f0-9]{64}$/.test(item.id) || !/^[a-f0-9]{64}$/.test(item.version)
        || typeof item.path !== 'string' || typeof item.name !== 'string'
        || !Number.isSafeInteger(item.size) || item.size < 0
        || !/^thumbs\/[a-f0-9]{64}\.webp$/.test(item.preview)) {
      throw new Error('网站缩略图库包含无效记录。');
    }
    return cloudAsset(item, new URL(item.preview, url).href);
  });
  return {assets, expires:Infinity, snapshot:true};
}

export async function createCosGallery() {
  const response = await fetch(new URL('./cos-config.json', import.meta.url));
  if (!response.ok) return null;
  const config = await response.json();
  const local = localHosts.includes(location.hostname);
  const address = config.apiEndpoint || (local ? 'http://127.0.0.1:8793/' : '');
  if (!address) return null;
  const endpoint = new URL(address);
  if (!['https:', 'http:'].includes(endpoint.protocol)
      || (endpoint.protocol !== 'https:' && !(local && localHosts.includes(endpoint.hostname)))
      || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('云图库需要有效的 HTTPS 服务地址。');
  }
  if (!endpoint.pathname.endsWith('/')) endpoint.pathname += '/';
  const cosHost = `${config.bucket}.cos.${config.region}.myqcloud.com`;
  const sessionKey = local && localHosts.includes(endpoint.hostname)
    ? 'xuntu:cos-session:' + endpoint.href
    : '';
  let code = '';

  function savedCode() {
    if (!sessionKey) return '';
    try {
      const saved = localStorage.getItem(sessionKey);
      if (saved) return saved;
    } catch {}
    try { return sessionStorage.getItem(sessionKey) || ''; }
    catch { return ''; }
  }

  function remember(access) {
    if (!sessionKey) return;
    try {
      if (access) localStorage.setItem(sessionKey, access);
      else localStorage.removeItem(sessionKey);
      access = '';
    } catch {}
    try {
      if (access) sessionStorage.setItem(sessionKey, access);
      else sessionStorage.removeItem(sessionKey);
    } catch {}
  }

  async function request(path, method = 'GET', access = code, timeout = 45000) {
    const response = await fetch(new URL(path, endpoint), {
      method, headers: {Authorization: 'Bearer ' + access}, redirect: 'error',
      cache: 'no-store', signal: AbortSignal.timeout(timeout)
    });
    if (response.status === 401) {
      if (access === code) code = '';
      if (access === savedCode()) remember('');
      throw new Error('云图库访问码已失效或输入有误，请重新连接。');
    }
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new Error(result?.error || '云图库读取失败（' + response.status + '），请稍后再试。');
    }
    return response.json();
  }

  return {
    local,
    get connected() { return Boolean(code); },
    get canResume() { return Boolean(savedCode()); },
    disconnect() { code = ''; remember(''); },
    async authorize(access) {
      await request('usage', 'GET', access);
      code = access;
      remember(access);
    },
    async catalog(access = code || savedCode(), {refresh=false} = {}) {
      const result = await request(refresh ? 'catalog?refresh=1' : 'catalog', 'GET', access);
      const assets = result.assets.map(item => {
        const image = new URL(item.preview, endpoint);
        if (image.origin !== endpoint.origin || !image.pathname.startsWith(endpoint.pathname + 'preview/')) {
          throw new Error('云图库返回了无效的缩略图地址。');
        }
        return cloudAsset(item, image.href);
      });
      code = access;
      remember(access);
      return {assets, expires: result.expires, photoshop:result.photoshop === true, canSync:result.canSync === true};
    },
    async usage() { return request('usage'); },
    async importToPs(id) { return request('photoshop/' + id, 'POST', code, 90000); },
    async original(id) {
      const result = await request('original/' + id, 'POST');
      const url = new URL(result.url);
      if (url.protocol !== 'https:' || url.host !== cosHost || url.username || url.password) {
        throw new Error('云图库返回了无效的 COS 原图地址。');
      }
      return url.href;
    }
  };
}
