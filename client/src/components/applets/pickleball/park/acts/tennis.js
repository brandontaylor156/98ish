// My Park > Play tennis (pure; no three.js): a quick, casual game of singles tennis on a real
// venue's tennis court, against the computer or a friend, or a rally challenge.
//
// It borrows Pickleball 98's way of doing things (physics.js, match.js, touchplay.js): a ball
// flown with gravity, air drag and spin lift at a fixed step, a court frame (x across, z along
// the court, the net at z = 0; team 0 plays from +z, team 1 from -z), a swipe that aims the
// shot (left/right, deep or short, how hard), and the swing "armed" early so the racket meets
// the ball when it arrives. With tennis numbers: the ball (57 g, 6.7 cm, drag 0.55), the court
// (23.77 x 8.23 m singles), the net (0.914 m in the middle, 1.07 m at the posts), a racket's
// reach. Kept simple and forgiving on purpose (the owner: "It doesn't need full realism").
//
// Nothing moves your player for you: you run with the move pad; the computer moves its own.
//
//   const g = createTennis({ mode: "match" | "rally", level, seed, cpu: [false, true] })
//   g.input(team, { x, y })          the move pad, in court terms (+x across, -z toward the net for team 0)
//   g.swing(team, { u, depth, pace, tap })   a swipe (touchplay.js readSwipe): arms the swing
//   g.step(dt)                       fixed steps inside
//   g.state, g.events (drained by the caller)

export const COURT = { L: 23.77, HL: 11.885, S: 8.23, HS: 4.115, D: 10.97, SERVICE: 6.4, NET: 0.914, POST_NET: 1.07, POST_X: 6.4 }
export const BALL = { r: 0.0335, drag: 0.0203, lift: 0.0013, spinDecay: 0.15, e: 0.75, grip: 0.62 }
export const G = 9.81
export const DT = 1 / 120
export const REACH = { side: 1.45, along: 0.95, low: 0.1, high: 2.65, arm: 0.6, window: 0.65 }
export const RUN = { speed: 5.0, accel: 16, decel: 22 }
export const LEVELS = {
  easy: { name: "Easy", speed: 3.9, react: 0.38, err: 1.0, miss: 0.14, pace: [0.25, 0.5], aimOpen: 0.25 },
  normal: { name: "Normal", speed: 4.8, react: 0.26, err: 0.7, miss: 0.07, pace: [0.4, 0.75], aimOpen: 0.6 },
  hard: { name: "Hard", speed: 5.8, react: 0.14, err: 0.5, miss: 0.035, pace: [0.55, 0.95], aimOpen: 0.95 },
}
export const GAMES_TO_WIN = 4
export const POINT_NAMES = ["0", "15", "30", "40"]

// seeded random (online: both sides can share a seed; tests repeat)
export const rng = (seed = 1) => {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}
const gauss = (rand) => {
  const u = Math.max(1e-9, rand())
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const sideOf = (team) => (team === 0 ? 1 : -1)

// the net's top at x (sags to the middle)
export const netHeight = (x) => {
  const k = clamp(Math.abs(x) / COURT.POST_X, 0, 1)
  return COURT.NET + (COURT.POST_NET - COURT.NET) * k * k
}

// ---------- the ball ----------
// ball: { p: {x,y,z}, v: {x,y,z}, w: {x,y,z} (spin, rad/s) }
export const stepBall = (b, dt = DT) => {
  const { p, v, w } = b
  const sp = Math.hypot(v.x, v.y, v.z)
  // drag, spin lift (w x v), gravity
  const ax = -BALL.drag * sp * v.x + BALL.lift * (w.y * v.z - w.z * v.y)
  const ay = -BALL.drag * sp * v.y + BALL.lift * (w.z * v.x - w.x * v.z) - G
  const az = -BALL.drag * sp * v.z + BALL.lift * (w.x * v.y - w.y * v.x)
  v.x += ax * dt
  v.y += ay * dt
  v.z += az * dt
  p.x += v.x * dt
  p.y += v.y * dt
  p.z += v.z * dt
  const k = Math.exp(-BALL.spinDecay * dt)
  w.x *= k
  w.y *= k
  w.z *= k
}
// the bounce: the court gives back 75% of the drop, grips the skid, topspin kicks it on
export const bounceBall = (b) => {
  const { p, v, w } = b
  p.y = BALL.r
  v.y = -v.y * (BALL.e - clamp((-v.y - 6) * 0.01, 0, 0.12))
  const vh = Math.hypot(v.x, v.z) || 1
  const dx = v.x / vh
  const dz = v.z / vh
  // topspin along the flight: (up x d) . w
  const top = dz * w.x - dx * w.z
  const keep = clamp(BALL.grip + top * 0.0007, 0.45, 0.86)
  v.x *= keep
  v.z *= keep
  w.x *= 0.5
  w.y *= 0.5
  w.z *= 0.5
}
const copyBall = (b) => ({ p: { ...b.p }, v: { ...b.v }, w: { ...b.w } })

// where a ball first comes down (y back to its radius), ignoring the net: { x, z, t } or null
export const landing = (b0, maxT = 4) => {
  const b = copyBall(b0)
  for (let t = 0; t < maxT; t += DT) {
    stepBall(b)
    if (b.p.y <= BALL.r && b.v.y < 0) return { x: b.p.x, z: b.p.z, t }
  }
  return null
}
// the ball's height where it crosses the net (z = 0), or null if it doesn't
export const netCross = (b0, maxT = 3) => {
  const b = copyBall(b0)
  let pz = b.p.z
  for (let t = 0; t < maxT; t += DT) {
    stepBall(b)
    if (Math.sign(b.p.z) !== Math.sign(pz) && pz !== 0) return { y: b.p.y, x: b.p.x, t }
    if (b.p.y < 0) return null
    pz = b.p.z
  }
  return null
}

// a launch from `from` (contact point) to land at `to` ({x, z}) at about `speed` m/s with
// topspin `spin` (rad/s): the elevation solved by bisection; it always clears the net by
// `clear` (a little slower if it has to, so it stays in). -> { v, w, land }
export const planShot = (from, to, { speed = 20, spin = 120, clear = 0.18 } = {}) => {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const dist = Math.hypot(dx, dz) || 1
  const ux = dx / dist
  const uz = dz / dist
  // topspin's axis: up x d (the ball's top rolls forward)
  const w = { x: uz * spin, y: 0, z: -ux * spin }
  const launch = (sp, th) => ({ p: { ...from }, v: { x: ux * sp * Math.cos(th), y: sp * Math.sin(th), z: uz * sp * Math.cos(th) }, w: { ...w } })
  const reach = (sp, th) => {
    const l = landing(launch(sp, th))
    return l ? Math.hypot(l.x - from.x, l.z - from.z) : 0
  }
  const crossesNet = Math.sign(from.z) !== Math.sign(to.z)
  let sp = speed
  let best = null
  for (let tries = 0; tries < 8; tries++) {
    // the angle that lands at the distance (reach grows with the angle up to ~40 degrees)
    let lo = -0.35
    let hi = 0.75
    if (reach(sp, hi) < dist) {
      // (can't get there at this pace: as far as it goes)
      best = { sp, th: hi }
      sp *= 1.12
      if (sp > 55) break
      continue
    }
    if (reach(sp, lo) > dist) {
      sp *= 0.85
      continue
    }
    for (let k = 0; k < 22; k++) {
      const mid = (lo + hi) / 2
      if (reach(sp, mid) < dist) lo = mid
      else hi = mid
    }
    const th = (lo + hi) / 2
    best = { sp, th }
    if (!crossesNet) break
    const n = netCross(launch(sp, th))
    if (n && n.y >= netHeight(n.x) + clear) break
    // (into the net: a touch slower, so the arc can rise over it and still come down in)
    sp *= 0.9
    if (sp < 6) break
  }
  if (!best) best = { sp: speed, th: 0.2 }
  const b = launch(best.sp, best.th)
  return { v: b.v, w: b.w, land: landing(b) }
}

// a swipe -> where in the other half it goes (touchplay.js readSwipe: u -1..1 across, depth
// 0..1 short to deep, pace 0..1); a tap: a safe one down the middle, deep
export const swipeAim = (team, s = {}) => {
  const opp = -sideOf(team)
  const u = s.tap || s.u === null || s.u === undefined ? 0 : clamp(s.u, -1, 1)
  const depth = s.tap || s.depth === null || s.depth === undefined ? 0.7 : clamp(s.depth, 0, 1)
  // (team 0 looks toward -z: the screen's right is +x; team 1's screen is turned round)
  const x = u * (COURT.HS - 0.55) * (team === 0 ? 1 : -1)
  const z = opp * (3.6 + depth * (COURT.HL - 1.0 - 3.6))
  return { x, z, pace: s.tap ? 0.35 : clamp(s.pace ?? 0.45, 0, 1) }
}
// a serve's target: the diagonal service box (deuce: the server's right)
export const serveBox = (team, deuce) => {
  const opp = -sideOf(team)
  // team 0 faces -z: its right is +x; the box diagonally across is on -x (deuce)
  const sx = (deuce ? -1 : 1) * sideOf(team)
  return { x0: sx < 0 ? -COURT.HS : 0, x1: sx < 0 ? 0 : COURT.HS, z0: opp > 0 ? 0 : -COURT.SERVICE, z1: opp > 0 ? COURT.SERVICE : 0, aim: { x: sx * 1.9, z: opp * (COURT.SERVICE - 1.2) } }
}
export const inBox = (box, x, z, pad = 0.03) => x >= box.x0 - pad && x <= box.x1 + pad && z >= box.z0 - pad && z <= box.z1 + pad
// in the singles court on a team's side
export const inSide = (team, x, z, pad = 0.03) => Math.abs(x) <= COURT.HS + pad && sideOf(team) * z >= -pad && sideOf(team) * z <= COURT.HL + pad

// the scoreboard words for one game: "15-30", "Deuce point", "Game"
export const pointWords = (pts, server) => {
  const [a, b] = server === 0 ? pts : [pts[1], pts[0]]
  if (a >= 3 && b >= 3 && a === b) return "Deciding point"
  return `${POINT_NAMES[Math.min(3, a)]}-${POINT_NAMES[Math.min(3, b)]}`
}
// a point won: no-ad (40-40, the next point wins the game); first to 4 games wins
export const scorePoint = (sc, team) => {
  const pts = sc.points.slice()
  pts[team]++
  // (no-ad: the first to four points, so at 40-40 the next point takes it)
  if (pts[team] < 4) return { ...sc, points: pts, game: null }
  const games = sc.games.slice()
  games[team]++
  const over = games[team] >= GAMES_TO_WIN
  return { ...sc, points: [0, 0], games, server: 1 - sc.server, faults: 0, game: team, winner: over ? team : null }
}

// ---------- the game ----------
export const createTennis = ({ mode = "match", level = "normal", seed = (Math.random() * 1e9) | 0, cpu = [false, true], firstServer = 0 } = {}) => {
  const rand = rng(seed)
  const L = LEVELS[level] || LEVELS.normal
  const player = (team) => ({ team, x: 0, z: sideOf(team) * (COURT.HL + 0.6), vx: 0, vz: 0, in: { x: 0, y: 0 }, armed: null, swing: null, cpu: !!cpu[team], plan: null, wait: 0, face: team === 0 ? Math.PI : 0 })
  const st = {
    mode,
    level,
    t: 0,
    phase: "serve", // serve | play | point | over
    phaseT: 0,
    players: [player(0), player(1)],
    ball: { p: { x: 0, y: 1, z: COURT.HL }, v: { x: 0, y: 0, z: 0 }, w: { x: 0, y: 0, z: 0 }, live: false, held: true },
    score: { points: [0, 0], games: [0, 0], server: mode === "rally" ? 0 : firstServer, faults: 0, game: null, winner: null },
    rally: { hits: 0, last: null, bounces: 0, bounceSide: 0, serve: false, crossed: false, served: false, deuce: true },
    streak: 0, // rally mode: shots in a row
    best: 0,
    lastPoint: null, // { to, why }
  }
  const events = []
  const emit = (e) => events.push({ t: st.t, ...e })

  const serverSpot = () => {
    const s = st.score.server
    const deuce = (st.score.points[0] + st.score.points[1]) % 2 === 0
    // (the server's right is +x for team 0, -x for team 1)
    const x = (deuce ? 1 : -1) * sideOf(s) * 0.9
    return { s, deuce, x, z: sideOf(s) * (COURT.HL + 0.25) }
  }
  // everyone to their places for the next point (between points the players walk there
  // themselves: a computer player walks; your player is placed, as a match's between-points
  // routine would put you on your mark)
  const setUp = () => {
    const sv = serverSpot()
    st.rally = { hits: 0, last: null, bounces: 0, bounceSide: 0, serve: true, crossed: false, served: false, deuce: sv.deuce }
    for (const p of st.players) {
      p.armed = null
      p.swing = null
      p.plan = null
      p.vx = p.vz = 0
      if (p.team === sv.s) {
        p.x = sv.x
        p.z = sv.z
      } else {
        // the returner: diagonally across, a step behind the baseline
        p.x = -sv.x * 1.6
        p.z = sideOf(p.team) * (COURT.HL + 0.6)
      }
    }
    const sp = st.players[sv.s]
    st.ball = { p: { x: sp.x + 0.3 * sideOf(sv.s) * -1, y: 1.0, z: sp.z }, v: { x: 0, y: 0, z: 0 }, w: { x: 0, y: 0, z: 0 }, live: false, held: true }
    st.phase = "serve"
    st.phaseT = 0
    // (the rally challenge: the computer starts every rally with an easy feed to you)
    if (st.mode === "rally") st.score.server = 1
  }

  // ---- hitting ----
  const reachable = (p) => {
    const b = st.ball
    if (!b.live || b.held) return false
    if (Math.sign(b.v.z) !== sideOf(p.team)) return false // coming toward them
    if (st.rally.last === p.team) return false
    // (the return of serve must bounce first)
    if (st.rally.serve && st.rally.bounces === 0) return false
    if (st.rally.bounces >= 2) return false
    const dz = (b.p.z - p.z) * sideOf(p.team)
    const dx = Math.abs(b.p.x - p.x)
    return dx <= REACH.side && dz >= -REACH.along && dz <= REACH.along * 0.55 && b.p.y >= REACH.low && b.p.y <= REACH.high && sideOf(p.team) * b.p.z > -0.2
  }
  const hit = (p, aim, quality = 1) => {
    const b = st.ball
    const contact = { x: b.p.x, y: b.p.y, z: b.p.z }
    const pace = clamp(aim.pace, 0, 1)
    // (error: the pace and the timing; the computer by its level)
    // (a person: a harder swipe is less sure, a mistimed or stretched one more so)
    const inSpeed = Math.hypot(b.v.x, b.v.y, b.v.z)
    const sigma = p.cpu ? L.err : 0.3 + (1 - quality) * 1.4 + pace * pace * 1.25 + clamp((inSpeed - 16) / 18, 0, 0.8)
    const tx = aim.x + gauss(rand) * sigma * 0.55
    const tz = aim.z + gauss(rand) * sigma * 0.7
    const lob = pace < 0.12 && Math.abs(aim.z) > COURT.HL - 3
    const speed = lob ? 12 : 15 + pace * 17
    const spin = lob ? 40 : 70 + pace * 170
    const shot = planShot(contact, { x: tx, z: tz }, { speed, spin, clear: lob ? 1.5 : 0.12 + (1 - pace) * 0.35 })
    b.v = shot.v
    b.w = shot.w
    st.rally.hits++
    st.rally.last = p.team
    st.rally.bounces = 0
    st.rally.serve = false
    st.rally.crossed = false
    const hand = (b.p.x - p.x) * (p.team === 0 ? -1 : 1) >= 0 ? "fh" : "bh"
    p.swing = { t: 0, kind: lob ? "lob" : pace > 0.65 ? "drive" : "drop", hand, x: contact.x, y: contact.y, z: contact.z, speed: Math.hypot(b.v.x, b.v.y, b.v.z), id: st.rally.hits }
    p.armed = null
    emit({ type: "hit", team: p.team, speed: p.swing.speed, pace, quality, x: contact.x, y: contact.y, z: contact.z })
    if (st.mode === "rally" && p.team === 0) {
      st.streak++
      if (st.streak > st.best) st.best = st.streak
    }
  }
  const serve = (p, aim) => {
    const b = st.ball
    const box = serveBox(p.team, st.rally.deuce)
    const pace = clamp(aim.pace ?? 0.5, 0, 1)
    const u = aim.u === null || aim.u === undefined ? 0 : clamp(aim.u, -1, 1)
    const sigma = p.cpu ? L.err * 0.45 : 0.18 + pace * 0.55
    const tx = clamp(box.aim.x + u * 1.3 * (p.team === 0 ? 1 : -1), Math.min(box.x0, box.x1) + 0.3, Math.max(box.x0, box.x1) - 0.3) + gauss(rand) * sigma * 0.5
    const tz = box.aim.z + gauss(rand) * sigma * 0.6
    b.held = false
    b.live = true
    b.p = { x: p.x + 0.25 * (p.team === 0 ? 1 : -1), y: 2.55, z: p.z - sideOf(p.team) * 0.2 }
    const shot = planShot(b.p, { x: tx, z: tz }, { speed: 17 + pace * 16, spin: 60 + pace * 60, clear: 0.1 + (1 - pace) * 0.3 })
    b.v = shot.v
    b.w = shot.w
    st.rally.hits = 0
    st.rally.last = p.team
    st.rally.bounces = 0
    st.rally.serve = true
    st.rally.served = true
    st.rally.crossed = false
    st.phase = "play"
    p.swing = { t: 0, kind: "serve", hand: "fh", x: b.p.x, y: b.p.y, z: b.p.z, speed: Math.hypot(b.v.x, b.v.y, b.v.z), id: 0 }
    p.armed = null
    emit({ type: "hit", team: p.team, serve: true, speed: p.swing.speed, pace, quality: 1, x: b.p.x, y: b.p.y, z: b.p.z })
  }
  // the rally challenge's feed: an easy ball from the computer to you
  const feed = (p) => {
    const b = st.ball
    b.held = false
    b.live = true
    b.p = { x: p.x, y: 1.0, z: p.z - sideOf(p.team) * 0.5 }
    const target = { x: (rand() - 0.5) * 3, z: sideOf(1 - p.team) * (COURT.HL - 3.2 - rand() * 2) }
    const shot = planShot(b.p, target, { speed: 15, spin: 90, clear: 0.6 })
    b.v = shot.v
    b.w = shot.w
    st.rally.hits = 1
    st.rally.last = p.team
    st.rally.bounces = 0
    st.rally.serve = false
    st.rally.served = true
    st.phase = "play"
    p.swing = { t: 0, kind: "drop", hand: "fh", x: b.p.x, y: b.p.y, z: b.p.z, speed: 15, id: 1 }
    emit({ type: "hit", team: p.team, feed: true, speed: 15, pace: 0.3, quality: 1, x: b.p.x, y: b.p.y, z: b.p.z })
  }

  // ---- a point ends ----
  const pointTo = (team, why) => {
    if (st.phase !== "play") return
    st.phase = "point"
    st.phaseT = 0
    st.ball.live = false
    st.lastPoint = { to: team, why }
    if (st.mode === "rally") {
      emit({ type: "point", to: team, why, streak: st.streak, best: st.best })
      st.streak = 0
      return
    }
    const before = st.score
    st.score = scorePoint(st.score, team)
    emit({ type: "point", to: team, why, score: st.score, words: st.score.game === null ? pointWords(st.score.points, st.score.server) : "Game", game: st.score.game, from: before })
    if (st.score.winner !== null) {
      st.phase = "over"
      emit({ type: "over", winner: st.score.winner, games: st.score.games })
    }
  }
  const fault = (why) => {
    if (st.phase !== "play") return
    st.ball.live = false
    st.score = { ...st.score, faults: st.score.faults + 1 }
    if (st.score.faults >= 2) {
      st.score = { ...st.score, faults: 0 }
      emit({ type: "fault", double: true, why })
      return pointTo(1 - st.score.server, "double fault")
    }
    emit({ type: "fault", double: false, why })
    st.phase = "point"
    st.phaseT = 0.6 // (a second serve comes sooner)
    st.lastPoint = { to: null, why: "fault" }
  }

  // ---- the computer ----
  const cpuThink = (p, dt) => {
    const b = st.ball
    const home = { x: 0, z: sideOf(p.team) * (COURT.HL + 0.4) }
    let goal = home
    if (st.phase === "play" && b.live && st.rally.last !== p.team && Math.sign(b.v.z) === sideOf(p.team)) {
      // (where it'll be: after its bounce on this side, at a comfortable height)
      if (!p.plan || p.plan.hits !== st.rally.hits || p.plan.bounces !== st.rally.bounces) {
        p.plan = { hits: st.rally.hits, bounces: st.rally.bounces, at: null, react: L.react * (0.7 + rand() * 0.6) }
        const sim = copyBall(b)
        let bounces = st.rally.bounces
        for (let t = 0; t < 4; t += DT * 2) {
          stepBall(sim, DT * 2)
          if (sim.p.y <= BALL.r && sim.v.y < 0) {
            bounces++
            bounceBall(sim)
            if (bounces >= 2) break
          }
          const mine = sideOf(p.team) * sim.p.z
          const ok = bounces >= 1 && mine > 1.2 && mine < COURT.HL + 4 && sim.p.y > 0.45 && sim.p.y < 1.7 && sim.v.y < 1.5
          if (ok) {
            p.plan.at = { x: sim.p.x - (sim.p.x > p.x ? 0.7 : -0.7) * 0.6, z: sim.p.z + sideOf(p.team) * 0.35, t }
            break
          }
        }
      }
      p.plan.react -= dt
      if (p.plan.at && p.plan.react <= 0) goal = p.plan.at
      else if (p.plan.react > 0) goal = { x: p.x, z: p.z }
    } else if (st.phase !== "play") goal = { x: p.x, z: p.z }
    const dx = goal.x - p.x
    const dz = goal.z - p.z
    const d = Math.hypot(dx, dz)
    const want = d < 0.15 ? 0 : Math.min(L.speed, d * 4)
    p.vx += clamp((d ? (dx / d) * want : 0) - p.vx, -RUN.accel * dt, RUN.accel * dt)
    p.vz += clamp((d ? (dz / d) * want : 0) - p.vz, -RUN.accel * dt, RUN.accel * dt)
    // the swing: when the ball's there
    if (st.phase === "play" && reachable(p)) {
      const opp = st.players[1 - p.team]
      const [p0, p1] = L.pace
      const pace = st.mode === "rally" ? 0.3 : p0 + rand() * (p1 - p0)
      // (to the open court, more so at higher levels)
      const open = st.mode === "rally" ? 0 : clamp(-opp.x / COURT.HS, -1, 1) * L.aimOpen + (rand() - 0.5) * 0.9
      // (better players go nearer the lines and deeper)
      let x = clamp(open, -1, 1) * (COURT.HS - 1.3 + L.aimOpen * 0.7)
      let z = -sideOf(p.team) * (st.mode === "rally" ? COURT.HL - 3.5 : 5.2 + L.aimOpen * 2 + rand() * 3.4)
      // (a casual player misses some: more off a fast ball, or one it had to stretch for)
      const inSpeed = Math.hypot(b.v.x, b.v.y, b.v.z)
      const stretch = Math.abs(b.p.x - p.x) / REACH.side
      const missP = st.mode === "rally" ? 0.02 : L.miss + clamp((inSpeed - 20) / 40, 0, 0.3) + stretch * stretch * 0.15
      if (rand() < missP) {
        if (rand() < 0.5) z = -sideOf(p.team) * (COURT.HL + 0.6 + rand() * 1.8)
        else x = Math.sign(x || rand() - 0.5) * (COURT.HS + 0.4 + rand() * 1.2)
      }
      hit(p, { x, z, pace }, 1)
    }
  }

  // ---- your player ----
  const humanMove = (p, dt) => {
    const ix = clamp(p.in.x, -1, 1)
    const iy = clamp(p.in.y, -1, 1)
    const mag = Math.min(1, Math.hypot(ix, iy))
    const dead = mag < 0.12
    // (the move pad: up the screen is toward the net)
    const wx = dead ? 0 : ix * (p.team === 0 ? 1 : -1)
    const wz = dead ? 0 : -iy * sideOf(p.team)
    const sp = RUN.speed * (dead ? 0 : 0.35 + 0.65 * mag)
    const tx = mag > 0 ? (wx / (mag || 1)) * sp : 0
    const tz = mag > 0 ? (wz / (mag || 1)) * sp : 0
    const a = dead ? RUN.decel : RUN.accel
    // (a friend online moves their own player: their screen says where; it runs on between)
    if (!p.remote) {
      p.vx += clamp(tx - p.vx, -a * dt, a * dt)
      p.vz += clamp(tz - p.vz, -a * dt, a * dt)
    }
    // the armed swing meets the ball when it arrives in reach
    if (p.armed && st.phase === "play") {
      p.armed.left -= dt
      if (reachable(p)) {
        // (timing: armed about a quarter second before is just right)
        const early = REACH.window - p.armed.left
        const stretch = Math.abs(st.ball.p.x - p.x) / REACH.side
        const quality = clamp(1 - Math.abs(early - 0.28) / 0.5, 0.2, 1) * (1 - 0.45 * stretch * stretch)
        hit(p, p.armed.aim, quality)
      } else if (p.armed.left <= 0) {
        p.swing = { t: 0, kind: "drive", hand: "fh", whiff: true, y: 0.9, x: p.x, z: p.z }
        p.armed = null
        emit({ type: "whiff", team: p.team })
      }
    }
  }

  const stepOnce = (dt) => {
    st.t += dt
    st.phaseT += dt
    for (const p of st.players) {
      if (p.cpu) cpuThink(p, dt)
      else humanMove(p, dt)
      p.x = clamp(p.x + p.vx * dt, -COURT.D / 2 - 3.2, COURT.D / 2 + 3.2)
      p.z += p.vz * dt
      // (each on their own side; up to the net, back to the fence)
      const mine = clamp(sideOf(p.team) * p.z, 0.5, COURT.HL + 5.5)
      p.z = sideOf(p.team) * mine
      if (p.swing) {
        p.swing.t += dt
        if (p.swing.t > 0.9) p.swing = null
      }
    }
    // serve: the computer serves after a moment (you swipe); the rally challenge feeds
    if (st.phase === "serve") {
      const s = st.players[st.score.server]
      if (st.mode === "rally") {
        if (st.phaseT > 1.0) return feed(s)
      } else if (s.cpu && st.phaseT > 1.4) {
        const [p0, p1] = L.pace
        return serve(s, { pace: p0 + rand() * (p1 - p0), u: (rand() - 0.5) * 1.6 })
      } else if (!s.cpu && s.armed) return serve(s, s.armed.aim)
      // (the ball in the server's hand)
      st.ball.p = { x: s.x + 0.3 * (s.team === 0 ? 1 : -1), y: 1.0, z: s.z }
      return
    }
    if (st.phase === "point") {
      if (st.phaseT > 1.8) setUp()
      if (st.ball.p.y > BALL.r) {
        stepBall(st.ball, dt)
        if (st.ball.p.y <= BALL.r && st.ball.v.y < 0) bounceBall(st.ball)
      }
      return
    }
    if (st.phase !== "play") return
    // the ball
    const b = st.ball
    const z0 = b.p.z
    stepBall(b, dt)
    // the net
    if (Math.sign(b.p.z) !== Math.sign(z0) && z0 !== 0) {
      const h = netHeight(b.p.x)
      if (Math.abs(b.p.x) <= COURT.POST_X) {
        if (b.p.y < h - BALL.r * 0.4) {
          // into the net: it drops on the hitter's side
          b.p.z = z0 >= 0 ? 0.05 : -0.05
          b.v.z = -b.v.z * 0.15
          b.v.x *= 0.3
          b.v.y = Math.min(b.v.y, 0) * 0.2
          emit({ type: "net", tape: false, x: b.p.x, y: b.p.y })
          if (st.rally.serve) return fault("net")
          return pointTo(1 - st.rally.last, "net")
        }
        if (b.p.y < h + BALL.r) {
          // off the tape: slowed, popped up, carries on
          b.v.z *= 0.55
          b.v.y = Math.abs(b.v.y) * 0.3 + 0.8 + rand() * 0.8
          emit({ type: "net", tape: true, x: b.p.x, y: b.p.y })
          if (st.rally.serve) st.rally.let = true
        }
      }
      st.rally.crossed = true
    }
    if (b.p.y <= BALL.r && b.v.y < 0) {
      const side = b.p.z >= 0 ? 0 : 1
      bounceBall(b)
      st.rally.bounces++
      emit({ type: "bounce", x: b.p.x, z: b.p.z, side, speed: Math.hypot(b.v.x, b.v.z) })
      const hitter = st.rally.last
      if (st.rally.bounces === 1) {
        if (st.rally.serve) {
          const box = serveBox(hitter, st.rally.deuce)
          if (!inBox(box, b.p.x, b.p.z)) return fault("out")
          if (st.rally.let) {
            // (a let: the serve again)
            emit({ type: "let" })
            st.phase = "point"
            st.phaseT = 0.6
            st.lastPoint = { to: null, why: "let" }
            st.ball.live = false
            return
          }
        } else if (!inSide(1 - hitter, b.p.x, b.p.z)) return pointTo(1 - hitter, side === hitter ? "net" : "out")
      } else if (st.rally.bounces >= 2) return pointTo(hitter, "two bounces")
    }
    // far beyond the court with no bounce (a wild one): out
    if (Math.abs(b.p.z) > COURT.HL + 14 || Math.abs(b.p.x) > 16) return pointTo(1 - st.rally.last, "out")
  }

  let acc = 0
  const game = {
    state: st,
    events,
    // the move pad for a person's team: { x right, y up the screen }
    input(team, { x = 0, y = 0 } = {}) {
      const p = st.players[team]
      p.in = { x, y }
    },
    // a swipe (or a tap, or a key): arms the swing; while serving, serves
    swing(team, s = {}) {
      const p = st.players[team]
      if (!p || p.cpu || st.phase === "over") return false
      if (st.phase === "serve" && st.score.server === team && st.mode !== "rally") {
        p.armed = { left: REACH.window, aim: { pace: s.tap ? 0.35 : clamp(s.pace ?? 0.45, 0, 1), u: s.u ?? 0 } }
        return true
      }
      if (st.phase !== "play") return false
      p.armed = { left: REACH.window, aim: swipeAim(team, s) }
      return true
    },
    step(dt) {
      acc += Math.min(0.1, dt)
      while (acc >= DT) {
        acc -= DT
        stepOnce(DT)
      }
    },
    drain() {
      return events.splice(0, events.length)
    },
    restart() {
      st.score = { points: [0, 0], games: [0, 0], server: st.mode === "rally" ? 1 : firstServer, faults: 0, game: null, winner: null }
      st.streak = 0
      setUp()
    },
    // (online: the host's world for the guest, and back)
    snapshot() {
      const r2 = (v) => Math.round(v * 100) / 100
      const b = st.ball
      return {
        t: r2(st.t),
        ph: st.phase,
        pl: st.players.map((p) => [r2(p.x), r2(p.z), r2(p.vx), r2(p.vz), p.swing ? [p.swing.kind, p.swing.hand, r2(p.swing.t), r2(p.swing.x || 0), r2(p.swing.y || 0), r2(p.swing.z || 0), p.swing.whiff ? 1 : 0] : 0]),
        b: [r2(b.p.x), r2(b.p.y), r2(b.p.z), r2(b.v.x), r2(b.v.y), r2(b.v.z), r2(b.w.x), r2(b.w.z), b.live ? 1 : 0, b.held ? 1 : 0],
        sc: [st.score.points, st.score.games, st.score.server, st.score.faults],
        st: [st.streak, st.best],
      }
    },
    apply(snap) {
      if (!snap) return
      st.phase = snap.ph
      st.t = snap.t
      snap.pl.forEach((row, i) => {
        const p = st.players[i]
        ;[p.x, p.z, p.vx, p.vz] = row
        p.swing = row[4] ? { kind: row[4][0], hand: row[4][1], t: row[4][2], x: row[4][3], y: row[4][4], z: row[4][5], whiff: !!row[4][6] } : null
      })
      const [x, y, z, vx, vy, vz, wx, wz, live, held] = snap.b
      st.ball = { p: { x, y, z }, v: { x: vx, y: vy, z: vz }, w: { x: wx, y: 0, z: wz }, live: !!live, held: !!held }
      st.score = { ...st.score, points: snap.sc[0], games: snap.sc[1], server: snap.sc[2], faults: snap.sc[3] }
      st.streak = snap.st[0]
      st.best = snap.st[1]
    },
  }
  setUp()
  return game
}

// what the scoreboard says
export const scoreLine = (st, names = ["You", "Them"]) => {
  if (st.mode === "rally") return { big: `${st.streak}`, small: `in a row · best ${st.best}` }
  const g = st.score.games
  return { big: `${g[0]} - ${g[1]}`, small: st.phase === "over" ? `${names[st.score.winner]} win${st.score.winner === 0 && names[0] === "You" ? "" : "s"}` : `${pointWords(st.score.points, st.score.server)} · ${names[st.score.server]} serving` }
}
