// My Park > Shoot hoops (pure; no three.js): a basketball's flight, the rim, the backboard and
// the floor; a swipe made into a shot; the games: shooting around, Around the World, and
// H-O-R-S-E against the computer or a friend.
//
// The court's frame as courtkit.js / propkit.js draw it: x across, z along, the hoops at
// z = +-rimZ, rims 3.05 m up. Units: metres, seconds.
//
// The ball: 0.119 m radius (a size 7), 0.62 kg, air drag; the floor gives back ~78% of a drop
// (a regulation ball dropped from 1.8 m comes up ~1.3 m); the rim is a torus (0.23 m to the
// middle of its 2 cm tube) the ball bounces off at ~0.6; the board ~0.65. A shot that drops
// through without touching the rim or the board is a swish.

export const BALL = { r: 0.119, drag: 0.0108, floor: 0.78, rim: 0.58, board: 0.66, roll: 0.9 }
export const G = 9.81
export const DT = 1 / 240
export const RELEASE_Y = 2.35 // the ball leaves the hands up over the head, in a jump shot
export const ARC = (51 * Math.PI) / 180
export const SWEET = 0.5 // the swipe that's just right: half way up its zone
export const SWEET_BAND = 0.08 // ...give or take this much
export const LETTERS = "HORSE"

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
export const rng = (seed = 1) => {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}
const gauss = (rand) => Math.sqrt(-2 * Math.log(Math.max(1e-9, rand()))) * Math.cos(2 * Math.PI * rand())

// a hoop: { z (rim centre along the court, signed), y, r (rim radius to the tube's middle),
// tube, boardZ (the board's front face), boardY0, boardY1, boardHalfW }
export const hoopAt = (end, { rimZ = 12.4, boardZ = 12.775, boardY0 = 2.775, boardY1 = 3.825 } = {}) => ({ end, z: end * rimZ, y: 3.05, r: 0.23, tube: 0.012, boardZ: end * boardZ, boardY0, boardY1, boardHalfW: 0.9 })
// courtkit.js's outdoor court; propkit.js's gym court (the hoop prop: rim 0.85 m in front of
// it, the board 0.55 m, 2.9-3.95 m up)
export const HOOP_KINDS = {
  court: { rimZ: 12.4, boardZ: 12.775, boardY0: 2.775, boardY1: 3.825 },
  gym: { rimZ: 12.425, boardZ: 12.7, boardY0: 2.9, boardY1: 3.95 },
}

// one step of the ball against the floor, the rim and the board -> what it touched
export const stepBall = (b, hoop, dt = DT) => {
  const { p, v } = b
  const sp = Math.hypot(v.x, v.y, v.z)
  v.x -= BALL.drag * sp * v.x * dt
  v.y -= (BALL.drag * sp * v.y + G) * dt
  v.z -= BALL.drag * sp * v.z * dt
  const y0 = p.y
  p.x += v.x * dt
  p.y += v.y * dt
  p.z += v.z * dt
  let touched = null
  // the floor
  if (p.y < BALL.r && v.y < 0) {
    p.y = BALL.r
    v.y = -v.y * BALL.floor
    if (Math.abs(v.y) < 0.35) v.y = 0
    v.x *= BALL.roll
    v.z *= BALL.roll
    touched = "floor"
  }
  if (!hoop) return touched
  // the board: a plane facing the court, from boardY0 to boardY1, boardHalfW either side
  const face = hoop.boardZ
  const toward = -Math.sign(hoop.end) // the board's face looks back into the court
  const gap = (p.z - face) * toward
  if (gap < BALL.r && gap > -0.12 && Math.abs(p.x) < hoop.boardHalfW + BALL.r * 0.5 && p.y > hoop.boardY0 - BALL.r * 0.5 && p.y < hoop.boardY1 + BALL.r * 0.5) {
    const vn = v.z * toward
    if (vn < 0) {
      v.z = -v.z * BALL.board
      v.x *= 0.92
      v.y *= 0.92
      touched = "board"
    }
    p.z = face + toward * BALL.r
  }
  // the rim: the nearest point of its circle; the ball bounces off the tube
  const dx = p.x
  const dz = p.z - hoop.z
  const d = Math.hypot(dx, dz)
  // (right in the middle: every point of the rim is as near; any one will do)
  const qx = d > 1e-4 ? (dx / d) * hoop.r : hoop.r
  const qz = hoop.z + (d > 1e-4 ? (dz / d) * hoop.r : 0)
  const nx = p.x - qx
  const ny = p.y - hoop.y
  const nz = p.z - qz
  const nd = Math.hypot(nx, ny, nz)
  const reach = BALL.r + hoop.tube
  if (nd < reach && nd > 1e-6) {
    const ux = nx / nd
    const uy = ny / nd
    const uz = nz / nd
    const vn = v.x * ux + v.y * uy + v.z * uz
    if (vn < 0) {
      // the normal part bounces back (a rim is lively), the rest keeps going with a little grip
      v.x -= (1 + BALL.rim) * vn * ux
      v.y -= (1 + BALL.rim) * vn * uy
      v.z -= (1 + BALL.rim) * vn * uz
      v.x *= 0.95
      v.z *= 0.95
      touched = "rim"
    }
    p.x = qx + ux * reach
    p.y = hoop.y + uy * reach
    p.z = qz + uz * reach
  }
  // through the hoop: down across the rim's plane inside it
  if (y0 >= hoop.y && p.y < hoop.y && v.y < 0 && Math.hypot(p.x, p.z - hoop.z) < hoop.r - BALL.r * 0.35) return touched ? `${touched}+in` : "in"
  return touched
}

// the shot that goes in: from (x, z), the release height, at the arc; the speed solved for the
// ball to come down through the rim's middle
export const idealShot = (from, hoop, arc = ARC) => {
  const dx = -from.x
  const dz = hoop.z - from.z
  // (aimed a touch past the middle: a ball coming down at an angle has more room at the back)
  const base = Math.hypot(dx, dz) || 1
  const dist = base + 0.07
  const ux = dx / base
  const uz = dz / base
  const fly = (sp) => {
    const b = { p: { x: from.x, y: RELEASE_Y, z: from.z }, v: { x: ux * sp * Math.cos(arc), y: sp * Math.sin(arc), z: uz * sp * Math.cos(arc) } }
    // (the horizontal distance when it comes down through the rim's height)
    let prevY = b.p.y
    for (let t = 0; t < 4; t += DT) {
      stepBall(b, null)
      if (b.v.y < 0 && prevY >= hoop.y && b.p.y < hoop.y) return Math.hypot(b.p.x - from.x, b.p.z - from.z)
      prevY = b.p.y
      if (b.p.y < 0.5) return 0
    }
    return 0
  }
  let lo = 2
  let hi = 20
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2
    if (fly(mid) < dist) lo = mid
    else hi = mid
  }
  const sp = (lo + hi) / 2
  return { speed: sp, ux, uz, dist, v: { x: ux * sp * Math.cos(arc), y: sp * Math.sin(arc), z: uz * sp * Math.cos(arc) } }
}

// a swipe -> the shot (touchplay.js readSwipe: depth 0..1 how far up, u -1..1 the angle).
// Just right: half way up and straight at the hoop; the further out, the less room there is.
// -> { v, power, aimErr, grade: "perfect" | "good" | "short" | "long" | "wide" }
export const swipeShot = (from, hoop, s = {}, { rand = Math.random, spread = 1 } = {}) => {
  const ideal = idealShot(from, hoop)
  const depth = s.tap ? SWEET : clamp(s.depth ?? SWEET, 0, 1.2)
  const u = clamp(s.u ?? 0, -1, 1)
  // power: +-2% speed for every 0.08 of the zone off the sweet spot (a little room either side)
  // (a thumb isn't a ruler: the middle eighth of the zone is all "just right", about 20 px
  // either side on a phone, then 2.2% faster or slower for every tenth further out)
  const raw = depth - SWEET
  const off = Math.abs(raw) < SWEET_BAND ? 0 : raw - Math.sign(raw) * SWEET_BAND
  const power = 1 + off * 0.22
  // aim: a dead zone round straight up, then 0.1 rad at the edge of the swipe
  const yaw = Math.abs(u) < 0.14 ? 0 : (u - Math.sign(u) * 0.14) * 0.11
  // a hand's own wobble, more from further out
  const wob = 0.0035 * spread * (1 + ideal.dist / 6)
  const sp = ideal.speed * (power + gauss(rand) * wob)
  const a = Math.atan2(ideal.ux, ideal.uz) + yaw + gauss(rand) * wob * 0.8
  const v = { x: Math.sin(a) * sp * Math.cos(ARC), y: sp * Math.sin(ARC), z: Math.cos(a) * sp * Math.cos(ARC) }
  const grade = off === 0 && yaw === 0 ? "perfect" : Math.abs(off) < 0.09 && Math.abs(yaw) < 0.02 ? "good" : Math.abs(yaw) >= 0.02 ? "wide" : off < 0 ? "short" : "long"
  return { v, power, yaw, grade, dist: ideal.dist }
}

// fly a shot to its end: { made, swish, bank, rims, path? } (deterministic: online, both
// screens fly the same launch)
export const flyShot = (from, v, hoop, { keepPath = false, maxT = 4 } = {}) => {
  const b = { p: { x: from.x, y: RELEASE_Y, z: from.z }, v: { ...v } }
  let rims = 0
  let bank = false
  let made = false
  let swish = false
  const path = keepPath ? [] : null
  for (let t = 0; t < maxT; t += DT) {
    const hit = stepBall(b, hoop)
    if (hit?.startsWith("rim")) rims++
    if (hit?.startsWith("board")) bank = true
    if (hit?.endsWith("in") && !made) {
      made = true
      swish = rims === 0 && !bank
    }
    if (path && Math.round(t / DT) % 4 === 0) path.push([b.p.x, b.p.y, b.p.z])
    if (hit === "floor" && t > 0.3) break
  }
  return { made, swish, bank: bank && made, rims, path, end: b.p }
}

// a computer shooter's wobble (measured in Node: from the free-throw line hard 59%, normal 37%,
// easy 24%; from the three-point line 35 / 21 / 14%)
export const cpuSpread = (level = "normal") => ({ easy: 4.5, normal: 3, hard: 2 })[level] || 3

// Around the World: seven spots round the key, 4.6 m from the rim, baseline to baseline
export const worldSpots = (hoop, n = 7, radius = 4.6) => Array.from({ length: n }, (_, i) => {
  const a = -Math.PI / 2 + (Math.PI * i) / (n - 1)
  // (from the baseline on one side, round the front of the rim, to the other baseline)
  return { x: Math.sin(a) * radius, z: hoop.z - Math.sign(hoop.end) * Math.max(0.6, Math.cos(a) * radius), i }
})

// ---- the games ----
// mode "free" | "world" | "horse"; players: [{ name, cpu }]
export const createHoopsGame = ({ mode = "free", players = [{ name: "You" }], hoop, seed = 1 } = {}) => {
  const st = {
    mode,
    turn: 0, // whose turn (horse)
    setter: 0, // horse: who sets the shot
    toMatch: null, // horse: { x, z } the spot to match, or null (a free shot)
    letters: players.map(() => ""),
    made: 0,
    shots: 0,
    swishes: 0,
    streak: 0,
    best: 0,
    world: 0, // around the world: the spot you're on
    worldShots: 0,
    over: null, // { winner, line }
    last: null, // the last shot's result
  }
  const spots = mode === "world" ? worldSpots(hoop) : []
  const word = (n) => LETTERS.slice(0, n)
  return {
    state: st,
    spots,
    players,
    // can this player shoot from (x, z) now? -> null or the reason not
    canShoot(i, at) {
      if (st.over) return "over"
      if (mode === "horse" && st.turn !== i) return "turn"
      if (mode === "world" && Math.hypot(at.x - spots[st.world].x, at.z - spots[st.world].z) > 1.0) return "spot"
      if (mode === "horse" && st.toMatch && Math.hypot(at.x - st.toMatch.x, at.z - st.toMatch.z) > 1.0) return "match"
      return null
    },
    // a shot by player i from `at` came out `res` (flyShot) -> what happened
    shot(i, at, res) {
      st.shots++
      if (res.made) {
        st.made++
        st.streak++
        st.best = Math.max(st.best, st.streak)
        if (res.swish) st.swishes++
      } else st.streak = 0
      let say = res.made ? (res.swish ? "Swish!" : res.bank ? "Bank!" : "Bucket!") : res.rims ? "Rimmed out" : "Miss"
      if (mode === "world") {
        st.worldShots++
        if (res.made) {
          st.world++
          if (st.world >= spots.length) {
            st.over = { winner: 0, line: `Around the world in ${st.worldShots} shots`, shots: st.worldShots }
            say = "Around the world!"
          } else say += " · next spot"
        }
      } else if (mode === "horse") {
        const other = 1 - i
        if (st.toMatch) {
          // matching: a miss is a letter; either way the one who set it shoots again (they keep
          // setting shots until they miss one)
          if (!res.made) {
            st.letters[i] = word(st.letters[i].length + 1)
            say = `${say} · ${players[i].name === "You" ? "you get" : `${players[i].name} gets`} ${st.letters[i]}`
            if (st.letters[i].length >= LETTERS.length) st.over = { winner: other, line: `${players[i].name === "You" ? "You" : players[i].name} spelled HORSE` }
          } else say = `${say} · matched`
          st.toMatch = null
          st.turn = st.setter
        } else if (res.made) {
          // a make sets the shot: the other matches it from there
          st.toMatch = { x: at.x, z: at.z }
          st.turn = other
          say = `${say} · ${players[other].name === "You" ? "match it" : `${players[other].name} has to match it`}`
        } else {
          st.turn = st.setter = other
        }
      }
      st.last = { i, made: res.made, swish: res.swish, bank: res.bank, say }
      return st.last
    },
    restart() {
      Object.assign(st, { turn: 0, setter: 0, toMatch: null, letters: players.map(() => ""), made: 0, shots: 0, swishes: 0, streak: 0, best: 0, world: 0, worldShots: 0, over: null, last: null })
    },
  }
}

// the computer's choice of where to set a H-O-R-S-E shot from: on its half, 2.5-7 m out
export const cpuSpot = (hoop, rand = Math.random) => {
  const r = 2.4 + rand() * 4.4
  const a = (rand() - 0.5) * Math.PI * 0.9
  return { x: Math.sin(a) * r, z: hoop.z - Math.sign(hoop.end) * Math.max(0.8, Math.cos(a) * r) }
}
