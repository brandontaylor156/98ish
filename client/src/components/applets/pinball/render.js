// Draws the Deep Sea Dive table on a canvas: everything that never changes (the ocean,
// walls, artwork) is painted once into an offscreen layer at the current size; each frame
// adds the lamps, bumpers, targets, flippers, plunger and balls on top.

import { BALL_R, flipperTip } from "./physics.js"
import {
  BUMPERS,
  CHEST,
  DOME,
  GUIDES,
  HEIGHT,
  INLANES,
  LANE,
  LANE_BOTTOM,
  LANE_GUIDES,
  LANE_TOP,
  MID,
  OUTLANES,
  POSTS,
  ROLLOVERS,
  SEPARATORS,
  SLINGS,
  TARGETS,
  WIDTH,
} from "./table.js"

const NEON = "#46f0ff"
const PINK = "#ff5fd2"
const GOLD = "#ffd23f"
const CORAL = "#ff7a45"
const LIME = "#7dff9a"
const RED = "#ff4040"
const FONT = '"Arial Black", "Segoe UI Black", Impact, Arial, sans-serif'

// a seeded random, so the artwork is the same every time
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646

// rounded rectangles where the browser has them (older Safari gets square corners)
const roundRect = (ctx, x, y, w, h, r) => (ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h))

const makeCanvas = (w, h) => {
  const c = document.createElement("canvas")
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

// The playfield's outline: the dome over the top and straight sides
const playfieldPath = (ctx) => {
  ctx.beginPath()
  ctx.moveTo(20, HEIGHT)
  ctx.lineTo(20, DOME.cy)
  ctx.arc(DOME.cx, DOME.cy, DOME.r, Math.PI, Math.PI * 2)
  ctx.lineTo(LANE.right, HEIGHT)
  ctx.closePath()
}

const neonLine = (ctx, draw, color = NEON, width = 3) => {
  ctx.save()
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  ctx.strokeStyle = "rgba(0,0,0,0.55)"
  ctx.lineWidth = width + 5
  draw()
  ctx.stroke()
  ctx.shadowColor = color
  ctx.shadowBlur = 12
  ctx.strokeStyle = color
  ctx.lineWidth = width
  draw()
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.strokeStyle = "rgba(255,255,255,0.75)"
  ctx.lineWidth = Math.max(1, width / 3)
  draw()
  ctx.stroke()
  ctx.restore()
}

const glowText = (ctx, text, x, y, size, color, { align = "center", blur = 14, stroke = "#00131f", italic = false, maxWidth } = {}) => {
  ctx.save()
  ctx.font = `${italic ? "italic " : ""}${size}px ${FONT}`
  ctx.textAlign = align
  ctx.textBaseline = "middle"
  ctx.lineJoin = "round"
  ctx.strokeStyle = stroke
  ctx.lineWidth = size * 0.22
  ctx.strokeText(text, x, y, maxWidth)
  ctx.shadowColor = color
  ctx.shadowBlur = blur
  ctx.fillStyle = color
  ctx.fillText(text, x, y, maxWidth)
  ctx.restore()
}

const drawSubmarine = (ctx, x, y) => {
  ctx.save()
  ctx.translate(x, y)
  // headlight beam toward the treasure
  const beam = ctx.createLinearGradient(60, 0, 190, -10)
  beam.addColorStop(0, "rgba(255,240,170,0.28)")
  beam.addColorStop(1, "rgba(255,240,170,0)")
  ctx.fillStyle = beam
  ctx.beginPath()
  ctx.moveTo(62, -4)
  ctx.lineTo(190, -48)
  ctx.lineTo(196, 30)
  ctx.closePath()
  ctx.fill()
  // hull
  const hull = ctx.createLinearGradient(0, -28, 0, 28)
  hull.addColorStop(0, "#ffb347")
  hull.addColorStop(0.5, "#f07a1a")
  hull.addColorStop(1, "#7a2e05")
  ctx.fillStyle = hull
  ctx.strokeStyle = "#2a0d00"
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.ellipse(0, 0, 66, 25, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  // tower and periscope
  ctx.beginPath()
  ctx.moveTo(-22, -20)
  ctx.lineTo(-16, -42)
  ctx.lineTo(16, -42)
  ctx.lineTo(24, -20)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.lineWidth = 4
  ctx.strokeStyle = "#c95f12"
  ctx.beginPath()
  ctx.moveTo(4, -42)
  ctx.lineTo(4, -58)
  ctx.lineTo(16, -58)
  ctx.stroke()
  // stripes
  ctx.strokeStyle = "rgba(42,13,0,0.55)"
  ctx.lineWidth = 2
  for (const sx of [-44, 46]) {
    ctx.beginPath()
    ctx.moveTo(sx, -21 + Math.abs(sx) * 0.1)
    ctx.lineTo(sx, 21 - Math.abs(sx) * 0.1)
    ctx.stroke()
  }
  // portholes
  for (const px of [-26, 0, 26]) {
    ctx.fillStyle = "#2a0d00"
    ctx.beginPath()
    ctx.arc(px, 2, 8.5, 0, Math.PI * 2)
    ctx.fill()
    const glass = ctx.createRadialGradient(px - 2, 0, 1, px, 2, 7)
    glass.addColorStop(0, "#fffbe0")
    glass.addColorStop(0.5, "#9ff8ff")
    glass.addColorStop(1, "#1a7fa0")
    ctx.fillStyle = glass
    ctx.beginPath()
    ctx.arc(px, 2, 6.5, 0, Math.PI * 2)
    ctx.fill()
  }
  // propeller
  ctx.fillStyle = "#c9c9c9"
  ctx.strokeStyle = "#333"
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.ellipse(-72, -9, 5, 11, 0.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(-72, 9, 5, 11, -0.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  // highlight
  ctx.strokeStyle = "rgba(255,255,255,0.45)"
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.ellipse(0, -2, 56, 17, 0, Math.PI * 1.15, Math.PI * 1.75)
  ctx.stroke()
  ctx.restore()
}

const drawKelp = (ctx, x, y, height, lean, rand) => {
  ctx.save()
  ctx.strokeStyle = "rgba(30,170,120,0.45)"
  ctx.fillStyle = "rgba(30,170,120,0.35)"
  ctx.lineWidth = 4
  ctx.lineCap = "round"
  ctx.beginPath()
  ctx.moveTo(x, y)
  const steps = 8
  let px = x
  let py = y
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const nx = x + Math.sin(t * 5 + lean) * 9 + lean * t * 14
    const ny = y - height * t
    ctx.quadraticCurveTo(px + (rand() - 0.5) * 10, (py + ny) / 2, nx, ny)
    px = nx
    py = ny
  }
  ctx.stroke()
  for (let i = 1; i < steps; i++) {
    const t = i / steps
    const lx = x + Math.sin(t * 5 + lean) * 9 + lean * t * 14
    const ly = y - height * t
    const side = i % 2 ? 1 : -1
    ctx.beginPath()
    ctx.ellipse(lx + side * 8, ly, 9, 3.5, side * 0.6, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

const drawCoral = (ctx, x, y, size, color, rand) => {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineCap = "round"
  const branch = (bx, by, angle, len, width, depth) => {
    const ex = bx + Math.cos(angle) * len
    const ey = by + Math.sin(angle) * len
    ctx.lineWidth = width
    ctx.beginPath()
    ctx.moveTo(bx, by)
    ctx.lineTo(ex, ey)
    ctx.stroke()
    if (depth > 0) {
      branch(ex, ey, angle - 0.45 - rand() * 0.2, len * 0.72, width * 0.7, depth - 1)
      branch(ex, ey, angle + 0.45 + rand() * 0.2, len * 0.72, width * 0.7, depth - 1)
    }
  }
  branch(x, y, -Math.PI / 2, size, size * 0.28, 3)
  ctx.restore()
}

const drawClamShape = (ctx, x, y, w, h) => {
  ctx.beginPath()
  ctx.moveTo(x, y + h / 2)
  ctx.quadraticCurveTo(x - w * 0.2, y + h * 0.1, x + w * 0.5, y)
  ctx.quadraticCurveTo(x + w * 1.2, y + h * 0.1, x + w, y + h / 2)
  ctx.closePath()
}

// Everything that never moves, painted in table units
const paintStatic = (ctx) => {
  const rand = seeded(1998)

  // the cabinet around the glass
  const cab = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT)
  cab.addColorStop(0, "#151a33")
  cab.addColorStop(1, "#05060f")
  ctx.fillStyle = cab
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  ctx.save()
  playfieldPath(ctx)
  ctx.clip()

  // the ocean, darker as it goes down
  const sea = ctx.createLinearGradient(0, 0, 0, HEIGHT)
  sea.addColorStop(0, "#0d5a8c")
  sea.addColorStop(0.35, "#073a66")
  sea.addColorStop(0.75, "#04223f")
  sea.addColorStop(1, "#020f22")
  ctx.fillStyle = sea
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  // sunbeams from the surface
  for (let i = 0; i < 7; i++) {
    const x = 40 + i * 75 + rand() * 30
    const spread = 30 + rand() * 50
    const g = ctx.createLinearGradient(0, 0, 0, 750)
    g.addColorStop(0, `rgba(170,240,255,${0.1 + rand() * 0.06})`)
    g.addColorStop(1, "rgba(170,240,255,0)")
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(x - 10, 0)
    ctx.lineTo(x + 14, 0)
    ctx.lineTo(x + spread + 40, 750)
    ctx.lineTo(x + spread - 40, 750)
    ctx.closePath()
    ctx.fill()
  }

  // caustic ripples near the top
  ctx.strokeStyle = "rgba(190,250,255,0.07)"
  ctx.lineWidth = 2
  for (let i = 0; i < 40; i++) {
    const x = rand() * WIDTH
    const y = 30 + rand() * 260
    ctx.beginPath()
    ctx.ellipse(x, y, 10 + rand() * 18, 3 + rand() * 5, rand() * 0.5, 0, Math.PI * 2)
    ctx.stroke()
  }

  // the sea floor: sand, rocks, kelp and coral
  const sand = ctx.createLinearGradient(0, 860, 0, HEIGHT)
  sand.addColorStop(0, "rgba(70,90,110,0)")
  sand.addColorStop(1, "rgba(120,110,80,0.55)")
  ctx.fillStyle = sand
  ctx.beginPath()
  ctx.moveTo(0, HEIGHT)
  ctx.lineTo(0, 900)
  ctx.quadraticCurveTo(120, 860, 262, 930)
  ctx.quadraticCurveTo(400, 880, 560, 900)
  ctx.lineTo(560, HEIGHT)
  ctx.closePath()
  ctx.fill()
  drawKelp(ctx, 40, 360, 160, 0.3, rand)
  drawKelp(ctx, 62, 680, 150, -0.2, rand)
  drawKelp(ctx, 470, 690, 170, 0.4, rand)
  drawKelp(ctx, 492, 400, 110, -0.5, rand)
  drawCoral(ctx, 120, 990, 46, "rgba(255,110,140,0.45)", rand)
  drawCoral(ctx, 410, 995, 40, "rgba(255,160,70,0.45)", rand)
  drawCoral(ctx, 40, 1000, 30, "rgba(200,120,255,0.4)", rand)
  drawCoral(ctx, 480, 1000, 34, "rgba(255,110,140,0.4)", rand)

  // drifting bubbles (still ones; a few more rise each frame)
  ctx.strokeStyle = "rgba(200,250,255,0.25)"
  ctx.lineWidth = 1.2
  for (let i = 0; i < 46; i++) {
    ctx.beginPath()
    ctx.arc(30 + rand() * 470, 60 + rand() * 860, 1.5 + rand() * 4, 0, Math.PI * 2)
    ctx.stroke()
  }

  // the top lanes' strip
  ctx.fillStyle = "rgba(0,10,25,0.35)"
  ctx.fillRect(LANE_GUIDES[0], LANE_TOP - 6, LANE_GUIDES[4] - LANE_GUIDES[0], LANE_BOTTOM - LANE_TOP + 14)

  // the submarine and the logo in the middle
  drawSubmarine(ctx, 245, 470)
  glowText(ctx, "DEEP SEA", MID, 588, 40, GOLD, { italic: true, blur: 18 })
  glowText(ctx, "DIVE", MID, 632, 52, CORAL, { italic: true, blur: 20 })
  // the depth gauge's lamp sockets (one per rank)
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = "rgba(0,0,0,0.45)"
    ctx.beginPath()
    ctx.arc(rankLamp(i).x, rankLamp(i).y, 6, 0, Math.PI * 2)
    ctx.fill()
  }

  // inserts: the multiplier arrows, the chest's lock lamps, shoot again
  for (let i = 0; i < 4; i++) {
    const { x, y } = multLamp(i)
    insertShape(ctx, x, y, 17, "rgba(255,210,63,0.12)", "rgba(255,210,63,0.35)")
    ctx.fillStyle = "rgba(255,230,160,0.35)"
    ctx.font = `14px ${FONT}`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(`${i + 2}x`, x, y + 1)
  }
  for (let i = 0; i < 3; i++) {
    const { x, y } = lockLamp(i)
    insertShape(ctx, x, y, 8, "rgba(255,95,210,0.15)", "rgba(255,95,210,0.4)")
  }
  insertPill(ctx, MID, 965, 96, 22, "rgba(125,255,154,0.12)", "rgba(125,255,154,0.35)")
  ctx.fillStyle = "rgba(200,255,210,0.35)"
  ctx.font = `11px ${FONT}`
  ctx.fillText("SHOOT AGAIN", MID, 966)
  insertPill(ctx, MID, 935, 60, 18, "rgba(70,240,255,0.12)", "rgba(70,240,255,0.35)")
  ctx.fillStyle = "rgba(200,250,255,0.35)"
  ctx.font = `10px ${FONT}`
  ctx.fillText("SAVE", MID, 936)
  for (const p of [...INLANES, ...OUTLANES]) insertShape(ctx, p.x, p.y + 26, 6, "rgba(70,240,255,0.12)", "rgba(70,240,255,0.35)")
  for (const t of TARGETS) insertShape(ctx, 62, (t.y0 + t.y1) / 2, 6, "rgba(255,210,63,0.12)", "rgba(255,210,63,0.35)")

  // the treasure chest behind its hole
  drawChest(ctx, CHEST.x + 22, CHEST.y - 36)
  ctx.restore()

  // ---- walls (drawn over the clip so their glow shows at the edges) ----
  neonLine(ctx, () => playfieldPath(ctx), NEON, 4)
  // the shooter lane
  ctx.fillStyle = "rgba(0,8,20,0.55)"
  ctx.fillRect(LANE.left, LANE.top, LANE.right - LANE.left, HEIGHT - LANE.top)
  for (let i = 0; i < 4; i++) {
    const y = 760 - i * 80
    ctx.fillStyle = "rgba(255,210,63,0.18)"
    ctx.beginPath()
    ctx.moveTo((LANE.left + LANE.right) / 2, y - 14)
    ctx.lineTo(LANE.right - 6, y + 6)
    ctx.lineTo(LANE.left + 6, y + 6)
    ctx.closePath()
    ctx.fill()
  }
  neonLine(
    ctx,
    () => {
      ctx.beginPath()
      ctx.moveTo(LANE.left, HEIGHT)
      ctx.lineTo(LANE.left, LANE.top)
    },
    NEON,
    4
  )
  // the one-way gate
  ctx.save()
  ctx.strokeStyle = "rgba(200,240,255,0.55)"
  ctx.lineWidth = 2
  ctx.setLineDash([4, 3])
  ctx.beginPath()
  ctx.moveTo(LANE.right - 2, 306)
  ctx.lineTo(LANE.left, LANE.top)
  ctx.stroke()
  ctx.restore()

  for (const x of LANE_GUIDES) {
    neonLine(
      ctx,
      () => {
        ctx.beginPath()
        ctx.moveTo(x, LANE_TOP)
        ctx.lineTo(x, LANE_BOTTOM)
      },
      "#9ff8ff",
      6
    )
  }
  for (const s of SEPARATORS) {
    neonLine(
      ctx,
      () => {
        ctx.beginPath()
        ctx.moveTo(s.x, s.y0)
        ctx.lineTo(s.x, s.y1)
      },
      NEON,
      5
    )
  }
  for (const [ax, ay, bx, by] of GUIDES) {
    neonLine(
      ctx,
      () => {
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
      },
      NEON,
      5
    )
  }
  // slingshot bodies
  for (const s of SLINGS) {
    const [[ax, ay], [bx, by], [cx, cy]] = s
    const g = ctx.createLinearGradient(ax, ay, cx, cy)
    g.addColorStop(0, "#1b6f8f")
    g.addColorStop(1, "#0b2e4d")
    ctx.save()
    ctx.fillStyle = g
    ctx.strokeStyle = "rgba(255,255,255,0.85)"
    ctx.lineWidth = 9
    ctx.lineJoin = "round"
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
    ctx.lineTo(cx, cy)
    ctx.closePath()
    ctx.stroke()
    ctx.fill()
    // a little fish on each
    const fx = (ax + bx + cx) / 3
    const fy = (ay + by + cy) / 3 + 4
    const dir = ax < MID ? 1 : -1
    ctx.fillStyle = "rgba(255,210,63,0.75)"
    ctx.beginPath()
    ctx.ellipse(fx, fy, 9, 5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(fx - dir * 7, fy)
    ctx.lineTo(fx - dir * 14, fy - 5)
    ctx.lineTo(fx - dir * 14, fy + 5)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
  for (const p of [...POSTS, ...SEPARATORS.map((s) => ({ x: s.x, y: s.y0, r: 5 }))]) {
    ctx.save()
    ctx.shadowColor = PINK
    ctx.shadowBlur = 10
    ctx.fillStyle = "#ffe0f4"
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.r + 1, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.fillStyle = PINK
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.r * 0.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
  // the clam targets' backing rail
  ctx.fillStyle = "rgba(0,0,0,0.5)"
  ctx.fillRect(20, TARGETS[0].y0 - 6, 10, TARGETS[2].y1 - TARGETS[0].y0 + 12)

  // the chest hole
  const hole = ctx.createRadialGradient(CHEST.x, CHEST.y, 2, CHEST.x, CHEST.y, CHEST.r + 4)
  hole.addColorStop(0, "#000")
  hole.addColorStop(0.75, "#05080f")
  hole.addColorStop(1, "#c8a14a")
  ctx.fillStyle = hole
  ctx.beginPath()
  ctx.arc(CHEST.x, CHEST.y, CHEST.r + 4, 0, Math.PI * 2)
  ctx.fill()

  // the apron at the very bottom
  ctx.fillStyle = "#0b0f22"
  ctx.fillRect(0, 990, WIDTH, 10)
}

const rankLamp = (i) => ({ x: MID - 70 + i * 20, y: 668 })
const multLamp = (i) => ({ x: MID - 66 + i * 44, y: 728 + Math.abs(i - 1.5) * -8 })
const lockLamp = (i) => ({ x: CHEST.x - 34 + i * 20, y: CHEST.y + 34 })

const insertShape = (ctx, x, y, r, fill, stroke) => {
  ctx.fillStyle = fill
  ctx.strokeStyle = stroke
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
}

const insertPill = (ctx, x, y, w, h, fill, stroke) => {
  ctx.fillStyle = fill
  ctx.strokeStyle = stroke
  ctx.lineWidth = 1.5
  ctx.beginPath()
  roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2)
  ctx.fill()
  ctx.stroke()
}

const drawChest = (ctx, x, y) => {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(0.12)
  ctx.fillStyle = "#6b3b12"
  ctx.strokeStyle = "#2a1404"
  ctx.lineWidth = 2
  ctx.beginPath()
  roundRect(ctx, -20, -6, 40, 22, 3)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#8a4d18"
  ctx.beginPath()
  ctx.moveTo(-20, -6)
  ctx.quadraticCurveTo(0, -24, 20, -6)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = GOLD
  ctx.fillRect(-21, -2, 42, 3)
  ctx.fillRect(-3, -6, 6, 12)
  ctx.fillStyle = "rgba(255,230,120,0.8)"
  for (let i = 0; i < 5; i++) {
    ctx.beginPath()
    ctx.arc(-12 + i * 6, -9 + (i % 2) * 2, 2.2, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

// Soft glow sprites (one per color), drawn with additive blending for lit lamps
const glowCache = new Map()
const glowSprite = (color) => {
  if (glowCache.has(color)) return glowCache.get(color)
  const c = makeCanvas(64, 64)
  const g = c.getContext("2d")
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, color)
  grad.addColorStop(0.25, color)
  grad.addColorStop(1, "rgba(0,0,0,0)")
  g.fillStyle = grad
  g.globalAlpha = 0.9
  g.fillRect(0, 0, 64, 64)
  glowCache.set(color, c)
  return c
}

const glow = (ctx, x, y, size, color, alpha = 1) => {
  ctx.globalAlpha = alpha
  ctx.drawImage(glowSprite(color), x - size / 2, y - size / 2, size, size)
  ctx.globalAlpha = 1
}

const lamp = (ctx, x, y, r, color, on) => {
  if (!on) return
  ctx.globalCompositeOperation = "lighter"
  glow(ctx, x, y, r * 5, color, 0.55 * on)
  ctx.globalCompositeOperation = "source-over"
  ctx.globalAlpha = Math.min(1, on)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
}

// how lit a recently hit thing still is (1 just hit, fading to 0)
const recent = (g, name, seconds = 0.25) => {
  const t = g.flash[name]
  if (t === undefined) return 0
  const age = g.time - t
  return age < 0 || age > seconds ? 0 : 1 - age / seconds
}

const blink = (now, hz = 3) => (Math.floor(now * hz * 2) % 2 ? 1 : 0.25)

const drawBumper = (ctx, b, lit, now, i) => {
  const { x, y, r } = b
  // skirt ring
  ctx.save()
  ctx.strokeStyle = lit ? "#fff" : "rgba(255,170,235,0.55)"
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(x, y, r + 3, 0, Math.PI * 2)
  ctx.stroke()
  if (lit) {
    ctx.globalCompositeOperation = "lighter"
    glow(ctx, x, y, r * 5, PINK, lit)
    ctx.globalCompositeOperation = "source-over"
  }
  // tentacles (wiggling)
  ctx.strokeStyle = `rgba(255,140,225,${0.35 + lit * 0.5})`
  ctx.lineWidth = 2
  for (let k = 0; k < 5; k++) {
    const tx = x - r * 0.6 + k * r * 0.3
    ctx.beginPath()
    ctx.moveTo(tx, y + r * 0.45)
    ctx.quadraticCurveTo(tx + Math.sin(now * 3 + k + i) * 5, y + r * 0.9, tx + Math.sin(now * 2.4 + k * 2 + i) * 4, y + r + 6)
    ctx.stroke()
  }
  // the bell
  const bell = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, 2, x, y, r)
  bell.addColorStop(0, lit ? "#ffffff" : "#ffd6f5")
  bell.addColorStop(0.45, lit ? "#ff9be6" : "#e04fb8")
  bell.addColorStop(1, lit ? "#c02a96" : "#5a0f4a")
  ctx.fillStyle = bell
  ctx.beginPath()
  ctx.arc(x, y + 2, r, Math.PI, 0)
  // frilly bottom edge
  for (let k = 6; k >= 0; k--) {
    const fx = x - r + (k / 6) * r * 2
    ctx.quadraticCurveTo(fx + r / 6, y + 2 + r * 0.55, fx, y + 2 + r * 0.3)
  }
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = lit ? "#fff" : "rgba(255,200,240,0.8)"
  ctx.lineWidth = 1.5
  ctx.stroke()
  // spots
  ctx.fillStyle = "rgba(255,255,255,0.55)"
  ctx.beginPath()
  ctx.ellipse(x - r * 0.35, y - r * 0.4, r * 0.18, r * 0.11, -0.6, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

const drawFlipper = (ctx, f, lit) => {
  const tip = flipperTip(f)
  const ang = f.angle
  const nx = -Math.sin(ang)
  const ny = Math.cos(ang)
  ctx.save()
  ctx.beginPath()
  // the tapered outline: base circle, tip circle and the tangent lines between
  ctx.moveTo(f.x + nx * f.r0, f.y + ny * f.r0)
  ctx.lineTo(tip.x + nx * f.r1, tip.y + ny * f.r1)
  ctx.arc(tip.x, tip.y, f.r1, ang + Math.PI / 2, ang - Math.PI / 2, true)
  ctx.lineTo(f.x - nx * f.r0, f.y - ny * f.r0)
  ctx.arc(f.x, f.y, f.r0, ang - Math.PI / 2, ang + Math.PI / 2, true)
  ctx.closePath()
  const grad = ctx.createLinearGradient(f.x - nx * f.r0, f.y - ny * f.r0, f.x + nx * f.r0, f.y + ny * f.r0)
  grad.addColorStop(0, "#ffd0a8")
  grad.addColorStop(0.5, CORAL)
  grad.addColorStop(1, "#8a2a06")
  ctx.shadowColor = CORAL
  ctx.shadowBlur = lit ? 16 : 6
  ctx.fillStyle = grad
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.lineWidth = 2.5
  ctx.strokeStyle = "#fff4e8"
  ctx.stroke()
  // pivot bolt
  ctx.fillStyle = "#2a1004"
  ctx.beginPath()
  ctx.arc(f.x, f.y, 3.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

const drawBall = (ctx, b) => {
  const speed = Math.hypot(b.vx, b.vy)
  // a short motion trail when it's quick
  if (speed > 900) {
    for (let k = 1; k <= 3; k++) {
      ctx.globalAlpha = 0.12 * (4 - k) * Math.min(1, (speed - 900) / 1500)
      ctx.fillStyle = "#bff6ff"
      ctx.beginPath()
      ctx.arc(b.x - b.vx * 0.006 * k, b.y - b.vy * 0.006 * k, BALL_R * (1 - k * 0.12), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }
  ctx.fillStyle = "rgba(0,0,0,0.35)"
  ctx.beginPath()
  ctx.ellipse(b.x + 3, b.y + 4, BALL_R, BALL_R * 0.85, 0, 0, Math.PI * 2)
  ctx.fill()
  const g = ctx.createRadialGradient(b.x - 4, b.y - 4, 1, b.x, b.y, BALL_R)
  g.addColorStop(0, "#ffffff")
  g.addColorStop(0.35, "#d7e3ea")
  g.addColorStop(0.8, "#6f8593")
  g.addColorStop(1, "#2c3a44")
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2)
  ctx.fill()
  // the ocean's reflection
  ctx.strokeStyle = "rgba(70,240,255,0.5)"
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.arc(b.x, b.y, BALL_R - 1.5, 0.3, 1.6)
  ctx.stroke()
}

const drawPlunger = (ctx, g) => {
  const p = g.world.plunger
  const cx = (LANE.left + LANE.right) / 2
  const top = p.y
  ctx.save()
  // the spring
  ctx.strokeStyle = "#9aa7b5"
  ctx.lineWidth = 2
  ctx.beginPath()
  const coils = 9
  const bottom = HEIGHT - 4
  for (let i = 0; i <= coils * 2; i++) {
    const y = top + 12 + ((bottom - top - 12) * i) / (coils * 2)
    const x = cx + (i % 2 ? 9 : -9)
    if (i) ctx.lineTo(x, y)
    else ctx.moveTo(x, y)
  }
  ctx.stroke()
  // the rod and its tip
  ctx.fillStyle = "#c8d3dd"
  ctx.fillRect(cx - 3, top, 6, bottom - top)
  const tip = ctx.createLinearGradient(LANE.left, 0, LANE.right, 0)
  tip.addColorStop(0, "#8b1d1d")
  tip.addColorStop(0.5, "#ff6a4d")
  tip.addColorStop(1, "#8b1d1d")
  ctx.fillStyle = tip
  ctx.beginPath()
  roundRect(ctx, LANE.left + 3, top, LANE.right - LANE.left - 6, 12, 3)
  ctx.fill()
  ctx.restore()
  // the pull meter beside the lane
  if (g.pull > 0) {
    const h = 120 * g.pull
    const grad = ctx.createLinearGradient(0, 940, 0, 820)
    grad.addColorStop(0, LIME)
    grad.addColorStop(1, RED)
    ctx.fillStyle = grad
    ctx.fillRect(LANE.right + 6, 940 - h, 8, h)
    ctx.strokeStyle = "rgba(255,255,255,0.5)"
    ctx.strokeRect(LANE.right + 6, 820, 8, 120)
  }
}

export const createRenderer = (canvas) => {
  const ctx = canvas.getContext("2d")
  let layer = null
  let view = { scale: 1, x: 0, y: 0, dpr: 1, width: 0, height: 0 }
  const bubbles = Array.from({ length: 14 }, (_, i) => ({ x: 40 + ((i * 97) % 460), y: (i * 173) % 1000, r: 2 + (i % 4), speed: 25 + (i % 5) * 9 }))

  // Fit the table into width x height CSS pixels (letterboxed)
  const resize = (width, height, dpr) => {
    dpr = Math.min(dpr || 1, 2.5)
    canvas.width = Math.max(1, Math.round(width * dpr))
    canvas.height = Math.max(1, Math.round(height * dpr))
    const scale = Math.min(width / WIDTH, height / HEIGHT)
    view = { scale, x: (width - WIDTH * scale) / 2, y: (height - HEIGHT * scale) / 2, dpr, width, height }
    layer = makeCanvas(WIDTH * scale * dpr, HEIGHT * scale * dpr)
    const l = layer.getContext("2d")
    l.scale(scale * dpr, scale * dpr)
    paintStatic(l)
  }

  // CSS pixel (relative to the canvas) -> table units
  const toTable = (x, y) => ({ x: (x - view.x) / view.scale, y: (y - view.y) / view.scale })

  const draw = (g, now) => {
    if (!layer) return
    const { dpr, scale } = view
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = "#03040a"
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // a nudge shakes the table for a moment
    const shakeAge = g.time - g.shake.t
    const shakeK = shakeAge >= 0 && shakeAge < 0.25 ? 1 - shakeAge / 0.25 : 0
    const sx = g.shake.x * shakeK * scale
    const sy = g.shake.y * shakeK * scale
    ctx.drawImage(layer, Math.round((view.x + sx) * dpr), Math.round((view.y + sy) * dpr))
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, (view.x + sx) * dpr, (view.y + sy) * dpr)

    // rising bubbles
    ctx.strokeStyle = "rgba(210,250,255,0.4)"
    ctx.lineWidth = 1.3
    for (const b of bubbles) {
      const y = 960 - ((now * b.speed + b.y) % 900)
      const x = b.x + Math.sin(now * 1.5 + b.y) * 6
      ctx.beginPath()
      ctx.arc(x, y, b.r, 0, Math.PI * 2)
      ctx.stroke()
    }

    const playing = g.mode === "play"

    // D-I-V-E lanes
    ROLLOVERS.forEach((r, i) => {
      const hit = recent(g, "lane" + i, 0.4)
      const done = recent(g, "dive", 1.2)
      const on = g.dive[i] ? 1 : done ? blink(now, 6) : hit
      lamp(ctx, r.x, r.y - 2, 13, GOLD, on)
      ctx.font = `18px ${FONT}`
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillStyle = on ? "#3a2400" : "rgba(255,210,63,0.45)"
      ctx.fillText(r.letter, r.x, r.y - 1)
      // the rollover wire
      ctx.strokeStyle = "rgba(220,230,240,0.6)"
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(r.x, r.y + 12)
      ctx.lineTo(r.x, r.y + 20)
      ctx.stroke()
    })

    // clam drop targets
    TARGETS.forEach((t, i) => {
      const down = g.targets[i]
      const ty = t.y0
      const h = t.y1 - t.y0
      if (down) {
        ctx.fillStyle = "rgba(0,0,0,0.65)"
        ctx.fillRect(t.x - 4, ty, 6, h)
      } else {
        ctx.save()
        const hit = recent(g, "target" + i)
        drawClamShape(ctx, t.x - 4, ty, 14, h)
        ctx.fillStyle = hit ? "#fff" : "#f2e6d0"
        ctx.fill()
        ctx.strokeStyle = "#7a5a3a"
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.strokeStyle = "rgba(122,90,58,0.6)"
        for (let k = 1; k < 4; k++) {
          ctx.beginPath()
          ctx.moveTo(t.x - 4, ty + h / 2)
          ctx.lineTo(t.x + 9, ty + (h * k) / 4)
          ctx.stroke()
        }
        ctx.restore()
      }
      lamp(ctx, 62, ty + h / 2, 5, GOLD, down ? 1 : 0)
    })
    if (recent(g, "bank", 1)) {
      ctx.globalCompositeOperation = "lighter"
      glow(ctx, 40, 440, 180, GOLD, recent(g, "bank", 1))
      ctx.globalCompositeOperation = "source-over"
    }

    // chest lamps
    for (let i = 0; i < 3; i++) {
      const { x, y } = lockLamp(i)
      const on = g.multiball ? blink(now, 4) : i < g.chestLocks ? 1 : 0
      lamp(ctx, x, y, 6, PINK, on)
    }
    const chestHit = recent(g, "chest", 0.8)
    if (chestHit || g.chestBall) {
      ctx.globalCompositeOperation = "lighter"
      glow(ctx, CHEST.x, CHEST.y, 90, GOLD, Math.max(chestHit, 0.5))
      ctx.globalCompositeOperation = "source-over"
    }

    // multiplier, ranks, shoot again, ball save
    for (let i = 0; i < 4; i++) {
      const { x, y } = multLamp(i)
      if (g.multiplier >= i + 2) {
        lamp(ctx, x, y, 15, GOLD, 0.9)
        ctx.fillStyle = "#3a2400"
        ctx.font = `14px ${FONT}`
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillText(`${i + 2}x`, x, y + 1)
      }
    }
    for (let i = 0; i < 8; i++) {
      const { x, y } = rankLamp(i)
      const on = i < g.rank ? 1 : i === g.rank && playing ? 0.25 + 0.2 * Math.sin(now * 4) : 0
      lamp(ctx, x, y, 5, LIME, on)
    }
    if (g.extraBalls > 0) {
      lamp(ctx, MID - 56, 965, 5, LIME, 1)
      lamp(ctx, MID + 56, 965, 5, LIME, 1)
      ctx.fillStyle = LIME
      ctx.font = `11px ${FONT}`
      ctx.textAlign = "center"
      ctx.fillText("SHOOT AGAIN", MID, 966)
    }
    const saveLeft = g.ballSaveUntil - g.time
    if (playing && (saveLeft > 0 || g.ballSavePending) && !g.tilted) {
      const on = saveLeft > 0 && saveLeft < 2 ? blink(now, 5) : 1
      ctx.globalAlpha = on
      ctx.fillStyle = NEON
      ctx.font = `10px ${FONT}`
      ctx.textAlign = "center"
      ctx.fillText("SAVE", MID, 936)
      ctx.globalAlpha = 1
      lamp(ctx, MID - 34, 935, 4, NEON, on)
      lamp(ctx, MID + 34, 935, 4, NEON, on)
    }
    INLANES.forEach((p, i) => lamp(ctx, p.x, p.y + 26, 5, NEON, recent(g, "inlane" + i, 0.6)))
    OUTLANES.forEach((p, i) => lamp(ctx, p.x, p.y + 26, 5, RED, recent(g, "outlane" + i, 0.8)))

    // slingshot kicks light the rubber
    SLINGS.forEach((s, i) => {
      const on = recent(g, "sling" + i, 0.15)
      if (!on) return
      const [[ax, ay], , [cx, cy]] = s
      ctx.save()
      ctx.strokeStyle = `rgba(255,255,255,${on})`
      ctx.shadowColor = NEON
      ctx.shadowBlur = 16
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(cx, cy)
      ctx.stroke()
      ctx.restore()
    })

    BUMPERS.forEach((b, i) => drawBumper(ctx, b, recent(g, "bumper" + i, 0.18), now, i))

    drawPlunger(ctx, g)
    for (const f of g.world.flippers) drawFlipper(ctx, f, f.pressed)
    for (const b of g.world.balls) drawBall(ctx, b)

    // the message banner
    const m = g.message
    if (m && (m.big || !playing)) {
      const big = m.text.length < 14
      const size = big ? 44 : 22
      ctx.save()
      ctx.globalAlpha = 0.75
      ctx.fillStyle = "#000814"
      const y = 520
      ctx.fillRect(40, y - size, 450, size * 2)
      ctx.globalAlpha = 1
      ctx.strokeStyle = m.text === "TILT" ? RED : GOLD
      ctx.lineWidth = 2
      ctx.strokeRect(40, y - size, 450, size * 2)
      ctx.restore()
      const color = m.text === "TILT" || m.text === "DANGER" ? RED : m.text === "GAME OVER" ? CORAL : GOLD
      glowText(ctx, m.text, MID, 520, size, color, { blur: 18, maxWidth: 420 })
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  return { resize, draw, toTable, get view() { return view } }
}

