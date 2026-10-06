// Writes park/riverside.fixture.json: what the hand-written Riverside Park layout (layout.js
// before makeLayout) gave, so the test can check makeLayout(RIVERSIDE) gives the same.
//   node tools/venues/snapshot-riverside.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PARK = path.join(HERE, "../../client/src/components/applets/pickleball/park")
const L = await import(pathToFileURL(path.join(PARK, "layout.js")).href)

let s = 12345
const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
const r4 = (v) => Math.round(v * 1e4) / 1e4
const pt = () => ({ x: r4(L.BOUNDS.x0 - 3 + rnd() * (L.BOUNDS.x1 - L.BOUNDS.x0 + 6)), z: r4(L.BOUNDS.z0 - 3 + rnd() * (L.BOUNDS.z1 - L.BOUNDS.z0 + 6)) })
const resolves = []
for (let i = 0; i < 400; i++) {
  const p = pt()
  const q = L.resolve(p.x, p.z, 0.35)
  resolves.push([p.x, p.z, r4(q.x), r4(q.z)])
}
const routes = []
for (let i = 0; i < 80; i++) {
  const a = pt()
  const b = pt()
  if (L.blocked(a.x, a.z, 0.4) || L.blocked(b.x, b.z, 0.4)) continue
  routes.push({ a, b, path: L.route(a, b).map((p) => ({ x: r4(p.x), z: r4(p.z) })) })
}
const hits = []
for (let i = 0; i < 150; i++) {
  const a = pt()
  const b = pt()
  const h = L.segmentHit(a, b, 1.5, 0.45)
  hits.push([a.x, a.z, b.x, b.z, h === null ? null : r4(h)])
}
const pose = { yaw: 0.3, root: { x: 1, y: 1, z: 2, yaw: 0.2 }, look: { x: 0.5, y: 0, z: 0.8 }, footL: { x: 0.2, y: 0, z: 1.5, pin: { x: 0.1, y: 0, z: 1.4 } }, info: { a: 1 } }
const out = {
  COURTS: L.COURTS,
  BOXES: L.BOXES,
  CIRCLES: L.CIRCLES,
  ALL_SEATS: L.ALL_SEATS,
  approaches: L.ALL_SEATS.map(L.seatApproach),
  INTERACTABLES: L.INTERACTABLES,
  NAV: L.NAV,
  WAYPOINTS: L.WAYPOINTS,
  TREES: L.TREES,
  LIGHTS: L.LIGHTS,
  BENCHES: L.BENCHES,
  SPAWN: L.SPAWN,
  BOOTH: L.BOOTH,
  BOARD: L.BOARD,
  FOUNTAIN: L.FOUNTAIN,
  MACHINE_COURT: L.MACHINE_COURT,
  BOUNDS: L.BOUNDS,
  resolves,
  routes,
  hits,
  frames: L.COURTS.map((c) => ({ w: L.toWorld(c, 1.3, -2.1), l: L.toLocal(c, c.x + 2, c.z - 1), y: L.yawToWorld(0.4) })),
  pose: L.poseToWorld(pose, L.COURTS[2]),
}
fs.writeFileSync(path.join(PARK, "riverside.fixture.json"), JSON.stringify(out))
console.log("wrote", Math.round(JSON.stringify(out).length / 1024), "KB")
