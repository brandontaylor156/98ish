// A raised lounge walkway (SMASH's "spine": the reference pack's "raised lounge walkway ~5.5 m
// wide, ~0.9 m above courts ... sofas ... steps down to court level at both ends"). Pure: the
// generator (venuegen.js: a deck you walk on, its steps, solid sofas and frame posts) and the
// scenery (scenery.js: the drawing) both lay it out from here, so what you see is what you bump.
//
// x: the extra { x, z, deg, w, d, h, steps: ["east" | "west"] }. A spine without `steps` is a
// solid block as before.
// -> { u, v, at(u, v), deck: [[x, z] x4], stairs: [{ a, b, w, y0, y1 }], posts: [[x, z]],
//      sofas: [{ x, z, yaw }], walk }

const STEP_RUN = 0.3 // m of tread per 0.18 m riser
export const spineParts = (x) => {
  const w = x.w || 20
  const d = x.d || 5
  const h = x.h || 1
  const a = ((x.deg || 0) * Math.PI) / 180
  // (scenery.js turns it by -deg about y: its length runs along (cos a, sin a))
  const ux = Math.cos(a)
  const uz = Math.sin(a)
  const at = (u, v) => [x.x + u * ux - v * uz, x.z + u * uz + v * ux]
  const walk = Array.isArray(x.steps) && x.steps.length > 0
  const ends = walk ? x.steps.filter((s) => s === "east" || s === "west").map((s) => (s === "east" ? (ux >= 0 ? 1 : -1) : ux >= 0 ? -1 : 1)) : []
  const run = Math.max(1.2, Math.ceil(h / 0.18) * STEP_RUN)
  const sw = Math.min(d - 1.2, 3)
  const stairs = ends.map((e) => {
    const top = at((e * w) / 2, 0)
    const bot = at((e * w) / 2 + e * run, 0)
    return { a: bot, b: top, w: sw, y0: 0, y1: h }
  })
  const posts = []
  for (let u = -w / 2 + 1; u <= w / 2 - 1; u += 3) for (const v of [-d / 2 + 0.2, d / 2 - 0.2]) posts.push(at(u, v))
  // sofas: walkable, along the railings facing the court rows (alternating sides), none within
  // 5 m of the steps so the way on is open; a solid spine keeps them down the middle
  const sofas = []
  let k = 0
  for (let u = -w / 2 + 3; u < w / 2 - 2; u += 7) {
    if (walk) {
      if (ends.some((e) => Math.abs(u - (e * w) / 2) < 5)) continue
      const side = k++ % 2 ? 1 : -1
      const [sx, sz] = at(u, side * (d / 2 - 0.75))
      // (its back to the railing, facing the courts beyond it)
      sofas.push({ x: sx, z: sz, yaw: -a + (side > 0 ? 0 : Math.PI), side })
    } else {
      const [sx, sz] = at(u, 0)
      sofas.push({ x: sx, z: sz, yaw: -a })
    }
  }
  const deck = [at(-w / 2, -d / 2), at(w / 2, -d / 2), at(w / 2, d / 2), at(-w / 2, d / 2)]
  return { w, d, h, ux, uz, at, walk, deck, stairs, posts, sofas, ends }
}
