// Real Sky: the clear sky's color in every direction, from physics: single scattering of
// sunlight by air (Rayleigh: blue sky, red sunsets) and haze (Mie: the bright glow round the
// sun, a pale horizon), integrated along each view ray through a 60 km atmosphere with the
// Earth's shadow. Pure JS (Node-tested): it runs on the CPU into a small texture (64 x 32,
// a few ms) whenever the sun moves half a degree or the haze changes, so the phone's GPU only
// samples a texture: no per-pixel ray marching, the cost of the old gradient.
//
// Texture layout: u = azimuth (0..1 = 0..360 degrees from north, clockwise), v = elevation
// through V_POW (more rows near the horizon, where the color changes fastest), from EL_MIN to
// 90 degrees. The values are tone-mapped (1 - e^-kL) and sRGB-encoded bytes.

export const SKY_W = 64
export const SKY_H = 32
export const EL_MIN = -6 // degrees (a little below the horizon: fog meets it)
export const V_POW = 1.8 // el = EL_MIN + (90 - EL_MIN) * v^V_POW

const R_EARTH = 6360e3
const R_ATMOS = 6420e3
const H_R = 7994 // Rayleigh scale height (m)
const H_M = 1200 // Mie scale height (m)
const BETA_R = [5.8e-6, 13.5e-6, 33.1e-6] // per meter, red/green/blue
const BETA_M = 6e-6 // a clear day's aerosols (haze multiplies it)
const G = 0.76 // Mie anisotropy (forward glow)
const SUN_I = 20

const VIEW_STEPS = 16
const LIGHT_STEPS = 6

// the distance along a ray from o (inside a sphere of radius r at the origin) to its edge
const toSphere = (ox, oy, oz, dx, dy, dz, r) => {
  const b = ox * dx + oy * dy + oz * dz
  const c = ox * ox + oy * oy + oz * oz - r * r
  const disc = b * b - c
  if (disc < 0) return -1
  return -b + Math.sqrt(disc)
}
// does a ray from o hit the ground (the Earth sphere) ahead?
const hitsGround = (ox, oy, oz, dx, dy, dz) => {
  const b = ox * dx + oy * dy + oz * dz
  const c = ox * ox + oy * oy + oz * oz - R_EARTH * R_EARTH
  const disc = b * b - c
  return disc > 0 && -b - Math.sqrt(disc) > 0
}

// radiance (linear, HDR) toward the viewer from direction d = [x, y, z] (y up), sun s (unit,
// toward the sun); haze multiplies the Mie (aerosol) amount: 1 a clear day, 3+ a hazy one
export const skyRadiance = (d, s, haze = 1) => {
  const [dx, dy, dz] = d
  const ox = 0
  const oy = R_EARTH + 2
  const oz = 0
  // below the horizon: march only to the ground (the sky's own color there fades into fog)
  const tMax = toSphere(ox, oy, oz, dx, dy, dz, R_ATMOS)
  if (tMax <= 0) return [0, 0, 0]
  const mu = dx * s[0] + dy * s[1] + dz * s[2]
  const phaseR = (3 / (16 * Math.PI)) * (1 + mu * mu)
  const phaseM = (3 / (8 * Math.PI)) * (((1 - G * G) * (1 + mu * mu)) / ((2 + G * G) * Math.pow(1 + G * G - 2 * G * mu, 1.5)))
  const bm = BETA_M * haze
  let odR = 0
  let odM = 0
  let sr0 = 0
  let sr1 = 0
  let sr2 = 0
  let sm0 = 0
  let sm1 = 0
  let sm2 = 0
  for (let i = 0; i < VIEW_STEPS; i++) {
    // (samples packed near the viewer, where the air is thick: t = tMax u^2)
    const u = (i + 0.5) / VIEW_STEPS
    const t = tMax * u * u
    const seg = (tMax * 2 * u) / VIEW_STEPS
    const px = ox + dx * t
    const py = oy + dy * t
    const pz = oz + dz * t
    const h = Math.hypot(px, py, pz) - R_EARTH
    if (h < 0) break
    const hr = Math.exp(-h / H_R) * seg
    const hm = Math.exp(-h / H_M) * seg
    odR += hr
    odM += hm
    // the sunlight reaching this point (in the Earth's shadow: none)
    if (hitsGround(px, py, pz, s[0], s[1], s[2])) continue
    const lMax = toSphere(px, py, pz, s[0], s[1], s[2], R_ATMOS)
    const lseg = lMax / LIGHT_STEPS
    let lR = 0
    let lM = 0
    for (let j = 0; j < LIGHT_STEPS; j++) {
      const lt = lseg * (j + 0.5)
      const lh = Math.hypot(px + s[0] * lt, py + s[1] * lt, pz + s[2] * lt) - R_EARTH
      lR += Math.exp(-lh / H_R) * lseg
      lM += Math.exp(-lh / H_M) * lseg
    }
    const tauM = bm * 1.1 * (odM + lM)
    const a0 = Math.exp(-(BETA_R[0] * (odR + lR) + tauM))
    const a1 = Math.exp(-(BETA_R[1] * (odR + lR) + tauM))
    const a2 = Math.exp(-(BETA_R[2] * (odR + lR) + tauM))
    sr0 += a0 * hr
    sr1 += a1 * hr
    sr2 += a2 * hr
    sm0 += a0 * hm
    sm1 += a1 * hm
    sm2 += a2 * hm
  }
  return [
    SUN_I * (sr0 * BETA_R[0] * phaseR + sm0 * bm * phaseM),
    SUN_I * (sr1 * BETA_R[1] * phaseR + sm1 * bm * phaseM),
    SUN_I * (sr2 * BETA_R[2] * phaseR + sm2 * bm * phaseM),
  ]
}

// the elevation (degrees) of a texture row's middle, and back (the shader does the inverse)
export const rowElevation = (v) => EL_MIN + (90 - EL_MIN) * Math.pow(v, V_POW)

const srgb = (x) => {
  const c = Math.max(0, Math.min(1, x))
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055))
}

// the whole sky for a sun direction (unit, toward the sun) -> Uint8Array RGBA (SKY_W x SKY_H),
// tone-mapped with exposure k (the game's paint calibration keeps the midday zenith near the
// old look's blue). Also returns the horizon's average color (for fog) and the zenith's.
export const renderSky = (sun, { haze = 1, exposure = 2, saturation = 1.3, w = SKY_W, h = SKY_H } = {}) => {
  const data = new Uint8Array(w * h * 4)
  const horizon = [0, 0, 0]
  const zenith = [0, 0, 0]
  const RAD = Math.PI / 180
  for (let y = 0; y < h; y++) {
    const el = rowElevation((y + 0.5) / h) * RAD
    for (let x = 0; x < w; x++) {
      const az = ((x + 0.5) / w) * 2 * Math.PI
      const d = [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)]
      const L = skyRadiance(d, sun, haze)
      const i = (y * w + x) * 4
      // tone map, then a camera-like saturation (a phone camera white-balances the sky's blue up)
      const t = L.map((v) => 1 - Math.exp(-v * exposure))
      const lum = 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2]
      const c = t.map((v) => Math.max(0, lum + (v - lum) * saturation))
      data[i] = srgb(c[0])
      data[i + 1] = srgb(c[1])
      data[i + 2] = srgb(c[2])
      data[i + 3] = 255
      if (Math.abs(el / RAD - 2) < 3) for (let k = 0; k < 3; k++) horizon[k] += c[k] / w
      if (y === h - 1) for (let k = 0; k < 3; k++) zenith[k] += c[k] / w
    }
  }
  const rows = Math.max(1, [...Array(h).keys()].filter((y) => Math.abs(rowElevation((y + 0.5) / h) - 2) < 3).length)
  return { data, w, h, horizon: horizon.map((v) => v / rows), zenith }
}
