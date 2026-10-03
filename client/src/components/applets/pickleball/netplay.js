// Pickleball 98 online: how two to four browsers play one match over the room system's relay
// (server/arcade/rooms.js, relay mode). Pure JavaScript; the engine wires it to sockets.
//
// The host's browser runs the match: the referee, the score, the ball's flight and the
// computer players. Each person's own browser moves their own player and plays their own
// shots (so moving and timing feel instant, whatever the lag):
//   - guest -> host, ~30 a second (room:input, may drop): where I am, how I'm moving, whether
//     I'm holding a shot button;
//   - guest -> host, reliable (room:relay): "I hit it" with the ball my paddle sent back and
//     the host time it happened. The host rewinds that ball to then and flies it forward.
//     Bounces near a person whose shot may still be on its way wait a moment before the
//     referee hears of them (match.js `grace`), so the network can't cost a point;
//   - host -> everyone, ~30 a second (room:snap, may drop): the ball, the players, the
//     rally and the score, and recent events (calls, hits, points).
// A guest's copy of the match (match.js "mirror" mode) flies the ball forward from each
// snapshot to the host's present time, so the ball is where it really is, not where it was.

import { BALL_R, STEP, bounceOnCourt, flightStep, netContact } from "./physics.js"
import { applyRemoteStrike, createMatch, playerById, step } from "./match.js"
import { isLive } from "./rules.js"

export const PHASES = ["intro", "serve", "rally", "dead", "over"]
export const SHOT_KINDS = ["dink", "drop", "drive", "slice", "lob", "block", "punch", "smash", "serve", "return", "ai", "topspin", "soft", "auto"]
export const GRADES = ["perfect", "good", "early", "late", "very early", "very late", "soft"]
const SNAP_MS = 33
const INPUT_MS = 33

const r3 = (v) => Math.round(v * 1000) / 1000
const r2 = (v) => Math.round(v * 100) / 100
const idx = (list, v) => (v === undefined || v === null ? -1 : list.indexOf(v))
const at = (list, i) => (i >= 0 ? list[i] : null)

// Who plays where: seats alternate teams (seat 0 and 2 on the near side), computer players
// fill doubles. people: [{ seat, name, look, character }]. Returns roster entries for createMatch.
export const onlineRoster = (people, { doubles, level = "intermediate" }) => {
  const sorted = [...people].sort((a, b) => a.seat - b.seat)
  const teams = [[], []]
  sorted.forEach((p, i) => teams[i % 2].push(p))
  const size = doubles || sorted.length > 2 ? 2 : 1
  const roster = []
  for (const team of [0, 1]) {
    for (let k = 0; k < size; k++) {
      const p = teams[team][k]
      if (p) roster.push({ id: `p${p.seat}`, team, seat: p.seat, ctrl: "remote", name: p.name, look: p.look || null, character: p.character || null })
      else roster.push({ id: `cpu${team}${k}`, team, seat: null, ctrl: "cpu", level, name: "Computer", look: null, character: null })
    }
  }
  return { roster, doubles: size === 2 }
}

// ---- snapshots ----

const packPlayer = (m, p) => {
  const s = p.swing
  const c = p.charge
  const e = p.expect
  return [
    r3(p.x),
    r3(p.z),
    r2(p.vx),
    r2(p.vz),
    s ? s.id || 0 : 0,
    s ? idx(SHOT_KINDS, s.kind) : -1,
    s ? r3(s.t) : 0,
    s ? (s.hand === "bh" ? 1 : 0) : 0,
    s && !s.whiff ? r3(s.x) : 0,
    s && !s.whiff ? r3(s.y) : 0,
    s && !s.whiff ? r3(s.z) : 0,
    s ? idx(GRADES, s.grade) : -1,
    c ? idx(SHOT_KINDS, c.kind) : -1,
    c ? r2(m.t - c.start) : 0,
    p.armed && p.ctrl !== "cpu" ? 1 : 0,
    e ? r3(e.at - m.t) : -9,
    e ? r3(e.x) : 0,
    e ? r3(e.y) : 0,
    e ? r3(e.z) : 0,
    p.serving ? 1 : 0,
    s?.whiff ? 1 : 0,
    s?.n ? [r3(s.n.x), r3(s.n.y), r3(s.n.z)] : 0,
    p.spot ? [r3(p.spot.x), r3(p.spot.z)] : 0,
    p.lane === "left" ? 1 : 0,
  ]
}

// Events worth sending (the guest makes its own bounce sounds)
const SENT = new Set(["call", "ready", "toss", "hit", "net", "tape", "line", "fault", "point", "rally", "gameover", "whiff"])
const packEvent = (e) => {
  const out = {}
  for (const [k, v] of Object.entries(e)) if (v === null || typeof v !== "object" || k === "score" || k === "last" || k === "before") out[k] = v
  return out
}

export const encodeSnap = (m, recent = [], extra = {}) => {
  const b = m.ball
  const r = m.rally
  const g = m.game
  const ids = m.players.map((p) => p.id)
  return {
    v: 1,
    t: r3(m.t),
    ph: PHASES.indexOf(m.phase),
    pt: r2(m.phaseT),
    bs: m.version,
    b: [r3(b.p.x), r3(b.p.y), r3(b.p.z), r3(b.v.x), r3(b.v.y), r3(b.v.z), r2(b.w.x), r2(b.w.y), r2(b.w.z), idx(ids, b.held), b.rolling ? 1 : 0, b.rest ? 1 : 0],
    r: [r.hits, r.lastTeam ?? -1, r.bounces, r.serving, isLive(r) ? 1 : 0, idx(ids, r.lastPlayer), idx(ids, r.server), idx(ids, r.receiver), r.court === "left" ? 1 : 0],
    g: [g.score[0], g.score[1], g.serving, g.serverNumber, idx(ids, g.server), g.winner ?? -1, g.rallies],
    P: m.players.map((p) => packPlayer(m, p)),
    e: recent.map(packEvent),
    ...extra,
  }
}

// fly a ball (no referee) for `seconds`: court bounces and the net, like the real thing
export const projectBall = (ball, seconds) => {
  let n = Math.round(Math.max(0, Math.min(1, seconds)) / STEP)
  while (n-- > 0) {
    if (ball.held || ball.rest) return ball
    if (ball.rolling) {
      ball.p.x += ball.v.x * STEP
      ball.p.z += ball.v.z * STEP
      continue
    }
    const prevZ = ball.p.z
    flightStep(ball, STEP)
    netContact(prevZ, ball)
    if (ball.p.y <= BALL_R && ball.v.y < 0) {
      bounceOnCourt(ball)
      if (Math.abs(ball.v.y) < 0.25) {
        ball.v.y = 0
        ball.p.y = BALL_R
        ball.rolling = true
      }
    }
  }
  return ball
}

// ---- the host ----

// m: the match (its people on other computers have ctrl "remote"); send: { snap(data),
// relay(data, toSeat?) }. Returns handlers for incoming messages and a tick for each frame.
export const createHost = (m, send) => {
  const bySeat = new Map(m.players.filter((p) => p.seat !== null && p.seat !== undefined).map((p) => [p.seat, p]))
  const acks = {} // seat -> [input seq, the guest's clock]
  const recent = [] // events from the last second, for snapshots
  let clock = 0
  let lastSnap = -1
  let extra = {}
  // bounces wait while the ball is near someone whose hit may be on its way
  m.grace = (mm) => {
    const r = mm.rally
    if (!r || r.hits === 0) return false
    for (const p of mm.players) {
      if (p.ctrl !== "remote" || p.team === r.lastTeam) continue
      if (Math.hypot(mm.ball.p.x - p.x, mm.ball.p.z - p.z) < 2.4) return true
    }
    return false
  }
  return {
    // every message from a guest's room:input: where they are and what they're doing
    onInput(data, seat) {
      const p = bySeat.get(seat)
      if (!p || !data || p.ctrl !== "remote") return
      if (acks[seat] && data.s <= acks[seat][0]) return // old news (arrived out of order)
      acks[seat] = [data.s, data.ts]
      if ([data.x, data.z, data.vx, data.vz].every(Number.isFinite)) {
        p.x = data.x
        p.z = data.z
        p.vx = data.vx
        p.vz = data.vz
        p.netZ = data.z
        p.netAt = m.t
      }
      const ck = at(SHOT_KINDS, data.ch ?? -1)
      p.charge = ck ? { kind: ck, start: m.t - (data.cha || 0) } : null
      p.armed = data.ar ? { kind: ck || "auto", release: m.t } : null
    },
    // reliable messages from a guest: their hits
    onRelay(data, seat) {
      const p = bySeat.get(seat)
      if (!p || !data) return false
      if (data.type !== "hit" || !data.s) return false
      const s = unpackStrike(data.s)
      return s ? applyRemoteStrike(m, p, s) : false
    },
    // keep events for the snapshots (call before the engine clears m.events)
    capture(events) {
      for (const e of events) recent.push(e)
      while (recent.length && (recent[0].t < m.t - 1.2 || recent.length > 40)) recent.shift()
    },
    setExtra(x) {
      extra = x
    },
    tick(dtMs) {
      clock += dtMs
      if (clock - lastSnap < SNAP_MS && lastSnap >= 0) return
      lastSnap = clock
      send.snap(encodeSnap(m, recent.filter((e) => SENT.has(e.type)), { ack: acks, ...extra }))
    },
  }
}

export const packStrike = (s) => ({
  t: r3(s.t),
  kind: s.kind,
  grade: s.grade,
  risky: s.risky ? 1 : 0,
  serve: s.serve ? 1 : 0,
  volley: s.volley ? 1 : 0,
  c: [r3(s.contact.x), r3(s.contact.y), r3(s.contact.z)],
  f: [r3(s.feet.x), r3(s.feet.z)],
  hand: s.hand,
  b: [r3(s.ball.p.x), r3(s.ball.p.y), r3(s.ball.p.z), r3(s.ball.v.x), r3(s.ball.v.y), r3(s.ball.v.z), r2(s.ball.w.x), r2(s.ball.w.y), r2(s.ball.w.z)],
  n: [r3(s.n.x), r3(s.n.y), r3(s.n.z)],
  pd: r2(s.paddle),
  pvy: r2(s.paddleVy),
})
const finite = (a) => Array.isArray(a) && a.every(Number.isFinite)
export const unpackStrike = (d) => {
  if (!finite(d.b) || d.b.length !== 9 || !finite(d.c) || !finite(d.f) || !Number.isFinite(d.t)) return null
  // a sane ball only (no 300 m/s smashes from a modified browser)
  const speed = Math.hypot(d.b[3], d.b[4], d.b[5])
  if (speed > 40) return null
  return {
    t: d.t,
    kind: SHOT_KINDS.includes(d.kind) ? d.kind : "drive",
    grade: GRADES.includes(d.grade) ? d.grade : "good",
    risky: !!d.risky,
    serve: !!d.serve,
    volley: !!d.volley,
    contact: { x: d.c[0], y: d.c[1], z: d.c[2] },
    feet: { x: d.f[0], z: d.f[1] },
    hand: d.hand === "bh" ? "bh" : "fh",
    ball: { p: { x: d.b[0], y: d.b[1], z: d.b[2] }, v: { x: d.b[3], y: d.b[4], z: d.b[5] }, w: { x: d.b[6], y: d.b[7], z: d.b[8] } },
    n: finite(d.n) ? { x: d.n[0], y: d.n[1], z: d.n[2] } : { x: 0, y: 0, z: 1 },
    paddle: Number.isFinite(d.pd) ? d.pd : 8,
    paddleVy: Number.isFinite(d.pvy) ? d.pvy : 1,
  }
}
// ---- a guest ----

// options: everything createMatch needs (doubles, scoring, target, roster with ids), me: my
// player id, send: { input(data), relay(data) }. The returned match is what the engine draws.
export const createGuest = ({ me, send, ...options }) => {
  const roster = options.roster.map((r) => ({ ...r, ctrl: r.id === me ? "human" : "remote", slot: 0 }))
  const m = createMatch({ ...options, roster, seed: 1 })
  m.mirror = true
  m.events.length = 0
  const mine = playerById(m, me)
  let seq = 0
  let lastInput = -1
  let clock = 0 // our ms clock (performance.now() from the engine)
  let offset = null // host seconds - our seconds, from the freshest snapshots
  let rtt = 0.12
  let lastBs = -1
  let lastEvent = 0
  let pending = null // our own hit (or serve) the host hasn't shown yet: { at, hits }
  let lastSnapAt = 0
  const sent = new Map() // input seq -> our clock, for the round trip
  const fix = { x: 0, y: 0, z: 0 } // visual offset of the ball after a correction (decays)

  m.onStrike = (p, s) => {
    if (p !== mine) return
    pending = { at: clock, hits: m.rally.hits + 1 }
    send.relay({ type: "hit", s: packStrike(s) })
  }
  m.onToss = (p) => {
    if (p !== mine) return
    pending = { at: clock, hits: 1, serve: true }
  }

  const hostNow = () => (offset === null ? m.t : clock / 1000 + offset + rtt / 2)

  const applyBall = (snap) => {
    const [px, py, pz, vx, vy, vz, wx, wy, wz, held, rolling, rest] = snap.b
    const b = { p: { x: px, y: py, z: pz }, v: { x: vx, y: vy, z: vz }, w: { x: wx, y: wy, z: wz }, held: held >= 0 ? m.players[held].id : null, rolling: !!rolling, rest: !!rest }
    if (!b.held) projectBall(b, Math.max(0, m.t - snap.t))
    const old = m.ball.p
    const jump = Math.hypot(b.p.x - old.x, b.p.y - old.y, b.p.z - old.z)
    const changed = snap.bs !== lastBs
    if (!changed && jump < 0.25 && !b.held) {
      // the same flight: nudge (prediction drift)
      m.ball.p.x += (b.p.x - old.x) * 0.3
      m.ball.p.y += (b.p.y - old.y) * 0.3
      m.ball.p.z += (b.p.z - old.z) * 0.3
      return
    }
    if (!b.held && !m.ball.held && jump < 3) {
      fix.x += old.x - b.p.x
      fix.y += old.y - b.p.y
      fix.z += old.z - b.p.z
    }
    m.ball.p = b.p
    m.ball.v = b.v
    m.ball.w = b.w
    m.ball.held = b.held
    m.ball.rolling = b.rolling
    m.ball.rest = b.rest
    if (changed) m.version++
    lastBs = snap.bs
  }

  return {
    m,
    me: mine,
    fix,
    get rtt() {
      return rtt
    },
    get lastSnapAge() {
      return clock - lastSnapAt
    },
    onSnap(snap, nowMs = clock) {
      if (!snap || snap.v !== 1 || !Array.isArray(snap.P) || snap.P.length !== m.players.length) return
      lastSnapAt = nowMs
      // the clock: the least-delayed snapshots tell us the host's time best
      const sample = snap.t - nowMs / 1000
      // (and it may drift down a little each time: the host can fall behind on a slow computer)
      offset = offset === null ? sample : Math.max(sample, offset - 0.008)
      const ack = snap.ack?.[mine.seat]
      if (ack && sent.has(ack[0])) {
        const r = (nowMs - sent.get(ack[0])) / 1000
        rtt = rtt * 0.8 + Math.min(1, Math.max(0.01, r)) * 0.2
      }
      if (offset !== null && Math.abs(m.t - hostNow()) > 0.3) m.t = hostNow()
      const ids = m.players.map((p) => p.id)
      const [hits, lastTeam, bounces, serving, live, lastPlayer, server, receiver, court] = snap.r
      // our own hit: hold our version of the ball and the rally until the host has it
      if (pending && (hits >= pending.hits || clock - pending.at > 1200)) pending = null
      const r = m.rally
      if (!pending) {
        // bounces: ours (we fly the ball too) unless the host saw more, or it's a new shot
        r.bounces = hits !== r.hits ? bounces : Math.max(r.bounces, bounces)
        r.hits = hits
        r.lastTeam = lastTeam < 0 ? null : lastTeam
        r.serving = serving
        r.lastPlayer = at(ids, lastPlayer)
        r.server = at(ids, server)
        r.receiver = at(ids, receiver)
        r.court = court ? "left" : "right"
        r.pending = live ? null : r.pending || { decided: true }
        if (live) r.over = null
        else r.over = r.over || { decided: true }
        const phase = PHASES[snap.ph]
        if (phase !== m.phase) {
          // the walk back is over: we start the point exactly where the host has us
          if (phase === "serve" && mine.spot) {
            mine.x = mine.spot.x
            mine.z = mine.spot.z
            mine.vx = 0
            mine.vz = 0
          }
          m.phase = phase
          if (phase !== "rally") {
            mine.charge = mine.charge?.kind === "serve" && phase === "serve" ? mine.charge : null
            mine.armed = null
            mine.serving = null
          }
        }
        m.phaseT = snap.pt + Math.max(0, m.t - snap.t)
        applyBall(snap)
      }
      const [s0, s1, gs, sn, gServer, winner, rallies] = snap.g
      m.game.score = [s0, s1]
      m.game.serving = gs
      m.game.serverNumber = sn
      m.game.server = at(ids, gServer)
      m.game.winner = winner < 0 ? null : winner
      m.game.rallies = rallies
      // everyone else
      snap.P.forEach((d, i) => {
        const p = m.players[i]
        const spot = d[22]
        p.spot = Array.isArray(spot) ? { x: spot[0], z: spot[1] } : null
        p.lane = d[23] ? "left" : "right"
        if (p === mine) return
        const ahead = Math.max(0, Math.min(0.25, m.t - snap.t))
        const tx = d[0] + d[2] * ahead
        const tz = d[1] + d[3] * ahead
        const err = Math.hypot(tx - p.x, tz - p.z)
        const k = err > 0.8 ? 1 : 0.4
        p.x += (tx - p.x) * k
        p.z += (tz - p.z) * k
        p.vx = d[2]
        p.vz = d[3]
        const [sid, sk, st, sh, sx, sy, sz, sg, ck, cha, armed, eAt, ex, ey, ez, servingFlag, whiff, sn2] = d.slice(4)
        if (sid && sid !== p.swing?.id) {
          p.swing = { id: sid, kind: at(SHOT_KINDS, sk) || "drive", t: st + ahead, hand: sh ? "bh" : "fh", x: sx, y: sy, z: sz, grade: at(GRADES, sg), whiff: !!whiff, n: Array.isArray(sn2) ? { x: sn2[0], y: sn2[1], z: sn2[2] } : null }
        }
        const kind = at(SHOT_KINDS, ck)
        p.charge = kind ? { kind, start: m.t - cha } : null
        p.armed = armed ? { kind: kind || "auto" } : null
        p.expect = eAt > -9 ? { at: m.t + eAt, x: ex, y: ey, z: ez } : null
        p.serving = servingFlag ? {} : null
      })
      // events we haven't seen (not our own hits: we made those)
      for (const e of snap.e || []) {
        if (!(e.id > lastEvent)) continue
        lastEvent = e.id
        if (e.type === "hit" && e.player === mine.id) continue
        if (e.type === "toss" && e.player === mine.id) continue
        m.events.push(e)
      }
      m.paused = !!snap.paused
    },
    // a frame: run our copy of the match up to the host's present, and send our input
    tick(dtMs, nowMs) {
      clock = nowMs
      const target = hostNow()
      let dt = dtMs / 1000
      // keep up with the host's clock: small drifts smoothly, a slow frame all at once
      if (offset !== null) {
        const behind = target - (m.t + dt)
        dt += Math.abs(behind) > 0.05 ? Math.max(-0.05, Math.min(0.25, behind)) : behind * 0.2
        dt = Math.max(0, dt)
      }
      let n = Math.round(dt / STEP)
      while (n-- > 0 && !m.paused) step(m, STEP)
      const decay = Math.exp(-(dtMs / 1000) * 10)
      fix.x *= decay
      fix.y *= decay
      fix.z *= decay
      if (nowMs - lastInput >= INPUT_MS) {
        lastInput = nowMs
        seq++
        sent.set(seq, nowMs)
        if (sent.size > 60) sent.delete(sent.keys().next().value)
        const c = mine.charge
        send.input({ s: seq, ts: Math.round(nowMs), x: r3(mine.x), z: r3(mine.z), vx: r2(mine.vx), vz: r2(mine.vz), ch: c ? idx(SHOT_KINDS, c.kind) : -1, cha: c ? r2(m.t - c.start) : 0, ar: mine.armed ? 1 : 0 })
      }
    },
  }
}
