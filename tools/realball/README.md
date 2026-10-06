# Real Ball candidate scorer (training tools)

The scorer behind `client/src/components/applets/pickleball/twin/ball/scorer.js`: a 3-layer CNN
(~8k weights) that rates 24x24 three-frame RGB patches around the detector's candidates. Our own
weights (no third-party model): trained on procedurally generated fence-cam patches plus patches
from Pickleball 98's own rendered rally.

Shipped: `client/public/models/realball-scorer.json` (weights for the plain-JS forward pass) and
`realball-scorer.onnx` (the same network, opset 17, input `patch` [n, 9, 24, 24] in 0..1,
output `logit` [n]).

Rebuild (CPU only, ~10 min):
1. Render or reuse an engine fence-cam rally video (Twin Replay's e2e recording) and extract its
   frames at 640x406 with timestamps (`ffmpeg -fps_mode passthrough -vf scale=640:406 -f rawvideo
   -pix_fmt rgba native.raw`, `ffprobe -show_entries frame=pts_time`).
2. `node engine-patches.mjs` (edit the paths at the top) writes the engine patch sets.
3. `python train.py` (torch CPU, onnx, onnxscript, numpy) trains, exports the ONNX + JSON and a
   parity sample; `python onnx_check.py` checks the ONNX against torch.

Measured 2026-10-06: procedural held-out precision 0.94 / recall 0.95; engine held-out (second
half of the rally) precision 0.76 / recall 0.78; ONNX vs torch max |dlogit| 6e-4, JS vs torch 5e-4;
onnxruntime CPU 0.4 ms/patch, the JS forward pass ~4 ms/patch on a loaded laptop.
