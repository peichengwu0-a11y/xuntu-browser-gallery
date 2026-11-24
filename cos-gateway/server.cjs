const { createServer } = require('node:http');
const { createHash, createHmac, timingSafeEqual } = require('node:crypto');

const imageExtension = /\.(?:jpe?g|png|webp|gif|avif|tiff?|heic|heif)$/i;
const maxPreviewSource = 32 * 1024 * 1024;
const grantPeriod = 60 * 60 * 1000;
const digest = value => createHash('sha256').update(value).digest('hex');
const constantEquals = (left, right) => timingSafeEqual(Buffer.from(digest(left)), Buffer.from(digest(right)));

function createGateway({store, resize, accessCode, origins, prefix = '', thumbnailPrefix = '', now = Date.now}) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(accessCode || '')) throw new Error('Set XUNTU_ACCESS_CODE to a random base64url secret of at least 32 characters.');
  if (prefix && !prefix.endsWith('/') || thumbnailPrefix && !thumbnailPrefix.endsWith('/')) {
    throw new Error('COS prefixes must end with /.');
  }
  const counts = {list: 0, thumbnail: 0, originalLinks: 0};
  const startedAt = new Date(now()).toISOString();
  const cache = new Map(), pending = new Map();
  const previewQueue = [];
  let activePreviews = 0;
  let cachedBytes = 0, catalog = new Map(), freshUntil = 0, listing;

  function sign(id, version, expires) {
    return createHmac('sha256', accessCode).update(`xuntu-preview:${id}:${version}:${expires}`).digest('base64url');
  }

  async function list() {
    if (now() < freshUntil) return catalog;
    if (listing) return listing;
    listing = (async () => {
      const next = new Map();
      let marker = '';
      for (let page = 0; page < 20; page++) {
        counts.list++;
        const result = await store.list(prefix, marker);
        for (const entry of result.Contents || []) {
          const key = entry.Key;
          if (typeof key !== 'string' || !key.startsWith(prefix) || !imageExtension.test(key)) continue;
          if (thumbnailPrefix && key.startsWith(thumbnailPrefix)) continue;
          const id = digest(key), version = digest(String(entry.ETag || entry.LastModified || ''));
          next.set(id, {id, version, key, name: key.split('/').at(-1), size: Number(entry.Size) || 0});
        }
        if (String(result.IsTruncated) !== 'true') {
          catalog = next;
          freshUntil = now() + 60_000;
          return catalog;
        }
        const nextMarker = result.NextMarker || result.Contents?.at(-1)?.Key;
        if (!nextMarker || nextMarker === marker) throw new Error('COS listing did not advance');
        marker = nextMarker;
      }
      throw new Error('COS listing exceeds 20,000 objects. Configure a narrower XUNTU_COS_PREFIX.');
    })().finally(() => { listing = null; });
    return listing;
  }

  async function readPreview(asset) {
    if (thumbnailPrefix) {
      counts.thumbnail++;
      const prebuilt = await store.read(thumbnailPrefix + asset.key + '.webp', 2 * 1024 * 1024, true);
      if (prebuilt) return await resize(prebuilt);
    }
    if (asset.size > maxPreviewSource) throw new Error('Preview source is too large');
    counts.thumbnail++;
    return await resize(await store.read(asset.key, maxPreviewSource));
  }

  function preview(asset) {
    const key = asset.id + ':' + asset.version;
    if (cache.has(key)) {
      const value = cache.get(key);
      cache.delete(key);
      cache.set(key, value);
      return value;
    }
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 100) return null;
    const task = new Promise((resolve, reject) => {
      const start = () => {
        activePreviews++;
        readPreview(asset).then(resolve, reject).finally(() => {
          activePreviews--;
          previewQueue.shift()?.();
        });
      };
      if (activePreviews < 4) start();
      else previewQueue.push(start);
    }).then(data => {
      cache.set(key, data);
      cachedBytes += data.length;
      while (cache.size > 1000 || cachedBytes > 64 * 1024 * 1024) {
        const oldest = cache.keys().next().value;
        cachedBytes -= cache.get(oldest).length;
        cache.delete(oldest);
      }
      return data;
    }).finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  }

  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    res.setHeader('Vary', 'Origin');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    function json(status, value) {
      res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'});
      res.end(JSON.stringify(value));
    }
    if (origin && !origins.includes(origin)) return json(403, {error: '来源未授权'});
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization'});
      return res.end();
    }
    const url = new URL(req.url, 'http://localhost');
    const match = /^\/(preview|original)\/([a-f0-9]{64})$/.exec(url.pathname);
    try {
      if (req.method === 'GET' && match?.[1] === 'preview') {
        const asset = catalog.get(match[2]);
        const expires = Number(url.searchParams.get('expires'));
        const token = url.searchParams.get('token') || '';
        if (!asset || !Number.isSafeInteger(expires) || expires <= now()
            || !constantEquals(token, sign(asset.id, asset.version, expires))) return json(403, {error: '请刷新云图库'});
        const task = preview(asset);
        if (!task) return json(429, {error: '缩略图生成繁忙'});
        const data = await task;
        res.writeHead(200, {'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=600'});
        return res.end(data);
      }

      if (!constantEquals(req.headers.authorization || '', 'Bearer ' + accessCode)) {
        return json(401, {error: '请检查云图库访问码'});
      }
      if (req.method === 'GET' && url.pathname === '/usage') return json(200, {startedAt, ...counts});
      if (req.method === 'GET' && url.pathname === '/catalog') {
        const entries = await list();
        const expires = (Math.floor(now() / grantPeriod) + 2) * grantPeriod;
        const assets = [...entries.values()].map(({id, version, key, name, size}) => ({
          id, version, name, size, path: key,
          preview: `preview/${id}?expires=${expires}&token=${sign(id, version, expires)}`
        }));
        return json(200, {assets, expires});
      }
      if (req.method === 'POST' && match?.[1] === 'original') {
        const asset = catalog.get(match[2]);
        if (!asset) return json(404, {error: '找不到这张原图，请刷新云图库'});
        const url = await store.original(asset);
        counts.originalLinks++;
        return json(200, {url});
      }
      return json(404, {error: '接口不存在'});
    } catch (error) {
      console.error('COS gateway request failed:', error.code || error.name || 'Error');
      return json(502, {error: 'COS 读取失败，请检查权限、文件格式或服务连接'});
    }
  });
}

function cosStore(env) {
  const COS = require('cos-nodejs-sdk-v5');
  const bucket = env.XUNTU_COS_BUCKET || 'lorealmu-1540091546';
  const region = env.XUNTU_COS_REGION || 'ap-guangzhou';
  if (!env.COS_SECRET_ID || !env.COS_SECRET_KEY) throw new Error('Set COS_SECRET_ID and COS_SECRET_KEY on the server.');
  const client = new COS({
    SecretId: env.COS_SECRET_ID, SecretKey: env.COS_SECRET_KEY,
    SecurityToken: env.COS_SESSION_TOKEN, Protocol: 'https:', Timeout: 20_000, MaxRetries: 0
  });
  const base = {Bucket: bucket, Region: region};
  const call = (method, options) => new Promise((resolve, reject) => {
    client[method]({...base, ...options}, (error, value) => error ? reject(error) : resolve(value));
  });
  const signed = async (key, query) => (await call('getObjectUrl', {Key: key, Sign: true, Expires: 90, Query: query})).Url;
  return {
    list: (Prefix, Marker) => call('getBucket', {Prefix, Marker, MaxKeys: 1000}),
    original: ({key, name}) => signed(key, {
      'response-content-disposition': "attachment; filename*=UTF-8''" +
        encodeURIComponent(name).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16))
    }),
    async read(key, limit, optional) {
      const response = await fetch(await signed(key), {redirect: 'error', signal: AbortSignal.timeout(25_000)});
      if (optional && response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok || Number(response.headers.get('Content-Length')) > limit) {
        await response.body?.cancel();
        throw new Error('Source unavailable or too large');
      }
      const items = [];
      let length = 0;
      for await (const part of response.body) {
        length += part.length;
        if (length > limit) throw new Error('Source too large');
        items.push(part);
      }
      return Buffer.concat(items, length);
    }
  };
}

if (require.main === module) {
  const sharp = require('sharp');
  const env = process.env;
  const server = createGateway({
    store: cosStore(env),
    resize: data => sharp(data, {limitInputPixels: 35_000_000}).rotate()
      .resize(480, 480, {fit: 'inside', withoutEnlargement: true}).webp({quality: 82}).toBuffer(),
    accessCode: env.XUNTU_ACCESS_CODE,
    origins: (env.XUNTU_ORIGINS || 'https://peichengwu0-a11y.github.io,http://127.0.0.1:8792').split(',').map(value => value.trim()),
    prefix: env.XUNTU_COS_PREFIX,
    thumbnailPrefix: env.XUNTU_COS_THUMBNAIL_PREFIX
  });
  server.listen(Number(env.PORT || 8793), env.XUNTU_BIND || '127.0.0.1', () => console.log('COS gateway ready'));
}

module.exports = {createGateway};
