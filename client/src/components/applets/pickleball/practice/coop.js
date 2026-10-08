// Pickleball 98: drilling with a friend online (the owner: "There should be a multiplayer
// practice mode where I can drill online with someone else"). Two people rally together
// instead of against each other, and count the streak: how many good shots in a row.
//
// It's a `practice` object for match.js (m.practice: begin / tick / end), run by the host's
// browser in an ordinary online room (netplay.js: each person moves their own player and plays
// their own shots). Between rallies everyone walks to the drill's spots (the game's own walk
// back between points; nothing moves you during a rally), then the feeder's hand puts the
// ball in play (a soft drill feed, like a partner's toss: no serve rules) to the other person.
// The feeder takes turns. The serve-and-return drill uses real serves (taking turns too).
// Pure JavaScript (Node-tested in coop.test.js).
//
// What counts as a good shot (the streak):
//   dinks    lands in their kitchen
//   drops    from the baseline: lands in their kitchen (a third-shot drop); from the kitchen
//            line: lands deep (past the kitchen), so they get another third shot
//   volleys  taken out of the air, and in
//   serve    the serve in, then any shot in (a rally from the serve)
//   rally    any shot in (a free rally from the baseline)
// A shot in the court but not where the drill wants it starts the streak again; out, the net
// or a second bounce ends the rally (the referee: rules.js). The best streak is kept.

import { HALF_L, HALF_W, KITCHEN, solveShot, v3 } from "../physics.js"
import { NET_LINE } from "../ai.js"
import { sideOf } from "../rules.js"
import { handPos } from "../match.js"
import { planFeed } from "./machine.js"

export const COOP_DRILLS = [
  { id: "dinks", name: "Dinks", goal: "Keep it in each other's kitchen", feed: "dink", spots: ["net", "net"] },
  { id: "drops", name: "Third-shot drops", goal: "Baseline drops into the kitchen; the net player feeds deep", feed: "deep", spots: ["base", "net"] },
  { id: "volleys", name: "Volleys", goal: "Out of the air at the kitchen line", feed: "volley", spots: ["line", "line"] },
  { id: "serve", name: "Serve and return", goal: "Serve in, return in, keep it going", feed: null, spots: null },
  { id: "rally", name: "Free rally", goal: "Any shot in, from the baseline", feed: "deep", spots: ["base", "base"] },
]
export const COOP_IDS = COOP_DRILLS.map((d) => d.id)
export const coopById = (id) => COOP_DRILLS.find((d) => d.id === id) || COOP_DRILLS[0]

// where someone stands for a drill (in the +z half's frame; mirrored for the far side)
const SPOT = {
  net: { x: 0.4, z: NET_LINE },
  line: { x: 0.3, z: NET_LINE + 0.5 },
  base: { x: 0.5, z: HALF_L - 0.1 },
}
const FEED_AFTER = 0.9 // seconds in "serve" before the feed (the call settles, people set)

const inCourt = (x, z) => Math.abs(x) <= HALF_W + 0.02 && Math.abs(z) <= HALF_L + 0.02

// judge one shot: { by (player), role ("net" | "base" | "line"), landing: { x, z } | null
// (null: taken out of the air by the other), volley } -> true (good), false (not the drill's
// shot: the streak starts again), null (doesn't count either way)
export const judgeShot = (drillId, shot) => {
  const L = shot.landing
  if (!L) return drillId === "volleys" ? !!shot.volley : true // volleyed back: it was in reach, keep going
  if (!inCourt(L.x, L.z)) return null // out: the rally's over, the referee says so
  const kitchen = Math.abs(L.z) <= KITCHEN + 0.02
  switch (drillId) {
    case "dinks":
      return kitchen
    case "drops":
      return shot.role === "base" ? kitchen : !kitchen
    case "volleys":
      return !!shot.volley
    default:
      return true
  }
}

export const createCoop = (drillId, { rand = Math.random } = {}) => {
  const drill = coopById(drillId)
  const st = {
    drill: drill.id,
    streak: 0,
    best: 0,
    good: 0,
    rallies: 0,
    feeder: 0, // index into the two people: who feeds (or serves) this rally
    roles: {}, // player id -> "net" | "base" | "line"
    fedAt: null,
    pending: null, // the latest shot: { by, team, t, volley, role }
    lastShotT: null,
    label: null, // the last shot's word: "Good dink!" ...
    tone: null,
    seq: 0,
  }
  const people = (m) => {
    const list = m.players.filter((p) => p.ctrl !== "cpu" && p.ctrl !== "feeder")
    return list.length >= 2 ? list.slice(0, 2) : m.players.slice(0, 2)
  }
  const snap = () => ({ drill: st.drill, streak: st.streak, best: st.best, good: st.good, rallies: st.rallies, label: st.label, tone: st.tone, seq: st.seq })
  const emit = (m) => {
    st.seq++
    m.events.push({ id: ++m.eventSeq, t: m.t, type: "drill", coop: true, snap: snap() })
  }
  const spotFor = (p, key) => {
    const s = SPOT[key] || SPOT.base
    const sgn = sideOf(p.team)
    return { x: s.x * sgn, z: s.z * sgn }
  }

  const begin = (m) => {
    st.pending = null
    st.fedAt = null
    const [a, b] = people(m)
    if (!a || !b) return false
    const feeder = st.feeder % 2 === 0 ? a : b
    const other = feeder === a ? b : a
    if (!drill.feed) {
      // serve and return: a real serve, taking turns
      m.game.server = feeder.id
      m.game.serving = feeder.team
      return false
    }
    // the receiver plays the drill's first shot from the first spot; the feeder from the second
    st.roles = { [other.id]: drill.spots[0], [feeder.id]: drill.spots[1] }
    for (const p of m.players) {
      const key = st.roles[p.id] || "base"
      p.spot = spotFor(p, key)
      p.target = p.spot
      p.armed = null
      p.charge = null
      p.serving = null
      p.expect = null
      p.intercept = null
    }
    // the feeder holds the ball while everyone walks to their spots ("intro", then "serve")
    m.game.server = feeder.id
    m.game.serving = feeder.team
    m.ball.held = feeder.id
    m.ball.rolling = false
    m.ball.rest = false
    m.ball.v = v3()
    m.ball.w = v3()
    m.ball.p = handPos(m, feeder)
    feeder.serveAt = 99 // (a person: never served by the computer)
    return true
  }

  // the feed: a soft drill ball from the feeder's hand to the other person
  const feed = (m) => {
    const [a, b] = people(m)
    const feeder = st.feeder % 2 === 0 ? a : b
    const other = feeder === a ? b : a
    const kind = drill.feed === "volley" ? "dink" : drill.feed
    const plan = planFeed({ shot: kind === "deep" ? "drop" : "dink", speed: "slow", place: "middle" }, { index: st.rallies, rand, feed: kind })
    // (planFeed is in the receiver-on-+z frame: turn it to the receiver's side)
    const sgn = sideOf(other.team)
    let target = { x: plan.target.x * sgn, z: plan.target.z * sgn }
    let mode = plan.mode
    if (drill.feed === "volley") {
      // a firm ball at chest height for a volley: aimed past them so it's still up as it reaches them
      target = { x: 0.5 * sgn, z: (NET_LINE + 3.2) * sgn }
      mode = { speed: 9.5 + rand() * 0.8 }
    }
    const from = handPos(m, feeder)
    from.y = Math.max(from.y, 0.9)
    const solved = solveShot(from, target, { ...mode, spin: plan.spin, minClear: plan.minClear })
    m.ball.held = null
    m.ball.p = from
    m.ball.v = solved.v
    m.ball.w = solved.w
    m.ball.rolling = false
    m.ball.rest = false
    m.landing = null
    const r = m.rally
    r.hits = drill.feed === "deep" ? 2 : 4 // (past the two-bounce rule except a deep feed's third shot)
    r.over = null
    r.lastTeam = feeder.team
    r.lastPlayer = feeder.id
    r.bounces = 0
    m.phase = "rally"
    m.phaseT = 0
    const speed = Math.hypot(solved.v.x, solved.v.y, solved.v.z)
    feeder.swing = { t: 0, kind: drill.feed === "deep" ? "drive" : "dink", hand: "fh", x: from.x, y: from.y, z: from.z, id: (feeder.swingSeq = (feeder.swingSeq || 0) + 1) }
    m.lastShot = { kind: "feed", by: feeder.id, team: feeder.team, speed, t: m.t, feed: true }
    st.lastShotT = m.t
    st.fedAt = m.t
    m.version++
    m.events.push({ id: ++m.eventSeq, t: m.t, type: "hit", player: feeder.id, team: feeder.team, kind: drill.feed === "deep" ? "drive" : "dink", speed, x: from.x, y: from.y, z: from.z, paddle: 6, grade: "good" })
  }

  const decide = (m, ok, word) => {
    if (ok === null) return
    if (ok) {
      st.streak++
      st.good++
      st.best = Math.max(st.best, st.streak)
    } else st.streak = 0
    st.label = word
    st.tone = ok ? "good" : "warn"
    emit(m)
  }
  const wordFor = (ok, shot) => {
    if (!ok) return { dinks: "Out of the kitchen", drops: shot.role === "base" ? "Not a drop: short of the kitchen next time" : "Feed it deep", volleys: "Let it bounce: volley it" }[st.drill] || "Again"
    return { dinks: "Good dink", drops: shot.role === "base" ? "Good drop" : "Good feed", volleys: "Good volley", serve: "In", rally: "In" }[st.drill] || "Good"
  }
  const settlePending = (m, landing) => {
    const p = st.pending
    if (!p) return
    st.pending = null
    const shot = { ...p, landing }
    const ok = judgeShot(st.drill, shot)
    decide(m, ok, ok === null ? null : wordFor(ok, shot))
  }

  const tick = (m) => {
    // the feed, once everyone's set
    if (drill.feed && m.phase === "serve" && st.fedAt === null && m.phaseT >= FEED_AFTER) feed(m)
    const s = m.lastShot
    if (s && !s.feed && s.t !== st.lastShotT) {
      // a new shot: the one before it was taken out of the air (no landing yet)
      if (st.pending && st.pending.by !== s.by) settlePending(m, null)
      st.lastShotT = s.t
      const p = m.players.find((x) => x.id === s.by)
      st.pending = { by: s.by, team: p?.team, t: s.t, volley: !!s.volley, role: st.roles[s.by] || "base" }
    }
    if (st.pending && m.landing && m.landing.by === st.pending.by) settlePending(m, { x: m.landing.x, z: m.landing.z })
  }

  const end = (m, res) => {
    // (a shot still in the air when the rally ended went out or into the net: not counted)
    st.pending = null
    st.rallies++
    st.feeder++
    st.streak = 0
    st.label = res?.reason ? `${res.reason}: again` : st.label
    st.tone = "warn"
    emit(m)
  }

  // the feeder tapped before the feed came: feed now (a drill has no serve; the serve drill does)
  const serveTap = (m) => {
    if (!drill.feed || st.fedAt !== null || m.phase !== "serve") return false
    feed(m)
    return true
  }

  return { state: st, begin, tick, end, serveTap, returns: false, coop: true, snap }
}
