// Pickleball 98 practice: the ball machine. Its settings (what it feeds, how fast, with what
// spin, where, how often, how many) and the feeds themselves: each one a plain description
// (where the machine is, where you stand, where the ball should land on your side and how
// it flies there) that session.js turns into a real ball with physics.js. Pure JavaScript.
//
// Court frame: you are team 0 on the +z half (facing -z, your right is +x for a right-hander);
// the machine is on the -z half.

import { HALF_L, HALF_W, KITCHEN, NET_H_CENTER } from "../physics.js"
import { NET_LINE } from "../ai.js"

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const NET_TOP = NET_H_CENTER

// What the machine can feed. you: where you stand for it ("net" = the kitchen line,
// "base" = the baseline, "mid" = a step behind the line); at: where the machine sits.
export const SHOTS = [
  { id: "dink", label: "Dinks", sub: "Soft balls into your kitchen", you: "net", at: "net" },
  { id: "drop", label: "Third-shot feeds", sub: "Deep balls: drop them in", you: "base", at: "base" },
  { id: "drive", label: "Drives", sub: "Hard, deep balls", you: "base", at: "base" },
  { id: "volley", label: "Volleys & hands", sub: "Fast balls at you at the net", you: "net", at: "net" },
  { id: "lob", label: "Lobs", sub: "High balls to smash", you: "mid", at: "net" },
  { id: "mix", label: "Random mix", sub: "Dinks, floaters, speed-ups, lobs", you: "net", at: "net" },
]
export const SPEEDS = [
  ["slow", "Slow"],
  ["medium", "Medium"],
  ["fast", "Fast"],
]
export const SPINS = [
  ["none", "None"],
  ["top", "Topspin"],
  ["slice", "Slice"],
]
export const PLACES = [
  ["random", "Random"],
  ["fh", "Forehand"],
  ["bh", "Backhand"],
  ["middle", "Middle"],
  ["alternate", "Alternate"],
]
export const RATES = [10, 15, 20, 30]
export const COUNTS = [10, 20, 30, 50]
export const TARGETS = [
  ["auto", "On"],
  ["off", "Off"],
]

export const DEFAULT_MACHINE = { shot: "dink", speed: "medium", spin: "none", place: "random", rate: 15, balls: 20, targets: "auto" }

const pick = (v, list, fallback) => (list.some((x) => (Array.isArray(x) ? x[0] : x) === v) ? v : fallback)

// any saved or half-filled settings -> valid settings
export const normalizeMachine = (s) => {
  const o = s && typeof s === "object" ? s : {}
  return {
    shot: SHOTS.some((x) => x.id === o.shot) ? o.shot : DEFAULT_MACHINE.shot,
    speed: pick(o.speed, SPEEDS, DEFAULT_MACHINE.speed),
    spin: pick(o.spin, SPINS, DEFAULT_MACHINE.spin),
    place: pick(o.place, PLACES, DEFAULT_MACHINE.place),
    rate: Number.isFinite(+o.rate) ? clamp(Math.round(+o.rate), 6, 40) : DEFAULT_MACHINE.rate,
    balls: Number.isFinite(+o.balls) ? clamp(Math.round(+o.balls), 5, 100) : DEFAULT_MACHINE.balls,
    targets: pick(o.targets, TARGETS, DEFAULT_MACHINE.targets),
  }
}

const labelOf = (list, v) => (list.find((x) => x[0] === v) || [v, v])[1]

// the one-line summary under "More options" (docs/simplicity.md)
export const machineSummary = (s) => {
  const n = normalizeMachine(s)
  return [`${labelOf(SPINS, n.spin) === "None" ? "No spin" : labelOf(SPINS, n.spin)}`, labelOf(PLACES, n.place), `${n.rate} a minute`, `${n.balls} balls`, n.targets === "off" ? "No targets" : "Targets"].join(" · ")
}

// seconds between feeds
export const feedInterval = (s) => 60 / normalizeMachine(s).rate

// where you stand and where the machine sits for a shot type
export const SPOTS = {
  you: { net: { x: 0.45, z: NET_LINE }, base: { x: 0.5, z: HALF_L - 0.1 }, mid: { x: 0.35, z: NET_LINE + 0.9 } },
  machine: { net: { x: -0.2, z: -NET_LINE - 0.3 }, base: { x: -0.2, z: -HALF_L + 0.4 } },
}
export const shotById = (id) => SHOTS.find((x) => x.id === id) || SHOTS[0]

// sideways offset for the placement (in your frame: + is your forehand)
const lateral = (place, index, rand) => {
  switch (place) {
    case "fh":
      return 0.55 + rand() * 0.35
    case "bh":
      return -(0.55 + rand() * 0.35)
    case "middle":
      return (rand() - 0.5) * 0.25
    case "alternate":
      return (index % 2 === 0 ? 1 : -1) * (0.6 + rand() * 0.3)
    default:
      return (rand() * 2 - 1) * 0.95
  }
}

const SPEED_K = { slow: 0, medium: 1, fast: 2 }
const spinOf = (spin, soft) => (spin === "top" ? 90 : spin === "slice" ? -70 : 0) * (soft ? 0.4 : 1)

// The mix: what comes next (dinks most of the time; now and then a floater, a speed-up or
// a lob, the way a real point at the line goes)
const MIX = [
  ["dink", 0.5],
  ["float", 0.2],
  ["fast", 0.2],
  ["lob", 0.1],
]
const mixKind = (rand) => {
  let r = rand()
  for (const [k, w] of MIX) {
    if (r < w) return k
    r -= w
  }
  return "dink"
}

// One feed. settings: machine settings; index: which ball (0..); hand: your paddle hand
// (+1 right, -1 left: forehand/backhand placement follows it); feed: an override kind
// (drills and lessons feed special balls: "serve", "transition", "float", "dinkfloat" (low
// dinks with a floater now and then)).
// Returns { kind, from, target, mode: { speed } | { apex }, spin, minClear, hits, you, at, float }
//   kind: "dink" | "float" | "deep" | "drive" | "fast" | "lob" | "serve" | "transition"
//   hits: how many shots the rally counts as already played (the two-bounce rule follows it)
export const planFeed = (settings, { index = 0, rand = Math.random, hand = 1, feed = null } = {}) => {
  const s = normalizeMachine(settings)
  const shot = shotById(s.shot)
  const k = SPEED_K[s.speed]
  let kind = feed === "dinkfloat" ? (rand() < 0.4 ? "float" : "dink") : feed || { dink: "dink", drop: "deep", drive: "drive", volley: "fast", lob: "lob", mix: null }[s.shot] || mixKind(rand)
  const youAt = feed === "serve" || feed === "deep" ? "base" : feed === "transition" ? "mid" : shot.you
  const atKey = kind === "deep" || kind === "drive" || kind === "serve" ? "base" : "net"
  const you = { ...SPOTS.you[youAt] }
  if (feed === "transition") you.z = 4.4
  const at = SPOTS.machine[atKey]
  const side = lateral(s.place, index, rand) * (hand === -1 ? -1 : 1)
  const from = { x: at.x + 0.15, y: kind === "fast" || kind === "drive" ? 1.0 : 0.85, z: at.z + 0.4 }
  let target
  let mode
  let spin = 0
  let minClear = 0.08
  let hits = 4
  const xAt = (dx) => clamp(you.x + dx, -HALF_W + 0.25, HALF_W - 0.25)
  switch (kind) {
    case "dink":
      target = { x: xAt(side * 0.9), z: KITCHEN - 0.45 - rand() * 0.6 }
      mode = { apex: NET_TOP + [0.42, 0.3, 0.2][k] + rand() * 0.06 }
      spin = spinOf(s.spin, true) - 10
      break
    case "float":
      // a dink that floats up into your reach above the net: attack it
      target = { x: xAt(side * 0.6), z: NET_LINE + 0.3 + rand() * 0.4 }
      mode = { apex: 1.55 + rand() * 0.3 }
      spin = spinOf(s.spin, true)
      break
    case "deep":
      // a deep return to the baseline (you play the third shot)
      target = { x: xAt(side * 1.1), z: HALF_L - 1.3 - rand() * 0.8 }
      mode = { speed: [9.5, 11, 13][k] + rand() * 0.6 }
      spin = spinOf(s.spin, false) || 40
      minClear = 0.3
      hits = 2
      break
    case "drive":
      target = { x: xAt(side * 1.1), z: HALF_L - 1.6 - rand() * 1.0 }
      mode = { speed: [11, 14.5, 18][k] + rand() * 0.8 }
      spin = spinOf(s.spin, false) || 60
      minClear = 0.12
      break
    case "fast":
      // a speed-up at you: aimed well behind you so it passes at your hip or chest
      target = { x: xAt(side * 0.5), z: you.z + 2.6 + rand() * 1.2 }
      mode = { speed: [11, 13.5, 16][k] + rand() * 0.8 }
      spin = spinOf(s.spin, false) || 60
      minClear = 0.1
      hits = 6
      break
    case "transition":
      // a hard ball at your feet in the middle of the court: reset it
      target = { x: xAt(side * 0.5), z: you.z - 0.4 - rand() * 0.5 }
      mode = { speed: [10.5, 12.5, 14.5][k] + rand() * 0.8 }
      spin = spinOf(s.spin, false) || 60
      minClear = 0.06
      break
    case "lob":
      // a short, high lob over the line: let it come down and put it away
      target = { x: xAt(side * 0.6), z: NET_LINE + 0.7 + rand() * 0.7 }
      mode = { apex: [2.2, 2.45, 2.7][k] + rand() * 0.2 }
      spin = spinOf(s.spin, true)
      minClear = 0.4
      break
    case "serve":
      // a serve from the machine's right court into your right service box (you return it)
      target = { x: 0.8 + rand() * 1.2, z: HALF_L - 1.0 - rand() * 1.0 }
      mode = { speed: [10.5, 12, 13.5][k] + rand() * 0.6 }
      spin = spinOf(s.spin, false) || 50
      minClear = 0.25
      hits = 1
      break
    default:
      throw new Error(`unknown feed ${kind}`)
  }
  return { kind, from, target, mode, spin, minClear, hits, you, at: { ...at }, float: kind === "float", index }
}
