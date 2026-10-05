// Pickleball 98 practice: drills. Each has one goal, takes 1-3 minutes, and earns up to
// three stars. A drill is a session spec (session.js) plus how it's scored:
//   measure: "made" (good shots), "points" (target zones) or "streak" (best run in a row)
//   stars: [one, two, three] thresholds on that score
// Pure JavaScript.

import { KITCHEN } from "../physics.js"
import { ZONE_SETS } from "./targets.js"
import { deepInTheirCourt, inTheirKitchen } from "./classify.js"

const SOFT = new Set(["dink", "drop", "reset", "block"])
const soft = (r) => !!r.shot && SOFT.has(r.shot.kind)
const lowAndIn = (r) => r.outcome === "in" && soft(r) && !r.shot.attackable

// a message for the common misses (null when there's nothing to add)
const missMsg = (r) => {
  if (r.outcome === "miss") return "Missed: move to it and let go as it arrives."
  if (r.outcome === "net") return "Net: aim a little deeper."
  if (r.outcome === "out") return "Out: softer, and aim inside the lines."
  if (r.outcome === "fault") return /kitchen/i.test(r.fault || "") ? "Kitchen fault: stop before the line after a volley." : "Fault: let it bounce first."
  return null
}

export const DRILLS = [
  {
    id: "serve",
    name: "Serve targets",
    goal: "Serve deep: the back of the box scores 3.",
    measure: "points",
    stars: [8, 15, 22],
    spec: {
      serve: true,
      balls: 10,
      time: 180,
      zones: ZONE_SETS.serve,
      judge: (r) => ({ ok: r.outcome === "in", msg: r.zone === "sv-deep" ? "Deep serve!" : r.outcome === "in" ? "In, but short: hold a bit longer." : r.outcome === "net" ? "Net: hold a bit longer." : "Out: let go a little sooner." }),
    },
  },
  {
    id: "return",
    name: "Return deep, move in",
    goal: "Return deep, then run up to the kitchen line.",
    measure: "made",
    stars: [3, 5, 7],
    spec: {
      machine: { shot: "drive", speed: "slow", place: "random", rate: 10 },
      feed: "serve",
      track: "moveIn",
      balls: 8,
      time: 180,
      zones: ZONE_SETS.deep,
      judge: (r) => {
        const deep = r.outcome === "in" && deepInTheirCourt(r.landing)
        const moved = r.moveIn >= 2
        if (deep && moved) return { ok: true, msg: "Deep, and you came in!" }
        if (deep) return { ok: false, msg: "Deep! Now run in to the kitchen line after it." }
        if (r.outcome === "in") return { ok: false, msg: "Short: aim at the back of their court." }
        return { ok: false, msg: missMsg(r) }
      },
    },
  },
  {
    id: "drop",
    name: "Third-shot drop",
    goal: "From the baseline, drop it softly into their kitchen.",
    measure: "made",
    stars: [3, 5, 7],
    spec: {
      machine: { shot: "drop", speed: "medium", place: "random", rate: 12 },
      balls: 10,
      time: 180,
      zones: ZONE_SETS.drop,
      judge: (r) => {
        if (lowAndIn(r) && -r.landing.z <= KITCHEN + 0.6) return { ok: true, msg: "Great drop!" }
        if (r.outcome === "in" && soft(r) && r.shot.attackable) return { ok: false, msg: "Too high: aim lower over the net." }
        if (r.outcome === "in" && !soft(r)) return { ok: false, msg: "Too hard: a quick soft tap drops it in." }
        if (r.outcome === "in") return { ok: false, msg: "A bit deep: aim into the kitchen." }
        return { ok: false, msg: missMsg(r) }
      },
    },
  },
  {
    id: "dink",
    name: "Dinking cross-court",
    goal: "Keep 10 dinks in a row going, cross-court.",
    measure: "streak",
    stars: [4, 7, 10],
    spec: {
      machine: { shot: "dink", speed: "slow", place: "random", rate: 15 },
      returns: true,
      streakGoal: 10,
      time: 150,
      zones: ZONE_SETS.kitchen,
      judge: (r) => {
        if (lowAndIn(r) && inTheirKitchen(r.landing, 0.3) && r.landing.x < 0.6) return { ok: true, msg: null }
        if (lowAndIn(r) && inTheirKitchen(r.landing, 0.3)) return { ok: true, msg: "Try cross-court: aim to your left." }
        if (r.outcome === "in" && r.shot.attackable) return { ok: false, msg: "Too high: aim lower over the net." }
        if (r.outcome === "in" && !soft(r)) return { ok: false, msg: "Too hard: at the line, just tap it." }
        if (r.outcome === "in") return { ok: false, msg: "Deep: keep it in the kitchen." }
        return { ok: false, msg: missMsg(r) }
      },
    },
  },
  {
    id: "reset",
    name: "Reset from mid-court",
    goal: "Caught mid-court: soften hard balls into the kitchen.",
    measure: "made",
    stars: [3, 5, 7],
    spec: {
      machine: { shot: "drive", speed: "medium", place: "random", rate: 12 },
      feed: "transition",
      balls: 10,
      time: 180,
      zones: ZONE_SETS.drop,
      judge: (r) => {
        if (lowAndIn(r) && -r.landing.z <= KITCHEN + 0.8) return { ok: true, msg: "Reset!" }
        if (r.outcome === "in" && r.shot.attackable) return { ok: false, msg: "Popped up: soft hands, aim into the kitchen." }
        if (r.outcome === "in" && !soft(r)) return { ok: false, msg: "Don't swing: just tap it soft." }
        if (r.outcome === "in") return { ok: false, msg: "Deep: aim shorter, into the kitchen." }
        return { ok: false, msg: missMsg(r) }
      },
    },
  },
  {
    id: "hands",
    name: "Hand battle volleys",
    goal: "Fast balls at you at the net: get them back.",
    measure: "made",
    stars: [4, 6, 8],
    spec: {
      machine: { shot: "volley", speed: "medium", place: "random", rate: 15 },
      balls: 10,
      time: 150,
      zones: ZONE_SETS.feet,
      judge: (r) => {
        if (r.outcome === "in") return { ok: true, msg: r.zone === "f-feet" ? "At their feet!" : null }
        if (r.outcome === "miss") return { ok: false, msg: "Paddle up early: hold hit as the machine swings." }
        return { ok: false, msg: missMsg(r) }
      },
    },
  },
  {
    id: "smash",
    name: "Overhead smash",
    goal: "Lobs over your head: put them away.",
    measure: "made",
    stars: [3, 5, 7],
    spec: {
      machine: { shot: "lob", speed: "medium", place: "random", rate: 12 },
      balls: 8,
      time: 150,
      zones: ZONE_SETS.smash,
      judge: (r) => {
        if (r.outcome === "in" && r.shot.speed >= 12) return { ok: true, msg: "Put away!" }
        if (r.outcome === "in") return { ok: false, msg: "Too soft: hold longer on a high ball." }
        return { ok: false, msg: missMsg(r) }
      },
    },
  },
  {
    id: "split",
    name: "Split-step timing",
    goal: "Be still as the machine hits (the split step), then move.",
    measure: "made",
    stars: [4, 6, 8],
    spec: {
      machine: { shot: "dink", speed: "medium", place: "alternate", rate: 12 },
      cue: "split",
      balls: 10,
      time: 150,
      zones: ZONE_SETS.kitchen,
      judge: (r) => {
        const on = !!r.fed?.split
        if (on && r.outcome === "in") return { ok: true, msg: "Split on time!" }
        if (!on) return { ok: false, msg: "Still moving as it hit: get back to the middle and stop." }
        return { ok: false, msg: missMsg(r) }
      },
    },
  },
]

export const drillById = (id) => DRILLS.find((d) => d.id === id) || null

// a drill's score from a session snapshot (session.js snap())
export const drillScore = (drill, snap) => (!snap ? 0 : drill.measure === "points" ? snap.points : drill.measure === "streak" ? snap.bestStreak : snap.made)
export const drillStars = (drill, snap) => drill.stars.filter((s) => drillScore(drill, snap) >= s).length
// what the score means, in a few words
export const scoreText = (drill, snap) => (drill.measure === "points" ? `${snap?.points || 0} points` : drill.measure === "streak" ? `${snap?.bestStreak || 0} in a row` : `${snap?.made || 0} good`)
