// Pickleball 98 motion matching: the database ready to search. Pure JavaScript.
// buildLibrary(json, raw) decodes the poses (db.js), works out every frame's features and
// their mirror images (features.js), normalizes them and builds the search index. A few tens
// of milliseconds on a laptop for ~20k frames, done once when Pickleball loads.

import { decodeDB } from "./db.js"
import { buildFeatures, normalize, searchable } from "./features.js"
import { buildIndex } from "./search.js"

// the tags the game searches by (a bit each)
export const TAG = { neutral: 1, ready: 2, cross: 4, lunge: 8, stop: 16, idle: 32, fast: 64 }

export const tagMaskOf = (tags) => {
  let m = 0
  for (const t of tags) if (TAG[t]) m |= TAG[t]
  return m
}

export const buildLibrary = (json, raw) => {
  const db = decodeDB(json, raw)
  const N = db.N
  const raw2 = buildFeatures(db)
  const F = new Float32Array(raw2)
  const norm = normalize(F)
  const ok1 = searchable(db)
  const ok = new Uint8Array(2 * N)
  ok.set(ok1, 0)
  ok.set(ok1, N)
  const tags = new Uint32Array(2 * N)
  for (const c of db.clips) {
    const m = tagMaskOf(c.tags) || 1
    for (let i = 0; i < c.n; i++) {
      tags[c.start + i] = m
      tags[N + c.start + i] = m
    }
  }
  const idx = buildIndex(F, ok, tags)
  const clipOfV = (v) => (v >= N ? db.clipOf[v - N] + 65536 : db.clipOf[v])
  // a calm standing frame to start from (the first idle clip's middle)
  const idle = db.clips.find((c) => c.tags.includes("idle")) || db.clips[0]
  return { db, raw: raw2, F, norm, ok, tags, idx, clipOfV, start: idle.start + (idle.n >> 1) }
}
