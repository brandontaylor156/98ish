// Draws the Sunny Acres map: water around an island of grass, the railway, wild woods on
// land you don't own yet, and every building sorted back to front. Also turns screen
// points into tiles and buildings (hit testing) and runs the little animations: smoke,
// floating "+2" rewards, wandering animals, the helicopter and the train.

import { BUILDINGS, TW, TH, WELCOME_BOARD, buildingSprite, drawAnimal, drawHelicopter, drawIcon, drawTrainCar, fieldSprite, heartPath, isoX, isoY, roundRect, trainKit } from "./art.js"
import { EXPANSIONS, FACTORIES, MAP_H, MAP_W, PENS, RAIL_ROW, kindOf, sizeOf } from "./data.js"
import { canPlace, factoryJobs, fieldStage, isLand, penState } from "./game.js"

// ---- camera ----
// view = { cx, cy, z, W, H }: the world point at the middle of the screen, zoom, CSS size
export const toWorld = (view, sx, sy) => [view.cx + (sx - view.W / 2) / view.z, view.cy + (sy - view.H / 2) / view.z]
export const toScreen = (view, wx, wy) => [(wx - view.cx) * view.z + view.W / 2, (wy - view.cy) * view.z + view.H / 2]
export const toTile = (wx, wy) => {
  const a = wx / (TW / 2)
  const b = wy / (TH / 2)
  return [(a + b) / 2, (b - a) / 2]
}
export const MIN_ZOOM = 0.45
export const MAX_ZOOM = 2.6

// keep the camera over the island
export const clampView = (view) => {
  view.z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.z))
  const left = isoX(0, MAP_H)
  const right = isoX(MAP_W, 0)
  const top = isoY(0, 0) - 60
  const bottom = isoY(MAP_W, MAP_H)
  const hw = view.W / 2 / view.z
  const hh = view.H / 2 / view.z
  view.cx = right - left < hw * 2 ? (left + right) / 2 : Math.max(left + hw * 0.6, Math.min(right - hw * 0.6, view.cx))
  view.cy = bottom - top < hh * 2 ? (top + bottom) / 2 : Math.max(top + hh * 0.6, Math.min(bottom - hh * 0.6, view.cy))
}

// ---- the wild land: trees and rocks on land you don't own (same every time) ----
const hash = (x, y) => {
  let h = Math.imul(x * 374761393 + y * 668265263, 1274126177)
  h ^= h >>> 13
  return (Math.imul(h, 1103515245) >>> 0) / 4294967296
}
const WILD = ["wildOak", "wildPine", "wildOak2", "wildPine2", "bush", "rock"]
export const wildItems = (s) => {
  const out = []
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      if (y === RAIL_ROW || isLand(s, x, y)) continue
      const h = hash(x, y)
      if (h < 0.5) out.push({ x, y, t: WILD[Math.floor(hash(y, x) * WILD.length)] })
    }
  // a sign on each piece of land for sale
  EXPANSIONS.forEach((e, k) => {
    if (s.exp[k]) return
    const x = e.x + Math.floor(e.w / 2)
    const y = e.y + Math.floor(e.h / 2)
    const i = out.findIndex((w) => w.x === x && w.y === y)
    if (i >= 0) out.splice(i, 1)
    out.push({ x, y, t: "saleSign", exp: k })
  })
  return out
}
export const expansionAt = (s, x, y) => EXPANSIONS.findIndex((e, k) => !s.exp[k] && x >= e.x && x < e.x + e.w && y >= e.y && y < e.y + e.h)

// ---- hit testing ----
// how tall each kind of thing looks, for taps on roofs
const heightOf = (o) => {
  if (o.t === "field") return 4
  if (o.b) return sizeOf(o.t) * 14 + 8
  const b = BUILDINGS[o.t]
  return b ? b.up * 0.7 : 20
}
const inside = (pts, x, y) => {
  let c = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}
const depth = (x, y, n) => x + y + n
export const objectAt = (s, wx, wy) => {
  const sorted = [...s.objs].sort((a, b) => depth(b.x, b.y, sizeOf(b.t)) - depth(a.x, a.y, sizeOf(a.t)))
  for (const o of sorted) {
    const n = sizeOf(o.t)
    const X = isoX(o.x, o.y)
    const Y = isoY(o.x, o.y)
    const H = heightOf(o)
    const pts = [[X, Y - H], [X + n * 32, Y + n * 16 - H], [X + n * 32, Y + n * 16], [X, Y + n * 32], [X - n * 32, Y + n * 16], [X - n * 32, Y + n * 16 - H]]
    if (inside(pts, wx, wy)) return o
  }
  return null
}
// a visitor's note sign under a point (they stand in front of buildings, so check them first)
export const noteAt = (notes, wx, wy) => {
  for (const n of [...(notes || [])].sort((a, b) => b.x + b.y - (a.x + a.y))) {
    const x = isoX(n.x, n.y)
    const y = isoY(n.x, n.y, 16)
    if (wx > x - 14 && wx < x + 14 && wy > y - 24 && wy < y + 6) return n
  }
  return null
}

// what's on the ground right under a point (for swipes)
export const groundObjectAt = (s, wx, wy) => {
  const [u, v] = toTile(wx, wy)
  const x = Math.floor(u)
  const y = Math.floor(v)
  return s.objs.find((o) => x >= o.x && x < o.x + sizeOf(o.t) && y >= o.y && y < o.y + sizeOf(o.t)) || null
}

// where the top of a building's art is (bubbles and arrows go there), in world px
export const topOf = (o) => {
  const n = sizeOf(o.t)
  const X = isoX(o.x + n / 2, o.y + n / 2)
  const Y = isoY(o.x + n / 2, o.y + n / 2)
  return [X, Y - (o.t === "field" ? 14 : heightOf(o) + n * 8)]
}

// ---- small cached icon canvases for drawing on the map ----
const icons = new Map()
const iconCanvas = (id) => {
  if (icons.has(id)) return icons.get(id)
  const c = document.createElement("canvas")
  c.width = c.height = 64
  drawIcon(c.getContext("2d"), id, 64)
  icons.set(id, c)
  return c
}

// ---- the scene ----
const WATER = "#5cc0e6"

const drawGround = (ctx, s, view, t) => {
  const [x0, y0] = toWorld(view, 0, 0)
  const [x1, y1] = toWorld(view, view.W, view.H)
  ctx.fillStyle = WATER
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
  // gentle waves
  ctx.strokeStyle = "rgba(255,255,255,0.35)"
  ctx.lineWidth = 2
  const step = 90
  for (let y = Math.floor(y0 / step) * step; y < y1; y += step)
    for (let x = Math.floor(x0 / (step * 2)) * step * 2 + ((y / step) % 2) * step; x < x1; x += step * 2) {
      const d = Math.sin(t * 1.2 + x * 0.01 + y * 0.02) * 6
      ctx.beginPath()
      ctx.moveTo(x + d, y)
      ctx.quadraticCurveTo(x + 10 + d, y - 5, x + 20 + d, y)
      ctx.stroke()
    }
  ctx.lineWidth = 1
  const diamond = (u0, v0, u1, v1) => {
    ctx.moveTo(isoX(u0, v0), isoY(u0, v0))
    ctx.lineTo(isoX(u1, v0), isoY(u1, v0))
    ctx.lineTo(isoX(u1, v1), isoY(u1, v1))
    ctx.lineTo(isoX(u0, v1), isoY(u0, v1))
    ctx.closePath()
  }
  // sandy shore, then the island's cliff edge
  ctx.fillStyle = "#f1dc9a"
  ctx.beginPath()
  diamond(-0.6, -0.6, MAP_W + 0.6, MAP_H + 0.6)
  ctx.fill()
  ctx.fillStyle = "#b8925a"
  ctx.beginPath()
  ctx.moveTo(isoX(0, MAP_H), isoY(0, MAP_H))
  ctx.lineTo(isoX(MAP_W, MAP_H), isoY(MAP_W, MAP_H))
  ctx.lineTo(isoX(MAP_W, 0), isoY(MAP_W, 0))
  ctx.lineTo(isoX(MAP_W, 0), isoY(MAP_W, 0, -8))
  ctx.lineTo(isoX(MAP_W, MAP_H), isoY(MAP_W, MAP_H, -8))
  ctx.lineTo(isoX(0, MAP_H), isoY(0, MAP_H, -8))
  ctx.closePath()
  ctx.fill()
  // visible tiles only
  const corners = [toTile(x0, y0), toTile(x1, y0), toTile(x0, y1), toTile(x1, y1)]
  const ua = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0]))))
  const ub = Math.min(MAP_W, Math.ceil(Math.max(...corners.map((c) => c[0]))))
  const va = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1]))))
  const vb = Math.min(MAP_H, Math.ceil(Math.max(...corners.map((c) => c[1]))))
  const fills = { a: [], b: [], c: [], d: [] }
  for (let v = va; v < vb; v++)
    for (let u = ua; u < ub; u++) {
      const land = isLand(s, u, v)
      const odd = (u + v) % 2
      fills[land ? (odd ? "a" : "b") : odd ? "c" : "d"].push([u, v])
    }
  const colors = { a: "#97d470", b: "#8fce69", c: "#78b75a", d: "#73b155" }
  for (const k of Object.keys(fills)) {
    ctx.fillStyle = colors[k]
    ctx.beginPath()
    for (const [u, v] of fills[k]) diamond(u, v, u + 1, v + 1)
    ctx.fill()
  }
  // edges of the land you own
  ctx.strokeStyle = "rgba(255,255,255,0.35)"
  ctx.setLineDash([6, 5])
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (let v = va; v < vb; v++)
    for (let u = ua; u < ub; u++) {
      if (!isLand(s, u, v)) continue
      if (u + 1 < MAP_W && !isLand(s, u + 1, v)) {
        ctx.moveTo(isoX(u + 1, v), isoY(u + 1, v))
        ctx.lineTo(isoX(u + 1, v + 1), isoY(u + 1, v + 1))
      }
      if (v + 1 < MAP_H && !isLand(s, u, v + 1)) {
        ctx.moveTo(isoX(u, v + 1), isoY(u, v + 1))
        ctx.lineTo(isoX(u + 1, v + 1), isoY(u + 1, v + 1))
      }
      if (u > 0 && !isLand(s, u - 1, v)) {
        ctx.moveTo(isoX(u, v), isoY(u, v))
        ctx.lineTo(isoX(u, v + 1), isoY(u, v + 1))
      }
      if (v > 0 && !isLand(s, u, v - 1)) {
        ctx.moveTo(isoX(u, v), isoY(u, v))
        ctx.lineTo(isoX(u + 1, v), isoY(u + 1, v))
      }
    }
  ctx.stroke()
  ctx.setLineDash([])
  ctx.lineWidth = 1
  // the railway
  const r = RAIL_ROW
  ctx.fillStyle = "#c2ad8c"
  ctx.beginPath()
  diamond(0, r + 0.12, MAP_W, r + 0.88)
  ctx.fill()
  ctx.fillStyle = "#7a5a3c"
  ctx.beginPath()
  for (let u = 0.1; u < MAP_W; u += 0.3) diamond(u, r + 0.2, u + 0.12, r + 0.8)
  ctx.fill()
  ctx.strokeStyle = "#6f747a"
  ctx.lineWidth = 2
  ctx.beginPath()
  for (const v of [r + 0.33, r + 0.67]) {
    ctx.moveTo(isoX(0, v), isoY(0, v, 1))
    ctx.lineTo(isoX(MAP_W, v), isoY(MAP_W, v, 1))
  }
  ctx.stroke()
  ctx.lineWidth = 1
}

// draw a sprite with its footprint's top corner at tile (x, y)
const blit = (ctx, sp, x, y, flip, alpha = 1) => {
  if (!sp) return
  const wx = isoX(x, y)
  const wy = isoY(x, y)
  if (alpha !== 1) ctx.globalAlpha = alpha
  if (flip) {
    ctx.save()
    ctx.translate(wx, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(sp.canvas, -sp.ox, wy - sp.oy, sp.w, sp.h)
    ctx.restore()
  } else ctx.drawImage(sp.canvas, wx - sp.ox, wy - sp.oy, sp.w, sp.h)
  if (alpha !== 1) ctx.globalAlpha = 1
}

const bubble = (ctx, x, y, icon, z, t, extra) => {
  const bob = Math.sin(t * 3 + x * 0.05) * 3
  const r = 15 / Math.max(0.8, Math.min(z, 1.6)) // stays readable when zoomed out
  y += bob - r
  ctx.fillStyle = "rgba(0,0,0,0.15)"
  ctx.beginPath()
  ctx.ellipse(x, y + r + 4, r * 0.6, r * 0.2, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = "#fffdf6"
  ctx.strokeStyle = "rgba(52,36,24,0.6)"
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.moveTo(x - 4, y + r - 1)
  ctx.lineTo(x, y + r + 5)
  ctx.lineTo(x + 4, y + r - 1)
  ctx.fill()
  ctx.stroke()
  ctx.drawImage(iconCanvas(icon), x - r * 0.75, y - r * 0.75, r * 1.5, r * 1.5)
  if (extra) {
    ctx.font = `bold ${Math.round(r * 0.7)}px Arial, sans-serif`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.lineWidth = 3
    ctx.strokeStyle = "#fff"
    ctx.strokeText(extra, x + r * 0.75, y + r * 0.6)
    ctx.fillStyle = "#2f6b2f"
    ctx.fillText(extra, x + r * 0.75, y + r * 0.6)
    ctx.lineWidth = 1
  }
}

const progressBar = (ctx, x, y, frac, z) => {
  const w = 44 / Math.min(z, 1.4)
  const h = 7 / Math.min(z, 1.4)
  ctx.fillStyle = "rgba(40,30,20,0.6)"
  roundRect(ctx, x - w / 2 - 1, y - 1, w + 2, h + 2, 3)
  ctx.fill()
  ctx.fillStyle = "#fff"
  roundRect(ctx, x - w / 2, y, w, h, 2.5)
  ctx.fill()
  ctx.fillStyle = "#5bc25a"
  roundRect(ctx, x - w / 2, y, Math.max(h, w * frac), h, 2.5)
  ctx.fill()
}

// where the animals in a pen stand right now (they wander a little)
const animalSpots = (o, t) =>
  o.a.map((_, k) => {
    const hu = [0.9, 2.0, 1.4][k % 3]
    const hv = [1.0, 1.4, 2.1][k % 3]
    const ph = o.i * 1.7 + k * 2.3
    const du = Math.sin(t * 0.35 + ph) * 0.35
    const dv = Math.cos(t * 0.27 + ph * 1.3) * 0.28
    const dir = Math.cos(t * 0.35 + ph) * 0.35 - Math.sin(t * 0.27 + ph * 1.3) * 0.28 * 0.77
    return { u: o.x + hu + du, v: o.y + hv + dv, flip: dir < 0 }
  })

// fx: { t, floaters, puffs, heli, train, ghost, arrow, now, selected }
export const drawScene = (ctx, s, view, fx) => {
  const { t, now } = fx
  const z = view.z
  ctx.imageSmoothingEnabled = true
  drawGround(ctx, s, view, t)
  const [vx0, vy0] = toWorld(view, -80, -80)
  const [vx1, vy1] = toWorld(view, view.W + 80, view.H + 200)
  const visible = (x, y, n, up) => {
    const X = isoX(x, y)
    const Y = isoY(x, y)
    return X + n * 32 > vx0 && X - n * 32 < vx1 && Y + n * 32 > vy0 && Y - up < vy1
  }

  // everything that stands on the map, back to front
  const items = []
  for (const w of fx.wild) if (visible(w.x, w.y, 1, 70)) items.push({ d: depth(w.x, w.y, 1), w })
  for (const o of s.objs) {
    if (fx.ghost?.id === o.i) continue
    const n = sizeOf(o.t)
    if (visible(o.x, o.y, n, 160)) items.push({ d: depth(o.x, o.y, n), o })
  }
  // the train
  const train = trainCars(s, fx, t)
  for (const car of train) items.push({ d: car.u + RAIL_ROW + 0.5, car })
  // visitors' notes, and visitors walking around
  for (const n of fx.notes || []) items.push({ d: n.x + n.y + 0.5, note: n })
  for (const p of fx.visitors || []) items.push({ d: p.u + p.v + 0.6, person: p })
  items.sort((a, b) => a.d - b.d)

  const bubbles = []
  const bars = []
  for (const it of items) {
    if (it.w) {
      blit(ctx, buildingSprite(it.w.t), it.w.x, it.w.y)
      continue
    }
    if (it.car) {
      drawTrainCar(trainKitFor(ctx), it.car.u, RAIL_ROW, it.car.kind)
      continue
    }
    if (it.note) {
      blit(ctx, buildingSprite("noteSign"), it.note.x - 0.5, it.note.y - 0.5, false, it.note.id === fx.noteSel ? 1 : 0.96)
      continue
    }
    if (it.person) {
      drawVisitor(ctx, it.person, t, z)
      continue
    }
    const o = it.o
    drawObject(ctx, o, s, now, t, bubbles, bars, fx)
  }
  // hearts visitors gave buildings
  if (fx.hearts) {
    for (const o of s.objs) {
      const n = fx.hearts[o.i]
      if (!n || o.b) continue
      const [x, y] = topOf(o)
      drawHeartTag(ctx, x + 16, y + 4 + Math.sin(t * 2 + o.i) * 1.5, n, z, fx.myHearts?.includes(o.i))
    }
  }
  // the helicopter
  drawHeli(ctx, s, fx, t)
  // building ghost (placing or moving)
  if (fx.ghost) drawGhost(ctx, s, fx.ghost)
  for (const b of bars) progressBar(ctx, b.x, b.y, b.f, z)
  for (const b of bubbles) bubble(ctx, b.x, b.y, b.icon, z, t, b.extra)
  // smoke
  for (const p of fx.puffs) {
    const a = (t - p.t0) / 2.6
    if (a >= 1) continue
    ctx.fillStyle = `rgba(250,250,250,${0.55 * (1 - a)})`
    ctx.beginPath()
    ctx.arc(p.x + Math.sin(a * 5 + p.x) * 4 + a * 10, p.y - a * 50, 4 + a * 9, 0, Math.PI * 2)
    ctx.fill()
  }
  fx.puffs = fx.puffs.filter((p) => t - p.t0 < 2.6)
  // floating rewards
  for (const f of fx.floaters) {
    const a = (t - f.t0) / 1.3
    if (a < 0 || a >= 1) continue
    const y = f.y - a * 46
    const k = 1 / Math.max(0.7, Math.min(z, 1.5))
    ctx.globalAlpha = a < 0.75 ? 1 : (1 - a) * 4
    if (f.icon) ctx.drawImage(iconCanvas(f.icon), f.x - 26 * k, y - 12 * k, 24 * k, 24 * k)
    if (f.text) {
      ctx.font = `bold ${Math.round(15 * k)}px Arial, sans-serif`
      ctx.textAlign = "left"
      ctx.textBaseline = "middle"
      ctx.lineWidth = 3.5 * k
      ctx.strokeStyle = "rgba(40,30,20,0.85)"
      ctx.strokeText(f.text, f.x + (f.icon ? 0 : -10 * k), y)
      ctx.fillStyle = f.color || "#fff"
      ctx.fillText(f.text, f.x + (f.icon ? 0 : -10 * k), y)
      ctx.lineWidth = 1
    }
    ctx.globalAlpha = 1
  }
  fx.floaters = fx.floaters.filter((f) => t - f.t0 < 1.3)
  // the tutorial's bouncing arrow
  if (fx.arrow) {
    const [x, y] = fx.arrow
    const k = 1 / Math.max(0.6, Math.min(z, 1.6))
    const b = Math.abs(Math.sin(t * 4)) * 10 * k
    ctx.save()
    ctx.translate(x, y - b - 6 * k)
    ctx.scale(k, k)
    ctx.fillStyle = "#ffcf3f"
    ctx.strokeStyle = "#7a4a10"
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(-14, -16)
    ctx.lineTo(-6, -16)
    ctx.lineTo(-6, -34)
    ctx.lineTo(6, -34)
    ctx.lineTo(6, -16)
    ctx.lineTo(14, -16)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }
}

let trainKitCache = null
const trainKitFor = (ctx) => (trainKitCache?.ctx === ctx ? trainKitCache.k : (trainKitCache = { ctx, k: trainKit(ctx) }).k)

const CAR_COLORS = ["#d4483b", "#4a8fd6", "#f0b43c", "#6bb05a", "#a06bd6"]
// where the train's cars are: parked at the station, rolling in or rolling out
const trainCars = (s, fx, t) => {
  const st = s.train
  const STOP = 15.4 // the engine's front, at the station
  let front = null
  if (st.st === "here") {
    const a = fx.train?.in != null ? Math.min(1, (t - fx.train.in) / 3) : 1
    front = STOP - (1 - easeOut(a)) * 26
  } else if (fx.train?.out != null) {
    const a = (t - fx.train.out) / 3.5
    if (a < 1) front = STOP + easeIn(a) * 26
  }
  if (front === null) return []
  const n = st.st === "here" ? st.cars.length : fx.train.cars || 3
  const cars = [{ u: front, kind: "engine" }]
  for (let k = 0; k < n; k++) cars.push({ u: front - 1.45 * (k + 1), kind: CAR_COLORS[k % CAR_COLORS.length] })
  return cars.filter((c) => c.u > -0.5 && c.u - 1.3 < MAP_W + 0.5)
}
const easeOut = (a) => 1 - (1 - a) * (1 - a)
const easeIn = (a) => a * a

// the helicopter sits on the pad and flies off with each delivery
const drawHeli = (ctx, s, fx, t) => {
  const pad = s.objs.find((o) => o.t === "helipad")
  if (!pad) return
  const X = isoX(pad.x + 1.5, pad.y + 1.5)
  const Y = isoY(pad.x + 1.5, pad.y + 1.5)
  let x = X
  let y = Y - 4
  let spin = false
  if (fx.heli != null) {
    const a = t - fx.heli
    spin = a < 7.5
    if (a < 1) y -= easeIn(a) * 40
    else if (a < 3) {
      const b = (a - 1) / 2
      y -= 40 + b * 120
      x += easeIn(b) * 500
    } else if (a < 5) {
      x += 9999 // away
    } else if (a < 7) {
      const b = 1 - (a - 5) / 2
      y -= 40 + b * 120
      x -= easeIn(b) * 500
    } else if (a < 7.5) y -= (1 - (a - 7) / 0.5) * 40
  }
  if (x > 9000) return
  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.18)"
  ctx.beginPath()
  ctx.ellipse(X + (x - X) * 0.4, Y, 20, 8, 0, 0, Math.PI * 2)
  ctx.fill()
  drawHelicopter(ctx, x, y, 1, t, spin)
}

// a little pink heart with how many visitors liked a building
const drawHeartTag = (ctx, x, y, n, z, mine) => {
  const k = 1 / Math.max(0.8, Math.min(z, 1.6))
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(k, k)
  heartPath(ctx, 0, 0, 9)
  ctx.fillStyle = mine ? "#ff3f7a" : "#ff7aa2"
  ctx.fill()
  ctx.strokeStyle = "#fff"
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.font = "bold 9px Arial, sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillStyle = "#fff"
  ctx.fillText(String(n), 0, 0)
  ctx.restore()
  ctx.lineWidth = 1
}

// someone visiting: a little round person with their name over their head
const SHIRTS = ["#ff7aa2", "#6fb4ff", "#ffb347", "#8bd17c", "#c58cff", "#ff8f6b"]
const drawVisitor = (ctx, p, t, z) => {
  const x = isoX(p.u, p.v)
  const y = isoY(p.u, p.v)
  const hop = Math.abs(Math.sin(t * 6 + p.u)) * (p.moving ? 3 : 0.8)
  let h = 0
  for (const c of p.name) h = (h * 31 + c.charCodeAt(0)) | 0
  ctx.fillStyle = "rgba(0,0,0,0.2)"
  ctx.beginPath()
  ctx.ellipse(x, y, 8, 3.5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = "rgba(52,36,24,0.6)"
  ctx.fillStyle = SHIRTS[Math.abs(h) % SHIRTS.length]
  ctx.beginPath()
  ctx.ellipse(x, y - 9 - hop, 6.5, 8, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#f6d0a8"
  ctx.beginPath()
  ctx.arc(x, y - 21 - hop, 5.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#3a2a1e"
  ctx.fillRect(x - 2.5, y - 22 - hop, 1.4, 1.6)
  ctx.fillRect(x + 1.2, y - 22 - hop, 1.4, 1.6)
  // the name tag
  const k = 1 / Math.max(0.8, Math.min(z, 1.6))
  ctx.save()
  ctx.translate(x, y - 34 - hop)
  ctx.scale(k, k)
  ctx.font = "bold 10px Arial, sans-serif"
  const w = ctx.measureText(p.name).width + 10
  ctx.fillStyle = "rgba(255,253,246,0.95)"
  ctx.strokeStyle = "rgba(52,36,24,0.6)"
  roundRect(ctx, -w / 2, -8, w, 15, 7)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#5a2a40"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(p.name, 0, 0)
  ctx.restore()
}

// the names on the welcome sign, written to fit the board
const drawWelcomeText = (ctx, o, names) => {
  const x = isoX(o.x + 0.5, o.y + 0.5)
  const y = isoY(o.x + 0.5, o.y + 0.5, WELCOME_BOARD.z)
  const lines = names?.b ? [names.a, `♥ ${names.b}`] : [names?.a ? `${names.a}'s` : "Welcome to", "Sunny Acres"]
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  lines.forEach((line, k) => {
    let size = 11
    ctx.font = `bold ${size}px Arial, sans-serif`
    const w = ctx.measureText(line).width
    if (w > WELCOME_BOARD.w - 8) size = Math.max(5, (size * (WELCOME_BOARD.w - 8)) / w)
    ctx.font = `bold ${size}px Arial, sans-serif`
    ctx.fillStyle = k ? "#d23f74" : "#5a3a2a"
    ctx.fillText(line, x, y - WELCOME_BOARD.h + 8 + k * 12)
  })
}

const drawObject = (ctx, o, s, now, t, bubbles, bars, fx = {}) => {
  const n = sizeOf(o.t)
  const kind = kindOf(o.t)
  if (o.t === "mailbox") return blit(ctx, buildingSprite(fx.mailFlag ? "mailboxUp" : "mailbox"), o.x, o.y, o.f)
  if (o.t === "welcome") {
    blit(ctx, buildingSprite("welcome"), o.x, o.y)
    return drawWelcomeText(ctx, o, fx.signNames)
  }
  if (o.b) {
    // still being built
    blit(ctx, buildingSprite(n === 2 ? "site2" : "site3"), o.x, o.y)
    const [x, y] = topOf(o)
    const total = (o.bt || 10) * 1000
    bars.push({ x, y: y + 6, f: Math.max(0, Math.min(1, 1 - (o.b - now) / total)) })
    return
  }
  if (kind === "field") {
    const stage = fieldStage(o, now)
    const sp = fieldSprite(o.c, stage)
    if (stage === 4) {
      // ripe crops sway a little
      const wx = isoX(o.x, o.y)
      const wy = isoY(o.x, o.y)
      ctx.drawImage(sp.canvas, wx - sp.ox + Math.sin(t * 2 + o.x + o.y) * 0.6, wy - sp.oy, sp.w, sp.h)
    } else blit(ctx, sp, o.x, o.y)
    return
  }
  if (kind === "pen") {
    blit(ctx, buildingSprite(o.t), o.x, o.y, o.f)
    const p = PENS[o.t]
    const spots = animalSpots(o, t)
    const order = spots.map((sp, k) => ({ ...sp, k })).sort((a, b) => a.u + a.v - (b.u + b.v))
    for (const a of order) {
      const v = o.a[a.k]
      const eating = v !== null && v > now
      const still = v === null || v <= now
      const u = still ? o.x + [0.9, 2.0, 1.4][a.k % 3] : a.u
      const vv = still ? o.y + [1.0, 1.4, 2.1][a.k % 3] : a.v
      drawAnimal(ctx, p.animal, isoX(u, vv), isoY(u, vv), 1, a.flip, t + a.k, eating)
    }
    blit(ctx, buildingSprite(o.t, "front"), o.x, o.y, o.f)
    const st = penState(o, now)
    const [x, y] = topOf(o)
    if (st.ready) bubbles.push({ x, y, icon: p.good, extra: st.ready > 1 ? `${st.ready}` : null })
    else if (st.hungry === o.a.length) bubbles.push({ x, y, icon: p.feed })
    return
  }
  blit(ctx, buildingSprite(o.t), o.x, o.y, o.f)
  if (kind === "factory") {
    const jobs = factoryJobs(o, now)
    const done = jobs.filter((j) => j.done)
    const run = jobs.find((j) => j.running)
    const [x, y] = topOf(o)
    if (done.length) bubbles.push({ x, y, icon: done[0].g, extra: done.length > 1 ? `${done.length}` : null })
    if (run) {
      const r = FACTORIES[o.t].recipes.find((r) => r.id === run.g)
      const d = (s.tut < 4 && run.g === "cowfeed" ? 5 : r.time) * 1000
      bars.push({ x, y: y + 8, f: Math.max(0, Math.min(1, 1 - (run.e - now) / d)) })
    }
  }
  if (o.t === "station" && s.level < 5) {
    const [x, y] = topOf(o)
    bubbles.push({ x, y, icon: "lock" })
  }
}

const drawGhost = (ctx, s, g) => {
  const n = sizeOf(g.type)
  const ok = canPlace(s, g.type, g.x, g.y, g.id)
  ctx.fillStyle = ok ? "rgba(90,220,90,0.45)" : "rgba(240,70,60,0.45)"
  ctx.strokeStyle = ok ? "#2f9a3a" : "#c0302a"
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(isoX(g.x, g.y), isoY(g.x, g.y))
  ctx.lineTo(isoX(g.x + n, g.y), isoY(g.x + n, g.y))
  ctx.lineTo(isoX(g.x + n, g.y + n), isoY(g.x + n, g.y + n))
  ctx.lineTo(isoX(g.x, g.y + n), isoY(g.x, g.y + n))
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.lineWidth = 1
  if (g.type === "field") blit(ctx, fieldSprite(null, 0), g.x, g.y, false, 0.8)
  else {
    blit(ctx, buildingSprite(g.type), g.x, g.y, g.flip, 0.82)
    blit(ctx, buildingSprite(g.type, "front"), g.x, g.y, g.flip, 0.82)
  }
}

// smoke puffs from busy factories (called a few times a second)
export const emitSmoke = (s, fx, now) => {
  for (const o of s.objs) {
    const b = BUILDINGS[o.t]
    if (!b?.chimney || o.b || !o.q?.length || o.q[0].e <= now) continue
    const [u, v, z] = b.chimney
    let x = isoX(o.x + u, o.y + v)
    if (o.f) x = 2 * isoX(o.x, o.y) - x
    fx.puffs.push({ x, y: isoY(o.x + u, o.y + v, z), t0: fx.t })
  }
}

