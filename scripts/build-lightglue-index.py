"""Build a compact DISK retrieval index; full descriptors are computed locally at query time."""
import argparse, gzip, hashlib, json, os, struct, time
from pathlib import Path
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps

def projection():
    state=20261013; values=[]
    for _ in range(128*64):
        state ^= (state << 13) & 0xffffffff; state ^= state >> 17; state ^= (state << 5) & 0xffffffff; state &= 0xffffffff
        values.append(1 if state & 1 else -1)
    return np.array(values,dtype=np.float32).reshape(128,64)

def image_input(path):
    with Image.open(path) as im:
        im=ImageOps.exif_transpose(im).convert('RGB'); ratio=480/max(im.size)
        w=max(1,round(im.width*ratio)); h=max(1,round(im.height*ratio))
        canvas=Image.new('RGB',(512,512),'white');canvas.paste(im.resize((w,h),Image.Resampling.BILINEAR),((512-w)//2,(512-h)//2))
        return np.asarray(canvas,dtype=np.float32).transpose(2,0,1)[None]/255

def extract(session,path):
    kpts,scores,desc=session.run(None,{'image':image_input(path)})
    ids=np.argsort(-scores[0],kind='stable')[:2048]
    return kpts[0,ids].astype(np.float32),desc[0,ids].astype(np.float32)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--gallery',default='shared-gallery');parser.add_argument('--model',default='vendor/lightglue/disk.onnx');parser.add_argument('--cache',default='qa-output/disk-cache');args=parser.parse_args()
    root=Path(args.gallery);manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'));cache=Path(args.cache);cache.mkdir(parents=True,exist_ok=True)
    opts=ort.SessionOptions();opts.enable_mem_pattern=False;opts.execution_mode=ort.ExecutionMode.ORT_SEQUENTIAL;opts.intra_op_num_threads=4
    provider='DmlExecutionProvider' if 'DmlExecutionProvider' in ort.get_available_providers() else 'CPUExecutionProvider'
    session=ort.InferenceSession(args.model,sess_options=opts,providers=[provider,'CPUExecutionProvider']);proj=projection();buf=bytearray(b'LGI1'+struct.pack('<I',len(manifest['assets'])));start=time.time()
    for i,a in enumerate(manifest['assets']):
        image=root/a['image'];key=hashlib.sha256(image.read_bytes()).hexdigest();saved=cache/(key+'.npz')
        if saved.exists():
            data=np.load(saved);points,descriptors=data['points'],data['descriptors']
        else:
            points,descriptors=extract(session,image);np.savez_compressed(saved,points=points,descriptors=descriptors)
        bits=descriptors@proj>0; codes=np.packbits(bits,axis=1,bitorder='little')
        encoded=a['id'].encode();buf.extend(struct.pack('<HH',len(encoded),len(points))+encoded+codes.tobytes())
        if i%100==0:print(f'DISK {i+1}/{len(manifest["assets"])} · {time.time()-start:.0f}s · {provider}',flush=True)
    target=root/'index/lightglue-retrieval.bin.gz';raw=gzip.compress(buf,compresslevel=6,mtime=0);target.write_bytes(raw)
    manifest['lightglue']={'engine':'DISK + LightGlue ONNX','version':hashlib.sha256(raw).hexdigest()[:20],'keypoints':2048,'retrieval': 'index/lightglue-retrieval.bin.gz','bytes':len(raw)}
    (root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')),encoding='utf-8');print(f'Complete: {len(raw)} bytes',flush=True)

if __name__=='__main__':main()
