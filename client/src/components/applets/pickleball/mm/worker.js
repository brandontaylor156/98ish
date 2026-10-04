// Pickleball 98 motion matching: builds the library (ungzips the poses, works out every
// frame's features, normalizes them, builds the search index) off the main thread, so a phone
// never stalls on it (about a second at a 4x slowdown). runtime.js falls back to doing it on
// the main thread if workers aren't there.

import { buildLibrary, libraryBuffers, libraryData } from "./library.js"

self.onmessage = async (e) => {
  try {
    const { json, bin } = e.data
    const bytes = new Uint8Array(bin)
    let raw = bytes
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))
      raw = new Uint8Array(await new Response(stream).arrayBuffer())
    }
    const t0 = performance.now()
    const lib = buildLibrary(json, raw)
    lib.buildMs = performance.now() - t0
    self.postMessage({ ok: true, lib: libraryData(lib) }, libraryBuffers(lib))
  } catch (err) {
    self.postMessage({ ok: false, error: String(err && err.message ? err.message : err) })
  }
}
