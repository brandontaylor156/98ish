// Draws Critter Catch Pinball each frame into a 280 x 500 pixel buffer: the table's base
// layer (art.js), lit lamps, the screen in the middle (a green handheld LCD showing the
// area, the mystery critter being revealed, the critter to evolve), bumpers, E-V-O
// targets, the spinner, Sparkit at its outlane, the critter out to be caught, flippers,
// plunger, balls tinted by their upgrade, the apron, the ramp's plastic and score popups.
// Bonus stages draw their own floor, the Mudpups, the boss and its claws.
// createDrawer() is DOM-free (Node's tests draw frames with it); createRenderer() puts the
// buffer on a canvas (the same fit as Blue Screen).


import { drawBallAt, drawFlipper, drawPlunger, fitTable, roll } from "../pinball/render.js"
import { C, FONTS, RGB, blit, blitRaw, line, pset, rect, text } from "../pinball/pixel.js"
import { AREAS, BY_ID, CRITTERS } from "./critters.js"
import { CATCH_TIME, CHOOSE_TIME, EVOLVE_TIME, SAVER_SPINS, multiplier } from "./game.js"
import { BOSS, MOLE_HOLES, OUTLANES, rampHeightOf } from "./layout.js"
import { H, K, MUDPUP, W, buildArt, buildBonusArt, screenRect } from "./art.js"
import { critterSprite, silhouette, flashed } from "./sprites.js"

const p = (u) => u * K

const recent = (g, name, seconds = 0.25) => {
  const t = g.flash[name]
  if (t === undefined) return 0
  const age = g.time - t
  return age < 0 || age > seconds ? 0 : 1 - age / seconds
}
const blink = (now, hz = 3) => Math.floor(now * hz * 2) % 2 === 0

// ---- the handheld LCD's four greens: any sprite can be shown in them ----
const GB = [C.gb0, C.gb1, C.gb2, C.gb3]
const GB_LUT = RGB.map(([r, g, b], i) => {
  if (i === 0) return -1
  const l = (0.3 * r + 0.59 * g + 0.11 * b) / 255
  return GB[Math.min(3, Math.floor(l * 3.4 + 0.15))]
})
const gbCache = new WeakMap()
const inGreens = (spr) => {
  let out = gbCache.get(spr)
  if (!out) {
    out = { w: spr.w, h: spr.h, data: spr.data.map((c) => (c < 0 ? -1 : c === C.ink ? C.gb0 : GB_LUT[c])) }
    gbCache.set(spr, out)
  }
  return out
}
const silCache = new WeakMap()
const shadowOf = (spr) => {
  let out = silCache.get(spr)
  if (!out) {
    out = silhouette(spr, C.gb0)
    silCache.set(spr, out)
  }
  return out
}
const flashCache = new WeakMap()
const whiteOf = (spr) => {
  let out = flashCache.get(spr)
  if (!out) {
    out = flashed(spr)
    flashCache.set(spr, out)
  }
  return out
}

// Which lamps are lit right now
export const lampStates = (g, now) => {
  if (g.mode === "attract" || g.mode === "over") {
    return (l, i) => {
      const k = Math.floor(now * 9) % 12
      const band = Math.floor(((l.y0 ?? 0) / H) * 12)
      return (11 - band + k) % 12 < 2 || (Math.floor(now * 2) % 6 === 0 && blink(now, 4)) || (i * 7 + Math.floor(now * 3)) % 23 === 0
    }
  }
  const on = {}
  const a = g.active
  const spots = a?.kind === "evolve" && a.phase === "collect" ? a.spots : []
  const spot = (name) => spots.includes(name) && blink(now, 4)
  g.lanes.forEach((lit, i) => (on["lane" + i] = lit || recent(g, "lane" + i, 0.4) > 0 || (g.skillLane === i && blink(now, 6))))
  for (let i = 0; i < 5; i++) on["letter" + i] = g.catchLit ? blink(now, 3) : a?.kind === "catch" ? false : i < g.letters || (i === g.letters && blink(now, 1))
  g.targets.forEach((down, i) => (on["target" + i] = down || recent(g, "bank", 1.2) > 0 || spot("targets")))
  on.evoArrow = spot("targets") || (!g.evoLit && g.targets.some(Boolean) && blink(now, 1.5))
  const ready = a?.kind === "evolve" && a.phase === "ready"
  on.denArrow = ready ? blink(now, 6) : !a && (g.catchLit || g.evoLit) ? blink(now, 3) : recent(g, "den", 0.6) > 0
  on.denCatch = a?.kind === "catch" || (!a && g.catchLit && blink(now, 3))
  on.denEvo = ready ? blink(now, 6) : a?.kind === "evolve" || (!a && !g.catchLit && g.evoLit && blink(now, 3))
  on.caveArrow = spot("cave") || ((g.bonusLit || g.mapLit) && !a && blink(now, 3)) || recent(g, "cave", 0.6) > 0
  on.caveMap = g.mapLit && (blink(now, 2) || a?.kind === "catch")
  on.caveBonus = g.bonusLit && blink(now, 4)
  on.rampArrow = spot("ramp") || recent(g, "ramp", 0.6) > 0 || (!g.catchLit && !a && blink(now, 1))
  on.orbitL = spot("orbitL") || recent(g, "orbit0", 0.4) > 0
  on.orbitR = spot("orbitR") || recent(g, "orbit1", 0.4) > 0
  const full = g.saver.charge >= SAVER_SPINS
  for (let i = 0; i < 4; i++) on["charge" + i] = full ? blink(now, 3) : g.saver.charge >= ((i + 1) * SAVER_SPINS) / 4
  for (let i = 0; i < 4; i++) on["level" + i] = i < g.ballLevel || (i === g.ballLevel && (g.ballLevel === 0 || g.levelUntil - g.time > 10 || blink(now, 3)))
  const saveLeft = g.ballSaveUntil - g.time
  on.save = !g.tilted && (g.ballSavePending || saveLeft > 0) && (saveLeft > 2 || g.ballSavePending || blink(now, 5))
  on.extra = g.extraBalls > 0 || recent(g, "extraBall", 2) > 0
  for (let i = 0; i < 2; i++) {
    on["inlane" + i] = recent(g, "inlane" + i, 0.6) > 0
    on["outlane" + i] = recent(g, "outlane" + i, 0.8) > 0
  }
  return (l) => !!on[l.id]
}

// ---- the LCD screen ----
const lcdText = (fb, str, x, y, c = C.gb0, align = "center") => text(fb, str, x, y, c, { font: FONTS.small, align })

// a little picture of each area, in the four greens
const drawScene = (fb, sc, areaId, now) => {
  const { x, y, w, h } = sc
  const ground = y + h - 12
  const hill = (cx, r, c) => {
    for (let i = -r; i <= r; i++) {
      const top = Math.round(ground - Math.sqrt(Math.max(0, r * r - i * i)) * 0.5)
      rect(fb, x + cx + i, top, 1, ground - top, c)
    }
  }
  const tri = (cx, top, half, c) => {
    for (let j = 0; j < ground - top; j++) {
      const hw = Math.round((j / (ground - top)) * half)
      rect(fb, x + cx - hw, top + j, hw * 2 + 1, 1, c)
    }
  }
  const sea = areaId === "beach" || areaId === "lagoon" || areaId === "reef" || areaId === "glacier"
  switch (areaId) {
    case "meadow":
      hill(18, 20, C.gb2)
      hill(52, 16, C.gb2)
      for (let i = 0; i < 7; i++) pset(fb, x + 6 + i * 9, ground - 2 - (i % 2), C.gb0)
      break
    case "forest":
      for (const [cx, t] of [[10, 18], [24, 12], [40, 16], [56, 10]]) tri(cx, y + t, 7, C.gb1)
      break
    case "canyon":
      rect(fb, x + 4, y + 22, 18, ground - y - 22, C.gb1)
      rect(fb, x + 46, y + 16, 20, ground - y - 16, C.gb1)
      break
    case "volcano":
      tri(35, y + 14, 26, C.gb1)
      rect(fb, x + 32, y + 13, 6, 2, C.gb3)
      for (let i = 0; i < 4; i++) pset(fb, x + 34 + Math.round(Math.sin(now * 3 + i) * 2), y + 10 - i * 2, C.gb1)
      break
    case "ruins":
      for (const cx of [12, 26, 44, 58]) rect(fb, x + cx - 2, y + 18 + (cx % 3) * 3, 5, ground - y - 18 - (cx % 3) * 3, C.gb1)
      rect(fb, x + 8, y + 16, 22, 3, C.gb1)
      break
    case "summit":
      tri(22, y + 8, 18, C.gb1)
      tri(50, y + 14, 16, C.gb2)
      rect(fb, x + 20, y + 8, 5, 3, C.gb3)
      break
    case "seacave":
      rect(fb, x, y, w, h - 10, C.gb1)
      for (let i = 0; i < w; i++) {
        const top = Math.round(y + 14 + Math.abs(i - w / 2) * 0.35)
        rect(fb, x + i, top, 1, Math.max(0, ground - top - 6), C.gb2)
      }
      break
    case "abyss":
      rect(fb, x, y, w, h - 10, C.gb0)
      for (let i = 0; i < 6; i++) pset(fb, x + 8 + i * 10, y + ((Math.round(now * 12) + i * 9) % (h - 14)), C.gb2)
      break
    default:
  }
  if (sea) {
    for (let i = 0; i < w; i++) {
      const wy = Math.round(ground - 4 + Math.sin(i * 0.4 + now * 3) * 1.5)
      rect(fb, x + i, wy, 1, ground - wy, C.gb2)
    }
    if (areaId === "beach") {
      rect(fb, x + 54, y + 16, 2, ground - y - 20, C.gb1)
      for (const dx of [-5, -3, 3, 5]) pset(fb, x + 55 + dx, y + 16 + Math.abs(dx) / 2, C.gb1)
    }
    if (areaId === "glacier") tri(18, y + 18, 10, C.gb3)
    if (areaId === "reef") for (const cx of [14, 30, 50]) rect(fb, x + cx, ground - 9, 2, 6, C.gb1)
  }
  rect(fb, x, ground, w, 1, C.gb1)
}

const timerBar = (fb, sc, left, total) => {
  const w = Math.max(0, Math.round((sc.w - 6) * Math.min(1, left / total)))
  rect(fb, sc.x + 3, sc.y + sc.h - 4, sc.w - 6, 2, C.gb2)
  rect(fb, sc.x + 3, sc.y + sc.h - 4, w, 2, C.gb0)
}

const drawScreen = (fb, g, now, art) => {
  const sc = screenRect(g.T)
  const a = g.active
  const areas = AREAS[g.table]
  if (g.mode !== "play") {
    // the attract screen: critters parade past
    const shown = CRITTERS.filter((c) => c.table === g.table)
    const c = shown[Math.floor(now / 1.6) % shown.length]
    const spr = critterSprite(c)
    const known = g.dex.caught[c.id]
    blit(fb, known ? inGreens(spr) : shadowOf(spr), sc.cx - 16, sc.y + 2)
    lcdText(fb, known ? c.name.toUpperCase() : "???", sc.cx + 0.5, sc.y + sc.h - 18)
    lcdText(fb, "CRITTER CATCH", sc.cx + 0.5, sc.y + sc.h - 10, blink(now, 1) ? C.gb0 : C.gb1)
    return
  }
  if (a?.kind === "catch") {
    const c = BY_ID[a.id]
    const spr = critterSprite(c)
    const sx = sc.cx - 16
    const sy = sc.y + 6
    if (a.phase === "reveal") {
      // a plain screen, so the shape is easy to read
      rect(fb, sc.x, sc.y + sc.h - 12, sc.w, 1, C.gb1)
      blit(fb, shadowOf(spr), sx, sy)
      // the hidden tiles (3 across, 2 down)
      a.tiles.forEach((open, i) => {
        if (open) return
        const tx = sx + (i % 3) * 11 - 1
        const ty = sy + Math.floor(i / 3) * 16
        rect(fb, tx, ty, 11, 16, C.gb1)
        rect(fb, tx, ty, 11, 1, C.gb2)
        lcdText(fb, "?", tx + 6, ty + 6, C.gb3)
      })
      lcdText(fb, "BUMPERS!", sc.cx + 0.5, sc.y + 1, blink(now, 2) ? C.gb0 : C.gb1)
    } else {
      drawScene(fb, sc, g.area, now)
      lcdText(fb, c.name.toUpperCase(), sc.cx + 0.5, sc.y + 1)
      for (let i = 0; i < a.need; i++) {
        const px = sc.cx - (a.need * 6) / 2 + i * 6 + 1
        rect(fb, px, sc.y + sc.h - 10, 4, 4, i < a.hits ? C.gb0 : C.gb2)
      }
    }
    timerBar(fb, sc, a.until - g.time, CATCH_TIME)
    return
  }
  if (a?.kind === "evolve") {
    const id = a.phase === "choose" ? a.options[a.pick] : a.id
    const c = BY_ID[id]
    const spr = critterSprite(c)
    blit(fb, inGreens(spr), sc.cx - 16, sc.y + 7)
    if (a.phase === "choose") {
      lcdText(fb, "EVOLVE WHO?", sc.cx + 0.5, sc.y + 1)
      if (a.options.length > 1) {
        lcdText(fb, "<", sc.x + 5, sc.y + 22, blink(now, 3) ? C.gb0 : C.gb1)
        lcdText(fb, ">", sc.x + sc.w - 5, sc.y + 22, blink(now, 3) ? C.gb0 : C.gb1)
      }
      lcdText(fb, c.name.toUpperCase(), sc.cx + 0.5, sc.y + sc.h - 12)
      timerBar(fb, sc, a.until - g.time, CHOOSE_TIME)
    } else if (a.phase === "collect") {
      lcdText(fb, `ITEMS ${a.got}/3`, sc.cx + 0.5, sc.y + 1)
      lcdText(fb, c.name.toUpperCase(), sc.cx + 0.5, sc.y + sc.h - 12)
      timerBar(fb, sc, a.until - g.time, EVOLVE_TIME)
    } else {
      lcdText(fb, "TO THE DEN!", sc.cx + 0.5, sc.y + 1, blink(now, 4) ? C.gb0 : C.gb2)
      lcdText(fb, c.name.toUpperCase(), sc.cx + 0.5, sc.y + sc.h - 12)
      timerBar(fb, sc, a.until - g.time, EVOLVE_TIME)
    }
    return
  }
  // nothing running: the area, and what's next
  drawScene(fb, sc, g.area, now)
  const name = (areas.find((ar) => ar.id === g.area)?.name || "").toUpperCase()
  lcdText(fb, name, sc.cx + 0.5, sc.y + 2)
  const hint = g.catchLit ? "CATCH: DEN" : g.evoLit ? "EVOLVE: DEN" : g.bonusLit ? "BONUS: CAVE" : g.mapLit ? "MAP: CAVE" : `CATCH ${g.letters}/5`
  lcdText(fb, hint, sc.cx + 0.5, sc.y + sc.h - 9, (g.catchLit || g.evoLit || g.bonusLit || g.mapLit) && blink(now, 2) ? C.gb1 : C.gb0)

}

// ---- dynamic pieces ----
const drawSpinner = (s, sp, S, hit) => {
  const y = Math.round(p(S.ay))
  const x0 = Math.round(p(S.ax)) + 2
  const x1 = Math.round(p(S.bx)) - 2
  line(s, x0 - 2, y, x1 + 2, y, C.g5)
  const c = Math.cos(sp.angle)
  const h = Math.max(1, Math.round(Math.abs(c) * 6))
  const front = c >= 0
  const top = y - (h >> 1)
  rect(s, x0, top, x1 - x0 + 1, h, front ? (hit ? C.cream : C.yellow) : C.g6)
  rect(s, x0, top, x1 - x0 + 1, 1, front ? C.white : C.white)
  rect(s, x0, top + h - 1, x1 - x0 + 1, 1, C.ink)
  rect(s, x0, top, 1, h, C.ink)
  rect(s, x1, top, 1, h, C.ink)
  // a lightning bolt on the plate
  if (front && h >= 5) {
    const cx = Math.round((x0 + x1) / 2)
    pset(s, cx, y - 2, C.ink)
    pset(s, cx - 1, y - 1, C.ink)
    pset(s, cx, y - 1, C.ink)
    pset(s, cx, y, C.ink)
    pset(s, cx + 1, y, C.ink)
    pset(s, cx, y + 1, C.ink)
  }
}

// a sprite at twice the size (the bosses); door 1/2 draws every other pixel (faded)
const blit2x = (fb, spr, x, y, door = 0) => {
  x = Math.round(x)
  y = Math.round(y)
  for (let j = 0; j < spr.h; j++)
    for (let i = 0; i < spr.w; i++) {
      const c = spr.data[j * spr.w + i]
      if (c < 0 || (door && ((i + j + door) & 1))) continue
      rect(fb, x + i * 2, y + j * 2, 2, 2, c)
    }
}

// sparkles round a point (a catch, an evolution)
const sparkle = (fb, cx, cy, t, n = 10, r0 = 10) => {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + t * 2
    const r = r0 + t * 30
    const x = Math.round(cx + Math.cos(a) * r)
    const y = Math.round(cy + Math.sin(a) * r)
    const c = i % 2 ? C.yellow : C.white
    pset(fb, x, y, c)
    pset(fb, x - 1, y, c)
    pset(fb, x + 1, y, c)
    pset(fb, x, y - 1, c)
    pset(fb, x, y + 1, c)
  }
}

export const createDrawer = (getArt) => {
  const arts = new Map()
  const artFor = (key, make) => {
    if (!arts.has(key)) arts.set(key, make())
    return arts.get(key)
  }
  const spin = new WeakMap()
  const rolling = (b) => {
    let st = spin.get(b)
    if (!st) {
      st = {
        marks: [
          [0.6, 0, 0.8],
          [-0.6, 0, -0.8],
          [0, 0.7, 0.71],
        ],
        x: b.x,
        y: b.y,
      }
      spin.set(b, st)
    }
    const dx = b.x - st.x
    const dy = b.y - st.y
    const d = Math.hypot(dx, dy)
    if (d > 0.01 && d < 200) {
      const ax = -dy / d
      const ay = dx / d
      for (const m of st.marks) roll(m, ax, ay, d / 11)
    }
    st.x = b.x
    st.y = b.y
    return st.marks
  }

  const drawMain = (fb, g, now) => {
    const art = artFor(g.table, () => (getArt ? getArt(g.T) : buildArt(g.T)))
    fb.buf.set(art.base.buf)
    const lit = lampStates(g, now)
    art.lamps.forEach((l, i) => {
      if (lit(l, i)) blitRaw(fb, l.on, l.x0, l.y0)
    })
    drawScreen(fb, g, now, art)

    const a = g.active
    const live = g.mode === "play"
    const bumperSpot = a?.kind === "evolve" && a.phase === "collect" && a.spots.includes("bumpers") && blink(now, 4)
    const revealing = a?.kind === "catch" && a.phase === "reveal" && blink(now, 2)
    g.T.bumpers.forEach((b, i) => {
      const spr = art.bumpers[i][recent(g, "bumper" + i, 0.16) > 0 || bumperSpot || revealing || (!live && blink(now + i * 0.3, 1)) ? 1 : 0]
      blitRaw(fb, spr, Math.round(p(b.x) - spr.w / 2), Math.round(p(b.y) - spr.h / 2))
    })
    const targets = g.world === g.mainWorld ? g.world.colliders.filter((c) => c.tag === "target") : []
    targets.forEach((t, i) => {
      if (g.targets[i]) return
      const spr = art.keys[i][recent(g, "target" + i, 0.2) > 0 ? 1 : 0]
      blitRaw(fb, spr, Math.round(p((t.ax + t.bx) / 2) - spr.w / 2), Math.round(p((t.ay + t.by) / 2) - spr.h + 2))
    })
    for (const sp of g.world.spinners) drawSpinner(fb, sp, g.T.spinner, recent(g, "spinner", 0.1) > 0)
    drawPlunger(fb, g)

    // Sparkit at its outlane (bright when charged, jumping when it saves a ball)
    if (live) {
      const ready = g.saver.charge >= SAVER_SPINS
      const jump = recent(g, "saver", 0.6)
      const sx = Math.round(p(OUTLANES[g.saver.side].x) - 6)
      const sy = Math.round(p(770) - 6 - jump * 10)
      blit(fb, ready && blink(now, 3) ? art.sparkitLit : art.sparkit, sx, sy)
    }

    // the critter out to be caught
    if (a?.kind === "catch" && a.phase === "out") {
      const c = BY_ID[a.id]
      const spr = critterSprite(c)
      const sc = screenRect(g.T)
      const bob = Math.round(Math.sin(now * 5) * 1.5)
      const hit = recent(g, "critterHit", 0.14) > 0
      const appear = Math.min(1, (g.time - (a.outAt ?? g.time)) / 0.4)
      if (appear < 1 && blink(now, 12)) blit(fb, whiteOf(spr), sc.cx - 16, sc.cy - 18 + bob)
      else blit(fb, hit ? whiteOf(spr) : spr, sc.cx - 16, sc.cy - 18 + bob)
    }
    const caughtT = recent(g, "caught", 0.8)
    if (caughtT > 0) {
      const sc = screenRect(g.T)
      sparkle(fb, sc.cx, sc.cy, 1 - caughtT)
    }
    const evoT = recent(g, "evolved", 1)
    if (evoT > 0) {
      const sc = screenRect(g.T)
      sparkle(fb, sc.cx, sc.cy, 1 - evoT, 14, 6)
    }

    for (const f of g.world.flippers) drawFlipper(fb, f)

    const tint = g.ballLevel
    const up = []
    for (const b of g.world.balls) {
      if (b.layer === 1) {
        up.push(b)
        continue
      }
      drawBallAt(fb, art.balls[tint], p(b.x), p(b.y), rolling(b), b.held ? 0 : 1)
    }
    blitRaw(fb, art.apron, art.apron.x, art.apron.y)
    const tray = live ? `BALL ${g.ballNumber} ${multiplier(g)}X` : g.mode === "over" ? "GAME OVER" : "INSERT"
    text(fb, tray, 222, 475, C.ink, { font: FONTS.small, align: "center" })
    blitRaw(fb, art.ramp, art.ramp.x, art.ramp.y)
    const height = rampHeightOf(g.T)
    for (const b of up) {
      const hgt = height(b.x, b.y)
      drawBallAt(fb, hgt > 0.35 ? art.ballsBig[tint] : art.balls[tint], p(b.x), p(b.y) - hgt * 3, rolling(b), 1 + Math.round(hgt * 3))
    }
  }

  const drawBonus = (fb, g, now) => {
    const B = g.bonus
    const art = artFor("bonus-" + B.kind, () => buildBonusArt(B.kind))
    fb.buf.set(art.base.buf)
    const boss = BY_ID[B.stage.boss]
    const bossSpr = critterSprite(boss)
    const hit = recent(g, "boss", 0.14) > 0
    for (const c of g.world.colliders) {
      if (c.tag === "bumper") {
        const spr = art.bumper[recent(g, "bumper" + c.id, 0.16) > 0 ? 1 : 0]
        blitRaw(fb, spr, Math.round(p(c.cx) - spr.w / 2), Math.round(p(c.cy) - spr.h / 2))
      }
    }
    if (B.kind === "mole") {
      MOLE_HOLES.forEach((h, i) => {
        const up = B.moles[i]
        if (!up) return
        const left = up - g.time
        const rise = Math.min(1, (2.4 - left) / 0.2, left / 0.2)
        const dy = Math.round((1 - Math.max(0, rise)) * 10)
        blit(fb, recent(g, "mole" + i, 0.12) > 0 ? whiteOf(MUDPUP) : MUDPUP, Math.round(p(h.x) - 16), Math.round(p(h.y) - 24 + dy))
      })
      if (B.phase === "boss") {
        const S = BOSS.mole
        blit2x(fb, hit ? whiteOf(bossSpr) : bossSpr, p(S.x) - 32, p(S.y) - 36 + Math.sin(now * 4) * 1.5)
      }
    } else if (B.kind === "ghost") {
      const c = g.world.colliders.find((x) => x.tag === "boss")
      // see-through (every other pixel, flickering) while faded
      blit2x(fb, hit ? whiteOf(bossSpr) : bossSpr, p(c.cx) - 32, p(c.cy) - 28, B.fade ? 1 + (Math.floor(now * 20) & 1) : 0)
    } else if (B.kind === "crab") {
      const body = g.world.colliders.find((x) => x.tag === "boss")
      blit2x(fb, hit ? whiteOf(bossSpr) : bossSpr, p(body.cx) - 32, p(body.cy) - 40)
      for (const c of g.world.colliders) if (c.tag === "claw" && recent(g, "claw" + c.id, 0.15) > 0) sparkle(fb, p(c.cx), p(c.cy), 0.1, 6, 4)
    }
    // the stage's clock and count
    const left = Math.max(0, Math.ceil(B.until - g.time))
    const goal = B.kind === "mole" ? (B.phase === "boss" ? `KING ${3 - B.bossHits}` : `${Math.max(0, B.stage.goal - B.hits)} LEFT`) : `${Math.max(0, B.stage.goal - B.hits)} HITS`
    text(fb, `0:${String(left).padStart(2, "0")}`, p(262) + 0.5, 34, left <= 10 && blink(now, 3) ? C.red3 : C.white, { align: "center", outline: C.ink })
    text(fb, goal, p(262) + 0.5, 46, C.yellow, { font: FONTS.small, align: "center", outline: C.ink })
    for (const f of g.world.flippers) drawFlipper(fb, f)
    for (const b of g.world.balls) drawBallAt(fb, art.balls[g.ballLevel], p(b.x), p(b.y), rolling(b), 1)
    blitRaw(fb, art.apron, art.apron.x, art.apron.y)
    text(fb, B.stage.name.toUpperCase(), 222, 475, C.ink, { font: FONTS.small, align: "center" })
  }

  const draw = (fb, g, now) => {
    if (g.stage === "bonus" && g.bonus) drawBonus(fb, g, now)
    else drawMain(fb, g, now)
    for (const pop of g.popups) {
      const age = g.time - pop.t
      if (age > 0.8 && blink(now, 8)) continue
      text(fb, pop.text, p(pop.x), p(pop.y) - 10 - age * 14, C.yellow, { font: FONTS.small, align: "center", outline: C.ink })
    }
    if (g.tilted && blink(now, 2)) text(fb, "TILT", W / 2, H / 2 - 20, C.red3, { scale: 3, align: "center", outline: C.ink })
  }
  return { draw, artFor }
}

export const createRenderer = (canvas) => {
  const low = document.createElement("canvas")
  low.width = W
  low.height = H
  const lctx = low.getContext("2d", { alpha: false })
  const img = lctx.createImageData(W, H)
  let ctx = canvas.getContext("2d", { alpha: false })
  let n = 1
  const fb = { w: W, h: H, buf: new Uint32Array(img.data.buffer) }
  const drawer = createDrawer()
  const present = () => {
    if (n === 1) ctx.putImageData(img, 0, 0)
    else {
      lctx.putImageData(img, 0, 0)
      ctx.drawImage(low, 0, 0, W * n, H * n)
    }
  }
  const draw = (g, now) => {
    drawer.draw(fb, g, now)
    present()
  }
  const resize = (cssW, cssH, dpr = 1) => {
    const fit = fitTable(cssW, cssH, dpr)
    const v = fit.scale * dpr
    n = fit.whole ? 1 : v < 2 ? 2 : Math.floor(v)
    canvas.width = W * n
    canvas.height = H * n
    ctx = canvas.getContext("2d", { alpha: false })
    ctx.imageSmoothingEnabled = false
    return { ...fit, smooth: !fit.whole, prescale: n }
  }
  const shakeOffset = (g, reduced) => {
    if (reduced) return [0, 0]
    const age = g.time - g.shake.t
    if (age < 0 || age > 0.25) return [0, 0]
    const k = 1 - age / 0.25
    const wob = Math.cos(age * 60)
    return [Math.round(g.shake.x * k * wob * 0.5), Math.round(g.shake.y * k * wob * 0.5)]
  }
  return { draw, resize, shakeOffset, width: W, height: H, fb }
}

