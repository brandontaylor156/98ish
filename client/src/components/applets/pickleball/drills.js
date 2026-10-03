// Pickleball 98: practice. Drills put you on court with a ball machine (a "feeder" on the
// other side) that feeds the ball you need: deep balls for third-shot drops, dinks for a dink
// rally, a mix of low dinks and floaters (dink the low ones, attack the high ones), speed-ups
// at your body for hand battles, hard balls at your feet in the transition zone to reset, or
// nothing while you practice serves. Each of your shots is judged by what it gives the other
// side (shots.js: unattackable, popped up, in or out). The tutorial is a string of short
// drills, one skill at a time, in the order a point is played. Pure JavaScript; the match
// runs it through m.practice.

import { HALF_L, KITCHEN, solveShot, v3 } from "./physics.js"
import { NET_LINE } from "./ai.js"
import { planShot } from "./shots.js"
import { createRally } from "./rules.js"

const inTheirKitchen = (l) => l && l.z < 0 && Math.abs(l.z) <= KITCHEN + 0.02 && Math.abs(l.x) <= 3.05
const nearTheirKitchen = (l) => l && l.z < 0 && Math.abs(l.z) <= KITCHEN + 0.6 && Math.abs(l.x) <= 3.05
const inTheirCourt = (l) => l && l.z < 0 && Math.abs(l.z) <= HALF_L && Math.abs(l.x) <= 3.05
const deepInTheirCourt = (l) => inTheirCourt(l) && Math.abs(l.z) >= HALF_L - 2.4
const ATTACKS = new Set(["speedup", "smash", "counter", "roll", "punch", "drive"])

// The feeds: where you stand, where the machine is, and what it sends. kind: a planShot kind,
// or "fast" (a hard ball at you), "float" (a dink that floats up into your reach); mix: the
// chance a feed is the float instead
const FEEDS = {
  deep: { you: { x: 0.6, z: HALF_L - 0.1 }, feeder: { x: -0.4, z: -NET_LINE }, kind: "return", target: (rand) => ({ x: 0.2 + rand() * 1.4, z: HALF_L - 1.4 - rand() * 0.8 }), power: 0.3, hits: 2 },
  serve: { you: { x: 0.6, z: HALF_L - 0.1 }, feeder: { x: -0.9, z: -HALF_L - 0.3 }, kind: "return", target: (rand) => ({ x: 0.8 + rand() * 1.2, z: HALF_L - 1.0 - rand() * 1.0 }), power: 0.5, hits: 1 },
  rally: { you: { x: 0.6, z: HALF_L - 0.1 }, feeder: { x: -0.2, z: -HALF_L + 0.6 }, kind: "drive", target: (rand) => ({ x: -0.8 + rand() * 2.2, z: HALF_L - 2.2 - rand() * 1.2 }), power: 0.1, hits: 4 },
  dink: { you: { x: 0.5, z: NET_LINE }, feeder: { x: -0.5, z: -NET_LINE }, kind: "dink", target: (rand) => ({ x: -0.6 + rand() * 1.6, z: KITCHEN - 0.7 - rand() * 0.6 }), power: 0.2, hits: 4, returns: true },
  mix: { you: { x: 0.5, z: NET_LINE }, feeder: { x: -0.5, z: -NET_LINE }, kind: "dink", mix: 0.4, target: (rand) => ({ x: -0.6 + rand() * 1.6, z: KITCHEN - 0.7 - rand() * 0.6 }), power: 0.2, hits: 4 },
  popup: { you: { x: 0.3, z: NET_LINE + 1.0 }, feeder: { x: 0, z: -NET_LINE }, kind: "popup", target: (rand) => ({ x: -0.3 + rand() * 1.2, z: NET_LINE + 0.6 + rand() * 0.6 }), power: 0.4, hits: 4 },
  // (aimed well behind you: it passes at your hip or chest)
  hands: { you: { x: 0.4, z: NET_LINE }, feeder: { x: -0.3, z: -NET_LINE }, kind: "fast", target: (rand) => ({ x: 0.3 + (rand() - 0.3) * 1.2, z: NET_LINE + 2.6 + rand() * 1.2 }), power: 0.15, hits: 6 },
  transition: { you: { x: 0.4, z: 4.4 }, feeder: { x: -0.3, z: -NET_LINE }, kind: "fast", target: (rand) => ({ x: 0.1 + (rand() - 0.5) * 1.4, z: 3.9 - rand() * 0.5 }), power: 0.05, hits: 4 },
}

export const DRILLS = [
  { id: "serve", name: "Serving", goal: "Land 7 of 10 serves in the service box.", total: 10, pass: 7, serve: true, judge: { end: (res) => res.reason === "Double bounce" } },
  { id: "return", name: "Deep returns", goal: "Return 6 of 10 serves deep (the back 8 feet).", total: 10, pass: 6, feed: "serve", judge: { landing: deepInTheirCourt } },
  { id: "third", name: "Third-shot drop", goal: "From the baseline, 6 of 10 drops that land in their kitchen low (unattackable).", total: 10, pass: 6, feed: "deep", judge: { shot: (s) => (s.kind === "drop" && !s.attackable ? null : false), landing: inTheirKitchen } },
  { id: "dink", name: "Dinking", goal: "Unattackable dinks into the kitchen: 10 of 14.", total: 14, pass: 10, feed: "dink", judge: { shot: (s) => (s.tag === "dink" ? null : false), landing: inTheirKitchen } },
  { id: "patience", name: "Dink or attack?", goal: "Dink the low ones, speed up the floaters: 8 of 12.", total: 12, pass: 8, feed: "mix", judge: { shot: (s, fed) => (fed?.float ? (ATTACKS.has(s.kind) ? null : false) : s.tag === "dink" ? null : false), landing: (l, fed) => (fed?.float ? inTheirCourt(l) : inTheirKitchen(l)) } },
  { id: "hands", name: "Hand battle", goal: "Speed-ups at you: block them soft or counter. 7 of 10.", total: 10, pass: 7, feed: "hands", judge: { shot: (s) => (s.tag === "reset" || s.kind === "counter" || s.kind === "punch" ? null : false), landing: inTheirCourt } },
  { id: "reset", name: "Transition resets", goal: "Caught mid-court: reset hard balls into the kitchen. 6 of 10.", total: 10, pass: 6, feed: "transition", judge: { shot: (s) => (s.tag === "reset" || s.tag === "drop" ? null : false), landing: nearTheirKitchen } },
  { id: "smash", name: "Put-aways", goal: "Put the pop-ups away. 6 of 8.", total: 8, pass: 6, feed: "popup", judge: { landing: inTheirCourt } },
]
export const drillById = (id) => DRILLS.find((d) => d.id === id) || null

// The tutorial: how a point is played, one skill at a time (keys are filled in by the page:
// {move}, {hit}, {aim})
export const TUTORIAL = [
  { id: "move", title: "Moving", text: "Move with {move}. Get a feel for it: run around a little.", moved: 4 },
  {
    id: "touch",
    title: "One button: touch",
    text: "Every shot is {hit}. TAP it just before the ball reaches you and the shot is soft; HOLD it longer and it's harder. Let go as the marker hits the middle. At the kitchen line a soft tap is a dink. Land 3 in their kitchen.",
    feed: "dink",
    need: 3,
    count: (s) => s.kind === "dink" || s.kind === "drop" || s.kind === "reset",
    landing: inTheirKitchen,
  },
  { id: "aim", title: "Aim", text: "Aim with {aim}: the ring on their side is where it's going. Cross-court is safest (more court, the lowest part of the net). Land 2 dinks in their kitchen on the far side from you.", feed: "dink", need: 2, count: (s) => s.kind === "dink", landing: (l) => inTheirKitchen(l) && l.x < -0.3 },
  { id: "serve", title: "Serve deep", text: "Serves are underhand: HOLD {hit} to fill the serve meter, let go in the green. Aim deep into the box on the diagonal. Land 1 serve in.", serve: true, need: 1 },
  { id: "return", title: "Return deep, then come in", text: "Return the serve DEEP (hold a little for pace, aim at the back of their court), then run to the kitchen line: the serving team has to let your return bounce. Land 1 deep return.", feed: "serve", need: 1, count: () => true, landing: deepInTheirCourt },
  {
    id: "drop",
    title: "The third-shot drop",
    text: "Serving, you're stuck at the baseline while they're at the net. A hard ball from down there comes back at your feet. Instead: a soft tap aimed into their kitchen arcs over and drops low. Land 2 drops they can't attack.",
    feed: "deep",
    need: 2,
    count: (s) => s.kind === "drop" && !s.attackable,
    landing: inTheirKitchen,
  },
  {
    id: "dink",
    title: "Dinking: patience",
    text: "At the line, keep it LOW: a dink that floats up gets attacked. Soft taps, into the kitchen, cross-court. The label tells you how it was: \"Unattackable dink\" is the goal. Hit 4.",
    feed: "dink",
    need: 4,
    count: (s) => s.tag === "dink",
    landing: inTheirKitchen,
  },
  {
    id: "speedup",
    title: "Speed up the high ball",
    text: "When a ball comes up ABOVE the net (the contact marker turns orange), HOLD {hit} and drive it at their hip or shoulder: a speed-up. From below the net it sails long, so only attack what's up. Dink the low ones. 3 right calls.",
    feed: "mix",
    need: 3,
    count: (s, fed) => (fed?.float ? ATTACKS.has(s.kind) : s.tag === "dink"),
    landing: (l, fed) => (fed?.float ? inTheirCourt(l) : inTheirKitchen(l)),
  },
  {
    id: "hands",
    title: "Hand battle",
    text: "They speed it up at you: there's no time to wind up. Have {hit} held as their swing comes (paddle up) and let go as it arrives to COUNTER, or TAP it late to BLOCK it soft into the kitchen. Get 2 back.",
    feed: "hands",
    need: 2,
    count: (s) => s.tag === "reset" || s.kind === "counter" || s.kind === "punch",
    landing: inTheirCourt,
  },
  {
    id: "reset",
    title: "Reset from the middle",
    text: "Caught in the transition zone, balls come at your feet. Don't swing hard: TAP it soft into their kitchen (a reset), then move up a step. Reset 2.",
    feed: "transition",
    need: 2,
    count: (s) => s.tag === "reset" || s.tag === "drop",
    landing: nearTheirKitchen,
  },
  {
    id: "rules",
    title: "Two rules that matter",
    text: "TWO-BOUNCE RULE: the serve must bounce, and so must the return. Only then can anyone volley (hit it out of the air).\n\nTHE KITCHEN: the 7-foot zone by the net. You can't volley with a foot in it (or on its line), not even when your momentum carries you in after. Let a ball bounce there first and you're fine.\n\nTHE POINT: serve and return deep, drop the third, get to the line, dink until someone's ball comes up, then attack it (and be ready for it to come back fast).",
    card: true,
  },
]

// The practice object a match runs: feeds, judging, counting.
//   spec: a drill (DRILLS) or a tutorial step; emit: (event) => void (drill progress)
export const createPractice = (spec, rand = Math.random) => {
  const feed = spec.feed ? FEEDS[spec.feed] : null
  const st = { made: 0, attempts: 0, total: spec.total || spec.need || 0, done: false, moved: 0, last: null, waiting: null, fed: null }
  const need = spec.need ?? spec.pass ?? spec.total
  const report = (m, ok) => {
    if (st.done) return
    st.attempts += ok === null ? 0 : 1
    if (ok) st.made++
    const finished = spec.need !== undefined ? st.made >= spec.need : st.attempts >= st.total
    if (finished) st.done = true
    m.events.push({ id: ++m.eventSeq, t: m.t, type: "drill", ok, made: st.made, attempts: st.attempts, total: st.total, need, done: st.done, passed: st.made >= need })
  }
  const you = (m) => m.players.find((p) => p.ctrl === "human")
  const feeder = (m) => m.players.find((p) => p.ctrl === "feeder")

  const judgeShot = (m, shot) => {
    const j = spec.judge || {}
    // tutorial steps count shots by kind; drills by their rule
    if (spec.count) {
      if (!spec.count(shot, st.fed)) return report(m, false)
      if (!spec.landing) return report(m, true)
      st.waiting = { shot, check: spec.landing }
      return
    }
    if (j.shot) {
      const r = j.shot(shot, st.fed)
      if (r === false) return report(m, false)
    }
    if (j.landing) st.waiting = { shot, check: j.landing }
  }

  return {
    state: st,
    spec,
    // a new attempt: place everyone and get the machine ready (true: we've set up the point)
    begin(m) {
      st.waiting = null
      st.lastShotT = null
      const y = you(m)
      const f = feeder(m)
      if (spec.serve) {
        // a normal serve from the right court (the machine stays out of the way)
        if (f) {
          f.spot = { x: -1.2, z: -HALF_L - 1.2 }
          f.x = f.spot.x
          f.z = f.spot.z
        }
        return false
      }
      if (!feed) {
        // free movement: no ball
        m.ball.held = f?.id || null
        m.phase = "rally"
        m.rally.hits = 0
        return true
      }
      for (const [p, at] of [[y, feed.you], [f, feed.feeder]]) {
        if (!p) continue
        const far = Math.hypot(p.x - at.x, p.z - at.z) > 2.5 || st.attempts === 0
        p.spot = { ...at }
        if (far || p === f) {
          p.x = at.x
          p.z = at.z
          p.vx = 0
          p.vz = 0
        }
        p.target = null
      }
      m.phase = "rally"
      m.phaseT = 0
      m.ball.held = f.id
      m.ball.v = v3()
      m.ball.w = v3()
      m.ball.rolling = false
      m.ball.rest = false
      m.teamDepth = [feed.you.z < 3 ? "net" : feed.you.z < 5 ? "mid" : "back", "net"]
      st.feedAt = st.attempts === 0 ? 1.4 : feed.kind === "fast" ? 1.1 : 0.9
      return true
    },
    // every step: the machine feeds; your shots are judged
    tick(m, dt) {
      const y = you(m)
      const f = feeder(m)
      if (spec.moved && y) {
        st.moved += Math.hypot(y.vx, y.vz) * dt
        if (st.moved >= spec.moved && !st.done) report(m, true)
        return
      }
      if (feed && f && m.ball.held === f.id && m.phase === "rally" && m.phaseT >= st.feedAt) {
        const float = !!feed.mix && rand() < feed.mix
        st.fed = { float, kind: feed.kind }
        const from = v3(f.x + 0.15, feed.kind === "fast" ? 1.0 : 0.85, f.z + (feed.kind === "return" && feed.hits === 1 ? 0.2 : 0.4))
        const t = feed.target(rand)
        let plan
        let label = feed.kind
        if (feed.kind === "fast") {
          // a speed-up: hard and flat at you
          plan = planShot("drive", { team: f.team, from, targetX: t.x, targetZ: t.z, power: feed.power + rand() * 0.2 })
          label = "speedup"
        } else if (float) {
          // a dink that floats up: it comes into your reach above the net
          plan = planShot("dink", { team: f.team, from, targetX: t.x, targetZ: NET_LINE + 0.3 + rand() * 0.4 })
          plan.mode = { apex: 1.55 + rand() * 0.3 }
          label = "dink"
        } else {
          plan = planShot(feed.kind === "popup" ? "lob" : feed.kind, { team: f.team, from, targetX: t.x, targetZ: t.z, power: feed.power })
          if (feed.kind === "popup") plan.mode = { apex: 2.25 + rand() * 0.3 }
          if (feed.kind === "popup") label = "lob"
        }
        const solved = solveShot(from, plan.target, { ...plan.mode, spin: plan.spin, minClear: plan.minClear })
        m.ball.held = null
        m.ball.p = from
        m.ball.v = solved.v
        m.ball.w = solved.w
        const r = m.rally
        r.hits = feed.hits
        if (feed.hits === 1) {
          // a serve from the machine's right court, to you: the referee's serve rules apply
          r.court = "right"
          r.serving = f.team
          r.receiver = y.id
        }
        r.lastTeam = f.team
        r.lastPlayer = f.id
        r.bounces = 0
        f.swing = { t: 0, kind: label, hand: "fh", x: from.x, y: from.y, z: from.z, id: (f.swingSeq = (f.swingSeq || 0) + 1) }
        m.lastShot = { kind: label, by: f.id, team: f.team, speed: Math.hypot(solved.v.x, solved.v.y, solved.v.z), t: m.t }
        m.version++
        m.events.push({ id: ++m.eventSeq, t: m.t, type: "hit", player: f.id, team: f.team, kind: label, speed: Math.hypot(solved.v.x, solved.v.y, solved.v.z), x: from.x, y: from.y, z: from.z, paddle: 6, grade: "good" })
      }
      // your shots
      const s = m.lastShot
      // (the machine took your last one out of the air: it never landed; judge it by what
      // it gave them)
      if (st.waiting && s && s.by !== y?.id && s.t > st.waiting.shot.t) {
        const ok = !st.waiting.shot.attackable
        st.waiting = null
        report(m, ok)
      }
      if (s && s.by === y?.id && s.t !== st.lastShotT) {
        st.lastShotT = s.t
        if (!spec.serve) judgeShot(m, s)
      }
      // where it landed
      if (st.waiting && m.landing && m.landing.by === y?.id) {
        const ok = !!st.waiting.check(m.landing, st.fed)
        st.waiting = null
        report(m, ok)
      }
    },
    // the machine's own shots when it returns (the dink drill): a soft dink back
    shot(m, p) {
      if (p.ctrl !== "feeder") return null
      const t = FEEDS.dink.target(rand)
      return { pace: 0.06, target: { x: -t.x, z: -t.z }, intent: "dink" }
    },
    returns: !!feed?.returns,
    // the point's over
    end(m, res) {
      if (spec.serve) {
        const y = you(m)
        if (m.lastShot?.by === y?.id && m.rally.hits <= 1) report(m, res.reason === "Double bounce")
        return
      }
      if (st.waiting) {
        // it never landed (into the net, say)
        st.waiting = null
        report(m, false)
      }
    },
  }
}

// createMatch options for a drill or tutorial step: you against the machine
export const practiceMatch = (spec, { character = "maya", outfit, rand } = {}) => {
  const practice = createPractice(spec, rand)
  return {
    doubles: false,
    level: "intermediate",
    practice,
    roster: [
      { id: "you", team: 0, ctrl: "human", slot: 0, name: "You", character, outfit },
      { id: "machine", team: 1, ctrl: "feeder", level: "intermediate", name: "Ball machine", character: "gus" },
    ],
  }
}

export { createRally }
