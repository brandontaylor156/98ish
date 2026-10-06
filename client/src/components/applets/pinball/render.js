// Draws Blue Screen each frame into a 280 x 500 pixel buffer: the base layer from art.js,
// then lit lamps (palette-swapped sprites), bumpers, keycap targets, the spinner, the
// flippers (rasterized pixel by pixel, no anti-aliasing), the plunger, the balls (with a
// shadow and two marks that roll with them), the taskbar apron, the ramp's plastic, balls
// riding the ramp, and score popups. The canvas is the buffer's size; CSS scales it up with
// nearest-neighbour pixels (image-rendering: pixelated), at a whole number of device pixels
// when that still fills the space.

import { flipperTip } from "./physics.js"
import { BUMPERS, LANE, MONITOR, SPINNER, TARGETS, rampHeight } from "./table.js"
import { currentMission } from "./game.js"
import { H, K, W, buildArt, ICONS } from "./art.js"
import { C, FONTS, blit, blitRaw, line, pset, rampAt, rect, shape, text } from "./pixel.js"

const p = (u) => u * K
const LIGHT = [-0.6, -0.8]

// how lit a recently hit thing still is (1 just hit, fading to 0)
const recent = (g, name, seconds = 0.25) => {
  const t = g.flash[name]
  if (t === undefined) return 0
  const age = g.time - t
  return age < 0 || age > seconds ? 0 : 1 - age / seconds
}
const blink = (now, hz = 3) => Math.floor(now * hz * 2) % 2 === 0

// Which lamps are lit right now
export const lampStates = (g, now) => {
  const on = {}
  if (g.mode === "attract" || g.mode === "over") {
    // the attract show: a chase up the table and a sweep across it
    return (l, i) => {
      const k = Math.floor(now * 9) % 12
      const band = Math.floor(((l.y0 ?? 0) / H) * 12)
      return (11 - band + k) % 12 < 2 || (Math.floor(now * 2) % 6 === 0 && blink(now, 4)) || (i * 7 + Math.floor(now * 3)) % 23 === 0
    }
  }
  const m = currentMission(g)
  const shot = (s) => m.shot === s && blink(now, 2.5)
  g.lanes.forEach((lit, i) => (on["lane" + i] = lit || recent(g, "lane" + i, 0.4) > 0 || (g.skillLane === i && blink(now, 6)) || (m.shot === "lanes" && !lit && blink(now, 1.5))))
  g.targets.forEach((down, i) => (on["target" + i] = down || recent(g, "bank", 1.2) > 0))
  on.bankArrow = shot("bank") || (!g.lockLit && !g.multiball && g.targets.some(Boolean) && blink(now, 1.5))
  for (let i = 0; i < 3; i++) on["lock" + i] = g.multiball ? blink(now, 4) : i < g.locks || (g.lockLit && i === g.locks && blink(now, 3))
  on.lockArrow = g.lockLit ? blink(now, 4) : g.multiball ? blink(now, 2) : shot("scoop")
  on.rampArrow = g.multiball ? blink(now, 4) : shot("ramp") || recent(g, "ramp", 0.6) > 0
  on.jackpot = g.multiball && blink(now, 3)
  on.orbitL = shot("orbits") || shot("orbitL") || recent(g, "orbit0", 0.4) > 0
  on.orbitR = shot("orbits") || recent(g, "orbit1", 0.4) > 0
  on.spinner = recent(g, "spinner", 0.12) > 0 || shot("orbitL")
  on.floppyArrow = g.extraLit ? blink(now, 4) : shot("floppy")
  on.extraBall = g.extraLit
  on.driveArrow = shot("drive")
  on.drive = recent(g, "drive", 0.8) > 0
  for (let i = 0; i < 2; i++) {
    on["inlane" + i] = recent(g, "inlane" + i, 0.6) > 0
    on["outlane" + i] = recent(g, "outlane" + i, 0.8) > 0
  }
  on.kickback = g.kickback && !g.tilted ? true : recent(g, "kickback", 1) > 0 && blink(now, 6)
  for (const n of [2, 3, 4, 5, 6]) on["bonus" + n] = g.bonusX >= n
  const saveLeft = g.ballSaveUntil - g.time
  on.save = !g.tilted && (g.ballSavePending || saveLeft > 0) && (saveLeft > 2 || g.ballSavePending || blink(now, 5))
  on.shootAgain = g.extraBalls > 0
  for (let i = 0; i < 8; i++) on["rank" + i] = i < g.rank + 1 && (i < g.rank || g.rank >= 7 || blink(now, 1))
  if (recent(g, "mission", 1.5) > 0) for (let i = 0; i < 8; i++) on["rank" + i] = blink(now, 6)
  return (l) => !!on[l.id]
}

// ---- dynamic shapes ----
export const drawFlipper = (s, f) => {
  const x = p(f.x)
  const y = p(f.y)
  const len = p(f.length)
  const r0 = p(f.r0)
  const r1 = p(f.r1)
  const tip = flipperTip(f)
  const cos = Math.cos(f.angle)
  const sin = Math.sin(f.angle)
  const ramp = [C.g4, C.g6, C.g7, C.white]
  shape(s, Math.min(x, p(tip.x)) - r0 - 1, Math.min(y, p(tip.y)) - r0 - 1, Math.max(x, p(tip.x)) + r0 + 1, Math.max(y, p(tip.y)) + r0 + 1, (px, py) => {
    const qx = px + 0.5 - x
    const qy = py + 0.5 - y
    const t = Math.max(0, Math.min(1, (qx * cos + qy * sin) / len))
    const nx = qx - cos * len * t
    const ny = qy - sin * len * t
    const d = Math.hypot(nx, ny)
    const rr = r0 + (r1 - r0) * t
    if (d > rr) return 0
    if (d > rr - 1) return C.ink
    if (d > rr - 2) return C.red // the rubber ring
    const lit = 0.55 - 0.45 * ((nx * LIGHT[0] + ny * LIGHT[1]) / (d || 1)) * -1
    return rampAt(ramp, lit, px, py)
  })
  pset(s, Math.floor(x), Math.floor(y), C.g3)
  pset(s, Math.floor(x) + 1, Math.floor(y), C.g2)
}

export const drawPlunger = (s, g) => {
  const pl = g.world.plunger
  const cx = Math.round(p((LANE.left + LANE.right) / 2))
  const top = Math.round(p(pl.y))
  const bottom = H - 1
  // the spring
  for (let yy = top + 5; yy < bottom; yy += 2) {
    const w = 5
    line(s, cx - w, yy, cx + w, yy + 1, (yy >> 1) & 1 ? C.g5 : C.g4)
  }
  rect(s, cx - 1, top + 4, 3, bottom - top, C.g6)
  rect(s, cx - 1, top + 4, 1, bottom - top, C.white)
  // the knob
  rect(s, cx - 7, top, 15, 5, C.red)
  rect(s, cx - 7, top, 15, 1, C.red3)
  rect(s, cx - 7, top + 4, 15, 1, C.red0)
  pset(s, cx - 7, top, C.ink)
  pset(s, cx + 7, top, C.ink)
  // the pull meter on the cabinet beside the lane
  if (g.pull > 0) {
    const hgt = Math.round(70 * g.pull)
    for (let i = 0; i < hgt; i++) rect(s, W - 6, H - 30 - i, 4, 1, i > 52 ? C.red3 : i > 30 ? C.amber : C.lime)
  }
}

const drawSpinner = (s, sp, hit) => {
  const y = Math.round(p(SPINNER.ay))
  const x0 = Math.round(p(SPINNER.ax)) + 2
  const x1 = Math.round(p(SPINNER.bx)) - 2
  line(s, x0 - 2, y, x1 + 2, y, C.g5) // the wire
  const c = Math.cos(sp.angle)
  const h = Math.max(1, Math.round(Math.abs(c) * 6))
  const front = c >= 0
  const top = y - (h >> 1)
  rect(s, x0, top, x1 - x0 + 1, h, front ? (hit ? C.yellow : C.amber) : C.g6)
  rect(s, x0, top, x1 - x0 + 1, 1, front ? C.cream : C.white)
  rect(s, x0, top + h - 1, x1 - x0 + 1, 1, C.ink)
  rect(s, x0, top, 1, h, C.ink)
  rect(s, x1, top, 1, h, C.ink)
  if (front && h >= 5) blit(s, ICONS.hourglass, (x0 + x1) / 2 - 2, y - 2)
}

export const drawBallAt = (s, spr, x, y, marks, shadow) => {
  const r = spr.w / 2
  const ix = Math.round(x - r)
  const iy = Math.round(y - r)
  // a dithered shadow down and to the right
  if (shadow) {
    for (let j = 0; j < spr.h; j++) for (let i = 0; i < spr.w; i++) if (spr.raw[j * spr.w + i] && ((i + j + ix + iy) & 1) === 0) pset(s, ix + i + shadow, iy + j + shadow + 1, C.ink)
  }
  blitRaw(s, spr, ix, iy)
  if (marks) {
    for (const m of marks) {
      if (m[2] < 0.25) continue
      const mx = Math.round(x - 0.5 + m[0] * r * 0.62)
      const my = Math.round(y - 0.5 + m[1] * r * 0.62)
      pset(s, mx, my, m[2] > 0.7 ? C.g2 : C.g3)
    }
  }
}

// rotate a point on the ball about axis (ax, ay, 0) by angle
export const roll = (m, ax, ay, ang) => {
  const c = Math.cos(ang)
  const sn = Math.sin(ang)
  const [x, y, z] = m
  const dot = ax * x + ay * y
  // Rodrigues: v c + (k x v) s + k (k.v)(1 - c), k = (ax, ay, 0)
  const kx = ay * z
  const ky = -ax * z
  const kz = ax * y - ay * x
  m[0] = x * c + kx * sn + ax * dot * (1 - c)
  m[1] = y * c + ky * sn + ay * dot * (1 - c)
  m[2] = z * c + kz * sn
}

// The frame drawer (no DOM: Node's tests and screenshots use it too): draw(fb, g, now)
// paints game g into the pixel surface fb with the art from buildArt()
export const createDrawer = (art = buildArt()) => {
  const spin = new WeakMap() // ball -> { marks, x, y }

  const rolling = (b) => {
    let st = spin.get(b)
    if (!st) {
      st = { marks: [[0.6, 0, 0.8], [-0.6, 0, -0.8], [0, 0.7, 0.71]], x: b.x, y: b.y }
      spin.set(b, st)
    }
    const dx = b.x - st.x
    const dy = b.y - st.y
    const d = Math.hypot(dx, dy)
    if (d > 0.01 && d < 200) {
      // rolling without slipping: the axis is z x direction, the angle distance / radius
      const ax = -dy / d
      const ay = dx / d
      for (const m of st.marks) roll(m, ax, ay, d / 11)
    }
    st.x = b.x
    st.y = b.y
    return st.marks
  }

  const draw = (fb, g, now) => {
    fb.buf.set(art.base.buf)
    const lit = lampStates(g, now)
    art.lamps.forEach((l, i) => {
      if (lit(l, i)) blitRaw(fb, l.on, l.x0, l.y0)
    })

    // the Blue Screen's monitor shows what's going on
    const mx = Math.round(p((MONITOR.x0 + MONITOR.x1) / 2))
    const my = Math.round(p(MONITOR.y0)) + 11
    const live = g.mode === "play"
    if (live && g.scoopBall && blink(now, 4)) text(fb, "ERROR", mx + 0.5, my, C.white, { font: FONTS.small, align: "center" })
    else if (live && g.multiball) text(fb, "UPDATE", mx + 0.5, my, blink(now, 3) ? C.yellow : C.white, { font: FONTS.small, align: "center" })
    else if (live && g.lockLit) text(fb, "LOCK", mx + 0.5, my, blink(now, 3) ? C.white : C.cyan, { font: FONTS.small, align: "center" })

    // bumpers
    BUMPERS.forEach((b, i) => {
      const spr = art.bumper[recent(g, "bumper" + i, 0.16) > 0 || (g.mode !== "play" && blink(now + i * 0.3, 1)) ? 1 : 0]
      blitRaw(fb, spr, Math.round(p(b.x) - spr.w / 2), Math.round(p(b.y) - spr.h / 2))
    })

    // keycap drop targets (gone when down)
    TARGETS.forEach((t, i) => {
      if (g.targets[i]) return
      const spr = art.keycaps[i][recent(g, "target" + i, 0.2) > 0 ? 1 : 0]
      blitRaw(fb, spr, Math.round(p(t.x) - spr.w / 2), Math.round(p(t.y) - spr.h + 2))
    })

    for (const sp of g.world.spinners) drawSpinner(fb, sp, recent(g, "spinner", 0.1) > 0)
    drawPlunger(fb, g)
    for (const f of g.world.flippers) drawFlipper(fb, f)

    // balls on the playfield (and the captive Hard Drive ball)
    const up = []
    for (const b of g.world.balls) {
      if (b.layer === 1) {
        up.push(b)
        continue
      }
      drawBallAt(fb, art.ball, p(b.x), p(b.y), rolling(b), b.held ? 0 : 1)
    }

    blitRaw(fb, art.apron, art.apron.x, art.apron.y)
    // the tray clock: which ball this is
    if (live) text(fb, `BALL ${g.ballNumber}`, 222, 475, C.ink, { font: FONTS.small, align: "center" })
    else text(fb, g.mode === "over" ? "GAME OVER" : "INSERT", 222, 475, C.ink, { font: FONTS.small, align: "center" })

    blitRaw(fb, art.ramp, art.ramp.x, art.ramp.y)
    // balls on the ramp: bigger (nearer the glass), with a shadow that grows with height
    for (const b of up) {
      const hgt = rampHeight(b.x, b.y)
      drawBallAt(fb, hgt > 0.35 ? art.ballBig : art.ball, p(b.x), p(b.y) - hgt * 3, rolling(b), 1 + Math.round(hgt * 3))
    }

    // score popups: pixel text rising and blinking out
    for (const pop of g.popups) {
      const age = g.time - pop.t
      if (age > 0.8 && blink(now, 8)) continue
      text(fb, pop.text, p(pop.x), p(pop.y) - 10 - age * 14, C.yellow, { font: FONTS.small, align: "center", outline: C.ink })
    }
    if (g.tilted && blink(now, 2)) text(fb, "TILT", W / 2, H / 2 - 20, C.red3, { scale: 3, align: "center", outline: C.ink })

  }
  return { draw, art }
}

export const createRenderer = (canvas) => {
  // the 280 x 500 picture; shown 1:1 in the canvas when CSS can scale it by whole device
  // pixels, else blown up n times here (nearest neighbour) and eased the last bit by CSS
  const low = document.createElement("canvas")
  low.width = W
  low.height = H
  const lctx = low.getContext("2d", { alpha: false })
  const img = lctx.createImageData(W, H)
  let ctx = canvas.getContext("2d", { alpha: false })
  let n = 1
  const fb = { w: W, h: H, buf: new Uint32Array(img.data.buffer) }
  const drawer = createDrawer()
  const art = drawer.art
  const draw = (g, now) => {
    drawer.draw(fb, g, now)
    present()
  }

  const present = () => {
    if (n === 1) ctx.putImageData(img, 0, 0)
    else {
      lctx.putImageData(img, 0, 0)
      ctx.drawImage(low, 0, 0, W * n, H * n)
    }
  }

  // fit into cssW x cssH CSS pixels -> the layout for the canvas's CSS box
  const resize = (cssW, cssH, dpr = 1) => {
    const fit = fitTable(cssW, cssH, dpr)
    // below 2 device pixels per table pixel, draw at 2x and let the browser shrink it a
    // little (sharper than stretching 1x); above, the largest whole multiple that fits
    const v = fit.scale * dpr
    n = fit.whole ? 1 : v < 2 ? 2 : Math.floor(v)
    canvas.width = W * n
    canvas.height = H * n
    ctx = canvas.getContext("2d", { alpha: false })
    ctx.imageSmoothingEnabled = false
    return { ...fit, smooth: !fit.whole, prescale: n }
  }

  // the screen shake (whole table pixels), none with Reduce Motion
  const shakeOffset = (g, reduced) => {
    if (reduced) return [0, 0]
    const age = g.time - g.shake.t
    if (age < 0 || age > 0.25) return [0, 0]
    const k = 1 - age / 0.25
    const wob = Math.cos(age * 60)
    return [Math.round(g.shake.x * k * wob * 0.5), Math.round(g.shake.y * k * wob * 0.5)]
  }

  return { draw, resize, shakeOffset, width: W, height: H, art, fb }
}

// Fit the W x H picture into an area of cssW x cssH CSS pixels: a whole number of device
// pixels per table pixel when that fills at least 88% of the space, else the largest
// fractional fit (still nearest-neighbour)
export const fitTable = (cssW, cssH, dpr = 1) => {
  const fit = Math.min(cssW / W, cssH / H)
  const whole = Math.floor(fit * dpr) / dpr
  const scale = whole >= fit * 0.88 && whole > 0 ? whole : fit
  const w = W * scale
  const h = H * scale
  return { scale, width: w, height: h, left: Math.floor((cssW - w) / 2), top: Math.floor((cssH - h) / 2), whole: scale === whole }
}
