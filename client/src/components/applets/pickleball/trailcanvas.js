// Draws the swipe trail and the Classic ripples (swipetrail.js) on a 2D canvas laid over the
// court (pointer-events: none, so it never takes a touch). Runs a frame loop only while
// something is on it.

import { addPoint, colorForKind, createRipple, createTrail, outline, release, ribbon, rippleAt, SHOT_COLORS, swipeLook } from "./swipetrail.js"

const RESOLVE_S = 0.8 // a hit this soon after the lift recolors the trail with its real shot
const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`
}

export const createTrailCanvas = (canvas) => {
  const ctx = canvas.getContext("2d")
  let trails = []
  let ripples = []
  let live = null
  let raf = 0
  let enabled = true
  let rect = { left: 0, top: 0, width: 1, height: 1 }
  let dpr = 1
  const stats = { trails: 0, drawn: 0, maxPoints: 0, lastColor: null, lastAlpha: 0, ripples: 0, lastLength: 0 }
  const now = () => performance.now() / 1000

  const fit = () => {
    const r = canvas.getBoundingClientRect()
    rect = r
    dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = Math.max(1, Math.round(r.width * dpr))
    const h = Math.max(1, Math.round(r.height * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
  }
  const local = (p) => ({ x: p.x - rect.left, y: p.y - rect.top, t: p.t })

  const drawTrail = (t, at) => {
    const pts = ribbon(t, at)
    if (pts.length < 2) {
      if (pts.length === 1) {
        // (a tap: a dot where the finger is)
        ctx.globalAlpha = pts[0].a
        ctx.fillStyle = t.color
        ctx.beginPath()
        ctx.arc(pts[0].x, pts[0].y, pts[0].w * 0.6, 0, Math.PI * 2)
        ctx.fill()
      }
      return pts.length
    }
    // one filled shape per pass (no overlapping segments, so no beads), faint at the start
    // and full at the fingertip: a soft dark edge so it reads on a bright court, the color,
    // then a bright core
    const a0 = pts[0]
    const a1 = pts[pts.length - 1]
    for (const [color, wMul, aMul] of [
      ["#0a1428", 1.4, 0.3],
      [t.color, 1, 0.88],
      ["#ffffff", 0.34, 0.6],
    ]) {
      const shape = outline(pts, wMul)
      const grad = ctx.createLinearGradient(a0.x, a0.y, a1.x, a1.y)
      grad.addColorStop(0, rgba(color, a0.a * aMul))
      grad.addColorStop(1, rgba(color, a1.a * aMul))
      ctx.globalAlpha = 1
      ctx.fillStyle = grad
      ctx.beginPath()
      shape.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)))
      ctx.closePath()
      ctx.fill()
    }
    return pts.length
  }

  const frame = () => {
    raf = 0
    const at = now()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)
    let drawn = 0
    trails = trails.filter((t) => {
      const n = drawTrail(t, at)
      if (n) {
        drawn++
        stats.maxPoints = Math.max(stats.maxPoints, n)
      }
      return n > 0 || t === live
    })
    ripples = ripples.filter((r) => {
      const s = rippleAt(r, at)
      if (!s) return false
      ctx.globalAlpha = s.alpha
      ctx.strokeStyle = s.color
      ctx.lineWidth = s.line
      ctx.beginPath()
      ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2)
      ctx.stroke()
      return true
    })
    ctx.globalAlpha = 1
    stats.drawn = drawn
    const last = trails[trails.length - 1]
    stats.lastAlpha = last ? +(ribbon(last, at)[0]?.a ?? 0).toFixed(3) : 0
    if (trails.length || ripples.length) raf = requestAnimationFrame(frame)
  }
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(frame)
  }

  const api = {
    setEnabled(on) {
      enabled = !!on
      if (!enabled) {
        trails = []
        ripples = []
        live = null
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
    },
    // Swipe: the finger goes down / moves / lifts (client px, performance.now() ms)
    start(p) {
      if (!enabled) return
      fit()
      live = createTrail(local(p))
      trails.push(live)
      if (trails.length > 4) trails.shift()
      stats.trails++
      kick()
    },
    // color: the pace the finger is swiping at so far (it settles on the shot at the lift)
    move(p, color) {
      if (!live) return
      addPoint(live, local(p))
      if (color && !live.resolved) live.color = color
      kick()
    },
    // sw: the finished swipe (touchplay.js readSwipe): its color until the hit says for sure
    end(p, sw) {
      if (!live) return
      if (p) addPoint(live, local(p))
      // (the ball may already have been met while the finger was still down: keep that shot)
      release(live, now(), live.resolved ? null : swipeLook(sw).color)
      stats.lastColor = live.color
      stats.lastLength = live.pts.length
      live = null
      kick()
    },
    cancel() {
      if (!live) return
      release(live, now(), SHOT_COLORS.miss)
      live = null
      kick()
    },
    // the shot that came of it (the hit event's kind), or a whiff: recolor the trail being
    // drawn, or the last one if it lifted just now
    resolve(kind, whiff = false) {
      const t = live || trails[trails.length - 1]
      if (!t || t.resolved || (t !== live && (t.upAt === null || now() - t.upAt > RESOLVE_S))) return false
      t.resolved = true
      t.color = whiff ? SHOT_COLORS.miss : colorForKind(kind)
      stats.lastColor = t.color
      kick()
      return true
    },
    // Classic: a small ripple at the touch (big: the release, in the pace's color)
    ripple(x, y, color = SHOT_COLORS.touch, big = false) {
      if (!enabled) return
      fit()
      ripples.push(createRipple(x - rect.left, y - rect.top, now(), color, big))
      if (ripples.length > 8) ripples.shift()
      stats.ripples++
      kick()
    },
    // (tests) what's on it
    info() {
      return { ...stats, live: !!live, onScreen: trails.length, ripplesOn: ripples.length, enabled }
    },
    dispose() {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      trails = []
      ripples = []
    },
  }
  return api
}
