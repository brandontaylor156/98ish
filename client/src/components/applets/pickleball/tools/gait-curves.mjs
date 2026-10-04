// Pickleball 98: where locomotion.js PATHS and CLIPS come from. Forward kinematics of the
// Universal Animation Library's walk, jog and sprint loops (Quaternius, CC0): the feet relative to
// the pelvis over a cycle; then each clip's left-foot landing, stance share (duty), implied
// ground speed, and the swing path (progress and height through the step, in the ground's frame).
// Run from a folder with @gltf-transform/core installed and the UAL zip unpacked
// (ual/S/Unreal-Godot/UAL1_Standard.glb, from https://quaternius.itch.io/universal-animation-library):
//   node gait-curves.mjs            (writes gaitfk.json, then prints the curves)
// The numbers were sampled at nine points per swing into locomotion.js by hand (and shaped for
// court footwork: shuffles and backpedals are made, not captured).
// FK of the UAL locomotion clips: where the feet go relative to the pelvis over a cycle
import fs from "fs"
import { NodeIO } from "@gltf-transform/core"
const io = new NodeIO()
const doc = await io.read("ual/S/Unreal-Godot/UAL1_Standard.glb")
const root = doc.getRoot()
const nodes = root.listNodes()
const parent = new Map()
for (const n of nodes) for (const c of n.listChildren()) parent.set(c, n)
const byName = Object.fromEntries(nodes.map((n) => [n.getName(), n]))
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]]
const qrot = (q, v) => {
  const u = [q[0], q[1], q[2]]
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const t = cr(u, v).map((x) => x * 2)
  const c2 = cr(u, t)
  return [v[0] + q[3] * t[0] + c2[0], v[1] + q[3] * t[1] + c2[1], v[2] + q[3] * t[2] + c2[2]]
}
const slerp = (a, b, t) => {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  const s = d < 0 ? -1 : 1
  const r = a.map((x, i) => x + (s * b[i] - x) * t)
  const l = Math.hypot(...r)
  return r.map((x) => x / l)
}
const which = process.argv.slice(2)
const clips = which.length ? which : ["Walk_Loop", "Jog_Fwd_Loop", "Sprint_Loop"]
const result = {}
for (const anim of root.listAnimations()) {
  const name = anim.getName()
  if (!clips.includes(name)) continue
  const tracks = new Map()
  let dur = 0
  for (const ch of anim.listChannels()) {
    const s = ch.getSampler()
    const key = ch.getTargetNode().getName() + "|" + ch.getTargetPath()
    tracks.set(key, { t: s.getInput().getArray(), v: s.getOutput().getArray(), k: ch.getTargetPath() === "rotation" ? 4 : 3 })
    dur = Math.max(dur, s.getInput().getMax([])[0])
  }
  const sample = (node, path, time, def) => {
    const tr = tracks.get(node.getName() + "|" + path)
    if (!tr) return def
    const { t, v, k } = tr
    let i = 0
    while (i < t.length - 2 && t[i + 1] < time) i++
    const u = t.length > 1 ? Math.min(1, Math.max(0, (time - t[i]) / (t[i + 1] - t[i] || 1))) : 0
    const a = Array.from(v.slice(i * k, i * k + k))
    const b = t.length > 1 ? Array.from(v.slice(i * k + k, i * k + 2 * k)) : a
    return k === 4 ? slerp(a, b, u) : a.map((x, j) => x + (b[j] - x) * u)
  }
  const world = (node, time) => {
    const chain = []
    for (let n = node; n; n = parent.get(n)) chain.unshift(n)
    let q = [0, 0, 0, 1]
    let p = [0, 0, 0]
    for (const n of chain) {
      const lt = sample(n, "translation", time, n.getTranslation())
      const lr = sample(n, "rotation", time, n.getRotation())
      const ls = n.getScale()
      const off = qrot(q, [lt[0] * ls[0], lt[1] * ls[1], lt[2] * ls[2]])
      p = [p[0] + off[0], p[1] + off[1], p[2] + off[2]]
      q = qmul(q, lr)
    }
    return p
  }
  const N = 64
  const rows = []
  for (let i = 0; i < N; i++) {
    const time = (i / N) * dur
    const pel = world(byName.pelvis, time)
    const r = { u: i / N, pel }
    for (const s of ["l", "r"]) {
      r["foot_" + s] = world(byName["foot_" + s], time)
      r["ball_" + s] = world(byName["ball_" + s], time)
    }
    rows.push(r)
  }
  result[name] = { dur, rows }
}
// summarize: world is y up; forward axis? print ranges
for (const [name, { dur, rows }] of Object.entries(result)) {
  console.log("==", name, dur.toFixed(3))
  for (const r of rows.filter((_, i) => i % 4 === 0))
    console.log(r.u.toFixed(3), "pel", r.pel.map((x) => x.toFixed(3)).join(","), "| L", r.foot_l.map((x) => x.toFixed(3)).join(","), "bL", r.ball_l.map((x) => x.toFixed(3)).join(","), "| R", r.foot_r.map((x) => x.toFixed(3)).join(","))
}
fs.writeFileSync("gaitfk.json", JSON.stringify(result))

// ---- the curves ----
const R = result
for (const [name, { dur, rows }] of Object.entries(R)) {
  const N = rows.length
  const ay = rows.map((r) => r.foot_l[1])
  const by = rows.map((r) => r.ball_l[1])
  const amin = Math.min(...ay)
  const bmin = Math.min(...by)
  const down = rows.map((r, i) => Math.min(ay[i] - amin, by[i] - bmin) < 0.03)
  const idx = down.map((d, i) => (d ? i : -1)).filter((i) => i >= 0)
  const start = idx.find((i) => !down[(i - 1 + N) % N])
  const end = idx.find((i) => !down[(i + 1) % N])
  const len = ((end - start + N) % N) + 1
  const z0 = rows[start].foot_l[2]
  const z1 = rows[end].foot_l[2]
  const tStance = ((len - 1) / N) * dur
  const v = (z0 - z1) / tStance
  console.log(name, "dur", dur.toFixed(3), "contact u", (start / N).toFixed(3), "liftoff u", (end / N).toFixed(3), "duty", (len / N).toFixed(2), "speed", v.toFixed(2), "cadence steps/s", (2 / dur).toFixed(2), "pelvis bob", (Math.max(...rows.map((r) => r.pel[1])) - Math.min(...rows.map((r) => r.pel[1]))).toFixed(3))
  const sw = []
  const swLen = N - len + 1
  const zl = rows[end].foot_l[2]
  const zc = rows[start].foot_l[2]
  const tSw = (swLen / N) * dur
  const total = zc + v * tSw - zl
  for (let k = 0; k <= swLen; k++) {
    const i = (end + k) % N
    const t = (k / N) * dur
    const zw = rows[i].foot_l[2] + v * t - zl
    sw.push({ s: k / swLen, p: zw / total, h: ay[i] - amin, pitch: Math.atan2(by[i] - ay[i], rows[i].ball_l[2] - rows[i].foot_l[2]) })
  }
  console.log(" swing total", total.toFixed(2), sw.map((x) => `${x.s.toFixed(2)}:p${x.p.toFixed(2)} h${x.h.toFixed(2)} pt${x.pitch.toFixed(2)}`).join(" "))
  console.log(" pelvis", rows.map((r, i) => rows[(start + i) % N].pel[1].toFixed(3)).filter((_, i) => i % 4 === 0).join(" "))
  console.log(" stance pitch", Array.from({ length: len }, (_, k) => { const i = (start + k) % N; return Math.atan2(by[i] - ay[i], rows[i].ball_l[2] - rows[i].foot_l[2]).toFixed(2) + "/" + (ay[i] - amin).toFixed(3) }).join(" "))
}
