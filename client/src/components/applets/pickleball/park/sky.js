// My Park: the time of day follows the real clock (pure; Node-tested). Four looks (night,
// dawn/dusk, golden hour, day) blended by the hour: the sky, the sun (its direction, color
// and strength), the ambient light, fog, and whether the court lights are on.
// Real Sky (realLook below): the same looks blended by the true sun for a venue and the day's
// weather.

import { moonPosition, skyDir, sunPosition } from "./solar.js"
import { CLEAR } from "./weather.js"

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

// ---------------------------------------------------------------- Real Sky
// The same four looks, blended by where the sun really is (solar.js) for a venue's latitude
// and longitude at this moment, then the day's weather on top (weather.js): clouds dim and
// soften the sun and grey the sky, rain darkens it, low visibility thickens the fog. The sky
// dome's own colors come from atmosphere.js (physical scattering); these colors are its
// fallback, the fog and the ambient light. Pure (Node-tested).

// sun elevation (degrees) -> look
const EL_KEYS = [
  [-90, "night"],
  [-9, "night"],
  [-3.5, "dusk"],
  [2.5, "golden"],
  [13, "day"],
  [90, "day"],
]
const lookAtElevation = (el) => {
  let i = 0
  while (i < EL_KEYS.length - 2 && EL_KEYS[i + 1][0] <= el) i++
  const [e0, k0] = EL_KEYS[i]
  const [e1, k1] = EL_KEYS[i + 1]
  const t = Math.max(0, Math.min(1, e1 > e0 ? (el - e0) / (e1 - e0) : 0))
  return { a: LOOKS[k0], b: LOOKS[k1], t, kind: t < 0.5 ? k0 : k1 }
}
const OVERCAST = { top: 0x8e98a3, horizon: 0xb9c0c7, fog: 0xb4bbc2 }
const RAINY = { top: 0x5d6670, horizon: 0x8b939b, fog: 0x8d959c }

// when a fun override wants sunset or night: the moment today (local) it happens
export const overrideDate = (kind, lat, lon, now = new Date()) => {
  if (kind === "night") {
    const d = new Date(now)
    d.setHours(22, 30, 0, 0)
    return d
  }
  if (kind === "sunset") {
    // scan this afternoon for the sun dropping through 4 degrees
    const d = new Date(now)
    d.setHours(12, 0, 0, 0)
    for (let m = 0; m < 12 * 60; m += 5) {
      const t = new Date(d.getTime() + m * 60000)
      if (sunPosition(t, lat, lon).elevation < 4) return t
    }
    d.setHours(18, 30, 0, 0)
    return d
  }
  return now
}

// { date, lat, lon, weather } -> a look (dayLook's shape) plus { real, sunEl, sunAz, sunSky,
// moon, weather, haze }
export const realLook = ({ date = new Date(), lat, lon, weather = CLEAR } = {}) => {
  const w = { ...CLEAR, ...(weather || {}) }
  const sun = sunPosition(date, lat, lon)
  const moon = moonPosition(date, lat, lon)
  const { a, b, t, kind } = lookAtElevation(sun.elevation)
  const mix = (x, y) => lerpHex(x, y, t)
  let top = mix(a.sky[0], b.sky[0])
  let horizon = mix(a.sky[1], b.sky[1])
  let fog = mix(a.fog, b.fog)
  // the light from the sun (or the moon at night)
  const dayK = Math.max(0, Math.min(1, (sun.elevation + 2) / 10))
  const sDir = skyDir(sun.azimuth, Math.max(sun.elevation, 1.5))
  const mDir = skyDir(moon.azimuth, Math.max(moon.elevation, 10))
  const moonUp = moon.elevation > 0
  let sunI = lerp(a.sunI, b.sunI, t)
  let sunColor = mix(a.sun, b.sun)
  const dir = sun.elevation > -3 ? sDir : moonUp ? mDir : { x: 0.2, y: 0.95, z: 0.25 }
  if (sun.elevation <= -3) sunI = moonUp ? 0.25 + 0.4 * moon.lit : 0.25
  // weather: clouds take the direct sun and add soft light; rain darkens; fog greys
  const c = w.cover
  const direct = 1 - 0.82 * Math.pow(c, 1.4) - 0.35 * w.rain
  sunI *= Math.max(0.08, direct)
  const greyK = Math.min(1, c * 0.85 + w.rain * 0.3)
  const grey = w.rain > 0.15 ? RAINY : OVERCAST
  const dim = (hex) => lerpHex(hex, 0x000000, Math.min(0.85, 1 - dayK * 0.95))
  top = lerpHex(top, dim(grey.top), greyK * dayK)
  horizon = lerpHex(horizon, dim(grey.horizon), greyK * dayK)
  fog = lerpHex(fog, dim(grey.fog), Math.min(1, greyK * dayK + w.fog * 0.6))
  const hemiI = lerp(a.hemi[2], b.hemi[2], t) * (1 + 0.22 * c - 0.15 * w.rain)
  const hemiSky = lerpHex(mix(a.hemi[0], b.hemi[0]), 0xd6dde4, greyK * 0.6 * dayK)
  sunColor = lerpHex(sunColor, 0xe8eef5, greyK * 0.5)
  // the camera's exposure: a lower sun puts less light on flat ground, and a camera (or an eye)
  // opens up for it, so the photo-matched paint reads true in any season (clear-sky light only:
  // clouds still darken the scene)
  const flat = (el) => 0.9 + 2.6 * Math.sin((Math.max(el, 4) * Math.PI) / 180)
  // (a low sun stays a low sun: the opening-up fades out toward the horizon, so golden hour
  // and dusk keep their mood)
  const expCap = 1 + 0.35 * Math.max(0, Math.min(1, (sun.elevation - 2) / 16))
  const autoExp = sun.elevation > 2 ? Math.max(1, Math.min(expCap, flat(76) / flat(sun.elevation))) : 1
  return {
    hour: date.getHours() + date.getMinutes() / 60,
    kind,
    real: true,
    sunEl: sun.elevation,
    sunAz: sun.azimuth,
    sunSky: skyDir(sun.azimuth, sun.elevation), // the true direction (may be below the horizon)
    moon: { ...moon, dir: skyDir(moon.azimuth, moon.elevation) },
    weather: w,
    haze: w.haze ?? 1,
    sky: [top, horizon],
    sun: { color: sunColor, intensity: sunI, dir },
    hemi: [hemiSky, mix(a.hemi[1], b.hemi[1]), hemiI],
    fog,
    exposure: lerp(a.exposure, b.exposure, t) * (1 - 0.05 * w.rain) * autoExp,
    ground: lerp(a.ground, b.ground, t),
    lights: sun.elevation < 3 || (c > 0.85 && w.rain > 0.4 && sun.elevation < 12),
    stars: sun.elevation < -8 && c < 0.6,
  }
}
