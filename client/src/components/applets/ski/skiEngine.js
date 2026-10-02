// Downhill: the game itself, with no drawing. A skier heads down an endless slope of trees,
// rocks, bumps, jumps and slalom gates. After 2,000 m the Snow-Moose comes looking for
// them. Everything is in world units (UNIT per meter), y grows downhill.

export const UNIT = 8 // world units per meter
export const MOOSE_AT = 2000 // meters
export const CELL = 320 // the slope is made in square cells, as they come into view

// Headings, -3 (across the slope, to the left: stopped) to 3, in degrees from straight down
export const ANGLES = [-90, -56, -28, 0, 28, 56, 90]
const GRAVITY = 5 // m/s/s along a heading straight down the hill
const MAX_SPEED = 24 // m/s

// Small fast random numbers from a seed
export const seeded = (seed) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const hash = (seed, cx, cy) => (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663) ^ Math.imul(seed, 83492791)) >>> 0

// What can be on the slope: how big it is to bump into (w x h around its foot), and
// whether a small hop clears it
export const KINDS = {
  tree: { w: 10, h: 6, crash: true },
  bigtree: { w: 12, h: 7, crash: true },
  deadtree: { w: 6, h: 5, crash: true },
  rock: { w: 14, h: 7, crash: true, low: true },
  stump: { w: 8, h: 5, crash: true, low: true },
  mogul: { w: 22, h: 8, bump: true, low: true },
  ramp: { w: 26, h: 10, ramp: true, low: true },
}

export const newGame = (seed = Math.floor(Math.random() * 2 ** 31)) => ({
  seed,
  t: 0,
  x: 0,
  y: 0,
  dir: 0,
  speed: 0,
  state: "skiing", // skiing | air | crashed | caught | over
  air: null, // { t, total, height, ramp } while in the air
  tricks: 0, // tricks done in this jump
  trickT: 0, // a trick in progress (seconds left)
  crashT: 0,
  safeT: 0, // just got up: can't crash again for a moment
  style: 0,
  combo: 0, // gates in a row
  gates: { passed: 0, missed: 0 },
  crashes: 0,
  cells: new Map(), // "cx,cy" -> objects
  courses: [], // slalom courses: { gates: [{ x, y, w, color, done }] , box }
  nextCourse: 300, // meters
  moose: null, // { x, y, speed, frame }
  messages: [], // floating text: { text, x, y, t }
  over: null, // { reason, score, distance, time }
  paused: false,
})

export const distanceOf = (g) => Math.max(0, Math.floor(g.y / UNIT))
export const scoreOf = (g) => distanceOf(g) + Math.floor(g.style)
export const speedKmh = (g) => Math.round(g.speed * 3.6)

const say = (g, text, color = "#000080") => g.messages.push({ text, x: g.x, y: g.y - 20, t: 1.4, color })

// ---------- the slope ----------

const inCourse = (g, x, y) => g.courses.some((c) => x > c.box.x0 && x < c.box.x1 && y > c.box.y0 && y < c.box.y1)

const makeCell = (g, cx, cy) => {
  const rand = seeded(hash(g.seed, cx, cy))
  const out = []
  const y0 = cy * CELL
  const x0 = cx * CELL
  if (y0 + CELL < 160) return out // a clear run-out at the top
  const depth = Math.min(1, Math.max(0, y0 / UNIT / 3000)) // busier further down
  const count = (base, extra) => Math.floor(base + extra * depth + rand() * 1.6)
  const add = (kind, n) => {
    for (let i = 0; i < n; i++) {
      const x = x0 + rand() * CELL
      const y = y0 + rand() * CELL
      if (Math.abs(x) < 60 && y < 220) continue // the start
      if (inCourse(g, x, y)) continue
      out.push({ kind, x, y, v: Math.floor(rand() * 4) })
    }
  }
  add("tree", count(1.8, 3))
  add("bigtree", count(0.6, 1.4))
  add("rock", count(0.6, 1.5))
  add("deadtree", rand() < 0.35 ? 1 : 0)
  add("stump", rand() < 0.4 ? 1 : 0)
  add("mogul", count(0.6, 1))
  add("ramp", rand() < 0.3 + 0.2 * depth ? 1 : 0)
  return out
}

const cellKey = (cx, cy) => `${cx},${cy}`

// Make the cells around the skier, and forget the ones far behind
export const ensureCells = (g, view = { w: 900, h: 900 }) => {
  const cx0 = Math.floor((g.x - view.w) / CELL)
  const cx1 = Math.floor((g.x + view.w) / CELL)
  const cy0 = Math.floor((g.y - view.h * 0.6) / CELL)
  const cy1 = Math.floor((g.y + view.h) / CELL)
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) if (!g.cells.has(cellKey(cx, cy))) g.cells.set(cellKey(cx, cy), makeCell(g, cx, cy))
  for (const key of g.cells.keys()) {
    const [cx, cy] = key.split(",").map(Number)
    if (cy < cy0 - 2 || cx < cx0 - 3 || cx > cx1 + 3) g.cells.delete(key)
  }
}

export const objectsNear = (g, x0, y0, x1, y1) => {
  const out = []
  for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      for (const o of g.cells.get(cellKey(cx, cy)) || []) if (o.x >= x0 && o.x <= x1 && o.y >= y0 && o.y <= y1) out.push(o)
    }
  }
  return out
}

// A slalom course a little way ahead: gates to ski between, clear of trees
const startCourse = (g) => {
  const rand = seeded(hash(g.seed, 7, Math.floor(g.y)))
  const y0 = g.y + 360
  const n = 6 + Math.floor(rand() * 3)
  const gates = []
  let x = g.x
  for (let i = 0; i < n; i++) {
    x += (i % 2 ? 1 : -1) * (30 + rand() * 40)
    gates.push({ x, y: y0 + i * 150, w: 64, color: i % 2 ? "blue" : "red", done: null })
  }
  const box = { x0: Math.min(...gates.map((q) => q.x)) - 90, x1: Math.max(...gates.map((q) => q.x)) + 160, y0: y0 - 60, y1: y0 + n * 150 }
  g.courses.push({ gates, box })
  // clear what's already there
  for (const [key, list] of g.cells) g.cells.set(key, list.filter((o) => !(o.x > box.x0 && o.x < box.x1 && o.y > box.y0 && o.y < box.y1)))
}

// ---------- moving ----------

const hits = (g, o, kind) => Math.abs(g.x - o.x) < kind.w / 2 + 2 && Math.abs(g.y - o.y) < kind.h / 2 + 1

const crash = (g, what) => {
  g.state = "crashed"
  g.crashT = 1.3
  g.speed = 0
  g.combo = 0
  g.crashes++
  g.air = null
  g.trickT = 0
  say(g, what === "trick" ? "Wipeout!" : "Ouch!", "#c00000")
}

const takeOff = (g, total, ramp) => {
  g.state = "air"
  g.air = { t: 0, total, ramp }
  g.tricks = 0
}

// Player commands between frames: { turn: -1 | 1, aim: heading or null, brake, jump, trick }
export const step = (g, dt, input = {}) => {
  if (g.paused || g.state === "over") return g
  dt = Math.min(dt, 1 / 20)
  g.t += dt
  g.messages = g.messages.filter((m) => (m.t -= dt) > 0)

  if (g.state === "crashed") {
    g.crashT -= dt
    if (g.crashT <= 0) {
      g.state = "skiing"
      g.dir = 0
      g.safeT = 1
    }
  } else if (g.state === "skiing" || g.state === "air") {
    // steering works in the air too (it's how you aim the landing)
    if (Number.isInteger(input.aim)) g.dir = Math.max(-3, Math.min(3, input.aim))
    if (input.turn) g.dir = Math.max(-3, Math.min(3, g.dir + Math.sign(input.turn) * Math.min(3, Math.abs(input.turn))))
    // stopped sideways: a turn the other way shuffles along
    if (input.turn && g.speed < 1 && Math.abs(g.dir) === 3 && g.state === "skiing") g.x += Math.sign(input.turn) * 4

    const angle = (ANGLES[g.dir + 3] * Math.PI) / 180
    if (g.state === "skiing") {
      // skis across the slope dig in and stop you
      let accel = GRAVITY * Math.cos(angle) - 0.4 - 0.008 * g.speed * g.speed - (Math.abs(g.dir) === 3 ? 5 : 0)
      if (input.brake) accel -= 14
      g.speed = Math.max(0, Math.min(MAX_SPEED, g.speed + accel * dt))
      if (input.jump && g.speed > 2) takeOff(g, 0.42, false) // a little hop
    } else {
      g.air.t += dt
      if (input.trick && g.air.ramp && g.trickT <= 0 && g.tricks < 3) {
        g.trickT = 0.38
        g.tricks++
      }
      g.trickT = Math.max(0, g.trickT - dt)
      if (g.air.t >= g.air.total) {
        // landing in the middle of a trick hurts
        if (g.trickT > 0.05) crash(g, "trick")
        else {
          g.state = "skiing"
          if (g.air.ramp) {
            const points = Math.round(20 + g.air.total * 40 + g.tricks * 75)
            g.style += points
            say(g, g.tricks ? `${["", "Spin", "Double spin", "Triple spin"][g.tricks]}! +${points}` : `Nice jump! +${points}`)
          }
          g.air = null
        }
      }
    }
    g.x += Math.sin(angle) * g.speed * UNIT * dt
    g.y += Math.cos(angle) * g.speed * UNIT * dt
    g.safeT = Math.max(0, g.safeT - dt)

    // bumping into things
    if (g.state !== "crashed") {
      for (const o of objectsNear(g, g.x - 30, g.y - 20, g.x + 30, g.y + 20)) {
        const kind = KINDS[o.kind]
        if (!hits(g, o, kind)) continue
        const flying = g.state === "air"
        const hopping = flying && !g.air.ramp
        if (kind.ramp && !flying && g.speed > 3) {
          takeOff(g, 0.5 + g.speed * 0.06, true)
          break
        }
        if (kind.bump && !flying && !o.bumped) {
          o.bumped = true
          g.speed *= 0.82
        }
        if (kind.crash && !g.safeT && (!flying || (hopping && !kind.low))) {
          crash(g, o.kind)
          break
        }
      }
    }

    // slalom gates: between the flags as you pass them
    for (const course of g.courses) {
      for (const gate of course.gates) {
        if (gate.done || g.y < gate.y) continue
        const through = g.x > gate.x && g.x < gate.x + gate.w
        gate.done = through ? "passed" : "missed"
        if (through) {
          g.combo++
          g.gates.passed++
          const points = 15 * g.combo
          g.style += points
          say(g, `Gate! +${points}`, "#006000")
        } else {
          g.combo = 0
          g.gates.missed++
          say(g, "Missed a gate", "#c00000")
        }
      }
    }
    g.courses = g.courses.filter((c) => c.box.y1 > g.y - 400)
    if (distanceOf(g) >= g.nextCourse && g.state !== "crashed") {
      startCourse(g)
      g.nextCourse += 550 + Math.floor(seeded(hash(g.seed, 3, g.nextCourse))() * 300)
    }
  }

  // the Snow-Moose
  if (!g.moose && distanceOf(g) >= MOOSE_AT && g.state !== "caught") {
    g.moose = { x: g.x + (g.x % 2 ? 120 : -120), y: g.y - 330, speed: 17, frame: 0 }
    say(g, "What was that?!", "#800000")
  }
  if (g.moose) {
    const m = g.moose
    m.frame += dt
    if (g.state === "caught") {
      // carry the skier off back up the hill
      m.y -= 60 * dt
      g.x = m.x
      g.y = m.y + 4
      g.crashT -= dt
      if (g.crashT <= 0) finish(g, "caught")
    } else {
      m.speed = Math.min(26, 17 + (distanceOf(g) - MOOSE_AT) / 600)
      const dx = g.x - m.x
      const dy = g.y - m.y
      const d = Math.hypot(dx, dy) || 1
      const move = Math.min(d, m.speed * UNIT * dt)
      m.x += (dx / d) * move
      m.y += (dy / d) * move
      if (d < 12) {
        g.state = "caught"
        g.reached = distanceOf(g) // the moose carries you back up: keep how far you got
        g.crashT = 1.6
        g.speed = 0
        g.air = null
        say(g, "Caught by the Snow-Moose!", "#800000")
      }
    }
  }
  return g
}

const finish = (g, reason) => {
  g.state = "over"
  const distance = g.reached ?? distanceOf(g)
  g.over = { reason, score: distance + Math.floor(g.style), distance, time: g.t, style: Math.floor(g.style) }
}

// ---------- high scores ----------

export const SCORES_KEY = "98ish.ski.scores"

export const loadScores = () => {
  try {
    const list = JSON.parse(localStorage.getItem(SCORES_KEY))
    return Array.isArray(list) ? list.filter((s) => s && Number.isFinite(s.score)).slice(0, 5) : []
  } catch {
    return []
  }
}

// Add a finished run; returns { scores, place } (place is 0-based, -1 if it didn't make it)
export const addScore = (run) => {
  const scores = loadScores()
  const entry = { score: run.score, distance: run.distance, time: Math.round(run.time), date: Date.now() }
  const list = [...scores, entry].sort((a, b) => b.score - a.score).slice(0, 5)
  try {
    localStorage.setItem(SCORES_KEY, JSON.stringify(list))
  } catch {
    // not saved: private browsing
  }
  return { scores: list, place: list.indexOf(entry) }
}
