// Composing helpers for Shred 98's songs, on top of the Media Player's toolkit
// (mediaPlayer/compose.js: chords, bass lines, drums, build). Adds the two guitar parts:
// riff() for the lead guitar you play (single notes and power chords) and chug() for the
// rhythm guitar under it.

import { atOrAbove, noteNum, progLength } from "../../mediaPlayer/compose.js"

export { build, prog, loop, pad, bass, arp, drums, shift, soften, repeat, comp, mel } from "../../mediaPlayer/compose.js"

// Lead guitar: "e3+b3/1 r/.5 a4/.5 c5" - a note, a chord (notes joined by +) or r for a
// rest, then /beats (sticky: it carries to the next tokens), ! accents, ? softens. Bars can
// be marked with | (ignored). Every note of a chord starts together.
export const riff = (text, { at = 0, vel = 0.8, transpose = 0, length = 0.96 } = {}) => {
  const out = []
  let beat = at
  let dur = 1
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    if (raw === "|") continue
    const m = /^((?:[a-g][#b]?-?\d)(?:\+[a-g][#b]?-?\d)*|r)(?:\/([\d.]+))?([!?]*)$/i.exec(raw)
    if (!m) throw new Error(`Bad riff token "${raw}"`)
    if (m[2]) dur = Number(m[2])
    if (m[1].toLowerCase() !== "r") {
      const v = m[3].includes("!") ? Math.min(1, vel * 1.2) : m[3].includes("?") ? vel * 0.7 : vel
      for (const name of m[1].split("+")) out.push([beat, noteNum(name) + transpose, dur * length, v])
    }
    beat += dur
  }
  return out
}

// Total beats a riff string spans (for checking bars add up)
export const riffBeats = (text) => {
  let beats = 0
  let dur = 1
  for (const raw of text.split(/\s+/).filter((t) => t && t !== "|")) {
    const m = /\/([\d.]+)/.exec(raw)
    if (m) dur = Number(m[1])
    beats += dur
  }
  return beats
}

const chordAt = (chords, beat) => chords.find((c) => beat >= c.at - 1e-9 && beat < c.at + c.len - 1e-9)

// Rhythm guitar power chords to a pattern: x a full chord, X accented, p palm-muted
// (short and dark), - holds, . rests. Each chord is root, fifth and octave from `low` up.
export const chug = (chords, { pattern = "x-x-x-x-", step = 0.5, low = 40, vel = 0.75, total } = {}) => {
  const steps = pattern.replace(/\s+/g, "")
  const end = total ?? progLength(chords)
  const out = []
  for (let start = 0; start < end - 1e-9; start += steps.length * step) {
    for (let i = 0; i < steps.length; i++) {
      const ch = steps[i]
      const beat = start + i * step
      if (beat >= end - 1e-9) break
      if (ch === "." || ch === "-") continue
      let len = 1
      while (steps[i + len] === "-") len++
      const c = chordAt(chords, beat)
      if (!c) continue
      const root = atOrAbove(c.bass, low)
      if (ch === "p") {
        // palm mute: a short, low thud (velocity under 0.5 tells the rig to damp it)
        out.push([beat, root, step * 0.55, vel * 0.45], [beat, root + 7, step * 0.55, vel * 0.45])
      } else {
        const v = ch === "X" ? Math.min(1, vel * 1.2) : vel
        const d = Math.min(len * step, end - beat) * 0.94
        out.push([beat, root, d, v], [beat, root + 7, d, v], [beat, root + 12, d, v * 0.8])
      }
    }
  }
  return out
}

// One crash on the one plus a beat for `bars` bars, ending on a fill (or not)
export const groove = (drumsFn, lanes, fill, bars = 8, { vel = 0.82, crash = true } = {}) => {
  const out = crash ? [[0, 49, 1, 0.85]] : []
  const body = fill ? bars - 1 : bars
  out.push(...drumsFn(lanes, { beats: body * 4, vel }))
  if (fill) out.push(...drumsFn(fill, { beats: 4, vel }).map(([b, p, d, v]) => [b + body * 4, p, d, v]))
  return out
}
