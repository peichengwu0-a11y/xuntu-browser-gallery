const fs = require('node:fs/promises');
const {createHash, randomUUID} = require('node:crypto');
const path = require('node:path');

const snapshot = path.join(__dirname, '..', 'cos-snapshot');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = /^[a-f0-9]{64}$/;

async function writeAtomic(file, data) {
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temp, data, {flag:'wx'});
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, {force:true});
  }
}

// Whitelist fields in the public artifact. Gateway metadata and credentials stay on the server.
function publicAsset(asset, key) {
  const {id, version, name, size} = asset;
  if (!digest.test(id) || !digest.test(version) || typeof key !== 'string' || hash(key) !== id ||
      !name || name !== key.split('/').at(-1) || !Number.isSafeInteger(size) || size < 0) {
    throw new Error('Invalid catalog entry: ' + id);
  }
  return {id, version, name, path:key, size};
}

function previewPath(bytes, name) {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'RIFF' ||
      bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) !== bytes.length - 8) {
    throw new Error('Missing or incomplete WebP: ' + name);
  }
  return 'thumbs/' + hash(bytes) + '.webp';
}

async function build(mode, directory) {
  const exporting = mode === 'export';
  const target = exporting ? snapshot : directory;
  const input = JSON.parse(await fs.readFile(exporting ? path.join(directory, 'catalog.json') :
    path.join(snapshot, 'manifest.json'), 'utf8'));
  if (!exporting && input.schema !== 1) throw new Error('Unsupported snapshot schema');
  const records = exporting ? input : input.assets;
  if (!Array.isArray(records) || !records.length) throw new Error('Empty catalog');
  await fs.mkdir(path.join(target, 'thumbs'), {recursive:true});
  const ids = new Set(), files = new Set(), assets = [];
  for (const item of records) {
    const asset = publicAsset(item, exporting ? item.key : item.path);
    if (ids.has(asset.id)) throw new Error('Duplicate asset: ' + asset.path);
    ids.add(asset.id);
    if (!exporting && !/^thumbs\/[a-f0-9]{64}\.webp$/.test(item.preview)) {
      throw new Error('Invalid preview path: ' + asset.path);
    }
    const source = exporting ? path.join(directory, asset.id + '-' + asset.version + '.webp') :
      path.join(snapshot, item.preview);
    const data = await fs.readFile(source);
    const preview = previewPath(data, asset.path);
    if (!exporting && preview !== item.preview) throw new Error('Preview checksum failed: ' + asset.path);
    if (!files.has(preview)) {
      await writeAtomic(path.join(target, preview), data);
      files.add(preview);
    }
    assets.push({...asset, preview});
  }
  // Readers see the new catalog only after all its referenced images are available.
  await writeAtomic(path.join(target, 'manifest.json'), JSON.stringify({schema:1, assets}) + '\n');
  console.log(`${assets.length} catalog entries, ${files.size} distinct WebP files`);
}

const [, , mode, directory] = process.argv;
if (!['export', 'stage'].includes(mode) || !directory) {
  console.error('Usage: node scripts/site-previews.cjs export <gateway-cache-directory> | stage <site-snapshot-directory>');
  process.exitCode = 1;
} else {
  build(mode, path.resolve(directory)).catch(error => {console.error(error.message); process.exitCode = 1;});
}
