// Real Sky (docs/venue-realism.md): where the sun and the moon are for a place and a moment.
// Pure (Node-tested in realsky.test.js).
//
// The sun: NOAA's solar position algorithm (the spreadsheet's equations: mean anomaly,
// equation of center, obliquity, equation of time), good to well under a degree for any
// year this game will see, with atmospheric refraction near the horizon. The moon: the
// low-precision series from Meeus (main terms only, about a degree), plus its phase from the
// sun-moon elongation. Angles in degrees; azimuth clockwise from north.

const RAD = Math.PI / 180
const DEG = 180 / Math.PI
const julian = (date) => date.getTime() / 86400000 + 2440587.5

// refraction (degrees) for an apparent elevation near the horizon (NOAA's piecewise fit)
const refraction = (el) => {
  if (el > 85) return 0
  const te = Math.tan(el * RAD)
  if (el > 5) return (58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5) / 3600
  if (el > -0.575) return (1735 + el * (-518.2 + el * (103.4 + el * (-12.79 + el * 0.711)))) / 3600
  return -20.772 / te / 3600
}

// the sun for a moment (Date) at lat/lon (degrees, east positive) ->
// { azimuth, elevation, declination, eqTime (minutes) }
export const sunPosition = (date, lat, lon) => {
  const t = (julian(date) - 2451545) / 36525
  const L0 = (((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360) + 360) % 360
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t)
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
  const Mr = M * RAD
  const C = Math.sin(Mr) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * Mr) * (0.019993 - 0.000101 * t) + Math.sin(3 * Mr) * 0.000289
  const omega = 125.04 - 1934.136 * t
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD)
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD)
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD))
  const y = Math.tan((eps / 2) * RAD) ** 2
  const L0r = L0 * RAD
  const eqTime =
    4 * DEG * (y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr) + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) - 0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr))
  const minutesUtc = (((date.getTime() / 60000) % 1440) + 1440) % 1440
  const tst = (((minutesUtc + eqTime + 4 * lon) % 1440) + 1440) % 1440
  let ha = tst / 4 - 180
  if (ha < -180) ha += 360
  const latR = lat * RAD
  const har = ha * RAD
  const cosZ = Math.max(-1, Math.min(1, Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(har)))
  const zenith = Math.acos(cosZ) * DEG
  const az = ((Math.atan2(Math.sin(har), Math.cos(har) * Math.sin(latR) - Math.tan(decl) * Math.cos(latR)) * DEG + 180) % 360 + 360) % 360
  const geo = 90 - zenith
  return { azimuth: az, elevation: geo + refraction(geo), declination: decl * DEG, eqTime }
}

// the moon (Meeus' low-precision terms) -> { azimuth, elevation, phase (0 new .. 0.5 full ..
// 1 new), lit (illuminated fraction 0..1), waxing }
export const moonPosition = (date, lat, lon) => {
  const d = julian(date) - 2451545
  const L = (218.316 + 13.176396 * d) * RAD
  const M = (134.963 + 13.064993 * d) * RAD
  const F = (93.272 + 13.22935 * d) * RAD
  const l = L + 6.289 * RAD * Math.sin(M) // ecliptic longitude
  const b = 5.128 * RAD * Math.sin(F) // ecliptic latitude
  const e = 23.4397 * RAD
  const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l))
  const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l))
  const sidereal = (280.16 + 360.9856235 * d) * RAD + lon * RAD
  const H = sidereal - ra
  const latR = lat * RAD
  const alt = Math.asin(Math.sin(latR) * Math.sin(dec) + Math.cos(latR) * Math.cos(dec) * Math.cos(H))
  const azS = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(latR) - Math.tan(dec) * Math.cos(latR)) // from south, westward
  // the phase from the moon's and the sun's ecliptic longitudes
  const t = d / 36525
  const sunL = (280.46646 + 36000.76983 * t + 1.9146 * Math.sin((357.52911 + 35999.05029 * t) * RAD)) * RAD
  const elong = ((((l - sunL) / RAD) % 360) + 360) % 360
  const altD = alt * DEG
  return {
    azimuth: (((azS * DEG + 180) % 360) + 360) % 360,
    elevation: altD + refraction(altD),
    phase: elong / 360,
    lit: (1 - Math.cos(elong * RAD)) / 2,
    waxing: elong < 180,
  }
}

// a sky direction (azimuth/elevation, degrees) in a venue's frame: x east, y up, z south
export const skyDir = (azimuth, elevation) => {
  const a = azimuth * RAD
  const el = elevation * RAD
  return { x: Math.sin(a) * Math.cos(el), y: Math.sin(el), z: -Math.cos(a) * Math.cos(el) }
}

// the local clock hour at a longitude (solar-ish, for the look's names and the court lights'
// schedule when the time zone isn't known): the device's own time zone is used by the game
export const localHour = (date = new Date()) => date.getHours() + date.getMinutes() / 60
