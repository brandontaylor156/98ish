// Pickleball 98: practice. Drills put you on court with a ball machine (a "feeder" on the
// other side) that feeds the ball you need: deep returns for third-shot drops, dinks for a
// dink rally, pop-ups to put away, or nothing while you practice serves. Each of your shots
// is judged (where it landed, how it was timed) and counted. The tutorial is a string of
// short drills, one skill at a time. Pure JavaScript; the match runs it through m.practice.

import { HALF_L, KITCHEN, solveShot, v3 } from "./physics.js"
import { NET_LINE } from "./ai.js"
import { planShot } from "./shots.js"
import { createRally } from "./rules.js"

const inTheirKitchen = (l) => l && l.z < 0 && Math.abs(l.z) <= KITCHEN + 0.02 && Math.abs(l.x) <= 3.05
const inTheirCourt = (l) => l && l.z < 0 && Math.abs(l.z) <= HALF_L && Math.abs(l.x) <= 3.05

// The feeds: where you stand, where the machine is, and what it sends
const FEEDS = {
  deep: { you: { x: 0.6, z: HALF_L - 0.1 }, feeder: { x: -0.4, z: -NET_LINE }, kind: "return", target: (rand) => ({ x: 0.2 + rand() * 1.4, z: HALF_L - 1.4 - rand() * 0.8 }), power: 0.3, hits: 2 },
  rally: { you: { x: 0.6, z: HALF_L - 0.1 }, feeder: { x: -0.2, z: -HALF_L + 0.6 }, kind: "drive", target: (rand) => ({ x: -0.8 + rand() * 2.2, z: HALF_L - 2.2 - rand() * 1.2 }), power: 0.1, hits: 4 },
  dink: { you: { x: 0.5, z: NET_LINE }, feeder: { x: -0.5, z: -NET_LINE }, kind: "dink", target: (rand) => ({ x: -0.6 + rand() * 1.6, z: KITCHEN - 0.7 - rand() * 0.6 }), power: 0.2, hits: 4, returns: true },
  popup: { you: { x: 0.3, z: NET_LINE + 1.0 }, feeder: { x: 0, z: -NET_LINE }, kind: "popup", target: (rand) => ({ x: -0.3 + rand() * 1.2, z: NET_LINE + 0.6 + rand() * 0.6 }), power: 0.4, hits: 4 },
  net: { you: { x: 0.3, z: NET_LINE }, feeder: { x: 0, z: -NET_LINE }, kind: "dink", target: (rand) => ({ x: -0.5 + rand() * 1.4, z: KITCHEN + 0.3 + rand() * 0.6 }), power: 0.3, hits: 4 },
}

export const DRILLS = [
  { id: "serve", name: "Serving", goal: "Land 7 of 10 serves in the service box.", total: 10, pass: 7, serve: true, judge: { end: (res) => res.reason === "Double bounce" } },
  { id: "third", name: "Third-shot drop", goal: "From the baseline, drop 6 of 10 into their kitchen.", total: 10, pass: 6, feed: "deep", judge: { landing: inTheirKitchen } },
  { id: "dink", name: "Dinking", goal: "Dink into the kitchen. 10 of 14 to pass.", total: 14, pass: 10, feed: "dink", judge: { landing: inTheirKitchen } },
  { id: "smash", button: "topspin", name: "Put-aways", goal: "Smash the pop-ups in. 6 of 8.", total: 8, pass: 6, feed: "popup", judge: { landing: inTheirCourt } },
  { id: "rally", name: "Groundstrokes", goal: "Time your drives: 7 of 10 good or perfect and in.", total: 10, pass: 7, feed: "rally", judge: { shot: (s) => (s.grade === "perfect" || s.grade === "good" ? null : false), landing: inTheirCourt } },
]
export const drillById = (id) => DRILLS.find((d) => d.id === id) || null

// The tutorial: one skill at a time (keys are filled in by the page)
export const TUTORIAL = [
  { id: "move", title: "Moving", text: "Move with {move}. Get a feel for it: run around a little.", moved: 4 },
  { id: "timing", button: "topspin", title: "Timing is everything", text: "Here comes a ball. Press and HOLD {topspin} as it comes (holding = more power), and LET GO when the marker reaches the green zone. Hit 2 good or perfect shots.", feed: "deep", need: 2, count: (s) => s.grade === "perfect" || s.grade === "good" },
  { id: "topspin", button: "topspin", title: "Topspin drive", text: "{topspin} is your topspin drive: fast and dipping. Steer with {move} as you let go (push forward to hit deeper). Hit 2 drives that land in.", feed: "rally", need: 2, count: (s) => s.kind === "drive" || s.kind === "return", landing: inTheirCourt },
  { id: "slice", button: "slice", title: "Slice", text: "{slice} is a slice: backspin, low and skidding. Great for a deep return. Hit 2 slices in.", feed: "deep", need: 2, count: (s) => s.kind === "slice" || s.kind === "block", landing: inTheirCourt },
  { id: "soft", button: "soft", title: "Dinks and drops", text: "{soft} hits soft: a dink at the kitchen line, a drop from farther back. Land 3 dinks in their kitchen.", feed: "dink", need: 3, count: (s) => s.kind === "dink" || s.kind === "drop" || s.kind === "block", landing: inTheirKitchen },
  { id: "lob", button: "lob", title: "Lob", text: "{lob} lobs it over a player crowding the net. Hit 1 lob that lands in.", feed: "net", need: 1, count: (s) => s.kind === "lob", landing: inTheirCourt },
  { id: "power", button: "topspin", risky: true, title: "Power shots", text: "Hold {power} while you swing for a power shot: faster and closer to the lines, but it can go out. Perfect timing tames it. Land 1 power shot.", feed: "rally", need: 1, count: (s) => s.risky, landing: inTheirCourt },
  { id: "smash", button: "topspin", title: "Put it away", text: "A ball up high near the net? {topspin} smashes it. Smash 1 in.", feed: "popup", need: 1, count: (s) => s.kind === "smash" || s.kind === "punch", landing: inTheirCourt },
  { id: "serve", title: "Serving", text: "Serves are underhand. HOLD a shot button to fill the serve meter and let go in the green. Steer with {move}. Land 1 serve in.", serve: true, need: 1 },
  { id: "rules", title: "Two rules that matter", text: "TWO-BOUNCE RULE: the serve must bounce, and so must the return. Only then can anyone volley (hit it out of the air).\n\nTHE KITCHEN: the 7-foot zone by the net. You can't volley with a foot in it (or on its line), not even when your momentum carries you in after. Let a ball bounce there first and you're fine.", card: true },
]

// The practice object a match runs: feeds, judging, counting.
//   spec: a drill (DRILLS) or a tutorial step; emit: (event) => void (drill progress)
export const createPractice = (spec, rand = Math.random) => {
  const feed = spec.feed ? FEEDS[spec.feed] : null
  const st = { made: 0, attempts: 0, total: spec.total || spec.need || 0, done: false, moved: 0, last: null, waiting: null }
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
      if (!spec.count(shot)) return report(m, false)
      if (!spec.landing) return report(m, true)
      st.waiting = { shot, check: spec.landing }
      return
    }
    if (j.shot) {
      const r = j.shot(shot)
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
      st.feedAt = st.attempts === 0 ? 1.4 : 0.9
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
        const from = v3(f.x + 0.15, 0.85, f.z + 0.4)
        const t = feed.target(rand)
        const kind = feed.kind === "popup" ? "lob" : feed.kind
        const plan = planShot(kind, { team: f.team, from, targetX: t.x, targetZ: t.z, power: feed.power })
        if (feed.kind === "popup") plan.mode = { apex: 2.25 + rand() * 0.3 }
        const solved = solveShot(from, plan.target, { ...plan.mode, spin: plan.spin, minClear: plan.minClear })
        m.ball.held = null
        m.ball.p = from
        m.ball.v = solved.v
        m.ball.w = solved.w
        const r = m.rally
        r.hits = feed.hits
        r.lastTeam = f.team
        r.lastPlayer = f.id
        r.bounces = 0
        f.swing = { t: 0, kind: feed.kind === "popup" ? "lob" : feed.kind, hand: "fh", x: from.x, y: from.y, z: from.z, id: (f.swingSeq = (f.swingSeq || 0) + 1) }
        m.version++
        m.events.push({ id: ++m.eventSeq, t: m.t, type: "hit", player: f.id, team: f.team, kind, speed: Math.hypot(solved.v.x, solved.v.y, solved.v.z), x: from.x, y: from.y, z: from.z, paddle: 6, grade: "good" })
      }
      // your shots
      const s = m.lastShot
      if (s && s.by === y?.id && s.t !== st.lastShotT) {
        st.lastShotT = s.t
        if (!spec.serve) judgeShot(m, s)
      }
      // where it landed
      if (st.waiting && m.landing && m.landing.by === y?.id) {
        const ok = !!st.waiting.check(m.landing)
        st.waiting = null
        report(m, ok)
      }
    },
    // the machine's own shots when it returns (the dink drill): a soft dink back
    shot(m, p) {
      if (p.ctrl !== "feeder") return null
      const t = FEEDS.dink.target(rand)
      return { kind: "dink", targetX: t.x * -1, targetZ: t.z, power: 0.2 }
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
