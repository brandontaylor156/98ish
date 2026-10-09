// My Park's frame-time split (dev and tests: __park.devProf). Off, each mark is one boolean
// test; on, every section's main-thread time adds up until read.
//   const t = mark(); ...; spent("bodies", t)
export const prof = { on: false, ms: Object.create(null), frames: 0, since: 0 }

export const mark = () => (prof.on ? performance.now() : 0)

export const spent = (key, t) => {
  if (prof.on) prof.ms[key] = (prof.ms[key] || 0) + (performance.now() - t)
}

// start (or restart) counting; read() -> ms per frame for each section
export const profStart = () => {
  prof.on = true
  prof.ms = Object.create(null)
  prof.frames = 0
  prof.since = performance.now()
}

export const profRead = () => {
  const n = Math.max(1, prof.frames)
  const out = { frames: prof.frames, seconds: +((performance.now() - prof.since) / 1000).toFixed(2) }
  for (const k of Object.keys(prof.ms)) out[k] = +(prof.ms[k] / n).toFixed(3)
  return out
}
