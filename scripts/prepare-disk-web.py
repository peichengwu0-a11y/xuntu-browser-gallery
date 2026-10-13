"""Preserve DISK NMS tie order using WebGPU-supported operators at 512px."""
import onnx,numpy as np
from onnx import helper,numpy_helper
m=onnx.load('vendor/lightglue/disk.onnx');source='/Slice_4_output_0';pool=m.graph.node[146];del pool.output[1:]
nodes=[]
def const(name,value):
 nodes.append(helper.make_node('Constant',[],[name],value=numpy_helper.from_array(np.array(value))));return name
const('nms-pads',np.array([0,0,2,2,0,0,2,2],np.int64));const('nms-neginf',np.float32(-np.inf));nodes.append(helper.make_node('Pad',[source,'nms-pads','nms-neginf'],['nms-pad'],mode='constant'))
nodes.append(helper.make_node('Equal',[source,pool.output[0]],['nms-equal']));current='nms-equal'
const('nms-axes',np.array([2,3],np.int64))
for i,(dy,dx) in enumerate([(dy,dx) for dy in [-2,-1] for dx in range(-2,3)]+[(0,-2),(0,-1)]):
 const(f'nms-start-{i}',np.array([2+dy,2+dx],np.int64));const(f'nms-end-{i}',np.array([514+dy,514+dx],np.int64))
 nodes.append(helper.make_node('Slice',['nms-pad',f'nms-start-{i}',f'nms-end-{i}','nms-axes'],[f'nms-shift-{i}']))
 nodes.append(helper.make_node('Greater',[source,f'nms-shift-{i}'],[f'nms-tie-{i}']))
 output='/Equal_output_0' if i==11 else f'nms-ok-{i}'
 nodes.append(helper.make_node('And',[current,f'nms-tie-{i}'],[output]));current=output
old=list(m.graph.node);new=old[:147]+nodes+old[171:];needed=set(x.name for x in m.graph.output);keep=[]
for n in reversed(new):
 if any(x in needed for x in n.output):keep.append(n);needed.update(n.input)
del m.graph.node[:];m.graph.node.extend(reversed(keep));initial=[x for x in m.graph.initializer if x.name in needed];del m.graph.initializer[:];m.graph.initializer.extend(initial)
onnx.checker.check_model(m);onnx.save(m,'vendor/lightglue/disk-web.onnx');print('Created equivalent fixed-512 NMS graph')
import onnxruntime as ort
s0=ort.InferenceSession('vendor/lightglue/disk.onnx');s1=ort.InferenceSession('vendor/lightglue/disk-web.onnx');x=np.random.default_rng(1).random((1,3,512,512),dtype=np.float32)
a=s0.run(None,{'image':x});b=s1.run(None,{'image':x})
for x,y in zip(a,b):assert x.shape==y.shape and np.allclose(x,y,atol=1e-6),(x.shape,y.shape)
print('PASS: original and WebGPU-compatible graph return equivalent points, scores and descriptors')
