// Which court a match at a real venue plays on (when you didn't walk up to one in My Park):
// the first live court whose camera space is clear. The match camera looks over the near
// baseline from behind and above it, so anything standing there taller than a bench (SMASH's
// orange lounge spine behind courts 3-6, a room's wall right behind Court 9) would fill the
// picture. Pure (play.test.js).

import { toLocal } from "../park/layout.js"

// the camera's space behind the near baseline, in the court's frame (metres)
const ZONE = { x: 4, z0: 7.3, z1: 15, h: 1.5 }

// how many things stand in a court's camera space (pens are see-through chain-link and don't count)
export const cameraBlockers = (layout, court) => {
  let n = 0
  for (const b of layout.BOXES || []) {
    if (b.kind === "pen" || !((b.h || 0) > ZONE.h)) continue
    // (sample the box: its corners, edges and middle)
    let hit = false
    for (let i = -4; i <= 4 && !hit; i++)
      for (let j = -4; j <= 4 && !hit; j++) {
        const x = b.cx + (b.ux * b.hx * i) / 4 - (b.uz * b.hz * j) / 4
        const z = b.cz + (b.uz * b.hx * i) / 4 + (b.ux * b.hz * j) / 4
        const p = toLocal(court, x, z)
        hit = Math.abs(p.x) < ZONE.x && p.z > ZONE.z0 && p.z < ZONE.z1
      }
    if (hit) n++
  }
  return n
}

// the court to play on: the one you asked for (My Park remembers your last court there) if
// it's live, else the first live court with a clear camera, else the clearest
export const pickCourt = (layout, want = null) => {
  const courts = layout.COURTS || []
  const asked = courts.find((c) => c.id === want)
  if (asked) return asked
  let best = null
  let bestN = Infinity
  for (const c of courts) {
    const n = cameraBlockers(layout, c)
    if (n === 0) return c
    if (n < bestN) {
      best = c
      bestN = n
    }
  }
  return best || courts[0]
}
