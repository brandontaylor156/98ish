// A made-up splat backdrop, generated here (no outside data, so no license question): a
// ring of SoCal hills, eucalyptus and palm clusters and low stucco buildings around a
// venue, as .splat bytes in venue meters (y up). Used for "Demo backdrop", the tests, and
// the frame-rate checks at 0.5M / 1M splats.
import { pointsToSplat } from "./files.js"

const rng = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}

export const synthBackdrop = ({ count = 300000, seed = 98, inner = 55, outer = 150, center = [0, 0] } = {}) => {
  const r = rng(seed)
  const pos = new Float32Array(count * 3)
  const col = new Uint8Array(count * 3)
  const put = (i, x, y, z, c) => {
    pos[i * 3] = center[0] + x
    pos[i * 3 + 1] = y
    pos[i * 3 + 2] = center[1] + z
    col[i * 3] = c[0]
    col[i * 3 + 1] = c[1]
    col[i * 3 + 2] = c[2]
  }
  const jitter = (c, a = 18) => c.map((v) => Math.max(0, Math.min(255, v + (r() - 0.5) * a)))
  // hills: a height field on the far ring (golden grass, chaparral greens)
  const hill = (ang, d) => 14 + 22 * Math.sin(ang * 3 + 1.3) ** 2 + 10 * Math.sin(ang * 7.1) + (d - inner) * 0.18
  // clusters of trees and buildings at fixed spots
  const trees = Array.from({ length: 40 }, () => ({ a: r() * Math.PI * 2, d: inner + r() * 25, palm: r() < 0.35 }))
  const blocks = Array.from({ length: 14 }, () => ({ a: r() * Math.PI * 2, d: inner + 5 + r() * 30, w: 8 + r() * 16, h: 4 + r() * 6 }))
  for (let i = 0; i < count; i++) {
    const kind = r()
    if (kind < 0.55) {
      const a = r() * Math.PI * 2
      const d = outer - (r() ** 2) * (outer - inner - 15)
      const top = hill(a, d)
      const y = r() * top
      const c = y > top * 0.6 ? jitter([196, 170, 110]) : jitter([110, 122, 80])
      put(i, Math.cos(a) * d, y, Math.sin(a) * d, c)
    } else if (kind < 0.85) {
      const t = trees[Math.floor(r() * trees.length)]
      const x0 = Math.cos(t.a) * t.d
      const z0 = Math.sin(t.a) * t.d
      if (r() < 0.25) {
        put(i, x0 + (r() - 0.5) * 0.5, r() * (t.palm ? 14 : 8), z0 + (r() - 0.5) * 0.5, jitter(t.palm ? [140, 120, 95] : [120, 110, 100]))
      } else {
        const u = r() * Math.PI * 2
        const v = Math.acos(2 * r() - 1)
        const rad = (t.palm ? 3 : 5) * Math.cbrt(r())
        const cy = t.palm ? 14 : 9
        put(i, x0 + rad * Math.sin(v) * Math.cos(u), cy + rad * Math.cos(v) * (t.palm ? 0.4 : 0.8), z0 + rad * Math.sin(v) * Math.sin(u), jitter(t.palm ? [70, 110, 50] : [60, 95, 55]))
      }
    } else {
      const b = blocks[Math.floor(r() * blocks.length)]
      const x0 = Math.cos(b.a) * b.d
      const z0 = Math.sin(b.a) * b.d
      const face = r()
      const lx = (r() - 0.5) * b.w
      const lz = (r() - 0.5) * b.w * 0.6
      if (face < 0.2) put(i, x0 + lx, b.h + 0.4 * r(), z0 + lz, jitter([178, 92, 62], 26)) // tile roof
      else put(i, x0 + (face < 0.6 ? lx : (Math.sign(lx) || 1) * b.w / 2), r() * b.h, z0 + (face < 0.6 ? (Math.sign(lz) || 1) * b.w * 0.3 : lz), jitter([232, 222, 200], 14))
    }
  }
  return pointsToSplat(pos, col, { size: 0.22, maxPoints: count })
}
