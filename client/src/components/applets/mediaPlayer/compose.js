// A tiny composing toolkit for the Media Player's songs. Everything works in beats and
// MIDI note numbers; a note is [beat, pitch, beats, velocity 0..1]. Songs are written as
// sections (chord progressions, rhythm strings, melody strings) and joined by build().

const LETTERS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }

// "c4" -> 60, "f#3" -> 54, "bb2" -> 46
export const noteNum = (name) => {
  const m = /^([a-g])(#|b)?(-?\d)$/i.exec(String(name).trim())
  if (!m) throw new Error(`Bad note "${name}"`)
  const acc = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0
  return 12 * (Number(m[3]) + 1) + LETTERS[m[1].toLowerCase()] + acc
}

const QUALITIES = {
  "": [0, 4, 7],
  maj: [0, 4, 7],
  m: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  5: [0, 7],
  6: [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  9: [0, 4, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  m9: [0, 3, 7, 10, 14],
  m11: [0, 3, 7, 10, 14, 17],
  13: [0, 4, 10, 14, 21],
  "7sus4": [0, 5, 7, 10],
  "9sus4": [0, 5, 10, 14],
  "7#9": [0, 4, 10, 15],
  "7b9": [0, 4, 10, 13],
  "6/9": [0, 4, 9, 14],
  "maj7#11": [0, 4, 11, 18],
}

const pitchClass = (letter, acc) => (LETTERS[letter.toLowerCase()] + (acc === "#" ? 1 : acc === "b" ? -1 : 0) + 12) % 12

// "F#m7b5/C" -> { name, root: pitch class, bass: pitch class, intervals }
export const parseChord = (symbol) => {
  const m = /^([A-G])(#|b)?([^/]*)(?:\/([A-G])(#|b)?)?$/.exec(symbol)
  if (!m || !(m[3] in QUALITIES)) throw new Error(`Bad chord "${symbol}"`)
  const root = pitchClass(m[1], m[2])
  return { name: symbol, root, bass: m[4] ? pitchClass(m[4], m[5]) : root, intervals: QUALITIES[m[3]] }
}

// Chord tones as a close voicing around `center` (each tone in [center-6, center+6)).
// Big chords drop the root, since the bass plays it.
export const voice = (chord, center = 60) => {
  const ints = chord.intervals.length >= 5 ? chord.intervals.slice(1) : chord.intervals
  const low = center - 6
  const notes = ints.map((i) => {
    const pc = (chord.root + i) % 12
    return low + ((pc - low) % 12 + 12) % 12
  })
  return [...new Set(notes)].sort((a, b) => a - b)
}

// The lowest note with pitch class pc at or above `from`
export const atOrAbove = (pc, from) => from + ((pc - from) % 12 + 12) % 12

// "Am F C G" (a bar each) or "Dm7:2 G7:2" (beats) -> [{ at, len, ...chord }]
export const prog = (text, bpb = 4) => {
  let at = 0
  return text
    .split(/\s+/)
    .filter((t) => t && t !== "|")
    .map((token) => {
      const [symbol, beats] = token.split(":")
      const len = beats ? Number(beats) : bpb
      const chord = { ...parseChord(symbol), at, len }
      at += len
      return chord
    })
}

export const progLength = (chords) => chords.reduce((n, c) => Math.max(n, c.at + c.len), 0)

// Repeat a progression n times
export const loop = (chords, times) => {
  const len = progLength(chords)
  return Array.from({ length: times }, (_, i) => chords.map((c) => ({ ...c, at: c.at + i * len }))).flat()
}

// "x.x-x..." -> hits [{ pos (steps), len (steps), accent }] for one cycle.
// x hit, X accent, g ghost, - holds the previous hit, . rest
const parseRhythm = (rhythm) => {
  const steps = rhythm.replace(/\s+/g, "")
  const hits = []
  for (let i = 0; i < steps.length; i++) {
    const ch = steps[i]
    if (ch === "-" && hits.length) hits.at(-1).len++
    else if (ch !== "." && ch !== "-") hits.push({ pos: i, len: 1, ch })
  }
  return { hits, length: steps.length }
}

const accentVel = (ch, vel) => (ch === "X" || ch === "!" ? Math.min(1, vel * 1.25) : ch === "g" ? vel * 0.45 : vel)

// The chord sounding at a beat
const chordAt = (chords, beat) => chords.find((c) => beat >= c.at - 1e-9 && beat < c.at + c.len - 1e-9)

// Tile a rhythm over [0, total) beats, calling hit(beat, beats, ch) for each step that sounds
const tile = (rhythm, step, total, hit) => {
  const { hits, length } = parseRhythm(rhythm)
  const cycle = length * step
  for (let start = 0; start < total - 1e-9; start += cycle) {
    for (const h of hits) {
      const beat = start + h.pos * step
      if (beat < total - 1e-9) hit(beat, Math.min(h.len * step, total - beat), h.ch)
    }
  }
}

// Sustained chords
export const pad = (chords, { center = 60, vel = 0.5, gap = 0 } = {}) =>
  chords.flatMap((c) => voice(c, center).map((p) => [c.at, p, c.len - gap, vel]))

// Chords played to a rhythm; length scales each hit (staccato < 1)
export const comp = (chords, { rhythm = "x...", step = 0.5, center = 60, vel = 0.6, length = 0.9, total } = {}) => {
  const out = []
  tile(rhythm, step, total ?? progLength(chords), (beat, beats, ch) => {
    const c = chordAt(chords, beat)
    if (!c) return
    for (const p of voice(c, center)) out.push([beat, p, beats * length, accentVel(ch, vel)])
  })
  return out
}

// Bass lines. Steps: R root, 3/5/7 chord tones above it, 8 octave, 4 fourth, 6 sixth,
// b flat seventh, n approach (half step under the next chord's root), r ghost root,
// - hold, . rest
export const bass = (chords, { pattern = "R...R...", step = 0.5, low = 33, vel = 0.8, length = 0.92, total } = {}) => {
  const out = []
  const end = total ?? progLength(chords)
  tile(pattern.replace(/[^R0-9bnr.\-X]/g, ""), step, end, (beat, beats, ch) => {
    const c = chordAt(chords, beat)
    if (!c) return
    const root = atOrAbove(c.bass, low)
    const third = c.intervals.includes(3) ? 3 : c.intervals.includes(4) ? 4 : c.intervals.includes(5) ? 5 : 4
    const seventh = c.intervals.includes(11) ? 11 : c.intervals.includes(9) && !c.intervals.includes(10) ? 9 : 10
    let pitch = root
    let v = vel
    if (ch === "3") pitch = root + third
    else if (ch === "4") pitch = root + 5
    else if (ch === "5") pitch = root + (c.intervals.includes(6) ? 6 : 7)
    else if (ch === "6") pitch = root + 9
    else if (ch === "7") pitch = root + seventh
    else if (ch === "b") pitch = root + 10
    else if (ch === "8") pitch = root + 12
    else if (ch === "r") v = vel * 0.5
    else if (ch === "n") {
      const next = chordAt(chords, c.at + c.len) || c
      pitch = atOrAbove(next.bass, low) - 1
    } else if (ch === "X") v = Math.min(1, vel * 1.2)
    out.push([beat, pitch, beats * length, v])
  })
  return out
}

// Arpeggios: digits index the chord's voicing (beyond its size climbs octaves), . rest, - hold
export const arp = (chords, { pattern = "0123", step = 0.25, center = 60, vel = 0.5, length = 0.95, total } = {}) => {
  const out = []
  const steps = pattern.replace(/\s+/g, "")
  const cycle = steps.length * step
  const end = total ?? progLength(chords)
  for (let start = 0; start < end - 1e-9; start += cycle) {
    for (let i = 0; i < steps.length; i++) {
      const ch = steps[i]
      const beat = start + i * step
      if (beat >= end - 1e-9) break
      if (ch === "." || ch === "-") continue
      let len = 1
      while (steps[i + len] === "-") len++
      const c = chordAt(chords, beat)
      if (!c) continue
      const tones = voice(c, center)
      const idx = parseInt(ch, 36)
      out.push([beat, tones[idx % tones.length] + 12 * Math.floor(idx / tones.length), len * step * length, vel])
    }
  }
  return out
}

// Melodies: "e5/1 d5/.5 c5 r/2 g4/1.5!" - a note (or r for rest), then /beats (sticky:
// it carries to the next notes), ! accents, ? softens; ~ joins a note to the previous one
export const mel = (text, { at = 0, vel = 0.75, transpose = 0, length = 0.95 } = {}) => {
  const out = []
  let beat = at
  let dur = 1
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    if (raw === "|") continue
    const m = /^(~)?([a-g][#b]?-?\d|r)(?:\/([\d.]+))?([!?]*)$/i.exec(raw)
    if (!m) throw new Error(`Bad melody token "${raw}"`)
    if (m[3]) dur = Number(m[3])
    if (m[2].toLowerCase() !== "r") {
      const v = m[4].includes("!") ? Math.min(1, vel * 1.2) : m[4].includes("?") ? vel * 0.7 : vel
      if (m[1] && out.length) out.at(-1)[2] += dur
      else out.push([beat, noteNum(m[2]) + transpose, dur * length, v])
    }
    beat += dur
  }
  return out
}

// Drum kit notes (General MIDI numbers)
export const KIT = { k: 36, r: 37, s: 38, p: 39, l: 41, t: 45, m: 47, i: 50, h: 42, o: 46, c: 49, y: 51, w: 70, b: 56 }

// { k: "x...x...", s: "....x..." } on a 16th grid (step in beats), tiled over `beats`
export const drums = (lanes, { beats = 16, step = 0.25, vel = 0.85 } = {}) => {
  const out = []
  for (const [lane, rhythm] of Object.entries(lanes)) {
    if (!(lane in KIT)) throw new Error(`Unknown drum lane "${lane}"`)
    tile(rhythm, step, beats, (beat, len, ch) => out.push([beat, KIT[lane], Math.max(len, 0.25), accentVel(ch, vel)]))
  }
  return out
}

// Move notes later by `beats` (and optionally transpose)
export const shift = (notes, beats, transpose = 0) => notes.map(([b, p, d, v]) => [b + beats, p + transpose, d, v])

// Scale velocities
export const soften = (notes, factor) => notes.map(([b, p, d, v]) => [b, p, d, v * factor])

// Keep only notes starting in [from, to)
export const slice = (notes, from, to) => notes.filter(([b]) => b >= from - 1e-9 && b < to - 1e-9)

// Repeat a note list whose loop is `len` beats long, n times
export const repeat = (notes, len, times) => Array.from({ length: times }, (_, i) => shift(notes, i * len)).flat()

// Join sections into a song.
// def: { id, file, title, artist, description, bpm, bpb, swing, tracks: { name: { instrument, gain, pan, reverb, delay } },
//        sections: { name: { bars, [track]: notes } }, order: [name] }
export const build = (def) => {
  const bpb = def.bpb || 4
  const notes = Object.fromEntries(Object.keys(def.tracks).map((t) => [t, []]))
  let offset = 0
  const markers = []
  for (const name of def.order) {
    const section = def.sections[name]
    if (!section) throw new Error(`${def.id}: no section "${name}"`)
    markers.push({ name, beat: offset })
    for (const [track, list] of Object.entries(section)) {
      if (track === "bars") continue
      if (!notes[track]) throw new Error(`${def.id}: section "${name}" uses unknown track "${track}"`)
      for (const [b, p, d, v] of list) {
        // a note past the end of its section is a typo in the melody
        if (b < -1e-9 || b >= section.bars * bpb - 1e-9) throw new Error(`${def.id}: ${name}/${track} has a note at beat ${b}, outside ${section.bars} bars`)
        notes[track].push([+(offset + b).toFixed(4), p, +d.toFixed(4), +v.toFixed(3)])
      }
    }
    offset += section.bars * bpb
  }
  // the last chord stops at the final barline (its release and the reverb ring on)
  for (const list of Object.values(notes)) for (const n of list) n[2] = Math.min(n[2], +(offset - n[0]).toFixed(4))
  return {
    id: def.id,
    file: def.file,
    title: def.title,
    artist: def.artist || "98ish Sound Studio",
    description: def.description || "",
    bpm: def.bpm,
    bpb,
    swing: def.swing || null,
    humanize: def.humanize ?? true,
    lengthBeats: offset,
    markers,
    tracks: Object.entries(def.tracks).map(([name, t]) => ({
      name,
      instrument: t.instrument,
      gain: t.gain ?? 0.7,
      pan: t.pan ?? 0,
      reverb: t.reverb ?? 0.2,
      delay: t.delay ?? 0,
      notes: notes[name].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    })),
  }
}
