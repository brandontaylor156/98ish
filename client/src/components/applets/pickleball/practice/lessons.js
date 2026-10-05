// Pickleball 98 practice: "Learn to play like a pro". Short lessons in the order a point is
// played: a coach tip (2-3 sentences) with a little animated court picture, then a task on
// court with live feedback. The strategy and its sources are in docs/pickleball-practice.md.
// Pure JavaScript (data + judges).
//
// diagram: a top-down court in feet (x 0..20 left to right as you see it; y 0 = their
// baseline, 22 = the net, 44 = your baseline; kitchen lines at 15 and 29):
//   hi: an area to light ("kitchen" | "their-kitchen" | "deep" | "box" | "line")
//   dots: [{ who: "you" | "mate" | "them", at: [x, y], to: [x, y] }] (moving over the loop)
//   ball: [[x, y, bounce?], ...] the ball's path (a point with true bounces there)
//   arrows: [[x1, y1, x2, y2]] (footwork)
// task: what to do, in a few words; spec: a session spec (session.js) with `need`.

import { KITCHEN } from "../physics.js"
import { ZONE_SETS } from "./targets.js"
import { deepInTheirCourt, inTheirKitchen } from "./classify.js"

const SOFT = new Set(["dink", "drop", "reset", "block"])
const soft = (r) => !!r.shot && SOFT.has(r.shot.kind)
const ATTACK = new Set(["speedup", "smash", "counter", "drive", "punch", "roll"])

const basic = (r) => {
  if (r.outcome === "miss") return "Move to the ball: press hit as it comes, let go as it arrives."
  if (r.outcome === "net") return "Into the net: aim a bit deeper."
  if (r.outcome === "out") return "Out: a shorter, softer tap."
  if (r.outcome === "fault") return /kitchen/i.test(r.fault || "") ? "Kitchen fault: after a volley, stop before the line." : "Fault: let it bounce first (two-bounce rule)."
  return null
}

export const LESSONS = [
  {
    id: "basics",
    title: "Your first 2 minutes",
    tip: "Tap hit for a soft shot, hold it for a hard one, and let go just before the ball reaches you. Point at their court to aim. Keep it simple: get the ball over the net and in.",
    tipTouch: "Touch their court where you want the ball to go: a quick tap hits soft, holding your finger down hits hard. Let go just before the ball reaches you. Keep it simple: over the net and in.",
    task: "Hit 3 balls in.",
    diagram: { dots: [{ who: "you", at: [12, 43], to: [11, 41] }, { who: "them", at: [9, 1] }], ball: [[9, 2], [11, 35, true], [11, 40], [8, 8, true], [7, 2]] },
    spec: {
      machine: { shot: "drop", speed: "slow", place: "middle", rate: 12 },
      need: 3,
      judge: (r) => (r.outcome === "in" ? { ok: true, msg: "In! That's a rally shot." } : { ok: false, msg: basic(r) }),
    },
  },
  {
    id: "two-bounce",
    title: "The two-bounce rule",
    tip: "The serve must bounce, and so must the return. Only after those two bounces can anyone hit the ball out of the air. So when you return a serve, always let it bounce first.",
    task: "Return 3 serves, letting each bounce.",
    diagram: { hi: "box", dots: [{ who: "you", at: [14, 43] }, { who: "them", at: [6, 1] }], ball: [[6, 1], [14, 36, true], [14, 42], [8, 6, true], [8, 1]] },
    spec: {
      machine: { shot: "drive", speed: "slow", place: "middle", rate: 10 },
      feed: "serve",
      need: 3,
      judge: (r) => {
        if (r.outcome === "in" && !r.volley) return { ok: true, msg: "Good: it bounced, then you hit it." }
        if (r.volley || r.outcome === "fault") return { ok: false, msg: "Let the serve bounce first: that's the two-bounce rule." }
        return { ok: false, msg: basic(r) }
      },
    },
  },
  {
    id: "serve",
    title: "Serve deep",
    tip: "A deep serve keeps them back at their baseline, so they can't rush the net. Serve underhand: hold hit, let go in the green, aim at the back of the box on the diagonal.",
    tipTouch: "A deep serve keeps them back at their baseline, so they can't rush the net. Touch the back of the box on the diagonal, hold, and let go in the green.",
    task: "Land 3 serves deep in the box.",
    diagram: { hi: "deep", dots: [{ who: "you", at: [14, 45] }, { who: "them", at: [5, 1] }], ball: [[14, 44], [6, 4, true], [5, 1]] },
    spec: {
      serve: true,
      need: 3,
      zones: ZONE_SETS.serve,
      judge: (r) => {
        if (r.zone === "sv-deep") return { ok: true, msg: "Deep serve! They have to stay back." }
        if (r.outcome === "in") return { ok: false, msg: "In, but short: hold a bit longer for depth." }
        return { ok: false, msg: r.outcome === "net" ? "Net: hold a bit longer." : "Out: let go a little sooner." }
      },
    },
  },
  {
    id: "return",
    title: "Return deep, then come in",
    tip: "Return the serve deep, then run straight to the kitchen line: they must let your return bounce, so you have time. The team at the line wins most points.",
    task: "2 deep returns, moving in after each.",
    diagram: { hi: "deep", dots: [{ who: "you", at: [14, 43], to: [13, 30] }, { who: "them", at: [6, 1] }], ball: [[6, 1], [14, 37, true], [14, 42], [6, 4, true], [6, 1]], arrows: [[14, 41, 13, 31]] },
    spec: {
      machine: { shot: "drive", speed: "slow", place: "middle", rate: 10 },
      feed: "serve",
      track: "moveIn",
      need: 2,
      zones: ZONE_SETS.deep,
      judge: (r) => {
        const deep = r.outcome === "in" && deepInTheirCourt(r.landing)
        if (deep && r.moveIn >= 2) return { ok: true, msg: "Deep, and you came in. That's it!" }
        if (deep) return { ok: false, msg: "Deep! Now run up to the kitchen line after it." }
        if (r.outcome === "in") return { ok: false, msg: "Short: aim at the back of their court." }
        return { ok: false, msg: basic(r) }
      },
    },
  },
  {
    id: "drop",
    title: "Third shot: drop, then advance",
    tip: "Serving, you're stuck back while they wait at the net. Hit a soft drop that lands in their kitchen: they must hit up, and you move in. A drive works too, but the drop is safer.",
    task: "3 drops into their kitchen.",
    diagram: { hi: "their-kitchen", dots: [{ who: "you", at: [7, 43], to: [8, 31] }, { who: "them", at: [7, 14] }, { who: "them", at: [13, 14] }], ball: [[13, 14], [7, 38, true], [7, 42], [9, 17, false], [10, 11, true]], arrows: [[7, 41, 8, 32]] },
    spec: {
      machine: { shot: "drop", speed: "slow", place: "random", rate: 10 },
      need: 3,
      zones: ZONE_SETS.drop,
      judge: (r) => {
        if (r.outcome === "in" && soft(r) && !r.shot.attackable && -r.landing.z <= KITCHEN + 0.6) return { ok: true, msg: "Great drop! Now step in." }
        if (r.outcome === "in" && soft(r) && r.shot.attackable) return { ok: false, msg: "Too high: aim lower over the net." }
        if (r.outcome === "in" && !soft(r)) return { ok: false, msg: "Too hard: a quick soft tap." }
        if (r.outcome === "in") return { ok: false, msg: "Landed deep: aim into the kitchen." }
        return { ok: false, msg: basic(r) }
      },
    },
  },
  {
    id: "kitchen",
    title: "Live at the kitchen line",
    tip: "Stand right behind the kitchen line: from there you can volley and reach their dinks. You can't volley inside the kitchen, and your momentum can't carry you in after a volley either.",
    task: "Volley 3 from the line without stepping in.",
    diagram: { hi: "kitchen", dots: [{ who: "you", at: [11, 30] }, { who: "them", at: [9, 14] }], ball: [[9, 15], [11, 29.5]], arrows: [] },
    spec: {
      machine: { shot: "dink", speed: "slow", place: "middle", rate: 10 },
      feed: "float",
      need: 3,
      judge: (r) => {
        if (r.outcome === "fault") return { ok: false, msg: "Kitchen fault: after a volley, stop before the line." }
        if (r.outcome === "in" && r.volley) return { ok: true, msg: "Volley from the line. You stayed out!" }
        if (r.outcome === "in") return { ok: false, msg: "Take it out of the air: don't back up." }
        return { ok: false, msg: basic(r) }
      },
    },
  },
  {
    id: "dink",
    title: "Dink and wait",
    tip: "At the line, dink: a soft ball that lands in their kitchen and stays low, so they can't attack it. Aim cross-court, over the low middle of the net. Be patient: the first one to pop it up loses.",
    task: "5 low dinks into their kitchen.",
    diagram: { hi: "their-kitchen", dots: [{ who: "you", at: [14, 30] }, { who: "them", at: [6, 14] }], ball: [[14, 29], [7, 18, true], [6, 15], [13, 25, true], [14, 29]] },
    spec: {
      machine: { shot: "dink", speed: "slow", place: "random", rate: 15 },
      returns: true,
      need: 5,
      zones: ZONE_SETS.kitchen,
      judge: (r) => {
        if (r.outcome === "in" && soft(r) && !r.shot.attackable && inTheirKitchen(r.landing, 0.3)) return { ok: true, msg: "Unattackable. Patience!" }
        if (r.outcome === "in" && r.shot.attackable) return { ok: false, msg: "Too high: aim lower over the net." }
        if (r.outcome === "in" && !soft(r)) return { ok: false, msg: "Too hard: at the line, just a tap." }
        if (r.outcome === "in") return { ok: false, msg: "Deep: keep it in the kitchen." }
        return { ok: false, msg: basic(r) }
      },
    },
  },
  {
    id: "speedup",
    title: "Attack the high ball",
    tip: "Wait for a ball that comes up above the net (the ring on the ball turns orange). Then hold hit and drive it at their hip or shoulder. A low ball gets dinked, not attacked.",
    tipTouch: "Wait for a ball that comes up above the net (the ring on the ball turns orange). Then hold your finger down and drive it at their hip or shoulder. A low ball gets dinked, not attacked.",
    task: "4 right calls: dink low, attack high.",
    diagram: { dots: [{ who: "you", at: [11, 30] }, { who: "them", at: [10, 14] }], ball: [[10, 15], [11, 26, false], [11, 29], [10.5, 12, false]] },
    spec: {
      machine: { shot: "dink", speed: "slow", place: "random", rate: 12 },
      feed: "dinkfloat",
      need: 4,
      judge: (r) => {
        const high = !!r.fed?.float
        const attacked = !!r.shot && ATTACK.has(r.shot.kind)
        if (r.outcome !== "in") return { ok: false, msg: basic(r) }
        if (high && attacked) return { ok: true, msg: "It was up high, so you attacked. Yes!" }
        if (high) return { ok: false, msg: "That one was high: hold hit and speed it up." }
        if (attacked) return { ok: false, msg: "Too low to attack: dink it." }
        return { ok: true, msg: "Patient dink. Good." }
      },
    },
  },
  {
    id: "reset",
    title: "In trouble? Reset",
    tip: "Caught in the middle of the court with a hard ball at your feet? Don't swing: soften your hands and tap it into their kitchen (a reset). Then take a step in.",
    task: "Reset 3 hard balls into the kitchen.",
    diagram: { hi: "their-kitchen", dots: [{ who: "you", at: [10, 35] }, { who: "them", at: [10, 14] }], ball: [[10, 15], [10, 34, true], [10, 35], [10, 17, true]] },
    spec: {
      machine: { shot: "drive", speed: "medium", place: "random", rate: 10 },
      feed: "transition",
      need: 3,
      judge: (r) => {
        if (r.outcome === "in" && soft(r) && !r.shot.attackable && -r.landing.z <= KITCHEN + 0.8) return { ok: true, msg: "Reset! Now take a step in." }
        if (r.outcome === "in" && r.shot.attackable) return { ok: false, msg: "Too high: soft hands, aim into the kitchen." }
        if (r.outcome === "in" && !soft(r)) return { ok: false, msg: "Don't swing: just tap it soft." }
        if (r.outcome === "in") return { ok: false, msg: "Deep: aim shorter." }
        return { ok: false, msg: basic(r) }
      },
    },
  },
  {
    id: "doubles",
    title: "Doubles: move as a unit",
    tip: "Move with your partner like you're tied by a rope: up together, back together, side by side. A ball down the middle goes to the player with the forehand there. Your partner here does that for you.",
    task: "Play 2 points staying level with your partner.",
    diagram: { dots: [{ who: "you", at: [14, 43], to: [14, 30] }, { who: "mate", at: [6, 43], to: [6, 30] }, { who: "them", at: [6, 14] }, { who: "them", at: [14, 14] }], arrows: [[14, 41, 14, 32], [6, 41, 6, 32]] },
    spec: {
      play: true,
      need: 2,
      time: 240,
      pointJudge: (pt) => (pt.level >= 0.65 ? { ok: true, msg: "You moved together with your partner." } : { ok: false, msg: "Stay level with your partner: up together, back together." }),
    },
  },
]

export const lessonById = (id) => LESSONS.find((l) => l.id === id) || null
export const nextLesson = (id) => {
  const i = LESSONS.findIndex((l) => l.id === id)
  return i >= 0 && i + 1 < LESSONS.length ? LESSONS[i + 1] : null
}
// the first lesson not done yet (or the first one)
export const suggestedLesson = (done = {}) => LESSONS.find((l) => !done[l.id]) || LESSONS[0]
