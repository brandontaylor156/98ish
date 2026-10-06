// Spatial voice: the math (pure, no audio). utils/voice/session.js uses it to place each
// friend's voice; the tests check it without a browser.
//
// World: My Park's ground plane, x and z in meters; a heading `yaw` faces (sin yaw, cos yaw)
// and your right is (-cos yaw, sin yaw) (park/followcam.js). Web Audio: the listener sits at
// the origin facing -Z with +X to its right, so a voice ahead of you is at (0, 0, -d).

export const VOICE = {
  ref: 1.5, // full volume within this distance (meters)
  fadeFrom: 11, // then the distance model, plus our own fade to silence...
  fadeTo: 17, // ...gone by here (so a voice ~15 m away is barely there)
  radius: 25, // connect to people within this far...
  max: 6, // ...at most this many (the nearest)
  keep: 30, // a connection stays until they're this far (no flapping at the edge)
  courtOthers: 0.22, // "court mode": everyone not on your court plays this quietly
}

// where a voice at world (x, z) sits for a listener at (lx, lz) facing yaw
export const listenerRelative = (listener, source) => {
  const dx = source.x - listener.x
  const dz = source.z - listener.z
  const yaw = listener.yaw || 0
  const right = dx * -Math.cos(yaw) + dz * Math.sin(yaw)
  const ahead = dx * Math.sin(yaw) + dz * Math.cos(yaw)
  return { x: right, y: 0, z: -ahead }
}

const smoothstep = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// loudness by distance: an inverse falloff from `ref`, then a fade to silence
export const distanceGain = (d, v = VOICE) => {
  if (!Number.isFinite(d)) return 0
  const inverse = d <= v.ref ? 1 : v.ref / (v.ref + (d - v.ref))
  return inverse * (1 - smoothstep(v.fadeFrom, v.fadeTo, d))
}

// Whom to connect to: people with voice on within `radius`, nearest first, at most `max`.
// Someone already connected stays while within `keep` and among the nearest max + 2.
//   me { x, z }, others [{ id, x, z }], current Set(id) -> Set(id)
export const pickPeers = (me, others, current = new Set(), v = VOICE) => {
  const ranked = others
    .filter((o) => Number.isFinite(o.x) && Number.isFinite(o.z))
    .map((o) => ({ id: o.id, d: Math.hypot(o.x - me.x, o.z - me.z) }))
    .sort((a, b) => a.d - b.d || String(a.id).localeCompare(String(b.id)))
  const out = new Set()
  ranked.forEach((o, i) => {
    if (out.size >= v.max + 2) return
    if (i < v.max && o.d <= v.radius) out.add(o.id)
    else if (current.has(o.id) && o.d <= v.keep && i < v.max + 2) out.add(o.id)
  })
  return out
}

// "court mode": while you play a game on a court with others, your court-mates come
// through clearly and the rest of the park is turned down
export const courtGain = (id, courtMates, v = VOICE) => (!courtMates || !courtMates.length ? 1 : courtMates.includes(id) ? 1 : v.courtOthers)

// Come Over: a friend's cursor to your right sounds to your right; farther cursors a bit
// quieter. Positions are 0..1 of the screen.
export const cursorPan = (mine, theirs) => {
  if (!theirs) return { pan: 0, gain: 1 }
  const ref = mine || { x: 0.5, y: 0.5 }
  const pan = Math.max(-1, Math.min(1, (theirs.x - ref.x) * 1.6))
  const d = Math.hypot(theirs.x - ref.x, theirs.y - ref.y)
  return { pan, gain: 1 - 0.35 * Math.min(1, d) }
}

// Watch Together: while anyone talks, the video drops to `low` quickly and comes back slowly.
//   current 0..1 (1 = the video's own volume), talking boolean, dt seconds -> next
export const duckStep = (current, talking, dt, { low = 0.3, attack = 0.12, release = 0.9 } = {}) => {
  const target = talking ? low : 1
  const tau = talking ? attack : release
  const k = 1 - Math.exp(-Math.max(0, dt) / tau)
  return current + (target - current) * k
}

// is a level (RMS 0..1 from an analyser) speech? (with a little hysteresis)
export const talking = (level, was = false) => (was ? level > 0.018 : level > 0.03)
