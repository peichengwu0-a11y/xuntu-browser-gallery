const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGateway } = require('../cos-gateway/server.cjs');

test('private bucket listing, cached previews and on-demand original links', async t => {
  const code = 'test-code-for-mock-bucket-0123456789';
  const origin = 'https://example.github.io';
  const headers = {origin, authorization: 'Bearer ' + code};
  const calls = [];
  const prefix = '产品/主品/';
  let now = Date.now();
  const server = createGateway({
    origins: [origin], accessCode: code, prefix, now: () => now,
    thumbnailPrefix: 'thumbs/',
    store: {
      async list(folder, marker) {
        assert.equal(folder, prefix);
        calls.push(['list', marker]);
        if (!marker) return {IsTruncated: 'true', Contents: [{Key: prefix + 'a.jpg', Size: 500, ETag: 'a1'}]};
        return {IsTruncated: 'false', Contents: [{Key: prefix + 'b.png', Size: 800}, {Key: prefix + 'info.txt'}]};
      },
      async read(key, _limit, optional) {
        calls.push(['read', key]);
        return optional?Buffer.from('thumbnail'):Buffer.from('source');
      },
      async original(asset) {
        calls.push(['original', asset.key]);
        return 'https://example.cos.ap-guangzhou.myqcloud.com/original';
      }
    },
    resize: async data => data
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const request = (path, options) => fetch(base + path, options);

  assert.equal((await request('catalog')).status, 401);
  assert.equal((await request('catalog', {headers:{...headers, origin:'https://untrusted.test'}})).status, 403);
  assert.equal(calls.length, 0);
  const catalog = await (await request('catalog', {headers})).json();
  assert.deepEqual(catalog.assets.map(asset=>asset.path), [prefix + 'a.jpg', prefix + 'b.png']);
  const [asset] = catalog.assets;
  assert.equal((await request(asset.preview.replace(/token=.*/, 'token=wrong'))).status, 403);
  const previews = await Promise.all([request(asset.preview), request(asset.preview)]);
  for(const response of previews){
    assert.equal(response.headers.get('content-type'), 'image/webp');
    assert.equal(await response.text(), 'thumbnail');
  }
  assert.equal((await request('original/' + asset.id, {method:'POST'})).status, 401);
  assert.equal((await request('original/' + asset.id, {method:'POST',headers})).status, 200);
  const usage = await (await request('usage', {headers})).json();
  assert.deepEqual([usage.list, usage.thumbnail, usage.originalLinks], [2, 1, 1]);
  assert.deepEqual(calls, [
    ['list', ''], ['list', prefix+'a.jpg'], ['read', 'thumbs/'+prefix+'a.jpg.webp'], ['original', prefix+'a.jpg']
  ]);
  now=catalog.expires+1;
  assert.equal((await request(asset.preview)).status, 403);
});
