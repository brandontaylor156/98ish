// My Park: the park's regulars (pure; Node-tested). People with names and their own kits
// who walk between the courts, sit on the benches and bleachers, watch, chat, put their
// paddles in a rack for next, play, and clap a great point.
//
// A regular is a small state machine:
//   wander -> (arrive) think
//   sit     (on a bleacher or bench seat a while)    -> think
//   watch   (standing by a court's bleachers)        -> think
//   queue   (paddle in a court's rack, waiting by it) -> toCourt (called on) or think (gave up)
//   toCourt (walking to the gate)                    -> the world puts them on court
//   chat    (two of them, face to face, a few lines) -> think
// think() picks the next one from what the park needs (a rack short of four paddles pulls
// people over), what they like (their level's courts) and a little chance.

import { ALL_SEATS, COURTS, WAYPOINTS, chatSpots, resolve, route, seatApproach } from "./layout.js"
import { DEFAULT_LOOK, HAIR_COLORS, SKIN_TONES, facesForBody, randomLook, validateLook } from "../locker.js"

export const WALK = 1.3 // m/s, a stroll
export const NAMES = [
  ["Marge", "f"], ["Dale", "m"], ["Priya", "f"], ["Tony", "m"], ["Bea", "f"], ["Luis", "m"], ["Kim", "f"], ["Otis", "m"],
  ["Rita", "f"], ["Sammy", "m"], ["June", "f"], ["Hank", "m"], ["Nina", "f"], ["Wes", "m"], ["Gloria", "f"], ["Raj", "m"],
  ["Tess", "f"], ["Ray", "m"], ["Ivy", "f"], ["Carl", "m"], ["Mae", "f"], ["Benny", "m"], ["Dot", "f"], ["Gus", "m"],
  ["Lola", "f"], ["Fred", "m"], ["Ana", "f"], ["Moe", "m"],
]
const LEVELS = ["beginner", "intermediate", "intermediate", "pro"]

// what people say (short, canned)
export const LINES = {
  chat: ["Good game earlier!", "Nice dinks today.", "Who's got next?", "Third shot drop!", "Stay out of the kitchen!", "Paddle up!", "That was in, by the way.", "Rematch later?", "New paddle?", "Hot out here.", "Soft hands win.", "Love this park."],
  queue: ["Got next!", "Paddle's in.", "Who's with me?"],
  enter: ["Let's go!", "Game on.", "Ready!"],
  cheer: ["Nice point!", "What a rally!", "Wow!", "Great get!", "Ooh!"],
  watch: ["Good game on 4.", "They're good.", "Nice serve."],
}

// a park regular's look: their own body, skin and hair, a random kit (locker.js randomLook)
export const parkLook = (rand, body) => {
  const pick = (a) => a[Math.floor(rand() * a.length) % a.length]
  const base = validateLook({
    ...DEFAULT_LOOK,
    body,
    skin: pick(SKIN_TONES),
    hair: body === "m" ? pick(["short", "buzz", "bald", "short", "long"]) : pick(["long", "buns", "pixie", "long"]),
    hairColor: pick(HAIR_COLORS.slice(0, 10)),
    beard: body === "m" && rand() < 0.3,
    height: 0.95 + rand() * 0.1,
    build: pick(["slim", "regular", "regular", "strong"]),
    plays: rand() < 0.12 ? "left" : "right",
    backhand: rand() < 0.2 ? "two" : "one",
  })
  const look = randomLook(rand, base, { venue: rand() < 0.6 ? "park" : null })
  // (some wear a cap or a visor at the park)
  if (rand() < 0.35) look.hat = pick(["cap", "visor", "cap", "capBack", "bucket"])
  // players v3: a photographed face (its own skin; its own hair color most of the time)
  const faces = facesForBody(body).filter((f) => f.body)
  if (faces.length) {
    const f = pick(faces)
    look.face = f.id
    look.skin = f.tone
    if (f.hairTone && rand() < 0.8) look.hairColor = f.hairTone
    if ((f.beard || 0) > 0.12) look.beard = rand() < 0.7
    // (their own photographed hair, most of the time)
    if (rand() < 0.65) look.hair = "own"
  }
  return validateLook(look, base)
}

export const createRegular = (i, rand, at) => {
  const [name, body] = NAMES[i % NAMES.length]
  return {
    id: `r${i}`,
    name,
    level: LEVELS[i % LEVELS.length],
    look: parkLook(rand, body),
    x: at.x,
    z: at.z,
    yaw: rand() * Math.PI * 2,
    vx: 0,
    vz: 0,
    speed: 0,
    walk: WALK * (0.9 + rand() * 0.25),
    state: "wander",
    t: 1 + rand() * 4,
    path: [],
    target: null,
    seat: null,
    seated: false,
    court: null,
    partner: null,
    face: null,
    say: null,
    mood: null,
    keen: 0.4 + rand() * 0.6, // how much they want to play
    idle: 0, // seconds since they last played
  }
}

// say something (shown over their head for a few seconds)
export const speak = (r, text, now) => {
  r.say = { text, at: now, until: now + 2.6 + text.length * 0.04 }
}

const pick = (rand, a) => a[Math.floor(rand() * a.length) % a.length]

export const goTo = (r, to) => {
  r.path = route(r, to)
  r.target = { x: to.x, z: to.z }
}

// The next thing to do. ctx: { rand, now, courts: [{ id, level, queue (length), open (still
// taking paddles) }], seatFree(seat) -> bool, takeSeat(seat, r), partnerFor(r) -> another
// regular free to chat or null, queueSpot(court, r) -> { x, z } }
// -> an event for the world ({ type: "queue", court } | { type: "chat", with } | null)
export const think = (r, ctx) => {
  const { rand } = ctx
  if (r.seat) {
    ctx.freeSeat?.(r.seat, r)
    // (up off the seat: back where they stepped on from)
    if (r.seated) {
      const a = seatApproach(r.seat)
      r.x = a.x
      r.z = a.z
    }
    r.seat = null
  }
  r.seated = false
  r.face = null
  r.partner = null
  // a rack short of four paddles: the keen ones (who haven't played for a while) go over,
  // their own level's courts first
  const open = ctx.courts.filter((c) => c.open && c.queue < 4)
  const wantPlay = r.keen * Math.min(1, 0.25 + r.idle / 90)
  if (open.length && rand() < wantPlay) {
    const mine = open.filter((c) => c.level === r.level)
    const c = mine.length && rand() < 0.75 ? pick(rand, mine) : pick(rand, open)
    r.state = "queue"
    r.court = c.id
    r.t = 90 + rand() * 120 // (they give up after a while)
    goTo(r, ctx.queueSpot(c.id, r))
    return { type: "queue", court: c.id }
  }
  const roll = rand()
  if (roll < 0.32) {
    // sit: a bleacher seat at a court (watching) or a bench
    const free = ALL_SEATS.filter((s) => ctx.seatFree(s))
    if (free.length) {
      const near = free.sort((a, b) => Math.hypot(a.x - r.x, a.z - r.z) - Math.hypot(b.x - r.x, b.z - r.z)).slice(0, 6)
      const seat = pick(rand, near)
      ctx.takeSeat(seat, r)
      r.seat = seat
      r.state = "sit"
      r.t = 25 + rand() * 50
      // walk up to the seat, then sit
      goTo(r, seatApproach(seat))
      return null
    }
  }
  if (roll < 0.5) {
    const c = pick(rand, COURTS)
    r.state = "watch"
    r.court = c.id
    r.t = 15 + rand() * 30
    const along = (rand() - 0.5) * 6
    // (behind the bleachers; a court without any: by its gate, outside the fence)
    const b = c.bleacher
    goTo(r, b ? resolve(b.x + b.ax * along + c.out.x * 1.05, b.z + b.az * along + c.out.z * 1.05, 0.3) : resolve(c.outside.x + c.rackAlong.x * along * 0.5 + c.out.x * 1.2, c.outside.z + c.rackAlong.z * along * 0.5 + c.out.z * 1.2, 0.3))
    r.face = { x: c.x, z: c.z }
    return null
  }
  if (roll < 0.66) {
    const other = ctx.partnerFor?.(r)
    if (other) {
      const [a, b] = chatSpots(r, other)
      startChat(r, other, a, b, rand)
      return { type: "chat", with: other.id }
    }
  }
  r.state = "wander"
  r.t = 30
  goTo(r, pick(rand, WAYPOINTS))
  return null
}

export const startChat = (r, other, a, b, rand) => {
  for (const [p, q, spot] of [
    [r, other, a],
    [other, r, b],
  ]) {
    if (p.seat) p.seat = null
    p.seated = false
    p.state = "chat"
    p.partner = q.id
    p.t = 8 + rand() * 6
    goTo(p, spot)
    p.face = null
  }
  r.chatTurn = 0
  other.chatTurn = 1.6
}

// steering: along the route at a stroll, easing in at the end; others: people to keep a
// little apart from. -> true when they've arrived
export const moveRegular = (r, dt, others = []) => {
  let arrived = false
  let tx = 0
  let tz = 0
  let want = 0
  if (r.path?.length) {
    const p = r.path[0]
    const d = Math.hypot(p.x - r.x, p.z - r.z)
    const last = r.path.length === 1
    if (d < (last ? 0.12 : 0.6)) {
      r.path.shift()
      if (!r.path.length) arrived = true
    } else {
      tx = (p.x - r.x) / d
      tz = (p.z - r.z) / d
      want = last ? Math.min(r.walk, d * 1.6 + 0.15) : r.walk
    }
  } else arrived = true
  // keep a little apart
  for (const o of others) {
    if (o === r) continue
    const dx = r.x - o.x
    const dz = r.z - o.z
    const d = Math.hypot(dx, dz)
    if (d > 0.01 && d < 0.7) {
      tx += (dx / d) * (0.7 - d) * 1.5
      tz += (dz / d) * (0.7 - d) * 1.5
    }
  }
  const tl = Math.hypot(tx, tz)
  const vx = tl > 1e-6 ? (tx / tl) * want : 0
  const vz = tl > 1e-6 ? (tz / tl) * want : 0
  const k = 1 - Math.exp(-dt * 5)
  r.vx += (vx - r.vx) * k
  r.vz += (vz - r.vz) * k
  const p = resolve(r.x + r.vx * dt, r.z + r.vz * dt, 0.3)
  r.x = p.x
  r.z = p.z
  r.speed = Math.hypot(r.vx, r.vz)
  if (r.speed > 0.25) r.yaw = Math.atan2(r.vx, r.vz)
  return arrived && r.speed < 0.3
}

// One regular, one frame: move, count down, and hand back what happened ("think" when the
// state ran out or a walk arrived somewhere it should stop being a walk).
// -> { think: bool, sat: bool }
export const tickRegular = (r, dt, others, now, rand) => {
  r.idle += dt
  if (r.state === "playing" || r.state === "leaving") return { think: false }
  if (r.say && now > r.say.until) r.say = null
  if (r.seated) {
    r.vx = 0
    r.vz = 0
    r.speed = 0
  } else {
    const arrived = moveRegular(r, dt, others)
    if (arrived && r.state === "sit" && r.seat && !r.seated) {
      r.seated = true
      r.x = r.seat.x
      r.z = r.seat.z
      r.yaw = r.seat.yaw
    }
    if (arrived && r.state === "wander") return { think: true }
    if (arrived && r.state === "toCourt") return { think: false, atGate: true }
    if (arrived && r.face) r.yaw = Math.atan2(r.face.x - r.x, r.face.z - r.z)
  }
  if (r.state === "chat" && !r.path.length) {
    r.chatTurn = (r.chatTurn || 0) - dt
    if (r.chatTurn <= 0) {
      r.chatTurn = 3.2
      speak(r, pick(rand, LINES.chat), now)
    }
  }
  if (r.state === "toCourt") return { think: false }
  r.t -= dt
  return { think: r.t <= 0 }
}
