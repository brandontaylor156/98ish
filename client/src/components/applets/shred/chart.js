// Note charts for Shred 98, made from each song's lead guitar part (the notes you play).
// Pure functions in beats, so the timing is exact at any practice speed.
//
// Expert gets every note. Lower difficulties keep the musically important ones (downbeats,
// long notes, phrase starts) with a minimum gap, and map the melody's shape onto fewer
// lanes: Easy uses 3 lanes, Medium 4, Hard and Expert all 5. Lanes follow the pitch
// contour of each phrase (higher notes, lanes further right; a repeated note, the same lane;
// a new note, a new lane), so the chart moves the way the guitar does.

export const DIFFICULTIES = ["easy", "medium", "hard", "expert"]

export const DIFF = {
  easy: { label: "Easy", lanes: 3, minBeats: 1, minSec: 0.5, maxChord: 1, chordMetric: 9, hopo: false },
  medium: { label: "Medium", lanes: 4, minBeats: 0.5, minSec: 0.22, maxChord: 2, chordMetric: 3, hopo: false },
  hard: { label: "Hard", lanes: 5, minBeats: 0.25, minSec: 0.155, maxChord: 2, chordMetric: 2.5, hopo: true },
  expert: { label: "Expert", lanes: 5, minBeats: 0, minSec: 0, maxChord: 3, chordMetric: 0, hopo: true },
}

export const LANE_NAMES = ["Green", "Red", "Yellow", "Blue", "Orange"]

const EPS = 1e-4
const PHRASE_GAP = 1 // beats of silence that end a phrase
const PHRASE_MAX = 16 // beats: long passages are mapped a few bars at a time
const STAR_LEN = 8 // beats: the longest a star power phrase runs
const HOPO_BEATS = 0.34
const HOPO_SEC = 0.19

// ---------- the lead part as events (a note or a chord at one time) ----------

export const leadEvents = (song) => {
  const lead = song.tracks.find((t) => t.name === "lead")
  if (!lead) return []
  const byBeat = new Map()
  for (const [beat, midi, beats, vel] of lead.notes) {
    const key = Math.round(beat / EPS)
    let e = byBeat.get(key)
    if (!e) byBeat.set(key, (e = { beat, pitches: [], dur: 0, vel: 0 }))
    if (!e.pitches.includes(midi)) e.pitches.push(midi)
    e.dur = Math.max(e.dur, beats)
    e.vel = Math.max(e.vel, vel)
  }
  return [...byBeat.values()].sort((a, b) => a.beat - b.beat).map((e) => ({ ...e, pitches: e.pitches.sort((a, b) => a - b) }))
}

// Where each section starts and ends, with repeats numbered ("Chorus 2")
export const sectionsOf = (song) => {
  const seen = {}
  const total = {}
  for (const m of song.markers) total[m.name] = (total[m.name] || 0) + 1
  return song.markers.map((m, i) => {
    seen[m.name] = (seen[m.name] || 0) + 1
    const base = m.name.replace(/\d+$/, "").replace(/^./, (c) => c.toUpperCase())
    const label = total[m.name] > 1 ? `${base} ${seen[m.name]}` : /\d$/.test(m.name) ? `${base} ${m.name.match(/\d+$/)[0]}` : base
    return { name: m.name, label, start: m.beat, end: song.markers[i + 1]?.beat ?? song.lengthBeats }
  })
}

// ---------- thinning ----------

// How much a note matters to the feel: downbeats, long notes, accents, phrase starts
const metric = (beat, bpb) => {
  const inBar = ((beat % bpb) + bpb) % bpb
  if (Math.abs(inBar) < EPS) return 4
  if (Math.abs(inBar % 2) < EPS) return 3
  if (Math.abs(inBar % 1) < EPS) return 2.5
  if (Math.abs(inBar % 0.5) < EPS) return 1.5
  return 0.5
}

export const importance = (events, i, bpb = 4) => {
  const e = events[i]
  const prev = events[i - 1]
  let score = metric(e.beat, bpb)
  if (e.dur >= 1.4) score += 1.5
  else if (e.dur >= 0.9) score += 0.8
  if (e.pitches.length > 1) score += 0.4
  if (!prev || e.beat - (prev.beat + prev.dur) >= PHRASE_GAP - EPS) score += 1.2 // a phrase starts here
  if (prev && prev.pitches[0] !== e.pitches[0]) score += 0.2 // melody beats repetition
  return score
}

// Keep the most important events with at least `gap` beats between any two
export const thin = (events, gap, bpb = 4) => {
  if (gap <= EPS) return events.slice()
  const order = events.map((_, i) => i).sort((a, b) => importance(events, b, bpb) - importance(events, a, bpb) || a - b)
  const kept = []
  const fits = (beat) => kept.every((k) => Math.abs(events[k].beat - beat) >= gap - EPS)
  for (const i of order) if (fits(events[i].beat)) kept.push(i)
  return kept.sort((a, b) => a - b).map((i) => events[i])
}

// ---------- lanes ----------

// Split into phrases: rests of a beat or more, section changes, or every few bars
export const phrases = (events, sections = []) => {
  const out = []
  let cur = []
  const sectionAt = (beat) => sections.findIndex((s) => beat >= s.start - EPS && beat < s.end - EPS)
  for (const e of events) {
    const prev = cur.at(-1)
    const split = prev && (e.beat - (prev.beat + prev.dur) >= PHRASE_GAP - EPS || sectionAt(e.beat) !== sectionAt(prev.beat) || e.beat - cur[0].beat >= PHRASE_MAX - EPS)
    if (split) {
      out.push(cur)
      cur = []
    }
    cur.push(e)
  }
  if (cur.length) out.push(cur)
  return out
}

// The lane of each event's lowest note in one phrase, for `n` lanes. `range` is the song's
// [low, high] pitch, so a phrase that sits high in the song also sits right on the neck.
export const contour = (phrase, n, range) => {
  const roots = phrase.map((e) => e.pitches[0])
  const distinct = [...new Set(roots)].sort((a, b) => a - b)
  const k = distinct.length
  const rank = (p) => distinct.indexOf(p)
  let lanes
  if (k <= n) {
    const mean = roots.reduce((s, p) => s + p, 0) / roots.length
    const span = Math.max(1, range[1] - range[0])
    const pos = Math.min(1, Math.max(0, (mean - range[0]) / span))
    const offset = Math.round((n - k) * pos)
    lanes = roots.map((p) => offset + rank(p))
  } else {
    lanes = roots.map((p) => Math.round((rank(p) * (n - 1)) / (k - 1)))
  }
  // a repeated note stays on its lane; a new note moves the way the pitch moves (if the
  // squeeze put it on the lane just played, or the wrong way, it steps over by one)
  for (let i = 1; i < lanes.length; i++) {
    const dir = Math.sign(roots[i] - roots[i - 1])
    if (!dir) lanes[i] = lanes[i - 1]
    else if (Math.sign(lanes[i] - lanes[i - 1]) !== dir) lanes[i] = Math.min(n - 1, Math.max(0, lanes[i - 1] + dir))
  }
  return lanes
}

// A chord's frets: two notes side by side (wider for an octave), three in a row
export const chordShape = (base, pitches, n, maxChord) => {
  const size = Math.min(pitches.length, maxChord, n)
  if (size <= 1) return [base]
  if (size === 2) {
    const wide = pitches.at(-1) - pitches[0] >= 12 && n >= 3
    const step = wide ? 2 : 1
    const lo = Math.min(base, n - 1 - step)
    return [lo, lo + step]
  }
  const lo = Math.min(base, n - 3)
  return [lo, lo + 1, lo + 2]
}

const assignLanes = (events, n, maxChord, sections, range) => {
  const lanes = new Map()
  for (const phrase of phrases(events, sections)) {
    const base = contour(phrase, n, range)
    phrase.forEach((e, i) => lanes.set(e, chordShape(base[i], e.pitches, n, maxChord)))
  }
  return lanes
}

// ---------- star power phrases ----------

// Every other section gets one star power phrase: its first phrase of three or more notes
// (at most STAR_LEN beats). Returns [{ start, end }] in beats, shared by all difficulties.
export const starWindows = (events, sections) => {
  const out = []
  sections.forEach((s, i) => {
    if (i % 2 === 0) return
    const inside = events.filter((e) => e.beat >= s.start - EPS && e.beat < s.end - EPS)
    if (inside.length < 4) return
    const phrase = phrases(inside, [s]).find((p) => p.length >= 3) || inside
    const start = phrase[0].beat
    const last = phrase.filter((e) => e.beat < start + STAR_LEN - EPS).at(-1)
    out.push({ start, end: last.beat + EPS * 2 })
  })
  return out
}

// ---------- the chart ----------

// [{ beat, lanes, sustain (beats), hopo, star, phrase (star phrase index or -1), pitches }]
export const buildChart = (song, difficulty) => {
  const d = DIFF[difficulty]
  if (!d) throw new Error(`Unknown difficulty "${difficulty}"`)
  const all = leadEvents(song)
  const sections = sectionsOf(song)
  const spb = 60 / song.bpm
  const bpb = song.bpb || 4
  const allPitches = all.flatMap((e) => e.pitches[0])
  const range = [Math.min(...allPitches), Math.max(...allPitches)]
  const gap = Math.max(d.minBeats, d.minSec / spb)
  const kept = thin(all, gap, bpb)

  // Hard keeps Expert's lanes so the two feel like the same part; Easy and Medium are
  // mapped onto their own, narrower necks
  const lanes = d.lanes === 5 ? assignLanes(all, 5, d.maxChord, sections, range) : assignLanes(kept, d.lanes, d.maxChord, sections, range)
  const stars = starWindows(all, sections)

  return kept.map((e, i) => {
    const next = kept[i + 1]
    const room = next ? next.beat - e.beat : e.dur
    const tail = Math.min(e.dur, room) - 0.25
    const sustain = tail >= 0.75 - EPS && tail * spb >= 0.4 ? +tail.toFixed(4) : 0
    let noteLanes = lanes.get(e)
    if (noteLanes.length > d.maxChord) noteLanes = noteLanes.slice(0, d.maxChord)
    // easier parts play only the chords that land on strong beats (the rest as one note)
    if (noteLanes.length > 1 && metric(e.beat, bpb) < d.chordMetric) noteLanes = noteLanes.slice(0, 1)
    const phrase = stars.findIndex((w) => e.beat >= w.start - EPS && e.beat <= w.end)
    return { beat: e.beat, lanes: noteLanes, sustain, hopo: false, star: phrase >= 0, phrase, pitches: e.pitches }
  }).map((n, i, list) => {
    const prev = list[i - 1]
    if (d.hopo && prev && n.lanes.length === 1 && prev.lanes.length === 1 && n.lanes[0] !== prev.lanes[0]) {
      const gapBeats = n.beat - prev.beat
      if (gapBeats <= HOPO_BEATS + EPS && gapBeats * spb <= HOPO_SEC && prev.sustain === 0) n.hopo = true
    }
    return n
  })
}

// Seconds at a tempo (practice speed changes `bpm`): adds time, end and an index
export const timeChart = (chart, bpm) => {
  const spb = 60 / bpm
  return chart.map((n, i) => ({ ...n, i, time: n.beat * spb, sustainTime: n.sustain * spb, end: (n.beat + n.sustain) * spb }))
}

// The star phrase each note belongs to, and the last note of each phrase
export const phraseEnds = (notes) => {
  const ends = new Map()
  for (const n of notes) if (n.phrase >= 0) ends.set(n.phrase, n.i)
  return ends
}

const cache = new Map()
export const chartFor = (song, difficulty) => {
  const key = `${song.id}:${difficulty}`
  if (!cache.has(key)) cache.set(key, buildChart(song, difficulty))
  return cache.get(key)
}

// Notes per second and a 1-6 intensity rating (the dots on the song list)
export const chartStats = (song, difficulty) => {
  const chart = chartFor(song, difficulty)
  const spb = 60 / song.bpm
  const span = Math.max(1, (chart.at(-1)?.beat ?? 0) - (chart[0]?.beat ?? 0)) * spb
  const gems = chart.reduce((s, n) => s + n.lanes.length, 0)
  const nps = chart.length / span
  const chords = chart.filter((n) => n.lanes.length > 1).length / Math.max(1, chart.length)
  const rating = Math.max(1, Math.min(6, Math.round(nps * 0.95 + chords * 1.5 + (difficulty === "expert" ? 0.6 : 0))))
  return { notes: chart.length, gems, nps: +nps.toFixed(2), rating, sustains: chart.filter((n) => n.sustain > 0).length, stars: new Set(chart.filter((n) => n.star).map((n) => n.phrase)).size }
}
