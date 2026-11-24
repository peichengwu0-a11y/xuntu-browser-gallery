const localHosts = ['127.0.0.1', 'localhost'];

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
  let code = '';

  async function request(path, method = 'GET', access = code) {
    const response = await fetch(new URL(path, endpoint), {
      method, headers: {Authorization: 'Bearer ' + access}, redirect: 'error',
      cache: 'no-store', signal: AbortSignal.timeout(45000)
    });
    if (response.status === 401) throw new Error('云图库访问码有误。');
    if (!response.ok) throw new Error('云图库读取失败（' + response.status + '），请稍后再试。');
    return response.json();
  }

  return {
    get connected() { return Boolean(code); },
    disconnect() { code = ''; },
    async catalog(access = code) {
      const result = await request('catalog', 'GET', access);
      const assets = result.assets.map(item => {
        const image = new URL(item.preview, endpoint);
        if (image.origin !== endpoint.origin || !image.pathname.startsWith(endpoint.pathname + 'preview/')) {
          throw new Error('云图库返回了无效的缩略图地址。');
        }
        return {
          id: 'cos:' + item.id, cloudId: item.id, version: item.version, cloud: true,
          name: item.name, path: item.path, size: item.size, cch: '', shared: '',
          folders: item.path.split('/').slice(0, -1).filter(Boolean),
          imageUrl: image.href, features: null
        };
      });
      code = access;
      return {assets, expires: result.expires};
    },
    async usage() { return request('usage'); },
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
