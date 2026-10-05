// Ordered (Bayer) dithering: how 256-colour games shaded without gradients. Pure, tested in
// retro.test.js.
//   bayer(n)                  the n x n threshold matrix (n = 2, 4, 8), values 0..n*n-1
//   BAYER4 / BAYER8           those matrices normalized to thresholds in (0, 1)
//   threshold(x, y, size=4)   the threshold at a pixel
//   pick(x, y, t, a, b)       a when t is below the pixel's threshold, else b (t in 0..1)
//   rampAt(ramp, t, x, y)     a colour from a ramp (indices dark -> light) at t (0..1),
//                             dithering between the two nearest entries

export const bayer = (n) => {
  if (n === 1) return [[0]]
  const half = bayer(n / 2)
  const m = half.length
  const out = Array.from({ length: n }, () => Array(n).fill(0))
  for (let y = 0; y < m; y++) {
    for (let x = 0; x < m; x++) {
      const v = half[y][x] * 4
      out[y][x] = v
      out[y][x + m] = v + 2
      out[y + m][x] = v + 3
      out[y + m][x + m] = v + 1
    }
  }
  return out
}

const normalized = (n) => {
  const m = bayer(n)
  const flat = new Float32Array(n * n)
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) flat[y * n + x] = (m[y][x] + 0.5) / (n * n)
  return flat
}
export const BAYER2 = normalized(2)
export const BAYER4 = normalized(4)
export const BAYER8 = normalized(8)

export const threshold = (x, y, size = 4) => {
  const m = size === 8 ? BAYER8 : size === 2 ? BAYER2 : BAYER4
  return m[(y & (size - 1)) * size + (x & (size - 1))]
}

export const pick = (x, y, t, a, b, size = 4) => (t > threshold(x, y, size) ? b : a)

export const rampAt = (ramp, t, x, y, size = 4) => {
  const n = ramp.length
  if (n === 1) return ramp[0]
  const v = Math.max(0, Math.min(1, t)) * (n - 1)
  const i = Math.floor(v)
  if (i >= n - 1) return ramp[n - 1]
  return v - i > threshold(x, y, size) ? ramp[i + 1] : ramp[i]
}
