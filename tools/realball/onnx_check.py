"""The exported ONNX scorer: shape, timing and agreement with the torch logits (parity.json)."""
import json, os, time
import numpy as np, onnxruntime as ort
HERE = os.path.dirname(os.path.abspath(__file__))
sess = ort.InferenceSession(os.path.join(HERE, "realball-scorer.onnx"), providers=["CPUExecutionProvider"])
par = json.load(open(os.path.join(HERE, "parity.json")))
x = np.array(par["x"], np.float32)
y = sess.run(None, {"patch": x})[0]
print("input", x.shape, "output", y.shape, "max |onnx - torch|", float(np.abs(y - np.array(par["logit"])).max()))
xb = np.random.rand(64, 9, 24, 24).astype(np.float32)
t = time.time()
for _ in range(20): sess.run(None, {"patch": xb})
print("onnxruntime CPU: %.3f ms per patch" % ((time.time() - t) / 20 / 64 * 1000))
print("model bytes", os.path.getsize(os.path.join(HERE, "realball-scorer.onnx")))
