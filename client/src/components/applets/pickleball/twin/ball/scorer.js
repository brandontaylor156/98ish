// Real Ball: the learned candidate scorer. A tiny CNN (3 conv layers, ~8k weights) looks at a
// 24x24 patch of the three frames around each detector candidate and says how ball-like it is.
// It was trained on fence-cam patches rendered procedurally and on Pickleball 98's own
// rendered rally (scratchpad train.py); the same weights ship as an ONNX file
// (public/models/realball-scorer.onnx) and as JSON for this forward pass, so no ML runtime is
// needed on the phone (a few hundred multiply-adds per pixel, ~0.1 ms a candidate).

export const PATCH = 24

let loading = null
// the weights (lazy: /models/realball-scorer.json, ~70 KB); null if it can't be fetched
export const loadScorer = (url = "/models/realball-scorer.json") =>
  (loading ||= fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (j ? prepare(j) : null))
    .catch(() => null))

export const prepare = (json) => {
  const w = json.weights
  const flat = (a) => Float32Array.from(a.flat(Infinity))
  return {
    P: json.P || PATCH,
    c1: { w: flat(w["c1.weight"]), b: flat(w["c1.bias"]), cin: 9, cout: w["c1.bias"].length },
    c2: { w: flat(w["c2.weight"]), b: flat(w["c2.bias"]), cin: w["c1.bias"].length, cout: w["c2.bias"].length },
    c3: { w: flat(w["c3.weight"]), b: flat(w["c3.bias"]), cin: w["c2.bias"].length, cout: w["c3.bias"].length },
    fc: { w: flat(w["fc.weight"]), b: flat(w["fc.bias"]) },
  }
}

// conv 3x3, padding 1, then ReLU, then 2x2 max pool. x: [cin][n][n] -> [cout][n/2][n/2]
const convReluPool = (x, n, L) => {
  const { w, b, cin, cout } = L
  const y = new Float32Array(cout * n * n)
  for (let o = 0; o < cout; o++) {
    const yo = o * n * n
    for (let i = 0; i < n * n; i++) y[yo + i] = b[o]
    for (let c = 0; c < cin; c++) {
      const xc = c * n * n
      const wk = (o * cin + c) * 9
      for (let ky = -1; ky <= 1; ky++)
        for (let kx = -1; kx <= 1; kx++) {
          const wv = w[wk + (ky + 1) * 3 + (kx + 1)]
          if (!wv) continue
          for (let r = 0; r < n; r++) {
            const sr = r + ky
            if (sr < 0 || sr >= n) continue
            const yr = yo + r * n
            const xr = xc + sr * n
            const c0 = Math.max(0, -kx)
            const c1 = Math.min(n, n - kx)
            for (let q = c0; q < c1; q++) y[yr + q] += wv * x[xr + q + kx]
          }
        }
    }
  }
  const m = n >> 1
  const z = new Float32Array(cout * m * m)
  for (let o = 0; o < cout; o++)
    for (let r = 0; r < m; r++)
      for (let q = 0; q < m; q++) {
        const i = o * n * n + 2 * r * n + 2 * q
        const v = Math.max(y[i], y[i + 1], y[i + n], y[i + n + 1])
        z[o * m * m + r * m + q] = v > 0 ? v : 0
      }
  return z
}

// one patch [9][P][P] (frames prev, cur, next x RGB, 0..1) -> logit
export const forward = (net, x) => {
  let n = net.P
  let h = convReluPool(x, n, net.c1)
  n >>= 1
  h = convReluPool(h, n, net.c2)
  n >>= 1
  h = convReluPool(h, n, net.c3)
  let s = net.fc.b[0]
  for (let i = 0; i < h.length; i++) s += h[i] * net.fc.w[i]
  return s
}

export const sigmoid = (v) => 1 / (1 + Math.exp(-v))

// the patch around (u, v) from three RGBA frames
export const patchAt = (prev, cur, next, W, H, u, v, P = PATCH) => {
  const out = new Float32Array(9 * P * P)
  const fr = [prev, cur, next]
  const x0 = Math.round(u) - P / 2
  const y0 = Math.round(v) - P / 2
  for (let f = 0; f < 3; f++)
    for (let c = 0; c < 3; c++)
      for (let y = 0; y < P; y++) {
        const sy = Math.min(H - 1, Math.max(0, y0 + y))
        for (let x = 0; x < P; x++) {
          const sx = Math.min(W - 1, Math.max(0, x0 + x))
          out[((f * 3 + c) * P + y) * P + x] = fr[f][(sy * W + sx) * 4 + c] / 255
        }
      }
  return out
}

// re-score candidates: the detector's score times how sure the net is
export const rescore = (net, prev, cur, next, W, H, cands) =>
  cands
    .map((c) => {
      const p = sigmoid(forward(net, patchAt(prev, cur, next, W, H, c.u, c.v, net.P)))
      return { ...c, p, score: c.score * (0.15 + p) }
    })
    .sort((a, b) => b.score - a.score)
