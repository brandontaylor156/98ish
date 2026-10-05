// My Park: the time of day follows the real clock (pure; Node-tested). Four looks (night,
// dawn/dusk, golden hour, day) blended by the hour: the sky, the sun (its direction, color
// and strength), the ambient light, fog, and whether the court lights are on.

const LOOKS = {
  night: { sky: [0x070b1e, 0x1a2348], sun: 0x9fb0ff, sunI: 0.55, hemi: [0x6f80c8, 0x1a1d2a, 0.75], fog: 0x0e1430, exposure: 1.05, ground: 0.42 },
  dusk: { sky: [0x2c3a78, 0xf08a5a], sun: 0xffa060, sunI: 1.3, hemi: [0xffc9a0, 0x3a3a4a, 1.0], fog: 0xd88a6a, exposure: 1.05, ground: 0.75 },
  golden: { sky: [0x4f6fc0, 0xffc184], sun: 0xffc98a, sunI: 2.4, hemi: [0xffe0c0, 0x4a5a3a, 1.2], fog: 0xf2c49a, exposure: 1.02, ground: 0.92 },
  day: { sky: [0x3f8fe0, 0xd8ecfb], sun: 0xfff3dc, sunI: 2.6, hemi: [0xdcefff, 0x4d7a3c, 1.4], fog: 0xd8ecfb, exposure: 1, ground: 1 },
}
// key hours and the look at each (blended between neighbours)
const KEYS = [
  [0, "night"],
  [5.2, "night"],
  [6.3, "dusk"],
  [7.6, "golden"],
  [9.5, "day"],
  [16.5, "day"],
  [18.3, "golden"],
  [19.6, "dusk"],
  [20.6, "night"],
  [24, "night"],
]

const lerpHex = (a, b, t) => {
  const ch = (h, s) => (h >> s) & 255
  const mix = (s) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t)
  return (mix(16) << 16) | (mix(8) << 8) | mix(0)
}
const lerp = (a, b, t) => a + (b - a) * t

// hour: 0..24 (fractions allowed) -> { kind, sky: [top, horizon], sun: { color, intensity,
// dir: { x, y, z } }, hemi: [sky, ground, intensity], fog, exposure, ground (grass shade),
// lights (court lights on), stars }
export const dayLook = (hour) => {
  const h = ((hour % 24) + 24) % 24
  let i = 0
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++
  const [h0, k0] = KEYS[i]
  const [h1, k1] = KEYS[i + 1]
  const t = h1 > h0 ? (h - h0) / (h1 - h0) : 0
  const a = LOOKS[k0]
  const b = LOOKS[k1]
  // the sun's path: up in the east at 6, highest at 13, down in the west at 20 (the moon at
  // night, high in the south)
  const day = h >= 6 && h <= 20
  const u = day ? (h - 6) / 14 : 0.5
  const elev = day ? Math.max(0.12, Math.sin(u * Math.PI)) : 0.75
  const az = day ? lerp(-1.2, 1.2, u) : 0.4
  const dir = { x: Math.sin(az) * Math.cos(Math.asin(elev)), y: elev, z: -Math.cos(az) * Math.cos(Math.asin(elev)) * 0.6 + 0.4 }
  const kind = t < 0.5 ? k0 : k1
  return {
    hour: h,
    kind,
    sky: [lerpHex(a.sky[0], b.sky[0], t), lerpHex(a.sky[1], b.sky[1], t)],
    sun: { color: lerpHex(a.sun, b.sun, t), intensity: lerp(a.sunI, b.sunI, t), dir },
    hemi: [lerpHex(a.hemi[0], b.hemi[0], t), lerpHex(a.hemi[1], b.hemi[1], t), lerp(a.hemi[2], b.hemi[2], t)],
    fog: lerpHex(a.fog, b.fog, t),
    exposure: lerp(a.exposure, b.exposure, t),
    ground: lerp(a.ground, b.ground, t),
    lights: h < 6.8 || h > 18.9,
    stars: h < 5.6 || h > 20.2,
  }
}

export const hourOf = (date = new Date()) => date.getHours() + date.getMinutes() / 60
