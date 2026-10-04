// Pickleball 98 motion matching: loading the database in the browser (once, in the
// background) and handing it to anim.js. The files: /assets/pickleball/motion.json (the
// clip list) and motion.bin (gzipped poses, ~1.6 MB; db.js), ungzipped with the browser's
// DecompressionStream. Without it (very old browsers) or if anything fails, anim.js keeps
// the procedural footwork (locomotion.js).

import { buildLibrary } from "./library.js"

const BASE = "/assets/pickleball/"
let lib = null
let loading = null
let failed = false
export const motionLibrary = () => lib
export const motionFailed = () => failed
export const setMotionLibrary = (l) => {
  lib = l
}

const gunzip = async (buf) => {
  if (typeof DecompressionStream !== "function") throw new Error("no DecompressionStream")
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export const loadMotion = () => {
  if (loading) return loading
  loading = (async () => {
    const t0 = performance.now()
    const [json, bin] = await Promise.all([
      fetch(BASE + "motion.json").then((r) => {
        if (!r.ok) throw new Error("motion.json " + r.status)
        return r.json()
      }),
      fetch(BASE + "motion.bin").then((r) => {
        if (!r.ok) throw new Error("motion.bin " + r.status)
        return r.arrayBuffer()
      }),
    ])
    // (a server that already ungzipped it hands over the raw bytes: gzip starts 1f 8b)
    const bytes = new Uint8Array(bin)
    const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? await gunzip(bytes) : bytes
    // (the features and the search index: ~0.2 s on a laptop, once, while the title screen shows)
    await new Promise((r) => setTimeout(r, 0))
    lib = buildLibrary(json, raw)
    lib.loadMs = performance.now() - t0
    lib.bytes = bin.byteLength
    return lib
  })()
  loading.catch(() => {
    failed = true
    loading = null
  })
  return loading
}
