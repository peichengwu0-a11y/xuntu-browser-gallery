# Models and provenance

Official LightGlue-ONNX v1.0.0 release:
https://github.com/fabio-sim/LightGlue-ONNX/releases/tag/v1.0.0

- disk.onnx: unmodified official DISK extractor.
- disk_lightglue_fused_cpu.onnx: unmodified official DISK LightGlue matcher; standard operators support browser WebGPU/WASM.
- disk-web.onnx: derived DISK extractor, replacing MaxPool index-output NMS with max-value comparison and explicit preceding-neighbor tie checks. This preserves the original peak selection at the app's fixed 512 × 512 input. Reproducible via scripts/prepare-disk-web.py; native original/derived outputs were compared.

Model weights are unchanged. DISK and LightGlue are Apache-2.0. Respective licenses are included.

ONNX Runtime Web 1.27.0 from the official npm registry, SHA-512 package integrity verified at download. Its MIT license is in vendor/onnxruntime.
