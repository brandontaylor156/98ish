// Pickleball 98 motion matching: gestures from motion capture, played by name (celebrations,
// frustration). Pure JavaScript (Node-tested). The legs keep doing what motion matching has
// them doing; a gesture gives only the arms: each elbow and wrist relative to its shoulder in
// the chest's own frame, so the arms move as captured from wherever the player's shoulders are
// (anim.js turns them into the mood's hand targets).

import { frameQ } from "./db.js"
import { B, NB, fk } from "./skeleton.js"
import { qinv, qrot } from "./quat.js"

// clip (name prefix in the database), the frames used (30 fps), what it is
export const GESTURES = {
  joy: { clip: "cmu79_69", from: 101, to: 131, about: "both arms up, waving: a big celebration (CMU 79_69, very happy)" },
  upset: { clip: "cmu79_74", from: 106, to: 132, about: "arms out to the sides, why?! (CMU 79_74, upset)" },
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })

// the arms of gesture `name`, t seconds in (held at the end): { l, r: { elbow, wrist, hand } }
// in the chest's frame (x: the body's left, y: up, z: forward; meters, from the shoulder),
// or null if the database doesn't have it
export const gestureArms = (lib, name, t) => {
  const g = GESTURES[name]
  if (!g || !lib) return null
  const db = lib.db
  const c = db.clips.find((k) => k.name.startsWith(g.clip))
  if (!c) return null
  const last = Math.min(g.to, c.n - 1)
  const x = Math.min(last, g.from + Math.max(0, t) * db.fps)
  const f0 = c.start + Math.floor(x)
  const D = new Array(NB)
  for (let b = 0; b < NB; b++) D[b] = frameQ(db, f0, b)
  const hip = { x: 0, y: db.hip[f0 * 3 + 1], z: 0 }
  const P = fk(D, hip)
  const inv = qinv(D[B.spine_03])
  const arm = (s) => {
    const sh = P[B["upperarm_" + s]]
    const hand = qrot(D[B["hand_" + s]], { x: s === "l" ? 0.09 : -0.09, y: 0, z: 0 })
    const w = P[B["hand_" + s]]
    return { elbow: qrot(inv, sub(P[B["lowerarm_" + s]], sh)), wrist: qrot(inv, sub(w, sh)), hand: qrot(inv, hand) }
  }
  return { l: arm("l"), r: arm("r"), u: (x - g.from) / Math.max(1, last - g.from) }
}
