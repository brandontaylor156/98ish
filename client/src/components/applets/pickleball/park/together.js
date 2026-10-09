// My Park "Together" (pure; Node-tested in together.test.js): things two people in the same
// park do together (the owner: "Me and my girlfriend. Add some other fun stuff at the venues
// that me and her can do together."). The server side, with the consent rules, is
// server/park/together.js.
//
// The owner's rule is "nothing moves your player for you". Here the only movement is what
// both of you said yes to: walking hand in hand or following (your own browser steers your
// own player beside or behind theirs) and stepping together for a hug or a selfie. Your own
// stick takes over at once: a push past BREAK_AWAY lets go (breaksAway), and stepping into
// place ends whenever you move yourself.
//
// Nothing here adds anything to a venue: a selfie is taken where you stand (the courts and
// the sky behind you), the sunset is watched from the benches and bleachers already there,
// and a dance has no speaker (the hangout's music has no object in the world).

import { itemName } from "./leisure/menu.js"

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)

// what you can do together. base: on the sheet at once; the rest under More options
export const TOGETHER = [
  { id: "hand", icon: "🤝", label: "Hold hands", base: true, ask: (n) => `${n} wants to hold hands`, sub: "They lead; your stick lets go" },
  { id: "selfie", icon: "📸", label: "Selfie", base: true, ask: (n) => `${n} wants a selfie together`, sub: "Saved to your Photos" },
  { id: "team", icon: "🎾", label: "Mixed doubles", base: true, ask: (n) => `${n} wants to play mixed doubles: you two vs the computers`, sub: "Us vs the computers, to 11" },
  { id: "date", icon: "🌙", label: "Date night", base: true, ask: (n) => `${n} asks you on a date night here`, sub: "Lights, music, a quiet park" },
  { id: "rally", icon: "🔁", label: "How long can we rally?", ask: (n) => `${n} wants to see how long you two can rally`, sub: "A co-op rally, your best kept" },
  { id: "sit", icon: "🪑", label: "Sit together", ask: (n) => `${n} wants to sit together`, sub: "The nearest free bench" },
  { id: "sunset", icon: "🌅", label: "Watch the sunset", ask: (n) => `${n} wants to watch the sunset with you`, sub: "Sit together, the sky time-lapses" },
  { id: "follow", icon: "👣", label: "Follow", ask: (n) => `${n} wants to follow you`, sub: "You walk behind them" },
  { id: "highfive", icon: "✋", label: "High five", ask: (n) => `${n} wants a high five` },
  { id: "hug", icon: "🤗", label: "Hug", ask: (n) => `${n} wants a hug` },
  { id: "twirl", icon: "💃", label: "Twirl", ask: (n) => `${n} wants to twirl you` },
  { id: "dance", icon: "🕺", label: "Dance", ask: (n) => `${n} wants to dance` },
  // (My Park activities, acts/: asked from the activity's own sheet at its spot, not this one)
  { id: "tennis", icon: "🎾", label: "Tennis", act: true, ask: (n, d) => (d?.mode === "rally" ? `${n} wants to rally at tennis with you` : `${n} wants to play you at tennis`) },
  { id: "horse", icon: "🏀", label: "H-O-R-S-E", act: true, ask: (n) => `${n} wants to play H-O-R-S-E with you` },
  { id: "workout", icon: "💪", label: "Work out", act: true, ask: (n) => `${n} wants to work out together` },
  // (My Park leisure, leisure/: asked from the pool's, the hot tub's and the counter's own sheets)
  { id: "swim", icon: "🏊", label: "Swim", act: true, ask: (n, d) => (d?.mode === "race" ? `${n} wants to race you in the pool` : `${n} wants to swim with you`) },
  { id: "tub", icon: "♨", label: "Hot tub", act: true, ask: (n) => `${n} wants to sit in the hot tub with you` },
  { id: "treat", icon: "🥤", label: "A treat", act: true, ask: (n, d) => `${n} wants to buy you ${itemName(d?.item) ? `a ${itemName(d.item).toLowerCase()}` : "something"}` },
]
export const TOGETHER_IDS = TOGETHER.map((t) => t.id)
export const togetherById = (id) => TOGETHER.find((t) => t.id === id) || null
export const LINK_KINDS = ["hand", "follow"]
export const EMOTE_KINDS = ["highfive", "hug", "twirl", "dance"]
// what each one stops as ("Let go", "Stop")
export const STOP_LABEL = { hand: "Let go", follow: "Stop following", date: "End date night", sunset: "Stand up", dance: "Stop dancing", selfie: "Cancel" }

// a key for a screen name (98 Messenger keys: no spaces, lower case)
export const nameKey = (n) => String(n || "").replace(/\s+/g, "").toLowerCase()

// the friend nearest you who's online in the park: your partner or a buddy, within `within`
// metres. people: [{ num, name, x, z, hidden, playing }]; friends: Set of name keys
export const nearestPal = (me, people, friends, within = 6) => {
  if (!friends || !friends.size) return null
  let best = null
  for (const p of people) {
    if (p.hidden || !friends.has(nameKey(p.name))) continue
    const d = dist(me, p)
    if (d <= within && (!best || d < best.d)) best = { num: p.num, name: p.name, d }
  }
  return best
}

// ---------- walking together ----------
export const BREAK_AWAY = 0.3 // how hard you push your own stick before it lets go
export const SIDE = 0.62 // hand in hand: the partner walks this far to the leader's right
export const BEHIND = 1.5 // following: this far behind
export const LEAD_S = 0.32 // the leader's position is this old here (interp.js DELAY): aim ahead
export const breaksAway = (input) => Math.hypot(input?.x || 0, input?.y || 0) > BREAK_AWAY || !!input?.keys

// the walker's frame (walker.js): forward (sin, cos), right (-cos, sin)
const fwdOf = (yaw) => ({ x: Math.sin(yaw), z: Math.cos(yaw) })
const rightOf = (yaw) => ({ x: -Math.cos(yaw), z: Math.sin(yaw) })

// where the one who isn't leading wants to be. leader: { x, z, yaw, vx, vz }; side: +1 on the
// leader's right, -1 on their left (whichever has room: a wall on one side, the other)
export const followTarget = (kind, leader, lead = LEAD_S, side = 1) => {
  const ax = leader.x + (leader.vx || 0) * lead
  const az = leader.z + (leader.vz || 0) * lead
  if (kind === "hand") {
    const r = rightOf(leader.yaw)
    return { x: ax + r.x * SIDE * side, z: az + r.z * SIDE * side, yaw: leader.yaw }
  }
  const f = fwdOf(leader.yaw)
  return { x: ax - f.x * BEHIND, z: az - f.z * BEHIND, yaw: leader.yaw }
}

// the move pad's push (x right, y forward, as walker.js reads it relative to the camera) that
// walks you toward a target at about the speed wanted. -> { x, y, sprint, arrived }
export const padToward = (me, target, camYaw, { speed = 0, stopWithin = 0.14 } = {}) => {
  const dx = target.x - me.x
  const dz = target.z - me.z
  const d = Math.hypot(dx, dz)
  if (d < stopWithin && speed < 0.25) return { x: 0, y: 0, sprint: false, arrived: true }
  // catch up quickly when far, match their pace when close
  const want = clamp(speed + d * 1.9, 0, 6.2)
  // (the last few steps at the slowest walk: right to the spot, not a quarter metre short)
  const mag = d >= stopWithin ? Math.max(magFor(want), 0.13) : magFor(want)
  if (mag === 0) return { x: 0, y: 0, sprint: false, arrived: d < 0.35 }
  const ux = dx / d
  const uz = dz / d
  const f = fwdOf(camYaw)
  const r = rightOf(camYaw)
  return { x: (ux * r.x + uz * r.z) * mag, y: (ux * f.x + uz * f.z) * mag, sprint: want > 4.8, arrived: false }
}
// walker.js speedFor, the other way: a speed -> how far to push the pad
export const magFor = (speed) => {
  if (speed < 0.45) return 0
  if (speed <= 1.45) return clamp(0.12 + ((speed / 1.45 - 0.45) / 0.55) * 0.43, 0.13, 0.549)
  if (speed <= 1.75) return 0.549
  if (speed <= 3.6) return 0.8
  return 0.97
}

// ---------- stepping together for a hug, a high five, a twirl, a dance ----------
export const EMOTE_GAP = { hug: 0.42, highfive: 0.8, twirl: 0.62, dance: 1.0 }
// where each of the two stands, facing each other: -> [spotA, spotB] ({ x, z, yaw })
export const emoteSpots = (a, b, kind) => {
  const gap = EMOTE_GAP[kind] ?? 0.8
  const mx = (a.x + b.x) / 2
  const mz = (a.z + b.z) / 2
  let dx = b.x - a.x
  let dz = b.z - a.z
  const d = Math.hypot(dx, dz)
  if (d < 1e-3) {
    dx = Math.sin(a.yaw || 0)
    dz = Math.cos(a.yaw || 0)
  } else {
    dx /= d
    dz /= d
  }
  const yawA = Math.atan2(dx, dz)
  return [
    { x: mx - (dx * gap) / 2, z: mz - (dz * gap) / 2, yaw: yawA },
    { x: mx + (dx * gap) / 2, z: mz + (dz * gap) / 2, yaw: wrap(yawA + Math.PI) },
  ]
}
// the athlete's mood for a paired emote (anim.js): [kind, variant] for the asker and the one asked
export const EMOTE_POSE = {
  hug: [["hug", 0], ["hug", 1]], // (one over the shoulders, the other round the waist)
  highfive: [["highfive", 0], ["highfive", 0]],
  twirl: [["twirl", 1], ["twirl", 0]], // the asker holds the hand up; the other one spins
  dance: [["dance", 0], ["dance", 1]],
}
export const EMOTE_SECONDS = { hug: 2.6, highfive: 1.6, twirl: 2.2, dance: 9 }
// a twirl: how far round the one twirling has turned t seconds in (one turn from 0.4 s to 1.6 s)
export const twirlAngle = (t) => {
  const k = clamp((t - 0.4) / 1.2, 0, 1)
  return Math.PI * 2 * (k * k * (3 - 2 * k))
}

// ---------- the selfie ----------
// Where the camera stands for a picture of two people side by side: the background a real
// thing (the court nearest them, or the low sun at golden hour), the lens 2.3 m out at eye
// height, turned a little at a time until nothing solid is in the way (isClear(cam, mid)).
// a, b: { x, z }; toward: { x, z } what should be behind them. -> { cam, look, fov, yaw,
// spots: [forA, forB] } (yaw: which way they face, at the camera)
export const selfieShot = (a, b, toward, isClear = () => true, { portrait = true } = {}) => {
  const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }
  const base = toward ? Math.atan2(toward.x - mid.x, toward.z - mid.z) : Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2
  const tries = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.57, -1.57, Math.PI]
  let pick = null
  for (const off of tries) {
    const bg = base + off
    // (the camera on the other side of them from the background)
    const cam = { x: mid.x - Math.sin(bg) * 2.3, y: 1.62, z: mid.z - Math.cos(bg) * 2.3 }
    if (isClear(cam, mid)) {
      pick = { bg, cam }
      break
    }
  }
  if (!pick) pick = { bg: base, cam: { x: mid.x - Math.sin(base) * 2.3, y: 1.62, z: mid.z - Math.cos(base) * 2.3 } }
  const faceYaw = wrap(pick.bg + Math.PI)
  // side by side across the picture, 0.6 m apart; whoever's already on the left stays left
  const r = rightOf(faceYaw)
  const left = { x: mid.x - r.x * 0.3, z: mid.z - r.z * 0.3, yaw: faceYaw }
  const right = { x: mid.x + r.x * 0.3, z: mid.z + r.z * 0.3, yaw: faceYaw }
  const aLeft = (a.x - mid.x) * r.x + (a.z - mid.z) * r.z <= 0
  return { cam: pick.cam, look: { x: mid.x, y: 1.32, z: mid.z }, fov: portrait ? 58 : 46, yaw: faceYaw, bg: pick.bg, spots: aLeft ? [left, right] : [right, left] }
}
// a moment's camera (a hug, a high five, a twirl, a dance): side on to the two of them, on
// the side the camera's already on, turned until clear. -> { cam, look, fov }
export const momentShot = (a, b, from, isClear = () => true, { portrait = true } = {}) => {
  const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }
  let px = -(b.z - a.z)
  let pz = b.x - a.x
  const l = Math.hypot(px, pz) || 1
  px /= l
  pz /= l
  if (from && (from.x - mid.x) * px + (from.z - mid.z) * pz < 0) {
    px = -px
    pz = -pz
  }
  const base = Math.atan2(px, pz)
  const back = portrait ? 3.4 : 2.8
  for (const off of [0, 0.4, -0.4, 0.8, -0.8, Math.PI]) {
    const cam = { x: mid.x + Math.sin(base + off) * back, y: 1.7, z: mid.z + Math.cos(base + off) * back }
    if (isClear(cam, mid)) return { cam, look: { x: mid.x, y: 1.15, z: mid.z }, fov: portrait ? 60 : 48 }
  }
  return { cam: { x: mid.x + px * back, y: 1.7, z: mid.z + pz * back }, look: { x: mid.x, y: 1.15, z: mid.z }, fov: portrait ? 60 : 48 }
}
export const SELFIE_COUNT = 3 // seconds of countdown
export const SELFIE_AT = 3.3 // the click
export const SELFIE_HOLD = 1.6 // the camera stays a moment after
// golden hour: the sun low (sky.js look.sunEl in degrees)
export const isGolden = (sunEl) => Number.isFinite(sunEl) && sunEl > -3 && sunEl < 10

// ---------- sitting together, the sunset ----------
// every two free seats side by side (a bench's pair, or neighbors on a bleacher row)
export const seatPairs = (seats, isFree, maxSpan = 1) => {
  const free = seats.filter(isFree)
  const out = []
  for (let i = 0; i < free.length; i++)
    for (let j = i + 1; j < free.length; j++) {
      const a = free[i]
      const b = free[j]
      if ((a.bench ?? a.court) !== (b.bench ?? b.court)) continue
      if (dist(a, b) > maxSpan || Math.abs((a.y || 0) - (b.y || 0)) > 0.1) continue
      out.push([a, b])
    }
  return out
}
// the pair to sit on: the nearest (within `max`); for the sunset, one whose seats look toward
// the sun (sunDir: { x, z } on the ground) counts for a lot. -> [seat, seat] | null
export const pickSeats = (seats, isFree, from, { sunDir = null, max = 45 } = {}) => {
  let best = null
  let bestScore = -Infinity
  for (const pair of seatPairs(seats, isFree)) {
    const m = { x: (pair[0].x + pair[1].x) / 2, z: (pair[0].z + pair[1].z) / 2 }
    const d = dist(m, from)
    if (d > max) continue
    let score = -d
    if (sunDir) {
      const yaw = pair[0].yaw || 0
      const facing = Math.sin(yaw) * sunDir.x + Math.cos(yaw) * sunDir.z
      score += facing * 30
    }
    if (score > bestScore) {
      bestScore = score
      best = pair
    }
  }
  return best
}
// the sunset's time-lapse: where the sky starts (a Date) given now and today's golden hour.
// elevationAt(date) -> degrees. The sun already low: from now; up high: from golden hour; down
// already (night): today's golden hour again, as a replay
export const LAPSE_RATE = 30 // sky seconds per real second
export const LAPSE_END_EL = -9 // the lapse holds once the sun is this far down
export const lapseStart = (now, golden, elevationAt) => {
  const el = elevationAt(now)
  if (el <= 9 && el > LAPSE_END_EL + 1) return new Date(now)
  return new Date(golden.getTime() - 8 * 60_000)
}
export const lapseAt = (start, seconds, elevationAt, rate = LAPSE_RATE) => {
  const t = new Date(start.getTime() + seconds * rate * 1000)
  return elevationAt(t) < LAPSE_END_EL ? null : t
}

// ---------- date night ----------
// the time of day it sets: under the lights where the courts have them, else golden hour
export const dateTime = (nightOk) => (nightOk ? "night" : "golden")
export const SPACE_M = 7 // the regulars keep this far from the two of you
// should this regular move along? (walking about, not playing, waiting in a rack or walking on)
export const givesSpace = (r, me, radius = SPACE_M) => !!r && !["playing", "leaving", "queue", "toCourt"].includes(r.state) && dist(r, me) < radius

// ---------- the court for playing together ----------
// courts: [{ id, x, z, busy, blockers }] -> the free court with the clearest camera, nearest you
export const teamCourt = (courts, me) => {
  const free = courts.filter((c) => !c.busy)
  if (!free.length) return null
  return free.sort((a, b) => (a.blockers || 0) - (b.blockers || 0) || dist(a, me) - dist(b, me))[0].id
}

// ---------- memories (Lovebirds' Our Story; server/couples POST /api/couples/park) ----------
export const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
export const memoryFor = (kind, { venue, date = new Date(), streak, photo, golden } = {}) => {
  const m = { kind, venue: String(venue || "My Park").slice(0, 60), date: localDate(date) }
  if (kind === "rally") m.streak = streak
  if (kind === "selfie") {
    if (photo) m.photo = photo
    if (golden) m.golden = true
  }
  return m
}
// the shared album the two of you are both in (just the two of you first), or null.
// albums: [{ id, name, members: [{ key }] }]
export const pickAlbum = (albums, meKey, partnerKey) => {
  if (!partnerKey) return null
  const both = (albums || []).filter((a) => {
    const keys = (a.members || []).map((m) => m.key)
    return keys.includes(partnerKey) && (!meKey || keys.includes(meKey))
  })
  return both.sort((a, b) => (a.members?.length || 0) - (b.members?.length || 0))[0] || null
}
