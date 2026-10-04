// Boom Frenzy's Sort Rush mode (no DOM; tested in boomfrenzy.test.js): bombs of two (later
// three) colors walk around a yard; drag or flick each into the pen of its color before its
// fuse burns down. The yard is 1 x 1 (the UI scales it). Pens: red on the left, blue on the
// right, and from 40 seconds green across the top.

import { rng } from "../../../utils/gameKit.js"

export const COLORS = ["red", "blue", "green"]
export const PEN_W = 0.2 // the side pens' width
export const PEN_TOP = 0.17 // the top pen's height
export const WALK = { x0: PEN_W + 0.05, x1: 1 - PEN_W - 0.05, y0: PEN_TOP + 0.06, y1: 0.96 }
export const GREEN_AT = 40
export const START_HEARTS = 3

export const newSort = ({ seed = Date.now() } = {}) => ({
  mode: "sort",
  random: rng(seed),
  t: 0,
  bombs: [],
  penned: { red: 0, blue: 0, green: 0 },
  hearts: START_HEARTS,
  score: 0,
  combo: 0,
  bestCombo: 0,
  sorted: 0,
  nextSpawnAt: 0.5,
  nextId: 1,
  events: [],
  over: null,
})

export const colorsAt = (s) => (s.t >= GREEN_AT ? COLORS : COLORS.slice(0, 2))
export const speedOf = (s) => Math.min(3, 1 + s.t / 50)
export const fuseFor = (s) => Math.max(3.6, 8.5 / Math.sqrt(speedOf(s)))
export const spawnGap = (s) => Math.max(0.6, 2.1 / speedOf(s))
export const multFor = (combo) => (combo >= 30 ? 4 : combo >= 15 ? 3 : combo >= 6 ? 2 : 1)

// which pen a point is in (or null)
export const penAt = (s, x, y) => {
  if (x < PEN_W) return "red"
  if (x > 1 - PEN_W) return "blue"
  if (y < PEN_TOP && s.t >= GREEN_AT) return "green"
  return null
}

export const spawn = (s, color) => {
  const colors = colorsAt(s)
  const c = color || colors[Math.floor(s.random() * colors.length)]
  const speed = 0.06 * Math.sqrt(speedOf(s))
  const ang = -Math.PI / 2 + (s.random() - 0.5) * 1.6
  const fuse = fuseFor(s)
  const b = { id: s.nextId++, color: c, x: 0.5 + (s.random() - 0.5) * 0.3, y: 1.02, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, fuse, left: fuse, held: false, turnIn: 1 + s.random() * 2 }
  s.bombs.push(b)
  s.events.push({ type: "pop", id: b.id })
  return b
}

const end = (s) => {
  if (s.over) return
  s.over = "lost"
  s.events.push({ type: "lost" })
}

const hurt = (s, b, why) => {
  s.hearts = Math.max(0, s.hearts - 1)
  s.combo = 0
  s.events.push({ type: "boom", id: b.id, x: b.x, y: b.y, why })
  if (s.hearts <= 0) end(s)
}

export const grab = (s, id) => {
  const b = s.bombs.find((x) => x.id === id)
  if (!b || s.over) return null
  b.held = true
  s.events.push({ type: "grab", id })
  return b
}

// let go of a bomb at (x, y): into a pen, or back on the ground
export const drop = (s, id, x, y) => {
  const i = s.bombs.findIndex((b) => b.id === id)
  if (i < 0 || s.over) return "gone"
  const b = s.bombs[i]
  b.held = false
  const pen = penAt(s, x, y)
  if (!pen) {
    b.x = Math.max(WALK.x0, Math.min(WALK.x1, x))
    b.y = Math.max(WALK.y0, Math.min(WALK.y1, y))
    return "ground"
  }
  s.bombs.splice(i, 1)
  if (pen === b.color) {
    s.combo++
    s.bestCombo = Math.max(s.bestCombo, s.combo)
    s.sorted++
    s.penned[pen]++
    const pts = 10 * multFor(s.combo)
    s.score += pts
    s.events.push({ type: "sorted", id, pen, x, y, points: pts, combo: s.combo })
    return "right"
  }
  hurt(s, { ...b, x, y }, "wrongPen")
  return "wrong"
}

// where a flicked bomb lands: it slides on from the release point
export const flickLanding = (x, y, vx, vy, slide = 0.22) => ({ x: x + vx * slide, y: y + vy * slide })

export const step = (s, dt) => {
  if (s.over || dt <= 0) return s
  s.t += dt
  if (s.t >= GREEN_AT && s.t - dt < GREEN_AT) s.events.push({ type: "newPen", pen: "green" })
  for (let i = s.bombs.length - 1; i >= 0; i--) {
    const b = s.bombs[i]
    b.left -= dt
    if (b.left <= 0) {
      s.bombs.splice(i, 1)
      hurt(s, b, "fuse")
      if (s.over) return s
      continue
    }
    if (b.held) continue
    // walk, turning now and then, and keep off the pens
    b.turnIn -= dt
    if (b.turnIn <= 0) {
      const sp = Math.hypot(b.vx, b.vy)
      const ang = Math.atan2(b.vy, b.vx) + (s.random() - 0.5) * 2
      b.vx = Math.cos(ang) * sp
      b.vy = Math.sin(ang) * sp
      b.turnIn = 1 + s.random() * 2
    }
    b.x += b.vx * dt
    b.y += b.vy * dt
    if (b.x < WALK.x0) (b.x = WALK.x0), (b.vx = Math.abs(b.vx))
    if (b.x > WALK.x1) (b.x = WALK.x1), (b.vx = -Math.abs(b.vx))
    if (b.y < WALK.y0) (b.y = WALK.y0), (b.vy = Math.abs(b.vy))
    if (b.y > WALK.y1 && b.vy > 0) b.vy = -Math.abs(b.vy)
  }
  if (s.t >= s.nextSpawnAt) {
    if (s.bombs.length < 4 + Math.floor(speedOf(s) * 2)) spawn(s)
    s.nextSpawnAt = s.t + spawnGap(s) * (0.7 + s.random() * 0.6)
  }
  return s
}
