"""Read the original SQLite library without modifying it; publish static thumbnails and ORB indices."""
import argparse, gzip, hashlib, io, json, sqlite3, struct, sys
from pathlib import Path
import numpy as np
import cv2
from PIL import Image, ImageOps

def features(raw):
    with Image.open(io.BytesIO(raw)) as original:
        image = ImageOps.exif_transpose(original).convert('RGBA')
        if image.width * image.height > 35000000:
            raise ValueError('Image exceeds pixel limit')
        bg = Image.new('RGBA', image.size, 'white')
        bg.alpha_composite(image)
        image = bg.convert('RGB')
        ratio = min(1, 640 / max(image.size))
        if ratio < 1:
            image = image.resize((max(1, round(image.width * ratio)), max(1, round(image.height * ratio))), Image.Resampling.BILINEAR)
        gray = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2GRAY)
    kp, desc = cv2.ORB_create(nfeatures=600).detectAndCompute(gray, None)
    points = np.array([(point.pt[0], point.pt[1]) for point in kp], dtype='<f4')
    if desc is None:
        desc = np.zeros((0,32), dtype=np.uint8)
    small = cv2.resize(gray, (9,8), interpolation=cv2.INTER_AREA)
    image_hash = (small[:,:-1] > small[:,1:]).astype(np.uint8)
    pixels = cv2.resize(gray, (16,16), interpolation=cv2.INTER_AREA)
    return image.width, image.height, len(kp), float(pixels.astype(float).var()), image_hash.tobytes(), pixels.tobytes(), points.tobytes(), desc.tobytes()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--database', required=True)
    parser.add_argument('--output', required=True)
    args=parser.parse_args()
    source=Path(args.database).resolve()
    con=sqlite3.connect(source.as_uri()+'?mode=ro', uri=True)
    rows=con.execute("SELECT i.id,i.name,i.path,i.image,COALESCE(l.cch,''),COALESCE(l.shared,i.path) FROM imported i LEFT JOIN links l ON l.id=i.id WHERE NOT EXISTS (SELECT 1 FROM removed r WHERE r.id=i.id) ORDER BY i.id").fetchall()
    destination=Path(args.output).resolve()
    (destination/'thumbnails').mkdir(parents=True,exist_ok=True)
    (destination/'index').mkdir(exist_ok=True)
    metadata=[];shards=[];buffer=bytearray();shard_count=0;version=hashlib.sha256()
    def flush():
        nonlocal buffer,shard_count
        if not shard_count:return
        name=f'index/features-{len(shards):03d}.bin.gz'
        content=gzip.compress(b'TJI1'+struct.pack('<I',shard_count)+buffer,compresslevel=6,mtime=0)
        (destination/name).write_bytes(content)
        shards.append(dict(url=name,count=shard_count,bytes=len(content)))
        buffer=bytearray();shard_count=0
    for index,(key,name,path,raw,cch,shared) in enumerate(rows):
        feature=features(raw)
        width,height,count,variance,*arrays=feature
        (destination/'thumbnails'/f'{key}.jpg').write_bytes(raw)
        encoded=key.encode('utf-8')
        buffer.extend(struct.pack('<H',len(encoded))+encoded+struct.pack('<HHHf',width,height,count,variance)+b''.join(arrays))
        shard_count+=1
        version.update(key.encode());version.update(raw);version.update(json.dumps([name,path,cch,shared],ensure_ascii=False).encode())
        metadata.append(dict(id=key,name=name,path=path,shared=shared,cch=cch,imported=True,size=len(raw),width=width,height=height,image=f'thumbnails/{key}.jpg'))
        if shard_count==200:flush()
        if index%200==0:print(f'Indexed {index+1} / {len(rows)}',flush=True)
    flush()
    manifest=dict(schema_version=1,source='shared-online-gallery',version=version.hexdigest()[:20],count=len(metadata),assets=metadata,feature_shards=shards)
    (destination/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(json.dumps(dict(count=len(metadata),shards=len(shards),bytes=sum(p.stat().st_size for p in destination.rglob('*') if p.is_file())),ensure_ascii=False),flush=True)

if __name__=='__main__':main()
