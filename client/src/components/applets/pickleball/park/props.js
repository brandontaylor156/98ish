// My Park: drawing the prop kit (propkit.js has the types, sizes and room presets). Every prop
// is a low-poly template built from boxes and cylinders with its colors in the vertices, so all
// the props of a zone share one material and venue.js mergeStatic turns a whole zone's props
// into one or two meshes (glass parts get their own see-through material). Templates are made
// once per type and color.

import * as THREE from "three"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"
import { PROPS } from "./propkit.js"

const C = new THREE.Color()
const M4 = new THREE.Matrix4()
const Q = new THREE.Quaternion()
const E = new THREE.Euler()
const V = new THREE.Vector3()
const S1 = new THREE.Vector3(1, 1, 1)
// a part: a geometry moved into place and painted (non-indexed, position + normal + color)
const paint = (g, color, x, y, z, ry = 0, rx = 0, rz = 0) => {
  let geo = g.index ? g.toNonIndexed() : g
  if (geo !== g) g.dispose()
  geo.deleteAttribute("uv")
  geo.applyMatrix4(M4.compose(V.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S1))
  C.set(color)
  const n = geo.attributes.position.count
  const col = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) col.set([C.r, C.g, C.b], i * 3)
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3))
  return geo
}
// box w x h x d standing on y0 at (x, z); cylinder r (top rt, bottom rb) standing on y0
const box = (w, h, d, x, y0, z, color, ry = 0) => paint(new THREE.BoxGeometry(w, h, d), color, x, y0 + h / 2, z, ry)
const cyl = (rt, rb, h, x, y0, z, color, seg = 8) => paint(new THREE.CylinderGeometry(rt, rb, h, seg), color, x, y0 + h / 2, z)
const disc = (r, x, y, z, color, seg = 16) => paint(new THREE.CircleGeometry(r, seg).rotateX(-Math.PI / 2), color, x, y, z)
// round 3 detail: a canopy with folds (every other rib's edge pulled in and up, as fabric
// hangs between ribs), and a valance round its edge
const canopy = (r, h) => {
  const g = new THREE.ConeGeometry(r, h, 16)
  const pos = g.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const y = pos.getY(i)
    if (Math.abs(Math.hypot(x, z) - r) > 1e-3 || y > -h / 2 + 1e-3) continue
    const k = Math.round(Math.atan2(z, x) / ((Math.PI * 2) / 16))
    if (k % 2) pos.setXYZ(i, x * 0.93, y + 0.07, z * 0.93)
  }
  g.computeVertexNormals()
  return g
}
const legs4 = (w, d, h, color, t = 0.04, inset = 0.04) => [-1, 1].flatMap((i) => [-1, 1].map((j) => box(t, h, t, i * (w / 2 - inset), 0, j * (d / 2 - inset), color)))

// type -> (c: the prop's own color or null) -> { solid: [parts], glass: [parts] }
const T = {
  // (round 3: three seat slats and two back slats with gaps, on cast side frames with an arm)
  bench: (c) => ({
    solid: [
      ...[-0.14, 0, 0.14].map((z) => box(1.8, 0.05, 0.11, 0, 0.42, z, c || "#8a5a33")),
      ...[0.58, 0.74].map((y) => box(1.8, 0.1, 0.035, 0, y, -0.21, c || "#8a5a33")),
      ...[-0.82, 0.82].flatMap((x) => [box(0.05, 0.42, 0.05, x, 0, 0.16, "#2f3338"), box(0.05, 0.84, 0.05, x, 0, -0.2, "#2f3338"), box(0.05, 0.04, 0.42, x, 0.4, 0, "#2f3338"), box(0.05, 0.04, 0.34, x, 0.62, -0.03, "#2f3338")]),
    ],
  }),
  picnic: (c) => ({ solid: [box(1.8, 0.05, 0.75, 0, 0.72, 0, c || "#7a5434"), ...[-0.6, 0.6].map((z) => box(1.8, 0.05, 0.28, 0, 0.42, z, c || "#7a5434")), ...[-0.7, 0.7].map((x) => box(0.06, 0.72, 1.3, x, 0, 0, "#3a3f45"))] }),
  chair: (c) => ({ solid: [box(0.45, 0.05, 0.45, 0, 0.44, 0, c || "#3d4652"), box(0.45, 0.45, 0.05, 0, 0.47, -0.2, c || "#3d4652"), ...legs4(0.42, 0.42, 0.44, "#2b2f36", 0.03)] }),
  stool: (c) => ({ solid: [cyl(0.2, 0.2, 0.07, 0, 0.71, 0, c || "#b23a2e", 12), cyl(0.03, 0.03, 0.71, 0, 0, 0, "#2b2f36", 6), cyl(0.22, 0.22, 0.03, 0, 0, 0, "#2b2f36", 12), paint(new THREE.TorusGeometry(0.17, 0.015, 4, 10).rotateX(Math.PI / 2), "#2b2f36", 0, 0.3, 0)] }),
  table: (c) => ({ solid: [cyl(0.45, 0.45, 0.04, 0, 0.72, 0, c || "#3a3330", 14), cyl(0.04, 0.04, 0.72, 0, 0, 0, "#2b2f36", 6), cyl(0.25, 0.25, 0.03, 0, 0, 0, "#2b2f36", 10)] }),
  tablesq: (c) => ({ solid: [box(1, 0.05, 1, 0, 0.71, 0, c || "#d8d2c4"), ...legs4(0.95, 0.95, 0.71, "#2b2f36", 0.05)] }),
  lounger: (c) => ({ solid: [box(0.65, 0.08, 1.4, 0, 0.3, 0.2, c || "#f2f2ee"), paint(new THREE.BoxGeometry(0.65, 0.08, 0.6), c || "#f2f2ee", 0, 0.5, -0.65, 0, 0.6), ...legs4(0.6, 1.8, 0.3, "#9aa0a8", 0.04)] }),
  umbrella: (c) => ({ solid: [cyl(0.03, 0.03, 2.4, 0, 0, 0, "#dcdcdc", 6), paint(canopy(1.3, 0.45), c || "#f4f2ec", 0, 2.35, 0), paint(new THREE.CylinderGeometry(1.24, 1.24, 0.12, 16, 1, true), c || "#f4f2ec", 0, 2.1, 0), cyl(0.05, 0.05, 0.12, 0, 2.55, 0, "#dcdcdc", 6), cyl(0.2, 0.25, 0.1, 0, 0, 0, "#555", 8)] }),
  tent: (c) => ({ solid: [paint(new THREE.ConeGeometry(2.1, 0.7, 4).rotateY(Math.PI / 4), c || "#f6f6f2", 0, 2.75, 0), box(3, 0.2, 3, 0, 2.3, 0, c || "#f6f6f2"), ...[-1, 1].flatMap((i) => [-1, 1].map((j) => box(0.05, 2.4, 0.05, i * 1.45, 0, j * 1.45, "#c8ccd0")))] }),
  cabana: (c) => ({ solid: [box(3.2, 0.12, 3.2, 0, 2.6, 0, c || "#8a3f2a"), ...[-1, 1].flatMap((i) => [-1, 1].map((j) => box(0.14, 2.6, 0.14, i * 1.45, 0, j * 1.45, c || "#8a3f2a"))), box(0.04, 2.3, 3, -1.45, 0.2, 0, "#f6f3ea")] }),
  fountain: () => ({ solid: [box(0.42, 0.85, 0.35, 0, 0, -0.03, "#b9bfc5"), box(0.48, 0.12, 0.42, 0, 0.85, 0, "#d5dadf"), cyl(0.12, 0.1, 0.05, 0, 0.97, 0.03, "#8e959c", 10)] }),
  filler: () => ({ solid: [box(0.55, 1.1, 0.12, 0, 0.5, -0.12, "#c9ced3"), box(0.4, 0.25, 0.25, 0, 0.95, 0, "#2a2f35"), box(0.35, 0.06, 0.2, 0, 0.75, 0, "#8e959c"), box(0.18, 0.12, 0.02, 0, 1.3, -0.05, "#3fa9f5")] }),
  vending: (c) => ({ solid: [box(1, 1.85, 0.82, 0, 0, 0, c || "#c62f2f"), box(0.62, 1.3, 0.03, -0.12, 0.35, 0.41, "#f4f1e6"), box(0.2, 0.55, 0.03, 0.34, 0.9, 0.41, "#1d1f22"), box(0.6, 0.18, 0.03, -0.12, 0.1, 0.41, "#1d1f22")], glass: [box(0.62, 1.3, 0.02, -0.12, 0.35, 0.43, "#bfe3ff")] }),
  bin: (c) => ({ solid: [cyl(0.26, 0.24, 0.85, 0, 0, 0, c || "#3b4148", 10), cyl(0.28, 0.28, 0.08, 0, 0.85, 0, c || "#2b2f36", 10)] }),
  recycle: (c) => ({ solid: [cyl(0.26, 0.24, 0.85, 0, 0, 0, c || "#2f6fb8", 10), cyl(0.28, 0.28, 0.08, 0, 0.85, 0, "#e6e6e6", 10)] }),
  waitboard: (c) => ({
    solid: [
      ...[-1, 1].map((i) => box(0.08, 1.9, 0.08, i * 1.05, 0, 0, "#2b2f36")),
      box(2.2, 0.32, 0.06, 0, 1.55, 0, c || "#f2c21a"),
      box(2.1, 0.06, 0.25, 0, 0.95, 0.05, "#3a3f45"),
      ...[-0.8, -0.48, -0.16, 0.16, 0.48, 0.8].map((x, k) => paint(new THREE.CylinderGeometry(0.11, 0.11, 0.015, 10).rotateX(Math.PI / 2), ["#e2442f", "#2f6fb8", "#2fb86b", "#f39a1e", "#7a3fb8", "#1d1f22"][k], x, 1.12, 0.1)),
    ],
  }),
  paddlerack: (c) => ({ solid: [box(1.2, 0.05, 0.25, 0, 0.9, 0, c || "#3a3f45"), ...[-1, 1].map((i) => box(0.05, 1.1, 0.05, i * 0.55, 0, 0, "#2b2f36")), ...[-0.4, -0.13, 0.13, 0.4].map((x, k) => paint(new THREE.CylinderGeometry(0.1, 0.1, 0.015, 10).rotateX(Math.PI / 2), ["#e2442f", "#2f6fb8", "#2fb86b", "#f39a1e"][k], x, 1.0, 0.05))] }),
  courtsign: (c) => ({ solid: [cyl(0.04, 0.04, 2.2, 0, 0, 0, "#2b2f36", 6), box(0.5, 0.5, 0.03, 0, 1.6, 0.03, c || "#f4f4f2"), box(0.3, 0.3, 0.035, 0, 1.7, 0.035, "#1f3a6e")] }),
  scoreboard: () => ({ solid: [cyl(0.04, 0.04, 1.5, -0.35, 0, 0, "#2b2f36", 6), cyl(0.04, 0.04, 1.5, 0.35, 0, 0, "#2b2f36", 6), box(0.9, 0.45, 0.06, 0, 1.0, 0, "#1d1f22"), box(0.32, 0.3, 0.07, -0.2, 1.07, 0, "#f4f4f2"), box(0.32, 0.3, 0.07, 0.2, 1.07, 0, "#f4f4f2")] }),
  machine: () => ({ solid: [box(0.55, 0.5, 0.5, 0, 0.05, 0, "#2b2b2b"), cyl(0.3, 0.22, 0.35, 0, 0.55, 0, "#3a6fd6", 12), box(0.06, 0.06, 0.35, 0, 0.35, 0.3, "#111")] }),
  // (round 3: each seat two aluminum planks with a gap, a foot plank, end frames and a back rail)
  bleacher: (c) => ({
    solid: [0, 1, 2]
      .flatMap((k) => [box(4.5, 0.045, 0.14, 0, 0.42 + k * 0.42, 0.67 - k * 0.6, c || "#b9c0c8"), box(4.5, 0.045, 0.14, 0, 0.42 + k * 0.42, 0.52 - k * 0.6, c || "#b9c0c8"), box(4.5, 0.03, 0.24, 0, 0.2 + k * 0.42, 0.82 - k * 0.6, c || "#a9b0b8")])
      .concat([-2.1, 0, 2.1].map((x) => box(0.06, 1.3, 1.8, x, 0, 0, "#3a3f47")))
      .concat([-2.2, 2.2].map((x) => box(0.04, 0.9, 0.04, x, 1.3, -0.82, "#9aa2aa")), [box(4.44, 0.04, 0.04, 0, 2.18, -0.82, "#9aa2aa")]),
  }),
  spa: (c) => ({ solid: [cyl(1.6, 1.6, 0.5, 0, 0, 0, c || "#e6e0d2", 20), disc(1.35, 0, 0.51, 0, "#5ed1e8", 20), paint(new THREE.TorusGeometry(1.48, 0.12, 4, 20).rotateX(Math.PI / 2), "#d8d1c2", 0, 0.52, 0)] }),
  treadmill: () => ({ solid: [box(0.75, 0.2, 1.8, 0, 0, 0.1, "#2a2d31"), box(0.55, 0.02, 1.5, 0, 0.2, 0.15, "#111316"), ...[-1, 1].map((i) => box(0.05, 1.2, 0.08, i * 0.33, 0.2, -0.7, "#3a3e44")), box(0.75, 0.3, 0.2, 0, 1.15, -0.72, "#1f2226"), box(0.45, 0.22, 0.03, 0, 1.25, -0.6, "#3fa9f5")] }),
  bike: () => ({ solid: [box(0.12, 0.08, 1.1, 0, 0, 0, "#2a2d31"), box(0.1, 0.8, 0.1, 0, 0.05, 0.3, "#3a3e44"), box(0.28, 0.08, 0.3, 0, 0.85, 0.35, "#111316"), box(0.1, 1.0, 0.1, 0, 0.05, -0.35, "#3a3e44"), box(0.5, 0.06, 0.12, 0, 1.05, -0.4, "#1f2226"), cyl(0.22, 0.22, 0.08, 0, 0.18, -0.2, "#c62f2f", 12)] }),
  elliptical: () => ({ solid: [box(0.6, 0.15, 1.7, 0, 0, 0, "#2a2d31"), box(0.12, 1.4, 0.12, 0, 0.1, -0.6, "#3a3e44"), ...[-1, 1].map((i) => box(0.18, 0.05, 0.4, i * 0.18, 0.4, 0.2, "#111316")), ...[-1, 1].map((i) => box(0.04, 1.0, 0.04, i * 0.25, 0.5, -0.3, "#3a3e44")), box(0.4, 0.2, 0.05, 0, 1.4, -0.62, "#1f2226")] }),
  powerrack: () => ({ solid: [...[-1, 1].flatMap((i) => [-1, 1].map((j) => box(0.08, 2.3, 0.08, i * 0.62, 0, j * 0.65, "#1d1f22"))), ...[-1, 1].map((j) => box(1.32, 0.08, 0.08, 0, 2.22, j * 0.65, "#1d1f22")), box(1.9, 0.04, 0.04, 0, 1.35, 0.2, "#b9bfc5"), ...[-1, 1].map((i) => cyl(0.22, 0.22, 0.06, i * 0.9, 1.13, 0.2, "#111316", 12)), box(1.3, 0.03, 1.4, 0, 0, 0, "#3a2e22")] }),
  weightbench: () => ({ solid: [box(0.3, 0.1, 1.2, 0, 0.42, 0, "#1d1f22"), box(0.08, 0.42, 0.08, 0, 0, -0.45, "#3a3e44"), box(0.08, 0.42, 0.08, 0, 0, 0.45, "#3a3e44"), box(0.5, 0.05, 0.08, 0, 0, -0.45, "#3a3e44")] }),
  dumbbells: () => ({ solid: [box(2.4, 0.06, 0.5, 0, 0.45, 0, "#2b2f36"), box(2.4, 0.06, 0.5, 0, 0.8, -0.05, "#2b2f36"), ...[-1, 1].map((i) => box(0.06, 0.85, 0.5, i * 1.15, 0, 0, "#2b2f36")), ...Array.from({ length: 10 }, (_, k) => box(0.16, 0.12, 0.3, -1.05 + k * 0.23, 0.51, 0, "#15171a")), ...Array.from({ length: 8 }, (_, k) => box(0.18, 0.13, 0.3, -0.95 + k * 0.27, 0.86, -0.05, "#15171a"))] }),
  mirror: () => ({ solid: [box(3, 2.1, 0.03, 0, 0.3, -0.01, "#9fb4bf")] }),
  mat: (c) => ({ solid: [box(2, 0.03, 1.2, 0, 0, 0, c || "#1f2a3a")] }),
  lockers: (c) => ({
    solid: [box(2.4, 1.95, 0.48, 0, 0, 0, c || "#4f6f8f"), ...Array.from({ length: 6 }, (_, k) => box(0.015, 1.85, 0.01, -1.2 + (k + 1) * 0.343, 0.05, 0.245, "#2b3a4a")), box(2.4, 0.015, 0.01, 0, 0.98, 0.245, "#2b3a4a"), ...Array.from({ length: 7 }, (_, k) => box(0.02, 0.08, 0.02, -1.08 + k * 0.343, 1.05, 0.25, "#d5dadf"))],
  }),
  sink: () => ({ solid: [box(2.4, 0.1, 0.55, 0, 0.82, 0, "#e9e6df"), box(2.4, 0.82, 0.05, 0, 0, -0.25, "#cfcac0"), ...[-0.6, 0.6].map((x) => box(0.4, 0.04, 0.3, x, 0.9, 0.02, "#f7f7f5")), ...[-0.6, 0.6].map((x) => box(0.04, 0.2, 0.04, x, 0.92, -0.18, "#b9bfc5")), box(2.3, 1.0, 0.03, 0, 1.1, -0.27, "#a9bcc6")] }),
  stall: (c) => ({ solid: [box(0.04, 1.8, 1.6, -0.5, 0.15, 0, c || "#8a9aa6"), box(0.04, 1.8, 1.6, 0.5, 0.15, 0, c || "#8a9aa6"), box(0.62, 1.7, 0.04, 0.17, 0.2, 0.8, c || "#7a8a96"), box(0.36, 0.4, 0.55, 0, 0, -0.45, "#f4f4f2")] }),
  shower: (c) => ({ solid: [box(0.05, 2.2, 1.1, -0.55, 0, 0, c || "#c9d6dc"), box(0.05, 2.2, 1.1, 0.55, 0, 0, c || "#c9d6dc"), box(1.1, 2.2, 0.05, 0, 0, -0.55, c || "#c9d6dc"), cyl(0.1, 0.1, 0.04, 0, 1.95, -0.35, "#b9bfc5", 10), box(1.1, 0.04, 1.1, 0, 0, 0, "#dfe6e9")], glass: [box(1.0, 1.9, 0.02, 0, 0.1, 0.55, "#d8eef5")] }),
  saunabench: (c) => ({ solid: [box(2.4, 0.06, 0.6, 0, 0.45, 0.3, c || "#c8955c"), box(2.4, 0.06, 0.6, 0, 0.9, -0.3, c || "#c8955c"), box(2.4, 0.45, 0.04, 0, 0, 0.58, "#a8784a"), box(2.4, 0.45, 0.04, 0, 0.45, 0, "#a8784a")] }),
  heater: () => ({ solid: [box(0.5, 0.6, 0.4, 0, 0, 0, "#3a3e44"), box(0.55, 0.2, 0.45, 0, 0.6, 0, "#6b6f74"), box(0.6, 0.6, 0.05, 0, 0.1, 0.28, "#a8784a")] }),
  tilebench: () => ({ solid: [box(2.4, 0.45, 0.5, 0, 0, 0, "#c3ced3")] }),
  desk: (c) => ({ solid: [box(3.2, 1.05, 0.75, 0, 0, 0, c || "#3d3a36"), box(3.3, 0.06, 0.9, 0, 1.05, 0.05, "#e8e2d4"), box(3.0, 0.3, 0.03, 0, 0.6, 0.38, "#c8a46a"), box(0.5, 0.35, 0.04, -0.6, 1.11, -0.15, "#1d1f22"), box(0.5, 0.35, 0.04, 0.7, 1.11, -0.15, "#1d1f22")] }),
  officedesk: () => ({ solid: [box(1.6, 0.04, 0.8, 0, 0.72, 0, "#c8b89a"), ...legs4(1.55, 0.75, 0.72, "#3a3e44", 0.04), box(0.55, 0.35, 0.03, 0, 0.76, -0.25, "#1d1f22")] }),
  shelf: (c) => ({ solid: [box(1.8, 2.0, 0.05, 0, 0, -0.22, c || "#e8e4da"), ...[0.05, 0.5, 0.95, 1.4, 1.85].map((y) => box(1.8, 0.04, 0.45, 0, y, 0, c || "#e8e4da")), ...Array.from({ length: 12 }, (_, k) => box(0.22, 0.28, 0.3, -0.75 + (k % 6) * 0.3, 0.55 + Math.floor(k / 6) * 0.45, 0, ["#e2442f", "#2f6fb8", "#f2c21a", "#2fb86b", "#1d1f22", "#f4f4f2"][k % 6]))] }),
  paddlewall: () => ({ solid: [box(3, 2.2, 0.06, 0, 0, -0.05, "#d8cbb0"), ...Array.from({ length: 18 }, (_, k) => paint(new THREE.CylinderGeometry(0.11, 0.11, 0.02, 10).rotateX(Math.PI / 2), ["#e2442f", "#2f6fb8", "#2fb86b", "#f39a1e", "#7a3fb8", "#1d1f22"][k % 6], -1.25 + (k % 6) * 0.5, 0.6 + Math.floor(k / 6) * 0.55, 0.0))] }),
  sofa: (c) => ({ solid: [box(2.1, 0.42, 0.85, 0, 0.08, 0, c || "#3d4f6b"), box(2.1, 0.45, 0.2, 0, 0.45, -0.33, c || "#3d4f6b"), box(0.18, 0.25, 0.85, -0.96, 0.45, 0, c || "#3d4f6b"), box(0.18, 0.25, 0.85, 0.96, 0.45, 0, c || "#3d4f6b"), box(2.0, 0.08, 0.8, 0, 0, 0, "#2b2f36")] }),
  armchair: (c) => ({ solid: [box(0.85, 0.42, 0.8, 0, 0.08, 0, c || "#3d4f6b"), box(0.85, 0.42, 0.18, 0, 0.45, -0.31, c || "#3d4f6b"), box(0.15, 0.22, 0.8, -0.35, 0.45, 0, c || "#3d4f6b"), box(0.15, 0.22, 0.8, 0.35, 0.45, 0, c || "#3d4f6b")] }),
  coffeetable: (c) => ({ solid: [box(1.2, 0.05, 0.6, 0, 0.38, 0, c || "#6b4a2b"), ...legs4(1.15, 0.55, 0.38, "#2b2f36", 0.04)] }),
  tv: () => ({ solid: [box(1.5, 0.86, 0.06, 0, 1.6, 0, "#121316"), box(1.4, 0.76, 0.01, 0, 1.65, 0.035, "#1f3d6b")] }),
  rug: (c) => ({ solid: [box(3, 0.012, 2, 0, 0.005, 0, c || "#8a6f5a")] }),
  // (just over a room's floor, which is drawn 1.5 cm up: scenery.js)
  courtline: (c) => ({ solid: [box(1, 0.004, 0.05, 0, 0.019, 0, c || "#f4f1ea")] }),
  plant: () => ({ solid: [cyl(0.24, 0.18, 0.45, 0, 0, 0, "#d9d2c4", 10), paint(new THREE.IcosahedronGeometry(0.42, 0), "#3f7a3a", 0, 0.95, 0)] }),
  planter: (c) => ({ solid: [box(2, 0.6, 0.8, 0, 0, 0, c || "#c9c1b0"), paint(new THREE.BoxGeometry(1.8, 0.5, 0.65), "#3f6b34", 0, 0.82, 0)] }),
  counter: (c) => ({ solid: [box(3, 1.02, 0.65, 0, 0, 0, c || "#5a3a26"), box(3.1, 0.06, 0.8, 0, 1.02, 0.05, "#2a2622"), box(3, 0.1, 0.04, 0, 0.15, 0.33, "#b8892f")] }),
  backbar: () => ({ solid: [box(3, 2.3, 0.45, 0, 0, 0, "#3b2a1e"), box(2.6, 0.7, 0.02, 0, 1.4, 0.23, "#9fb7c4"), ...Array.from({ length: 20 }, (_, k) => cyl(0.04, 0.045, 0.28, -1.3 + (k % 10) * 0.29, 1.05 + Math.floor(k / 10) * 0.55, 0.25, ["#4f8a3f", "#8a5a2a", "#c9b07a", "#2f4f6f", "#7a2a2a"][k % 5], 6))] }),
  stairs: (c) => {
    // straight run up along +z: 15 steps, rails both sides
    const parts = []
    const n = 15
    for (let k = 0; k < n; k++) parts.push(box(1.6, (2.8 * (k + 1)) / n, 4 / n, 0, 0, -2 + (4 * (k + 0.5)) / n, c || "#cfc8b8"))
    for (const i of [-1, 1]) {
      parts.push(paint(new THREE.BoxGeometry(0.05, 0.05, 4.9), "#2b2f36", i * 0.78, 1.85, 0, 0, -Math.atan2(2.8, 4)))
      for (const z of [-1.9, 0, 1.9]) parts.push(box(0.04, 0.95, 0.04, i * 0.78, 0.95 + (2.8 * (z + 2)) / 4 - 0.95, z, "#2b2f36"))
    }
    return { solid: parts }
  },
  // a garden wall: stucco with a cap (Paseo's fountain courtyard)
  stuccowall: (c) => ({ solid: [box(2, 2.2, 0.3, 0, 0, 0, c || "#e4d8bd"), box(2.02, 0.08, 0.36, 0, 2.2, 0, "#efe8d8")] }),
  partition: (c) => ({ solid: [box(2, 0.05, 0.05, 0, 1.05, 0, c || "#2b2f36"), box(0.05, 1.1, 0.05, -0.98, 0, 0, c || "#2b2f36"), box(0.05, 1.1, 0.05, 0.98, 0, 0, c || "#2b2f36")], glass: [box(1.9, 0.95, 0.02, 0, 0.08, 0, "#1d1f22")] }),
  glasswall: () => ({ solid: [box(2, 0.06, 0.06, 0, 2.34, 0, "#3a3e44"), box(2, 0.06, 0.06, 0, 0, 0, "#3a3e44")], glass: [box(2, 2.3, 0.02, 0, 0.05, 0, "#cfe6ef")] }),
  kidsmat: (c) => ({ solid: [box(2, 0.04, 2, 0, 0, 0, c || "#f4b942")] }),
  toybox: (c) => ({ solid: [box(0.9, 0.5, 0.5, 0, 0, 0, c || "#e2442f"), box(0.92, 0.05, 0.52, 0, 0.5, 0, "#f2c21a")] }),
  smalltable: (c) => ({ solid: [box(0.8, 0.04, 0.6, 0, 0.48, 0, c || "#7ac0e0"), ...legs4(0.75, 0.55, 0.48, "#f2c21a", 0.04)] }),
  door: (c) => ({ solid: [box(1.0, 2.15, 0.05, 0, 0, 0, c || "#8a6a4a"), box(0.04, 0.04, 0.12, 0.38, 1.0, 0.05, "#d5dadf")] }),
  lobbyfountain: (c) => ({ solid: [cyl(1.2, 1.25, 0.45, 0, 0, 0, c || "#cfc3ae", 16), disc(1.05, 0, 0.46, 0, "#7fc8dc", 16), cyl(0.18, 0.25, 0.9, 0, 0.45, 0, c || "#cfc3ae", 10), cyl(0.6, 0.45, 0.12, 0, 1.3, 0, c || "#cfc3ae", 12), disc(0.5, 0, 1.43, 0, "#7fc8dc", 12), cyl(0.08, 0.12, 0.4, 0, 1.42, 0, c || "#cfc3ae", 8), cyl(0.22, 0.15, 0.08, 0, 1.82, 0, c || "#cfc3ae", 10)] }),
  pooltable: (c) => ({ solid: [box(1.4, 0.18, 2.6, 0, 0.62, 0, "#4a2e1c"), box(1.24, 0.02, 2.44, 0, 0.8, 0, c || "#1f3a6e"), ...legs4(1.2, 2.3, 0.62, "#3a2414", 0.12, 0.1)] }),
  flagpole: () => ({ solid: [cyl(0.05, 0.07, 9, 0, 0, 0, "#d5dadf", 8), box(1.6, 1.0, 0.02, 0.82, 7.8, 0, "#b8323a"), box(0.65, 0.54, 0.025, 0.33, 8.26, 0, "#2b3f7a"), ...[0, 1, 2].map((k) => box(1.6, 0.11, 0.025, 0.82, 7.85 + k * 0.29, 0, "#f4f4f2"))] }),
  hoop: () => ({ solid: [box(0.15, 3.9, 0.15, 0, 0, -0.6, "#2b2f36"), box(0.15, 0.12, 1.2, 0, 3.4, -0.05, "#2b2f36"), box(1.8, 1.05, 0.05, 0, 2.9, 0.55, "#f4f4f2"), box(0.6, 0.45, 0.06, 0, 3.0, 0.56, "#d8483a"), paint(new THREE.TorusGeometry(0.23, 0.015, 4, 12).rotateX(Math.PI / 2), "#e0662a", 0, 3.05, 0.85)] }),
  massagebed: () => ({ solid: [box(0.75, 0.12, 1.95, 0, 0.6, 0, "#f4efe6"), box(0.7, 0.05, 1.85, 0, 0.55, 0, "#8a6a4a"), ...legs4(0.65, 1.8, 0.55, "#8a6a4a", 0.06)] }),
  pingpong: (c) => ({ solid: [box(1.53, 0.04, 2.74, 0, 0.72, 0, c || "#1f2f6a"), box(1.53, 0.005, 0.03, 0, 0.765, 0, "#f4f4f2"), box(0.02, 0.005, 2.74, 0, 0.765, 0, "#f4f4f2"), box(1.7, 0.15, 0.02, 0, 0.765, 0, "#1d1f22"), ...legs4(1.4, 2.5, 0.72, "#2b2f36", 0.05)] }),
  startblock: () => ({ solid: [box(0.5, 0.12, 0.55, 0, 0.62, 0, "#f4f4f2"), box(0.1, 0.62, 0.4, 0, 0, -0.05, "#d5dadf")] }),
  // irregular stone pavers on a strip (a spectator walkway): stones in greys and tans, grout between
  flagstone: (c) => {
    const parts = [box(4, 0.008, 3, 0, 0, 0, "#4a4b46")]
    const r = seeded(7)
    const tones = c ? [c] : ["#8a8a80", "#7d7c72", "#9a948a", "#6f716b", "#a39b8c", "#858378"]
    for (let x = -1.85; x < 1.9; x += 0.62)
      for (let z = -1.35; z < 1.4; z += 0.5) {
        const w = 0.42 + r() * 0.16
        const d = 0.32 + r() * 0.14
        parts.push(paint(new THREE.BoxGeometry(w, 0.02, d), tones[Math.floor(r() * tones.length)], x + (r() - 0.5) * 0.12, 0.01, z + (r() - 0.5) * 0.1, (r() - 0.5) * 0.5))
      }
    return { solid: parts }
  },
  // a decorative tree with white blossoms in a planter (an indoor prop)
  blossomtree: (c) => ({
    solid: [
      box(0.9, 0.5, 0.9, 0, 0, 0, "#2b2b2b"),
      cyl(0.06, 0.09, 1.9, 0, 0.5, 0, "#4a3a2c", 6),
      ...[[0, 2.5, 0, 0.75], [0.45, 2.2, 0.2, 0.5], [-0.4, 2.3, -0.25, 0.55], [0.1, 2.85, -0.3, 0.45], [-0.2, 2.15, 0.4, 0.45]].map(([x, y, z, s]) => paint(new THREE.IcosahedronGeometry(s, 0), c || "#f4f1ec", x, y, z)),
    ],
  }),
  // a square concrete fire pit with its glow (Whittier Narrows' turf lounge)
  firepit: (c) => ({ solid: [box(1.4, 0.4, 1.4, 0, 0, 0, c || "#9a958c"), box(1.0, 0.04, 1.0, 0, 0.4, 0, "#2b2522"), box(0.7, 0.06, 0.7, 0, 0.43, 0, "#e8762c")] }),
  cooler: (c) => ({ solid: [box(0.62, 0.38, 0.42, 0, 0, 0, c || "#2f6fb8"), box(0.64, 0.07, 0.44, 0, 0.38, 0, "#f4f4f2"), box(0.3, 0.03, 0.05, 0, 0.47, 0, "#2b2f36")] }),
  // a drinks fridge: dark case, glass door lit green, shelves of cans
  fridge: (c) => ({
    solid: [box(0.8, 2.0, 0.7, 0, 0, 0, c || "#1d1f22"), box(0.66, 1.6, 0.02, 0, 0.25, 0.35, "#7dffa8"), ...[0.45, 0.85, 1.25, 1.6].flatMap((y) => [box(0.62, 0.02, 0.5, 0, y, 0.05, "#e9f7ee"), ...[-0.22, -0.07, 0.08, 0.23].map((x, k) => cyl(0.035, 0.035, 0.14, x, y + 0.02, 0.2, ["#e2442f", "#2f6fb8", "#f2c21a", "#f4f4f2"][k], 6))]), box(0.7, 0.18, 0.02, 0, 1.8, 0.36, "#2fb86b")],
    glass: [box(0.66, 1.6, 0.02, 0, 0.25, 0.37, "#c8ffe0")],
  }),
  foldchair: (c) => ({ solid: [box(0.42, 0.03, 0.4, 0, 0.45, 0.02, c || "#d9d9d6"), box(0.42, 0.3, 0.03, 0, 0.55, -0.2, c || "#d9d9d6"), ...[-1, 1].map((i) => paint(new THREE.BoxGeometry(0.025, 0.95, 0.025), "#9aa0a6", i * 0.2, 0.45, 0, 0, 0.35)), ...[-1, 1].map((i) => paint(new THREE.BoxGeometry(0.025, 0.6, 0.025), "#9aa0a6", i * 0.2, 0.28, 0.05, 0, -0.45))] }),
  // a championship banner hanging on the wall (our own: a trophy shape, stars, stripes; no text)
  banner: (c) => ({ solid: [box(1.1, 2.0, 0.02, 0, 0.2, 0, c || "#a83a2c"), box(1.2, 0.05, 0.04, 0, 2.2, 0, "#2b2f36"), box(0.5, 0.35, 0.025, 0, 1.4, 0, "#f2c21a"), box(0.12, 0.25, 0.025, 0, 1.12, 0, "#f2c21a"), box(0.3, 0.07, 0.025, 0, 1.03, 0, "#f2c21a"), ...[-0.3, 0, 0.3].map((x) => box(0.1, 0.1, 0.025, x, 0.6, 0, "#f4f4f2")), box(1.1, 0.06, 0.025, 0, 0.4, 0, "#f4f4f2"), paint(new THREE.ConeGeometry(0.55, 0.2, 3).rotateZ(Math.PI), c || "#a83a2c", 0, 0.12, 0)] }),
  // a court-number card: white, black seven-segment digits (n), our own sign
  numcard: (c, n) => ({ solid: [box(0.6, 0.6, 0.02, 0, 0, 0, c || "#f4f4f2"), ...digitParts(String(n ?? "")).map(([w, h, x, y]) => box(w, h, 0.02, x, y, 0.012, "#151515"))] }),
  exitsign: () => ({ solid: [box(0.42, 0.2, 0.08, 0, 0, 0, "#f4f4f2"), box(0.34, 0.12, 0.01, 0, 0.04, 0.045, "#2fd36b")] }),
  extinguisher: () => ({ solid: [box(0.3, 0.3, 0.02, 0, 0.55, -0.08, "#d23a2a"), cyl(0.08, 0.08, 0.45, 0, 0.05, 0, "#d23a2a", 10), cyl(0.03, 0.04, 0.1, 0, 0.5, 0, "#2b2f36", 6)] }),
  // framed art: a dark frame round blocks of color (abstract, our own)
  wallart: (c) => {
    const r = seeded((c || "art").length * 131 + 17)
    const pal = c ? [c, "#f4f1e6", "#2b2f36"] : [["#e8602a", "#2a96cc", "#f2c21a", "#f4f1e6"], ["#6f9a45", "#2b4f7a", "#d9c7a3", "#f4f1e6"], ["#b8323a", "#1f2858", "#e9e2cf", "#7fc0d0"]][Math.floor(r() * 3)]
    const parts = [box(1.2, 0.9, 0.04, 0, 0, 0, "#2b2722"), box(1.08, 0.78, 0.01, 0, 0.06, 0.022, pal[3] || "#f4f1e6")]
    for (let k = 0; k < 4; k++) parts.push(box(0.2 + r() * 0.45, 0.15 + r() * 0.35, 0.01, (r() - 0.5) * 0.6, 0.15 + r() * 0.45, 0.03, pal[k % 3]))
    return { solid: parts }
  },
  signpanel: (c) => ({ solid: [box(1.8, 0.5, 0.05, 0, 0, 0, c || "#1f2858"), box(1.6, 0.06, 0.01, 0, 0.12, 0.03, "#f4f4f2"), box(1.0, 0.06, 0.01, -0.3, 0.3, 0.03, "#f4f4f2"), paint(new THREE.CircleGeometry(0.14, 12), "#f2c21a", 0.6, 0.3, 0.031)] }),
  // a pendant light: cord and a shade (hangs from its y)
  pendant: (c) => ({ solid: [cyl(0.008, 0.008, 0.5, 0, 0.2, 0, "#1d1f22", 4), paint(new THREE.ConeGeometry(0.22, 0.2, 12, 1, true), c || "#1d1f22", 0, 0.1, 0), disc(0.18, 0, 0.0, 0, "#fff6d8", 12)] }),
  // black netting curtain hanging from a rail (dividers at the ends of indoor courts)
  curtain: () => ({ solid: [box(3, 0.06, 0.06, 0, 3.95, 0, "#1d1f22")], glass: [box(3, 3.9, 0.02, 0, 0.02, 0, "#0e0f10")] }),
  // a waist-high black rail with cables between posts
  railing: (c) => ({ solid: [box(2, 0.05, 0.05, 0, 0.98, 0, c || "#151515"), ...[-0.98, 0, 0.98].map((x) => box(0.05, 1.0, 0.05, x, 0, 0, c || "#151515")), ...[0.3, 0.55, 0.8].map((y) => box(2, 0.012, 0.012, 0, y, 0, "#5a5f66"))] }),
  bagpile: () => ({ solid: [box(0.45, 0.3, 0.3, -0.2, 0, 0, "#2b2f36"), box(0.35, 0.25, 0.25, 0.22, 0, 0.05, "#7a3fb8"), cyl(0.04, 0.04, 0.22, 0.05, 0.3, -0.05, "#2f6fb8", 6)] }),
  // a check-in counter (lighter top, a screen, the club color along the front)
  checkin: (c) => ({ solid: [box(2.4, 1.05, 0.7, 0, 0, 0, c || "#2b2f36"), box(2.5, 0.05, 0.85, 0, 1.05, 0.05, "#e8e2d4"), box(2.3, 0.18, 0.02, 0, 0.75, 0.36, "#f2c21a"), box(0.45, 0.32, 0.04, -0.5, 1.1, -0.15, "#1d1f22"), box(0.25, 0.2, 0.15, 0.6, 1.1, -0.05, "#3a3e44")] }),
  cafetable: (c) => ({ solid: [cyl(0.35, 0.35, 0.03, 0, 0.73, 0, c || "#e8e2d4", 12), cyl(0.03, 0.03, 0.73, 0, 0, 0, "#2b2f36", 6), cyl(0.22, 0.22, 0.02, 0, 0, 0, "#2b2f36", 10)] }),
  umbrellastand: () => ({ solid: [cyl(0.15, 0.18, 0.55, 0, 0, 0, "#2b2f36", 8)] }),
  towels: (c) => ({ solid: [box(1.0, 1.6, 0.42, 0, 0, 0, "#e8e2d4"), ...[0.35, 0.75, 1.15].flatMap((y) => [box(0.92, 0.03, 0.38, 0, y, 0, "#cfc8b8"), ...[-0.3, 0, 0.3].map((x) => box(0.26, 0.2, 0.3, x, y + 0.03, 0, c || "#f4f4f2"))])] }),
  scale: () => ({ solid: [box(0.4, 0.06, 0.4, 0, 0, 0, "#3a3e44"), box(0.05, 1.1, 0.05, 0, 0.06, -0.15, "#9aa0a6"), box(0.3, 0.2, 0.06, 0, 1.0, -0.15, "#e8e8e6")] }),
}

// seven-segment digits (a court card's number): parts [w, h, x, y] for a string of digits
const SEG = { 0: "abcdef", 1: "bc", 2: "abdeg", 3: "abcdg", 4: "bcfg", 5: "acdfg", 6: "acdefg", 7: "abc", 8: "abcdefg", 9: "abcdfg" }
const digitParts = (s) => {
  const n = s.length
  if (!n) return []
  const dw = Math.min(0.2, 0.44 / n)
  const dh = 0.34
  const t = 0.035
  const out = []
  for (let k = 0; k < n; k++) {
    const segs = SEG[s[k]] || ""
    const cx = (k - (n - 1) / 2) * (dw + 0.06)
    const y0 = 0.13
    const L = { a: [dw, t, cx, y0 + dh - t], g: [dw, t, cx, y0 + dh / 2 - t / 2], d: [dw, t, cx, y0], b: [t, dh / 2, cx + dw / 2 - t / 2, y0 + dh / 2], c: [t, dh / 2, cx + dw / 2 - t / 2, y0], f: [t, dh / 2, cx - dw / 2 + t / 2, y0 + dh / 2], e: [t, dh / 2, cx - dw / 2 + t / 2, y0] }
    for (const sg of segs) out.push(L[sg])
  }
  return out
}
function seeded(seed) {
  let s = seed >>> 0 || 1
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}

const cache = new Map()
// the template geometries of a type in a color: { solid, glass } (BufferGeometry or null)
const template = (t, c, keep, n = null) => {
  const key = `${t}|${c || ""}|${n ?? ""}`
  if (!cache.has(key)) {
    const make = T[t]
    if (!make) return null
    const p = make(c || null, n)
    const merge = (list) => (list && list.length ? mergeGeometries(list, false) : null)
    const tpl = { solid: merge(p.solid), glass: merge(p.glass) }
    for (const g of [...(p.solid || []), ...(p.glass || [])]) g.dispose()
    cache.set(key, tpl)
  }
  return cache.get(key)
}

// the shared materials (one per build: venue.js disposes through keep)
export const propMaterials = (keep) => ({
  solid: keep(new THREE.MeshLambertMaterial({ vertexColors: true })),
  glass: keep(new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide })),
})

// add the props to a group (as plain meshes: mergeStatic merges them): props from propkit
// ({ t, x, z, a, y, s, c, w })
export const addProps = (group, props, mats, keep) => {
  let n = 0
  for (const pr of props) {
    const tpl = template(pr.t, pr.c, keep, pr.n ?? null)
    if (!tpl) continue
    const base = PROPS[pr.t] || {}
    const sx = (pr.s || 1) * (pr.w && base.w ? pr.w / base.w : 1)
    const sy = (pr.s || 1) * (pr.h && base.h ? pr.h / base.h : 1)
    const sz = (pr.s || 1) * (pr.d && base.d ? pr.d / base.d : 1)
    for (const [geo, mat] of [
      [tpl.solid, mats.solid],
      [tpl.glass, mats.glass],
    ]) {
      if (!geo) continue
      const m = new THREE.Mesh(geo, mat)
      m.position.set(pr.x, pr.y || 0, pr.z)
      m.rotation.y = pr.a || 0
      m.scale.set(sx, sy, sz)
      if (mat === mats.glass) m.renderOrder = 1
      group.add(m)
      n++
    }
  }
  return n
}

// the cached templates are shared by every build: free them when nothing uses them any more
export const disposePropTemplates = () => {
  for (const t of cache.values()) {
    t.solid?.dispose()
    t.glass?.dispose()
  }
  cache.clear()
}
