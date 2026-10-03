// One play of one chart: judging your frets and strums against the notes, streaks, the
// multiplier, score, sustains, star power and the rock meter. Pure: every input carries
// its own song time (seconds, already corrected for lag), so it's exact and testable.
//
// Two ways to play:
//  - tap ("Easy strum", phones): pressing a fret plays it. A chord is played once all of
//    its frets are down. A fret that matches nothing while a note is in reach is a wrong
//    note (no penalty when nothing's coming).
//  - strum: hold the frets, then strum. For a single note the highest fret held must be
//    the note (lower ones may be held too); a chord needs exactly its frets. Hammer-ons
//    and pull-offs (HOPO notes) play by changing frets alone while your streak is going.
//
// Inputs push events (hits, misses, star power...) onto game.events for the engine to
// draw and play; it empties the list.

import { judge, WINDOWS } from "./timing.js"
import { multiplierFor, NOTE_POINTS, SUSTAIN_POINTS, perfectScore, starsFor, accuracy, streakMilestone } from "./scoring.js"
import { createStar, award, activate, canActivate, drain, whammyGain, PHRASE_BONUS } from "./starpower.js"
import { createMeter, meterHit, meterMiss, meterWrong, zoneOf } from "./rockmeter.js"

export const LANES = 5
export const STRUM_GRACE = 0.05 // a strum this far ahead of the right frets still counts
export const HOPO_STRUM_IGNORE = 0.075 // strumming through a hammer-on you already played
export const SUSTAIN_GRACE = 0.1 // letting go this close to a sustain's end counts as holding it

export const createGame = ({ notes, difficulty = "medium", spb, noFail = false, tap = true, windows }) => {
  const g = {
    notes: notes.map((n, i) => ({ ...n, i, result: null, judge: null, delta: 0, pending: null })),
    w: windows || WINDOWS[difficulty] || WINDOWS.medium,
    difficulty,
    spb,
    noFail,
    tap,
    held: Array(LANES).fill(false),
    next: 0,
    streak: 0,
    longest: 0,
    score: 0,
    hit: 0,
    counts: { perfect: 0, great: 0, good: 0, miss: 0, wrong: 0 },
    star: createStar(),
    meter: createMeter(difficulty),
    sustains: [],
    phraseLast: new Map(),
    phraseBroken: new Set(),
    pendingStrum: null,
    lastHopoTap: -Infinity,
    lastTime: null,
    whammy: false,
    failed: false,
    failedAt: null,
    events: [],
    auto: { releases: [] },
  }
  for (const n of g.notes) if (n.phrase >= 0) g.phraseLast.set(n.phrase, n.i)
  g.perfect = perfectScore(g.notes, spb)
  return g
}

export const multiplier = (g) => multiplierFor(g.streak) * (g.star.active ? 2 : 1)

const emit = (g, e) => g.events.push(e)

const failCheck = (g, t) => {
  if (!g.noFail && !g.failed && g.meter.value <= 0) {
    g.failed = true
    g.failedAt = t
    for (const s of g.sustains) emit(g, { type: "sustainEnd", note: s.note, full: false })
    g.sustains = []
    emit(g, { type: "fail", t })
  }
}

// unresolved notes within the hit window of t, in time order
const candidates = (g, t) => {
  const out = []
  for (let i = g.next; i < g.notes.length; i++) {
    const n = g.notes[i]
    if (n.time > t + g.w.good) break
    if (!n.result && Math.abs(t - n.time) <= g.w.good) out.push(n)
  }
  return out
}

// The note an input at t is for: the first candidate that `fits`. Skipping an earlier
// note is allowed only if the input is closer in time to the later one.
const pickNote = (g, t, fits) => {
  const cands = candidates(g, t)
  const pick = cands.find(fits)
  if (!pick) return { pick: null, cands }
  const earlier = cands.filter((n) => n.time < pick.time)
  if (earlier.some((n) => Math.abs(t - n.time) <= Math.abs(t - pick.time))) return { pick: null, cands }
  return { pick, cands, earlier }
}

const advance = (g) => {
  while (g.next < g.notes.length && g.notes[g.next].result) g.next++
}

const hit = (g, n, t, earlier = []) => {
  for (const e of earlier) miss(g, e, t)
  n.result = "hit"
  n.delta = t - n.time
  n.judge = judge(n.delta, g.w) || "good"
  n.pending = null
  g.counts[n.judge]++
  g.hit++
  const before = multiplierFor(g.streak)
  g.streak++
  g.longest = Math.max(g.longest, g.streak)
  const mult = multiplier(g)
  g.score += NOTE_POINTS * n.lanes.length * mult
  meterHit(g.meter, g.star.active)
  emit(g, { type: "hit", note: n, judge: n.judge, delta: n.delta, mult, streak: g.streak, t })
  if (multiplierFor(g.streak) !== before) emit(g, { type: "multiplier", value: multiplierFor(g.streak) })
  const milestone = streakMilestone(g.streak)
  if (milestone) emit(g, { type: "streak", value: milestone })
  if (n.phrase >= 0 && !g.phraseBroken.has(n.phrase) && g.phraseLast.get(n.phrase) === n.i) {
    const ready = canActivate(g.star)
    award(g.star, PHRASE_BONUS)
    emit(g, { type: "starPhrase", phrase: n.phrase, energy: g.star.energy, ready: !ready && canActivate(g.star) })
  }
  if (n.sustainTime > 0) g.sustains.push({ note: n, last: Math.max(n.time, Math.min(t, n.end)), points: 0 })
  advance(g)
}

const miss = (g, n, t) => {
  if (n.result) return
  n.result = "miss"
  n.pending = null
  g.counts.miss++
  const lost = g.streak
  g.streak = 0
  meterMiss(g.meter)
  if (n.phrase >= 0 && !g.phraseBroken.has(n.phrase)) {
    g.phraseBroken.add(n.phrase)
    emit(g, { type: "phraseBroken", phrase: n.phrase })
  }
  emit(g, { type: "miss", note: n, lost, t })
  advance(g)
  failCheck(g, t)
}

// a wrong fret or a strum with nothing to play
const wrong = (g, t, lane = -1) => {
  g.counts.wrong++
  const lost = g.streak
  g.streak = 0
  meterWrong(g.meter)
  emit(g, { type: "wrong", lane, lost, t })
  failCheck(g, t)
}

// ---------- frets and strums ----------

const highestHeld = (g) => g.held.lastIndexOf(true)

// strum mode: do the frets held right now play note n?
const fretsMatch = (g, n) => {
  if (n.lanes.length === 1) return highestHeld(g) === n.lanes[0]
  for (let l = 0; l < LANES; l++) if (g.held[l] !== n.lanes.includes(l)) return false
  return true
}

const tapPress = (g, lane, t) => {
  const { pick, cands, earlier } = pickNote(g, t, (n) => n.lanes.includes(lane))
  if (!pick) {
    if (cands.length) wrong(g, t, lane)
    return
  }
  if (pick.lanes.length > 1 && !pick.lanes.every((l) => g.held[l])) {
    pick.pending = t // the rest of the chord is on its way
    return
  }
  hit(g, pick, t, earlier)
}

// strum mode: frets moved. Completes a strum that came a moment early, or plays a HOPO.
const fretChange = (g, t) => {
  if (g.pendingStrum) {
    const at = g.pendingStrum.t
    const { pick, earlier } = pickNote(g, at, (n) => fretsMatch(g, n))
    if (pick) {
      g.pendingStrum = null
      hit(g, pick, at, earlier)
      return
    }
  }
  if (g.streak <= 0) return
  const n = g.notes[g.next]
  if (!n || !n.hopo || Math.abs(t - n.time) > g.w.good) return
  const prev = g.notes[n.i - 1]
  if (prev && prev.result !== "hit") return
  if (fretsMatch(g, n)) {
    hit(g, n, t)
    g.lastHopoTap = t
  }
}

const endSustain = (g, s, t, full) => {
  const upTo = full ? s.note.end : Math.min(t, s.note.end)
  accrue(g, s, upTo)
  g.sustains = g.sustains.filter((x) => x !== s)
  emit(g, { type: "sustainEnd", note: s.note, full, points: Math.round(s.points) })
}

const accrue = (g, s, upTo) => {
  if (upTo <= s.last) return
  const pts = ((upTo - s.last) / g.spb) * SUSTAIN_POINTS * multiplier(g)
  s.points += pts
  g.score += pts
  s.last = upTo
}

export const fretDown = (g, lane, t) => {
  if (lane < 0 || lane >= LANES) return
  const was = g.held[lane]
  g.held[lane] = true
  if (g.failed || was) return
  if (g.tap) tapPress(g, lane, t)
  else fretChange(g, t)
}

export const fretUp = (g, lane, t) => {
  if (lane < 0 || lane >= LANES || !g.held[lane]) return
  g.held[lane] = false
  if (g.failed) return
  for (const s of [...g.sustains]) {
    if (s.note.lanes.includes(lane)) endSustain(g, s, t, s.note.end - t <= SUSTAIN_GRACE)
  }
  if (!g.tap) fretChange(g, t)
}

export const strum = (g, t) => {
  if (g.failed || g.tap) return
  if (t - g.lastHopoTap < HOPO_STRUM_IGNORE) return
  const { pick, earlier } = pickNote(g, t, (n) => fretsMatch(g, n))
  if (pick) {
    if (g.pendingStrum) wrong(g, g.pendingStrum.t)
    g.pendingStrum = null
    hit(g, pick, t, earlier)
    return
  }
  if (g.pendingStrum) wrong(g, g.pendingStrum.t) // strummed twice
  g.pendingStrum = { t }
}

export const activateStar = (g, t) => {
  if (g.failed || !activate(g.star)) return false
  emit(g, { type: "starOn", t, energy: g.star.energy })
  return true
}

export const setWhammy = (g, on) => {
  g.whammy = !!on
}

// Advance to song time t: notes that slipped by are misses, sustains score, star power drains
export const tick = (g, t) => {
  if (g.failed) return
  const dt = g.lastTime === null ? 0 : Math.max(0, t - g.lastTime)
  g.lastTime = g.lastTime === null ? t : Math.max(g.lastTime, t)
  if (g.pendingStrum && t - g.pendingStrum.t > STRUM_GRACE) {
    const at = g.pendingStrum.t
    g.pendingStrum = null
    wrong(g, at)
  }
  for (let i = g.next; i < g.notes.length; i++) {
    const n = g.notes[i]
    if (n.time + g.w.good >= t) break
    if (!n.result) miss(g, n, t)
    if (g.failed) return
  }
  for (const s of [...g.sustains]) {
    const lanesHeld = s.note.lanes.every((l) => g.held[l])
    if (!lanesHeld) {
      endSustain(g, s, t, s.note.end - t <= SUSTAIN_GRACE)
      continue
    }
    if (g.whammy && s.note.star && dt > 0) whammyGain(g.star, Math.min(dt, s.note.end - s.last), g.spb)
    if (t >= s.note.end) endSustain(g, s, t, true)
    else accrue(g, s, t)
  }
  if (drain(g.star, dt, g.spb)) emit(g, { type: "starOff", t })
}

// Pausing (or a lost window) lets go of everything; sustains keep what they earned
export const releaseAll = (g, t) => {
  for (const s of [...g.sustains]) endSustain(g, s, t, false)
  g.held.fill(false)
  g.pendingStrum = null
}

export const isDone = (g) => g.failed || g.next >= g.notes.length

export const results = (g) => {
  const total = g.notes.length
  const score = Math.round(g.score)
  return {
    score,
    perfect: g.perfect,
    stars: g.failed ? 0 : starsFor(score, g.perfect),
    accuracy: accuracy(g.hit, total),
    hit: g.hit,
    total,
    longest: g.longest,
    counts: { ...g.counts },
    fullCombo: !g.failed && g.counts.miss === 0 && g.longest === total && total > 0,
    failed: g.failed,
    starActivations: g.star.activations,
    progress: total ? g.notes.filter((n) => n.result).length / total : 0,
  }
}

export const hud = (g) => ({
  score: Math.round(g.score),
  streak: g.streak,
  multiplier: multiplier(g),
  baseMultiplier: multiplierFor(g.streak),
  meter: g.meter.value,
  zone: zoneOf(g.meter.value),
  energy: g.star.energy,
  starActive: g.star.active,
  starReady: canActivate(g.star),
})

// ---------- autoplay (tests and the attract demo) ----------

// Plays every note due by t perfectly, then ticks. `strumMode` plays with frets + strum.
// Activates star power whenever it can (unless `useStar` is false).
export const autoplay = (g, t, { useStar = true } = {}) => {
  const a = g.auto
  for (;;) {
    if (g.failed) return
    const n = g.notes[g.next]
    const due = n && n.time <= t ? n.time : Infinity
    const rel = a.releases.length ? a.releases[0].at : Infinity
    const at = Math.min(due, rel)
    if (at > t) break
    if (rel <= due) {
      const r = a.releases.shift()
      tick(g, r.at)
      fretUp(g, r.lane, r.at)
      continue
    }
    tick(g, at)
    if (g.tap) {
      for (const l of n.lanes) {
        if (g.held[l]) {
          a.releases = a.releases.filter((r) => r.lane !== l)
          fretUp(g, l, at)
        }
      }
      for (const l of n.lanes) fretDown(g, l, at)
    } else {
      for (let l = 0; l < LANES; l++) if (g.held[l] && !n.lanes.includes(l)) fretUp(g, l, at)
      a.releases = a.releases.filter((r) => !n.lanes.includes(r.lane))
      for (const l of n.lanes) fretDown(g, l, at)
      if (!n.result) strum(g, at)
    }
    const end = n.sustainTime > 0 ? n.end : at + 0.02
    for (const l of n.lanes) a.releases.push({ lane: l, at: end })
    a.releases.sort((x, y) => x.at - y.at)
    if (useStar && canActivate(g.star)) activateStar(g, at)
  }
  tick(g, t)
}
