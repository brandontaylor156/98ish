// Pixel effects: frame-by-frame explosions, sparkles and a tiny particle system (pure, tested
// in retro.test.js). Everything is drawn in palette indices with hard edges and dithered
// falloff, like a 1990s sprite sheet.
//
//   explosionFrames({ size, frames, fire, smoke, seed })  -> sprites (fire/smoke: ramps)
//   sparkleFrames({ size, colors })                       -> 4 twinkle sprites
//   createParticles()   .burst({ x, y, n, speed, colors, life, gravity }) .step(dt) .draw(b)

import { createBitmap, disc, paint, rect, pset } from "./bitmap.js"
import { rampAt, threshold } from "./dither.js"

const rand = (seed) => {
  let a = seed >>> 0 || 1
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A cartoon blast in `frames` steps: a white flash, a lumpy fireball that swells and cools
// (white -> yellow -> orange -> red), then breaks into smoke puffs that drift up and thin out
// (dithered away). fire: ramp dark -> light (red ... white); smoke: ramp dark -> light.
export const explosionFrames = ({ size = 40, frames = 8, fire, smoke, seed = 7 } = {}) => {
  const r = rand(seed)
  const c = size / 2
  // lumps round the edge, fixed for every frame so it grows like one shape
  const lumps = Array.from({ length: 9 }, (_, k) => ({ a: (k / 9) * Math.PI * 2 + r() * 0.5, d: 0.55 + r() * 0.3, s: 0.35 + r() * 0.25 }))
  const puffs = Array.from({ length: 6 }, (_, k) => ({ a: (k / 6) * Math.PI * 2 + r(), d: 0.35 + r() * 0.3, s: 0.22 + r() * 0.12 }))
  const out = []
  for (let f = 0; f < frames; f++) {
    const t = f / (frames - 1) // 0..1
    const b = createBitmap(size, size)
    if (f === 0) {
      // the flash: a small white star
      disc(b, c, c, size * 0.16, fire[fire.length - 1])
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2
        for (let d = 0; d < size * 0.34; d++) pset(b, c + Math.cos(a) * d, c + Math.sin(a) * d, fire[fire.length - 1 - (d > size * 0.2 ? 1 : 0)])
      }
      out.push(b)
      continue
    }
    const grow = Math.min(1, 0.45 + t * 1.4) // swells fast, then holds
    const heat = Math.max(0, 1 - t * 1.25) // cools over the frames
    const thin = Math.max(0, (t - 0.55) / 0.45) // the smoke fades at the end
    const rise = t * size * 0.12
    // fireball: a union of lumps, shaded by distance from the middle and the heat
    if (heat > 0.05) {
      paint(b, 0, 0, size, size, (x, y) => {
        let best = 0
        const dx0 = (x + 0.5 - c) / c
        const dy0 = (y + 0.5 - c + rise * 0.5) / c
        const core = Math.hypot(dx0, dy0) / (0.5 * grow)
        best = Math.max(best, 1 - core)
        for (const l of lumps) {
          const lx = Math.cos(l.a) * l.d * 0.62 * grow
          const ly = Math.sin(l.a) * l.d * 0.62 * grow
          const v = 1 - Math.hypot(dx0 - lx, dy0 - ly) / (l.s * grow)
          if (v > best) best = v
        }
        if (best <= 0) return -1
        // holes appear as it burns out
        if (heat < 0.5 && best < (0.5 - heat) * 0.9 && threshold(x, y) < 0.7) return -1
        const tt = Math.min(1, best * 1.3 * (0.35 + heat * 0.9))
        return rampAt(fire, tt, x, y)
      })
    }
    // smoke puffs (from the middle frames on)
    if (t > 0.3) {
      for (const p of puffs) {
        const px = c + Math.cos(p.a) * p.d * c * grow * 1.1
        const py = c + Math.sin(p.a) * p.d * c * grow - rise * 2
        const pr = p.s * c * (0.8 + t * 0.9)
        paint(b, px - pr - 1, py - pr - 1, pr * 2 + 2, pr * 2 + 2, (x, y) => {
          const d = Math.hypot(x + 0.5 - px, y + 0.5 - py) / pr
          if (d > 1) return -1
          // dithered thinning: fewer pixels as it fades
          if (threshold(x, y) < thin) return -1
          if (b.data[y * b.w + x] && heat > 0.4) return -1 // fire stays in front early on
          return rampAt(smoke, 1 - d * 0.7, x, y)
        })
      }
    }
    out.push(b)
  }
  return out
}

// a four-frame twinkle (+ shape growing then shrinking): colors [dim, bright, white]
export const sparkleFrames = ({ size = 7, colors }) => {
  const c = Math.floor(size / 2)
  const lens = [1, 2, c, 2]
  return lens.map((len, f) => {
    const b = createBitmap(size, size)
    for (let d = -len; d <= len; d++) {
      const col = Math.abs(d) === 0 ? colors[2] : Math.abs(d) < len ? colors[1] : colors[0]
      pset(b, c + d, c, col)
      pset(b, c, c + d, col)
    }
    if (f === 2) {
      pset(b, c - 1, c - 1, colors[0])
      pset(b, c + 1, c - 1, colors[0])
      pset(b, c - 1, c + 1, colors[0])
      pset(b, c + 1, c + 1, colors[0])
    }
    return b
  })
}

// square pixel particles with gravity; each { x, y, vx, vy, life, max, color(s), size }
export const createParticles = (max = 200) => {
  const list = []
  return {
    list,
    burst({ x, y, n = 12, speed = 40, spread = Math.PI * 2, angle = -Math.PI / 2, colors = [1], life = 0.6, gravity = 120, size = 1, random = Math.random }) {
      for (let k = 0; k < n && list.length < max; k++) {
        const a = angle + (random() - 0.5) * spread
        const v = speed * (0.4 + random() * 0.8)
        const l = life * (0.6 + random() * 0.6)
        list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: l, max: l, colors, gravity, size })
      }
    },
    step(dt) {
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i]
        p.life -= dt
        if (p.life <= 0) {
          list.splice(i, 1)
          continue
        }
        p.vy += p.gravity * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
      }
    },
    draw(b) {
      for (const p of list) {
        const k = Math.min(p.colors.length - 1, Math.floor((1 - p.life / p.max) * p.colors.length))
        rect(b, Math.round(p.x), Math.round(p.y), p.size, p.size, p.colors[k])
      }
    },
    clear: () => (list.length = 0),
  }
}
