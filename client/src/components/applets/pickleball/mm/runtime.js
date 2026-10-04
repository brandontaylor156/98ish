// Pickleball 98 motion matching: loading the database in the browser (once, in the
// background) and handing it to anim.js. The files: /assets/pickleball/motion.json (the
// clip list) and motion.bin (gzipped poses, ~2.9 MB; db.js). A worker (worker.js) ungzips it
// with the browser's DecompressionStream and builds the search library, so the page never
// stalls; without workers it's done here. If anything fails (or DecompressionStream is
// missing: very old browsers), anim.js keeps the procedural footwork (locomotion.js).

import { buildLibrary, libraryFromData } from "./library.js"

const BASE = "/assets/pickleball/"
let lib = null
let loading = null
let failed = false
let enabled = true
export const motionLibrary = () => (enabled ? lib : null)
// (dev and tests: switch motion matching off to compare with the procedural footwork)
export const setEnabled = (on) => {
  enabled = !!on
}
export const motionFailed = () => failed
export const setMotionLibrary = (l) => {
  lib = l
}

const gunzip = async (buf) => {
  if (typeof DecompressionStream !== "function") throw new Error("no DecompressionStream")
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// build in a worker: resolves with the library, or null if a worker can't be had
const inWorker = (json, bin) =>
  new Promise((resolve) => {
    let w
    try {
      w = new Worker(new URL("./worker.js", import.meta.url), { type: "module" })
    } catch {
      resolve(null)
      return
    }
    const done = (v) => {
      w.terminate()
      resolve(v)
    }
    w.onmessage = (e) => done(e.data?.ok ? libraryFromData(e.data.lib) : null)
    w.onerror = () => done(null)
    w.postMessage({ json, bin: bin.slice(0) }, [])
  })

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
    let l = typeof Worker === "function" ? await inWorker(json, bin) : null
    if (l) l.inWorker = true
    else {
      // (a server that already ungzipped it hands over the raw bytes: gzip starts 1f 8b)
      const bytes = new Uint8Array(bin)
      const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? await gunzip(bytes) : bytes
      await new Promise((r) => setTimeout(r, 0))
      const t1 = performance.now()
      l = buildLibrary(json, raw)
      l.buildMs = performance.now() - t1
    }
    l.loadMs = performance.now() - t0
    l.bytes = bin.byteLength
    lib = l
    // (dev: tests reach the loaded database here)
    if (import.meta.env?.DEV && typeof window !== "undefined") window.__pbMotion = { lib, setEnabled }
    return lib
  })()
  loading.catch(() => {
    failed = true
    loading = null
  })
  return loading
}
