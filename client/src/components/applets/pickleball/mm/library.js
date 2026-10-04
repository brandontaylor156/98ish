// Pickleball 98 motion matching: the database ready to search. Pure JavaScript.
// buildLibrary(json, raw) decodes the poses (db.js), works out every frame's features and
// their mirror images (features.js), normalizes them and builds the search index. A few tens
// of milliseconds on a laptop for ~20k frames, done once when Pickleball loads.

import { decodeDB } from "./db.js"
import { buildFeatures, normalize, searchable } from "./features.js"
import { buildIndex } from "./search.js"

// the tags the game searches by (a bit each)
export const TAG = { neutral: 1, ready: 2, cross: 4, lunge: 8, stop: 16, idle: 32, fast: 64, gesture: 128 }

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
  // a calm standing frame to start from (the first idle clip's middle)
  const idle = db.clips.find((c) => c.tags.includes("idle")) || db.clips[0]
  return finishLibrary({ db, raw: raw2, F, norm, ok, tags, idx, start: idle.start + (idle.n >> 1) })
}
// (the functions: added again after the data comes back from the worker, mm/worker.js)
export const finishLibrary = (lib) => {
  const N = lib.db.N
  lib.clipOfV = (v) => (v >= N ? lib.db.clipOf[v - N] + 65536 : lib.db.clipOf[v])
  return lib
}
// the library's typed arrays (to hand over from a worker without copying)
export const libraryBuffers = (lib) => {
  const { db, idx } = lib
  return [db.root, db.hip, db.rot, db.contacts, db.clipOf, lib.raw, lib.F, lib.norm.mean, lib.norm.scale, lib.ok, lib.tags, idx.sMin, idx.sMax, idx.lMin, idx.lMax, idx.sTag, idx.lTag].map((a) => a.buffer)
}
export const libraryData = (lib) => {
  const { clipOfV, ...rest } = lib
  void clipOfV
  // (the index points at F, ok and tags again when rebuilt: no duplicates in the message)
  const { F, ok, tags, ...idx } = lib.idx
  void F
  void ok
  void tags
  return { ...rest, idx }
}
export const libraryFromData = (d) => finishLibrary({ ...d, idx: { ...d.idx, F: d.F, ok: d.ok, tags: d.tags } })
