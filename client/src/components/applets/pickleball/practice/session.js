// Pickleball 98 practice: a session on court (the ball machine, a drill or a lesson's task).
// It is the `practice` object match.js runs (m.practice: begin/tick/shot/end/returns): it
// feeds balls from the machine (machine.js), follows each of your shots to where it lands,
// labels it (classify.js), scores it (target zones, the drill's or lesson's judge), keeps the
// stats, and reports through match events ({ type: "drill", train: true, snap, result }),
// which the engine passes to the page. Pure JavaScript.
//
// spec:
//   machine   ball machine settings (machine.js); feed: a special feed (machine.js planFeed)
//   cue       "split": a cue event as the machine hits (the split-step drill)
//   serve     you serve (no feeds; the machine is parked)
//   play      real points in doubles (you + a computer partner; opponents serve): no feeds
//   returns   the other side plays the ball back (rallies: a coach, not a machine)
//   balls     how many balls (attempts) at most; time: seconds at most; need: done once made >= need;
//   streakGoal: done once the streak gets there
//   zones     target zones (targets.js) or null
//   track     "moveIn": also measure how far you move forward after your shot
//   judge(result) -> { ok: true | false | null, msg }   (null: doesn't count)
//   pointJudge(point) -> { ok, msg }                     (play mode)

import { solveShot, v3 } from "../physics.js"
import { feedInterval, planFeed, normalizeMachine } from "./machine.js"
import { classifyShot, hintFor, MPH } from "./classify.js"
import { zoneAt, zonesFor } from "./targets.js"

const len = (v) => Math.hypot(v.x, v.y, v.z)
const SPLIT_SPEED = 0.9 // m/s: still enough at their contact to count as a split step
const FEED_LABEL = { dink: "dink", float: "dink", deep: "drive", drive: "drive", fast: "speedup", transition: "drive", lob: "lob", serve: "serve" }

export const createSession = (spec, { rand = Math.random } = {}) => {
  const machine = spec.machine ? normalizeMachine(spec.machine) : null
  const feeds = !!machine && !spec.serve && !spec.play
  const interval = machine ? feedInterval(machine) : 4
  const st = {
    t: 0,
    attempts: 0,
    made: 0,
    streak: 0,
    bestStreak: 0,
    points: 0,
    counts: { in: 0, out: 0, net: 0, miss: 0, fault: 0 },
    speedSum: 0,
    speedN: 0,
    fedN: 0,
    history: [],
    label: null,
    msg: null,
    hint: null,
    done: false,
    seq: 0,
    pending: null,
    fedOpen: false,
    fed: null,
    lastShotT: null,
    nextFeedAt: null,
    lastFeedT: -99,
    zones: spec.zones || null,
    flash: null, // { id, pts, t, x, z }: a zone lit up (layer.js)
    splitAt: null, // when the machine last hit (the split-step cue)
    machineAt: null, // where the machine stands ({ x, z }) when it's drawn
    home: null, // your spot
    showMachine: feeds && !spec.returns,
    play: spec.play ? { t: 0, level: 0 } : null,
  }
  const you = (m) => m.players.find((p) => p.ctrl === "human" && p.slot === 0)
  const feeder = (m) => m.players.find((p) => p.ctrl === "feeder")

  const snap = () => ({
    t: st.t,
    attempts: st.attempts,
    made: st.made,
    streak: st.streak,
    bestStreak: st.bestStreak,
    points: st.points,
    counts: { ...st.counts },
    avgMph: st.speedN ? Math.round((st.speedSum / st.speedN) * MPH) : 0,
    accuracy: st.attempts ? Math.round((st.counts.in / st.attempts) * 100) : 0,
    label: st.label,
    msg: st.msg,
    hint: st.hint,
    done: st.done,
    seq: st.seq,
  })
  const emit = (m, extra = {}) => {
    st.seq++
    m.events.push({ id: ++m.eventSeq, t: m.t, type: "drill", train: true, snap: snap(), ...extra })
  }

  const finished = () =>
    (spec.need !== undefined && spec.need !== null && st.made >= spec.need) ||
    (spec.streakGoal && st.bestStreak >= spec.streakGoal) ||
    (spec.balls && st.attempts >= spec.balls) ||
    (spec.time && st.t >= spec.time && !st.pending)

  const checkDone = (m) => {
    if (st.done || !finished()) return
    st.done = true
    emit(m, { done: true })
  }

  // one attempt is decided
  const record = (m, res) => {
    st.pending = null
    st.fedOpen = false
    res.label = classifyShot(res)
    const zone = res.outcome === "in" ? zoneAt(res.landing, st.zones) : null
    res.zone = zone?.id || null
    res.points = zone?.pts || 0
    const j = spec.judge ? spec.judge(res) || {} : { ok: res.outcome === "in" }
    res.ok = j.ok === undefined ? res.outcome === "in" : j.ok
    st.history.push(res)
    if (st.history.length > 60) st.history.shift()
    if (res.ok !== null) st.attempts++
    st.counts[res.outcome] = (st.counts[res.outcome] || 0) + 1
    if (res.shot && res.outcome !== "miss") {
      st.speedSum += res.shot.speed || 0
      st.speedN++
    }
    if (res.ok) {
      st.made++
      st.streak++
      st.bestStreak = Math.max(st.bestStreak, st.streak)
    } else if (res.ok === false) st.streak = 0
    if (zone && res.ok !== false) {
      st.points += zone.pts
      st.flash = { id: zone.id, pts: zone.pts, t: m.t, x: res.landing.x, z: res.landing.z }
    }
    st.label = res.label
    st.msg = j.msg || null
    st.hint = hintFor(st.history)
    emit(m, { result: { n: st.history.length, outcome: res.outcome, ok: res.ok, label: res.label, zone: res.zone, points: res.points, msg: st.msg, hint: st.hint, kind: res.shot?.kind || null } })
    checkDone(m)
  }

  // where everyone stands for the next ball; the machine gets it back
  const place = (m, plan, first) => {
    const y = you(m)
    const f = feeder(m)
    st.home = { ...plan.you }
    st.machineAt = { ...plan.at }
    for (const [p, at] of [
      [y, plan.you],
      [f, plan.at],
    ]) {
      if (!p) continue
      const far = Math.hypot(p.x - at.x, p.z - at.z) > 2.5
      p.spot = { ...at }
      if (first || far || p === f) {
        p.x = at.x
        p.z = at.z
        p.vx = 0
        p.vz = 0
      }
      p.target = null
    }
  }
  const nextPlan = (m) => planFeed(machine, { index: st.fedN, rand, hand: you(m)?.hand || 1, feed: spec.feed || null })
  const reload = (m, delay) => {
    const f = feeder(m)
    m.ball.held = f.id
    m.ball.v = v3()
    m.ball.w = v3()
    m.ball.rolling = false
    m.ball.rest = false
    st.nextFeedAt = Math.max(m.t + delay, st.lastFeedT + interval)
  }

  const feed = (m) => {
    const f = feeder(m)
    const y = you(m)
    const plan = st.next || nextPlan(m)
    st.next = null
    const from = v3(f.x + (plan.from.x - plan.at.x), plan.from.y, f.z + (plan.from.z - plan.at.z))
    const solved = solveShot(from, plan.target, { ...plan.mode, spin: plan.spin, minClear: plan.minClear })
    m.ball.held = null
    m.ball.p = from
    m.ball.v = solved.v
    m.ball.w = solved.w
    m.ball.rolling = false
    m.ball.rest = false
    m.landing = null
    const r = m.rally
    r.hits = plan.hits
    r.over = null
    if (plan.hits === 1 && y) {
      // a serve from the machine to you: the referee's serve rules apply
      r.court = "right"
      r.serving = f.team
      r.receiver = y.id
    }
    r.lastTeam = f.team
    r.lastPlayer = f.id
    r.bounces = 0
    const label = FEED_LABEL[plan.kind] || "drive"
    const speed = len(solved.v)
    f.swing = { t: 0, kind: label, hand: "fh", x: from.x, y: from.y, z: from.z, id: (f.swingSeq = (f.swingSeq || 0) + 1) }
    m.lastShot = { kind: label, by: f.id, team: f.team, speed, t: m.t }
    m.version++
    m.events.push({ id: ++m.eventSeq, t: m.t, type: "hit", player: f.id, team: f.team, kind: label, speed, x: from.x, y: from.y, z: from.z, paddle: 6, grade: "good" })
    st.fed = { kind: plan.kind, float: plan.float, index: plan.index, t: m.t, yourSpeed: y ? Math.hypot(y.vx, y.vz) : 0, split: y ? Math.hypot(y.vx, y.vz) < SPLIT_SPEED : false }
    st.fedOpen = true
    st.fedN++
    st.lastFeedT = m.t
    st.splitAt = m.t
    if (spec.cue) emit(m, { cue: spec.cue })
  }

  const begin = (m) => {
    st.pending = null
    st.fedOpen = false
    const f = feeder(m)
    if (spec.play) return false
    if (spec.serve) {
      // a normal serve from your right court; the machine is parked out of the way
      if (f) {
        f.spot = { x: -2.2, z: -6.9 }
        f.x = f.spot.x
        f.z = f.spot.z
      }
      st.machineAt = { ...f.spot }
      st.showMachine = true
      return false
    }
    if (!feeds) return false
    st.next = nextPlan(m)
    place(m, st.next, st.fedN === 0)
    m.phase = "rally"
    m.phaseT = 0
    m.teamDepth = [st.next.you.z < 3 ? "net" : st.next.you.z < 5 ? "mid" : "back", "net"]
    reload(m, st.fedN === 0 ? 1.6 : 0.7)
    return true
  }

  const tick = (m, dt) => {
    st.t += dt
    const y = you(m)
    const f = feeder(m)
    if (!y) return
    if (st.play) {
      // doubles: are you level with your partner?
      // (from the third shot on: the serve and the return keep a receiving team apart)
      if (m.phase === "rally" && !m.ball.held && m.rally.hits >= 2) {
        const mate = m.players.find((p) => p.team === y.team && p !== y)
        st.play.t += dt
        if (mate && Math.abs(Math.abs(mate.z) - Math.abs(y.z)) < 1.5) st.play.level += dt
      }
      return
    }
    // the machine stays put
    if (st.showMachine && f && f.spot && !spec.returns) {
      f.x = f.spot.x
      f.z = f.spot.z
      f.vx = 0
      f.vz = 0
    }
    const p = st.pending
    if (p) {
      p.minZ = Math.min(p.minZ, y.z)
      if (!p.landing && m.landing && m.landing.by === y.id) {
        p.landing = { x: m.landing.x, z: m.landing.z }
        // (the machine takes the ball back as it lands: it has a hopper full)
        if (feeds && !spec.returns && p.landing.z < 0 && f) reload(m, 0.5)
      }
      if (!p.landing && spec.returns && m.lastShot && m.lastShot.by !== y.id && m.lastShot.t > p.t) p.volleyed = true
      if (!p.fault && (p.landing || p.volleyed) && m.t >= p.resolveAt) {
        const outcome = p.volleyed ? "in" : p.landing.z > 0 ? "net" : Math.abs(p.landing.x) <= 3.07 && Math.abs(p.landing.z) <= 6.73 ? "in" : "out"
        record(m, { outcome, shot: p.shot, landing: p.landing, fed: p.fed, feet: p.feet, ballY: p.ballY, moveIn: p.startZ - p.minZ, volley: !!p.shot.volley })
      }
    }
    // your shot
    const s = m.lastShot
    if (s && s.by === y.id && s.t !== st.lastShotT) {
      st.lastShotT = s.t
      st.fedOpen = false
      st.pending = {
        t: s.t,
        shot: { kind: s.kind, tag: s.tag, label: s.label, tone: s.tone, attackable: !!s.attackable, speed: s.speed || 0, volley: !!s.volley, grade: s.grade, pace: s.pace },
        fed: st.fed,
        feet: { x: y.x, z: y.z },
        ballY: m.ball.p.y,
        startZ: y.z,
        minZ: y.z,
        landing: null,
        volleyed: false,
        // (a volley waits a moment: momentum may still carry you into the kitchen; moving in
        // after a return is measured for a couple of seconds)
        resolveAt: s.t + (spec.track === "moveIn" ? 2.2 : s.volley ? 0.6 : 0),
        // (the referee already called it against you: a volleyed serve or return, say)
        fault: (() => {
          const rr = m.rally.over || m.rally.pending
          return rr && rr.winner !== y.team ? rr.reason || "Fault" : null
        })(),
      }
    }
    // the machine feeds
    if (feeds && !st.done && f && m.ball.held === f.id && m.phase === "rally" && !st.pending && st.nextFeedAt !== null && m.t >= st.nextFeedAt) {
      if (spec.time && st.t >= spec.time) checkDone(m)
      else feed(m)
    }
    if (!st.done && spec.time && st.t >= spec.time && !st.pending && !st.fedOpen) checkDone(m)
  }

  // the coach's shots when it plays back (rallies): a soft dink into your kitchen
  const shot = (m, p) => {
    if (p.ctrl !== "feeder" || !spec.returns) return null
    const plan = planFeed({ ...machine, shot: "dink", place: "random" }, { index: st.fedN, rand, hand: you(m)?.hand || 1 })
    return { pace: 0.06, target: plan.target, intent: "dink" }
  }

  const end = (m, res) => {
    const kitchen = /kitchen/i.test(res?.reason || "")
    if (st.play) {
      const t = st.play.t
      const frac = t > 0.5 ? st.play.level / t : 1
      st.play = { t: 0, level: 0 }
      if (t > 0.5) {
        const point = { won: res?.winner === 0, level: frac, kitchen }
        const j = spec.pointJudge ? spec.pointJudge(point) || {} : { ok: point.won }
        const r = { outcome: kitchen ? "fault" : "in", shot: null, landing: null, point, ok: j.ok }
        r.label = { text: j.ok ? "Together!" : "Apart", tone: j.ok ? "good" : "warn", code: "unit" }
        st.history.push(r)
        st.attempts++
        if (j.ok) {
          st.made++
          st.streak++
          st.bestStreak = Math.max(st.bestStreak, st.streak)
        } else st.streak = 0
        st.label = r.label
        st.msg = j.msg || null
        st.hint = null
        emit(m, { result: { n: st.history.length, outcome: r.outcome, ok: j.ok, label: r.label, msg: st.msg, level: frac } })
        checkDone(m)
      }
      return
    }
    const p = st.pending
    if (p) {
      let outcome
      if (kitchen || p.fault) outcome = "fault"
      else if (p.landing) outcome = p.landing.z > 0 ? "net" : Math.abs(p.landing.x) <= 3.07 && Math.abs(p.landing.z) <= 6.73 ? "in" : "out"
      else if (p.volleyed) outcome = "in"
      else outcome = p.shot.tag === "net" || m.ball.p.z > 0 ? "net" : "out"
      record(m, { outcome, shot: p.shot, landing: p.landing, fed: p.fed, feet: p.feet, ballY: p.ballY, moveIn: p.startZ - p.minZ, volley: !!p.shot.volley, fault: p.fault || res?.reason })
      return
    }
    // a kitchen fault just after a volley that was already counted: it was a fault
    const last = st.history.at(-1)
    if (kitchen && last && last.outcome === "in" && last.shot?.volley && m.t - (last.fed?.t ?? 0) < 4) {
      st.counts.in--
      st.counts.fault++
      if (last.ok) {
        st.made--
        st.streak = 0
      }
      last.outcome = "fault"
      last.fault = res.reason
      last.ok = false
      last.label = classifyShot(last)
      st.label = last.label
      st.msg = spec.judge ? spec.judge(last)?.msg || null : null
      st.hint = hintFor(st.history)
      emit(m, { result: { n: st.history.length, outcome: "fault", ok: false, label: last.label, msg: st.msg, hint: st.hint } })
      return
    }
    if (st.fedOpen && !st.done && res?.winner !== 0) {
      // the ball went by (or the two-bounce rule caught you)
      record(m, { outcome: res && /bounce|fault/i.test(res.reason || "") && st.lastShotT > (st.fed?.t ?? 0) ? "fault" : "miss", shot: null, landing: null, fed: st.fed, fault: res?.reason })
    }
    st.fedOpen = false
    if (spec.serve) checkDone(m)
  }

  return { state: st, spec, begin, tick, shot, end, returns: !!spec.returns, snap }
}

// createMatch options for a session: you against the machine (or a coach), or doubles points
export const trainMatch = (spec, { character = "maya", outfit, rand } = {}) => {
  const practice = createSession(spec, { rand })
  if (spec.play) {
    return {
      doubles: true,
      level: "intermediate",
      firstServer: 1,
      practice,
      roster: [
        { id: "you", team: 0, ctrl: "human", slot: 0, name: "You", character, outfit },
        { id: "partner", team: 0, ctrl: "cpu", level: "intermediate", name: "Partner", character: "rosa" },
        { id: "opp1", team: 1, ctrl: "cpu", level: "beginner", name: "Opponent", character: "dex" },
        { id: "opp2", team: 1, ctrl: "cpu", level: "beginner", name: "Opponent", character: "gus" },
      ],
    }
  }
  return {
    doubles: false,
    level: "intermediate",
    practice,
    roster: [
      { id: "you", team: 0, ctrl: "human", slot: 0, name: "You", character, outfit },
      { id: "machine", team: 1, ctrl: "feeder", level: "intermediate", name: spec.returns ? "Coach" : "Ball machine", character: "gus" },
    ],
  }
}

// the Ball Machine's own session: its settings, every ball counted, zones if wanted
export const machineSpec = (settings) => {
  const s = normalizeMachine(settings)
  return { id: "machine", machine: s, balls: s.balls, zones: s.targets === "off" ? null : zonesFor(s.shot) }
}

// stars for a score against [one, two, three] thresholds
export const starsFor = (score, stars) => (stars ? stars.filter((s) => score >= s).length : 0)
