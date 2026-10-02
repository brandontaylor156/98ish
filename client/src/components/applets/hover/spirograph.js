/*
 * Geometry of the original CSS "spirograph" loader, evaluated in JS.
 *
 * The CSS version was 26 spans (each rotated 16deg * i inside a 300x300 box), each with
 * a 15px ::before carrying 8 box-shadows (4 solid + 4 blurred-20px squares at +-30px)
 * that rotated 0->360deg with filter: hue-rotate(0->360deg) over 2s, delayed -0.25s * i,
 * around transform-origin (1px, 50%). Hovering moved the origin to 250px and the shadows
 * to +-200px over 2s. All units below are those original CSS pixels ("loader units").
 */

export const ARMS = 26
const ARM_STEP = (16 * Math.PI) / 180
const PERIOD = 2000 // ms per rotation and per hue cycle
const DELAY = 250 // ms phase lead per arm
export const SQUARE = 15
export const HALF = SQUARE / 2
const BOX = 300
const ORIGIN_IDLE = 1
const ORIGIN_HOVER = 250
const OFFSET_IDLE = 30
const OFFSET_HOVER = 200
export const BLUR_SIGMA = 10 // CSS box-shadow blur 20px == gaussian sigma 10px
export const GLOW_PAD = 30 // how far the glow is drawn past the square's edge
export const SQUARES = ARMS * 4

// Paint order of one element's shadows: CSS paints the shadow list back to front, so
// the last listed (-30,+30) pair goes down first. Each square = its glow, then its solid.
const CORNERS = [[-1, 1], [1, -1], [1, 1], [-1, -1]]

// CSS filter: hue-rotate(deg) matrix applied to #00efff -> [r, g, b] in 0..1
function hueRotate(deg) {
  const a = (deg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  const r = 0, g = 239 / 255, b = 1
  const clamp = (v) => Math.min(1, Math.max(0, v))
  return [
    clamp((0.213 + c * 0.787 - s * 0.213) * r + (0.715 - c * 0.715 - s * 0.715) * g + (0.072 - c * 0.072 + s * 0.928) * b),
    clamp((0.213 - c * 0.213 + s * 0.143) * r + (0.715 + c * 0.285 + s * 0.14) * g + (0.072 - c * 0.072 - s * 0.283) * b),
    clamp((0.213 - c * 0.213 - s * 0.787) * r + (0.715 - c * 0.715 + s * 0.715) * g + (0.072 + c * 0.928 + s * 0.072) * b),
  ]
}

export const HUES = 360
export const HUE_RGB = new Float32Array(HUES * 3)
for (let d = 0; d < HUES; d++) HUE_RGB.set(hueRotate(d), d * 3)
export const hueCss = (d) =>
  `rgb(${Math.round(HUE_RGB[d * 3] * 255)}, ${Math.round(HUE_RGB[d * 3 + 1] * 255)}, ${Math.round(HUE_RGB[d * 3 + 2] * 255)})`

export const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2)

// Floats per square in the output buffer: centre x, y (device px), cos, sin of the
// square's rotation, hue index (0..359).
export const STRIDE = 5

/**
 * Fill `out` (Float32Array(SQUARES * STRIDE)) for time `clock` (ms) and expansion
 * `expand` (0..1, already eased). `cx, cy` is the centre and `scale` device px per unit.
 */
export function computeSquares(out, clock, expand, cx, cy, scale) {
  const ox = ORIGIN_IDLE + (ORIGIN_HOVER - ORIGIN_IDLE) * expand
  const oy = HALF
  const d = OFFSET_IDLE + (OFFSET_HOVER - OFFSET_IDLE) * expand
  let o = 0
  for (let i = 1; i <= ARMS; i++) {
    const phase = ((((clock + DELAY * i) % PERIOD) + PERIOD) % PERIOD) / PERIOD
    const theta = phase * Math.PI * 2
    const armA = ARM_STEP * i
    const ct = Math.cos(theta), st = Math.sin(theta)
    const ca = Math.cos(armA), sa = Math.sin(armA)
    const rc = Math.cos(theta + armA), rs = Math.sin(theta + armA)
    const hue = Math.floor(phase * HUES) % HUES
    for (let k = 0; k < 4; k++) {
      // square centre inside the ::before box, rotated about its transform-origin...
      const vx = HALF + CORNERS[k][0] * d - ox
      const vy = HALF + CORNERS[k][1] * d - oy
      const px = ox + ct * vx - st * vy - BOX / 2
      const py = oy + st * vx + ct * vy - BOX / 2
      // ...then the whole span rotated about the loader's centre
      out[o++] = cx + (ca * px - sa * py) * scale
      out[o++] = cy + (sa * px + ca * py) * scale
      out[o++] = rc
      out[o++] = rs
      out[o++] = hue
    }
  }
}
