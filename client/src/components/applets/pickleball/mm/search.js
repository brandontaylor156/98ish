// Pickleball 98 motion matching: the search. Pure JavaScript (Node-tested).
//
// Brute force over normalized feature vectors (one flat Float32Array, frame after frame),
// sped up with bounding boxes (as in Holden's motion-matching write-ups): frames are grouped
// in blocks of 16 inside blocks of 64, each with the min and max of every dimension; a block
// whose box is already further from the query than the best match so far is skipped whole.
// The distance inside a frame stops adding up once it passes the best (an early out). Frames
// can be limited by tag (a bit mask per frame: e.g. the athletic ready style during a rally,
// relaxed walking between points) and some frames can't be searched (the ends of clips).

import { DIM } from "./features.js"

const SMALL = 16
const LARGE = 64

// F: normalized features (M frames); ok: searchable flags (M); tags: bit masks (M)
export const buildIndex = (F, ok, tags) => {
  const M = F.length / DIM
  const nS = Math.ceil(M / SMALL)
  const nL = Math.ceil(M / LARGE)
  const sMin = new Float32Array(nS * DIM).fill(Infinity)
  const sMax = new Float32Array(nS * DIM).fill(-Infinity)
  const lMin = new Float32Array(nL * DIM).fill(Infinity)
  const lMax = new Float32Array(nL * DIM).fill(-Infinity)
  const sTag = new Uint32Array(nS)
  const lTag = new Uint32Array(nL)
  for (let i = 0; i < M; i++) {
    if (!ok[i]) continue
    const s = (i / SMALL) | 0
    const l = (i / LARGE) | 0
    sTag[s] |= tags[i]
    lTag[l] |= tags[i]
    for (let d = 0; d < DIM; d++) {
      const v = F[i * DIM + d]
      if (v < sMin[s * DIM + d]) sMin[s * DIM + d] = v
      if (v > sMax[s * DIM + d]) sMax[s * DIM + d] = v
      if (v < lMin[l * DIM + d]) lMin[l * DIM + d] = v
      if (v > lMax[l * DIM + d]) lMax[l * DIM + d] = v
    }
  }
  return { F, ok, tags, M, sMin, sMax, lMin, lMax, sTag, lTag }
}

const boxDist = (q, min, max, o, best) => {
  let s = 0
  for (let d = 0; d < DIM; d++) {
    const v = q[d]
    const lo = min[o + d]
    const hi = max[o + d]
    const e = v < lo ? lo - v : v > hi ? v - hi : 0
    s += e * e
    if (s >= best) return s
  }
  return s
}

// the nearest frame to query q (normalized) among frames with any of the tag bits in mask;
// best/bestI: a frame to beat (the current one), so the search only looks for better.
// Returns { i, cost, visited }.
export const search = (idx, q, { mask = 0xffffffff, best = Infinity, bestI = -1, exclude = null } = {}) => {
  const { F, ok, tags, M, sMin, sMax, lMin, lMax, sTag, lTag } = idx
  let visited = 0
  const nL = lTag.length
  for (let l = 0; l < nL; l++) {
    if (!(lTag[l] & mask)) continue
    if (boxDist(q, lMin, lMax, l * DIM, best) >= best) continue
    const s0 = l * (LARGE / SMALL)
    const s1 = Math.min(sTag.length, s0 + LARGE / SMALL)
    for (let s = s0; s < s1; s++) {
      if (!(sTag[s] & mask)) continue
      if (boxDist(q, sMin, sMax, s * DIM, best) >= best) continue
      const i1 = Math.min(M, (s + 1) * SMALL)
      for (let i = s * SMALL; i < i1; i++) {
        if (!ok[i] || !(tags[i] & mask)) continue
        if (exclude && exclude(i)) continue
        visited++
        const o = i * DIM
        let c = 0
        for (let d = 0; d < DIM; d++) {
          const e = q[d] - F[o + d]
          c += e * e
          if (c >= best) break
        }
        if (c < best) {
          best = c
          bestI = i
        }
      }
    }
  }
  return { i: bestI, cost: best, visited }
}

// the plain version (tests: the boxes must never change the answer)
export const searchBrute = (F, ok, tags, q, mask = 0xffffffff) => {
  const M = F.length / DIM
  let best = Infinity
  let bestI = -1
  for (let i = 0; i < M; i++) {
    if (!ok[i] || !(tags[i] & mask)) continue
    let c = 0
    for (let d = 0; d < DIM; d++) {
      const e = q[d] - F[i * DIM + d]
      c += e * e
    }
    if (c < best) {
      best = c
      bestI = i
    }
  }
  return { i: bestI, cost: best }
}
