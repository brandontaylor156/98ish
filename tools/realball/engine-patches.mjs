// Patches from the engine-rendered rally for the scorer: positives at the truth ball, negatives
// at the detector's other candidates. First 55% of the video -> train, the rest -> test.
// Writes engine_{Xtr,Ytr,Xte,Yte}.f32 + engine_meta.json
import fs from "node:fs"
const ROOT = "file:///C:/Users/brand/98ish/.claude/worktrees/agent-ae6801550e37cbea5/client/src/components/applets/pickleball/"
const S = "C:/Users/brand/AppData/Local/Temp/claude/C--Users-brand-98ish/ec32286b-4601-446e-9efd-d532c8ce7d14/scratchpad/"
const { cameraFromHomography } = await import(ROOT + "twin/ball/flight.js")
const { detectBall, searchRegion, sameFrame } = await import(ROOT + "twin/ball/detect.js")
const { calibrate } = await import(ROOT + "twin/core/homography.js")
const syn = await import(ROOT + "twin/synthetic.js")
const an = await import(ROOT + "twin/core/analyze.js")
const bp = await import(ROOT + "twin/core/ballpath.js")
const W = 640, H = 406, FS = W * H * 4, P = 24
const raw = fs.readFileSync(S + "realball/e2e/native.raw")
const PTS = fs.readFileSync(S + "realball/e2e/pts.txt", "utf8").trim().split(/\s+/).map(Number)
const N = Math.floor(raw.length / FS)
const frame = (i) => new Uint8ClampedArray(raw.buffer, raw.byteOffset + i * FS, FS)
const rec = JSON.parse(fs.readFileSync(S + "twin/e2e-rec.json", "utf8"))
const map = rec.map
const toEngine = (vt0) => {
  const vt = vt0 + 0.05
  if (vt <= map[0][0]) return map[0][1]
  for (let i = 1; i < map.length; i++) if (map[i][0] >= vt) { const [a, b] = [map[i - 1], map[i]]; return a[1] + ((vt - a[0]) / Math.max(1e-6, b[0] - a[0])) * (b[1] - a[1]) }
  return map[map.length - 1][1]
}
const script = syn.scriptRally({ t0: 1.5 })
const truth = { players: [0, 1, 2, 3].map((id) => ({ id, team: id < 2 ? 0 : 1, hand: 1, samples: [] })), rallies: [{ hits: script.hits.map((h, i) => ({ ...h, side: "fh", bounced: i <= 2 || Math.abs(h.z) > 4.2 || h.height < 0.42 })) }] }
const segs = an.withPaths(truth).paths[0].segments
const cal = calibrate(rec.taps.map((t) => ({ id: t.id, x: t.u * W, y: t.v * H })))
const cam = cameraFromHomography(cal.H, W, H)
const region = searchRegion(cam, W, H)
// distinct frames
const idx = []
for (let i = 0; i < N; i++) if (!idx.length || !sameFrame(frame(idx.at(-1)), frame(i))) idx.push(i)
const patch = (fi, u, v) => {
  const out = new Float32Array(9 * P * P)
  const fr = [frame(idx[fi - 1]), frame(idx[fi]), frame(idx[fi + 1])]
  const x0 = Math.round(u) - P / 2, y0 = Math.round(v) - P / 2
  for (let f = 0; f < 3; f++) for (let c = 0; c < 3; c++) for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
    const sx = Math.min(W - 1, Math.max(0, x0 + x)), sy = Math.min(H - 1, Math.max(0, y0 + y))
    out[((f * 3 + c) * P + y) * P + x] = fr[f][(sy * W + sx) * 4 + c] / 255
  }
  return out
}
const sets = { tr: { X: [], Y: [] }, te: { X: [], Y: [] } }
const split = Math.floor(idx.length * 0.55)
for (let fi = 1; fi < idx.length - 1; fi++) {
  const t = PTS[idx[fi]]
  const ball = bp.ballAt(segs, toEngine(t))
  const tp = ball ? cam.project(ball) : null
  const c = detectBall(frame(idx[fi - 1]), frame(idx[fi]), frame(idx[fi + 1]), W, H, region, { max: 8 })
  const set = fi < split ? sets.tr : sets.te
  for (const k of c) {
    const d = tp ? Math.hypot(k.u - tp[0], k.v - tp[1]) : 99
    if (d < 4) (set.X.push(patch(fi, k.u, k.v)), set.Y.push(1))
    else if (d > 12) (set.X.push(patch(fi, k.u, k.v)), set.Y.push(0))
  }
  // the truth spot itself (jittered) as a positive when the detector missed it
  if (tp && fi < split && !c.some((k) => Math.hypot(k.u - tp[0], k.v - tp[1]) < 4)) (set.X.push(patch(fi, tp[0] + 1, tp[1] - 1)), set.Y.push(1))
}
const save = (name, arrs) => {
  const n = arrs.length
  const buf = new Float32Array(n * (arrs[0]?.length || 0))
  arrs.forEach((a, i) => buf.set(a, i * a.length))
  fs.writeFileSync(S + `realball/engine_${name}.f32`, Buffer.from(buf.buffer))
  return n
}
const meta = { P, ntr: save("Xtr", sets.tr.X), nte: save("Xte", sets.te.X) }
fs.writeFileSync(S + "realball/engine_Ytr.f32", Buffer.from(new Float32Array(sets.tr.Y).buffer))
fs.writeFileSync(S + "realball/engine_Yte.f32", Buffer.from(new Float32Array(sets.te.Y).buffer))
fs.writeFileSync(S + "realball/engine_meta.json", JSON.stringify(meta))
console.log("distinct frames", idx.length, "train", meta.ntr, "pos", sets.tr.Y.filter(Boolean).length, "test", meta.nte, "pos", sets.te.Y.filter(Boolean).length)
