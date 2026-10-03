// Shred 98's artwork, drawn on canvases at startup (no image files): the band's backlit
// silhouettes, the crowd, flames and glows. Everything is original.

import * as THREE from "three"

const make = (w, h, draw) => {
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  draw(c.getContext("2d"), w, h)
  return c
}

export const textureOf = (canvas, { srgb = true } = {}) => {
  const t = new THREE.CanvasTexture(canvas)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

// ---------- glows ----------

export const dotCanvas = () =>
  make(64, 64, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
    g.addColorStop(0, "rgba(255,255,255,1)")
    g.addColorStop(0.25, "rgba(255,255,255,0.75)")
    g.addColorStop(0.6, "rgba(255,255,255,0.18)")
    g.addColorStop(1, "rgba(255,255,255,0)")
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, w)
  })

// a flame licking upward: white-hot base, then lane-colored (tinted by the material)
export const flameCanvas = () =>
  make(128, 256, (ctx, w, h) => {
    const tongue = (cx, top, width, alpha) => {
      ctx.beginPath()
      ctx.moveTo(cx - width, h * 0.92)
      ctx.bezierCurveTo(cx - width * 1.1, h * 0.6, cx - width * 0.25, h * 0.45, cx, top)
      ctx.bezierCurveTo(cx + width * 0.3, h * 0.42, cx + width * 1.1, h * 0.62, cx + width, h * 0.92)
      ctx.closePath()
      const g = ctx.createLinearGradient(0, top, 0, h)
      g.addColorStop(0, `rgba(255,255,255,0)`)
      g.addColorStop(0.35, `rgba(255,255,255,${alpha * 0.55})`)
      g.addColorStop(0.85, `rgba(255,255,255,${alpha})`)
      g.addColorStop(1, `rgba(255,255,255,0)`)
      ctx.fillStyle = g
      ctx.fill()
    }
    ctx.filter = "blur(5px)"
    tongue(w * 0.5, h * 0.05, w * 0.34, 0.7)
    tongue(w * 0.36, h * 0.28, w * 0.18, 0.6)
    tongue(w * 0.64, h * 0.22, w * 0.2, 0.6)
    ctx.filter = "blur(8px)"
    const core = ctx.createRadialGradient(w / 2, h * 0.86, 2, w / 2, h * 0.86, w * 0.42)
    core.addColorStop(0, "rgba(255,255,255,1)")
    core.addColorStop(1, "rgba(255,255,255,0)")
    ctx.fillStyle = core
    ctx.fillRect(0, 0, w, h)
  })

// speaker cloth for the amps
export const grilleCanvas = () =>
  make(128, 128, (ctx, w) => {
    ctx.fillStyle = "#111014"
    ctx.fillRect(0, 0, w, w)
    ctx.strokeStyle = "rgba(90,84,70,0.35)"
    ctx.lineWidth = 1
    for (let i = -w; i < w * 2; i += 6) {
      ctx.beginPath()
      ctx.moveTo(i, 0)
      ctx.lineTo(i + w, w)
      ctx.moveTo(i + w, 0)
      ctx.lineTo(i, w)
      ctx.stroke()
    }
    ctx.strokeStyle = "#3a352c"
    ctx.lineWidth = 6
    ctx.strokeRect(3, 3, w - 6, w - 6)
  })

// ---------- silhouettes ----------
// Each figure is drawn as a black shape with a bright band along its top-right edges (the
// rim light from the stage lights behind). A material color tints the band.

const SIZE = { w: 512, h: 1024 }

const rimLit = (draw, { rim = 7 } = {}) =>
  make(SIZE.w, SIZE.h, (ctx, w, h) => {
    const mask = make(w, h, (m) => {
      m.fillStyle = "#fff"
      m.strokeStyle = "#fff"
      m.lineCap = "round"
      m.lineJoin = "round"
      draw(m)
    })
    // the rim: the shape minus itself nudged up and right
    const band = make(w, h, (b) => {
      b.drawImage(mask, 0, 0)
      b.globalCompositeOperation = "destination-out"
      b.drawImage(mask, -rim, rim)
    })
    ctx.drawImage(mask, 0, 0)
    ctx.globalCompositeOperation = "source-in"
    ctx.fillStyle = "#06060a"
    ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = "source-over"
    ctx.filter = "blur(1.5px)"
    ctx.globalAlpha = 0.95
    ctx.drawImage(band, 0, 0)
  })

const limb = (ctx, points, width) => {
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (const [x, y] of points.slice(1)) ctx.lineTo(x, y)
  ctx.stroke()
}

const poly = (ctx, points) => {
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (const [x, y] of points.slice(1)) ctx.lineTo(x, y)
  ctx.closePath()
  ctx.fill()
}

// The guitarist's body: wide stance, boots, a jacket, the fretting arm reaching for the
// neck. Head and the strumming forearm are separate pieces so they can move.
const drawBody = (ctx, { bassist = false } = {}) => {
  // legs and boots
  poly(ctx, [[200, 470], [266, 482], [190, 905], [128, 905]])
  poly(ctx, [[246, 482], [312, 470], [392, 905], [330, 905]])
  ctx.beginPath()
  ctx.ellipse(146, 918, 56, 22, -0.1, 0, Math.PI * 2)
  ctx.ellipse(372, 918, 56, 22, 0.1, 0, Math.PI * 2)
  ctx.fill()
  // torso with an open jacket
  poly(ctx, [[176, 250], [336, 250], [326, 330], [314, 478], [198, 478], [186, 330]])
  poly(ctx, [[198, 440], [178, 520], [236, 488]])
  poly(ctx, [[314, 440], [336, 520], [276, 488]])
  // neck and shoulders
  ctx.fillRect(236, 205, 40, 60)
  ctx.beginPath()
  ctx.ellipse(186, 268, 30, 26, 0, 0, Math.PI * 2)
  ctx.ellipse(326, 268, 30, 26, 0, 0, Math.PI * 2)
  ctx.fill()
  // fretting arm: down to the elbow, forearm up along the neck
  limb(ctx, [[184, 272], [128, 396], bassist ? [92, 318] : [78, 336]], 40)
  ctx.beginPath()
  ctx.arc(bassist ? 92 : 78, bassist ? 312 : 330, 22, 0, Math.PI * 2)
  ctx.fill()
  // strumming arm, shoulder to elbow
  limb(ctx, [[328, 272], [376, 404]], 42)
}

const drawHead = (ctx, { hair = "long" } = {}) => {
  ctx.beginPath()
  ctx.ellipse(256, 160, 42, 52, 0, 0, Math.PI * 2)
  ctx.fill()
  if (hair === "long") {
    // long hair falling past the shoulders
    ctx.beginPath()
    ctx.moveTo(206, 140)
    ctx.bezierCurveTo(200, 90, 312, 80, 308, 140)
    ctx.bezierCurveTo(326, 200, 330, 270, 316, 336)
    ctx.lineTo(288, 300)
    ctx.lineTo(282, 220)
    ctx.lineTo(232, 220)
    ctx.lineTo(226, 300)
    ctx.lineTo(196, 340)
    ctx.bezierCurveTo(184, 270, 188, 200, 206, 140)
    ctx.fill()
  } else if (hair === "spiky") {
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI * 0.95 + (i / 6) * Math.PI * 0.9
      poly(ctx, [[256 + Math.cos(a - 0.2) * 40, 150 + Math.sin(a - 0.2) * 48], [256 + Math.cos(a) * 82, 150 + Math.sin(a) * 92], [256 + Math.cos(a + 0.2) * 40, 150 + Math.sin(a + 0.2) * 48]])
    }
  } else {
    ctx.beginPath()
    ctx.ellipse(256, 132, 50, 36, 0, Math.PI, Math.PI * 2)
    ctx.fill()
  }
}

// An original guitar: an offset double-cut body slung at the hip, the neck up to the left
const drawGuitar = (ctx, { bass = false } = {}) => {
  ctx.save()
  ctx.translate(292, 516)
  ctx.rotate(-0.42)
  ctx.beginPath()
  ctx.moveTo(-96, 18)
  ctx.bezierCurveTo(-110, -40, -60, -70, -30, -52)
  ctx.bezierCurveTo(-10, -96, 30, -92, 22, -56)
  ctx.bezierCurveTo(60, -78, 118, -44, 104, 6)
  ctx.bezierCurveTo(118, 70, 40, 92, 0, 66)
  ctx.bezierCurveTo(-40, 92, -112, 74, -96, 18)
  ctx.fill()
  // neck and headstock
  const len = bass ? 330 : 270
  ctx.fillRect(-len - 60, -12, len, bass ? 20 : 22)
  poly(ctx, [[-len - 60, -14], [-len - 116, -26], [-len - 122, 10], [-len - 60, 10]])
  ctx.restore()
  // strap over the shoulder
  ctx.lineWidth = 10
  ctx.beginPath()
  ctx.moveTo(196, 268)
  ctx.quadraticCurveTo(250, 380, 360, 470)
  ctx.stroke()
}

// strumming forearm, elbow at (376, 404), hand on the strings
const drawForearm = (ctx) => {
  limb(ctx, [[376, 404], [318, 504]], 36)
  ctx.beginPath()
  ctx.arc(312, 512, 22, 0, Math.PI * 2)
  ctx.fill()
}

export const guitaristCanvases = (style = {}) => ({
  body: rimLit((ctx) => drawBody(ctx, style)),
  head: rimLit((ctx) => drawHead(ctx, style)),
  guitar: rimLit((ctx) => drawGuitar(ctx, style)),
  forearm: rimLit((ctx) => drawForearm(ctx)),
})

// The drummer: shoulders and head over the kit, two arms with sticks (one piece each)
export const drummerCanvases = () => ({
  body: rimLit((ctx) => {
    poly(ctx, [[170, 330], [342, 330], [330, 620], [182, 620]])
    ctx.beginPath()
    ctx.ellipse(170, 352, 34, 30, 0, 0, Math.PI * 2)
    ctx.ellipse(342, 352, 34, 30, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillRect(236, 270, 40, 70)
    ctx.beginPath()
    ctx.ellipse(256, 230, 44, 54, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(256, 196, 52, 36, 0, Math.PI, Math.PI * 2)
    ctx.fill()
  }),
  armL: rimLit((ctx) => {
    limb(ctx, [[176, 360], [120, 470], [176, 520]], 34)
    ctx.lineWidth = 9
    ctx.beginPath()
    ctx.moveTo(176, 520)
    ctx.lineTo(300, 470)
    ctx.stroke()
  }),
  armR: rimLit((ctx) => {
    limb(ctx, [[336, 360], [392, 470], [336, 520]], 34)
    ctx.lineWidth = 9
    ctx.beginPath()
    ctx.moveTo(336, 520)
    ctx.lineTo(212, 470)
    ctx.stroke()
  }),
})

// The crowd: four people in one strip (cells of 256x256): just a head, a fist in the
// air, both arms up, and a lighter held high
export const crowdCanvas = () =>
  make(1024, 256, (ctx) => {
    const person = (ox, arms) => {
      ctx.save()
      ctx.translate(ox, 0)
      ctx.fillStyle = "#000"
      ctx.strokeStyle = "#000"
      ctx.lineCap = "round"
      ctx.beginPath()
      ctx.ellipse(128, 150, 30, 36, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(40, 256)
      ctx.bezierCurveTo(44, 200, 86, 190, 128, 192)
      ctx.bezierCurveTo(170, 190, 212, 200, 216, 256)
      ctx.fill()
      ctx.lineWidth = 24
      if (arms >= 1) {
        ctx.beginPath()
        ctx.moveTo(186, 210)
        ctx.lineTo(206, 120)
        ctx.lineTo(196, 40)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(196, 34, 17, 0, Math.PI * 2)
        ctx.fill()
      }
      if (arms === 2) {
        ctx.beginPath()
        ctx.moveTo(70, 210)
        ctx.lineTo(50, 120)
        ctx.lineTo(62, 40)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(62, 34, 17, 0, Math.PI * 2)
        ctx.fill()
      }
      if (arms === 3) {
        ctx.beginPath()
        ctx.moveTo(186, 210)
        ctx.lineTo(214, 120)
        ctx.lineTo(206, 60)
        ctx.stroke()
        ctx.fillRect(196, 36, 16, 26)
        const g = ctx.createRadialGradient(204, 22, 1, 204, 22, 16)
        g.addColorStop(0, "rgba(255,240,180,1)")
        g.addColorStop(0.4, "rgba(255,160,40,0.9)")
        g.addColorStop(1, "rgba(255,120,0,0)")
        ctx.fillStyle = g
        ctx.fillRect(184, 0, 40, 40)
      }
      ctx.restore()
    }
    person(0, 0)
    person(256, 1)
    person(512, 2)
    person(768, 3)
  })

// the kick drum's front head: the band's name in a ring (an original logo)
export const kickHeadCanvas = (name = "SHRED") =>
  make(256, 256, (ctx, w) => {
    ctx.fillStyle = "#0b0b10"
    ctx.beginPath()
    ctx.arc(w / 2, w / 2, w / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = "#c8c8d0"
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.arc(w / 2, w / 2, w / 2 - 14, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = "#e8e8f0"
    ctx.font = "bold 52px Impact, 'Arial Black', sans-serif"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(name, w / 2, w / 2 - 6)
    ctx.font = "bold 26px Impact, 'Arial Black', sans-serif"
    ctx.fillText("98", w / 2, w / 2 + 40)
  })
