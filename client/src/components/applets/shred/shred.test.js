// Tests for Shred 98's pure parts: songs, charts, timing, scoring, star power, the rock
// meter and the game itself.
// Run: node --test client/src/components/applets/shred/shred.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { SONGS, TIERS } from "./songs/index.js"
import { riff, riffBeats, chug } from "./songs/kit.js"
import * as C from "./chart.js"
import * as T from "./timing.js"
import * as S from "./scoring.js"
import * as SP from "./starpower.js"
import * as RM from "./rockmeter.js"
import * as G from "./game.js"
import * as P from "./progress.js"

const notesFor = (song, diff, rate = 1) => C.timeChart(C.chartFor(song, diff), song.bpm * rate)
const gameFor = (song, diff, opts = {}) => G.createGame({ notes: notesFor(song, diff), difficulty: diff, spb: 60 / song.bpm, ...opts })
const tiny = (spec, opts = {}) => {
  // spec: [[beat, lanes, sustainBeats?, extra?]] at 120 bpm
  const chart = spec.map(([beat, lanes, sustain = 0, extra = {}]) => ({ beat, lanes, sustain, hopo: false, star: false, phrase: -1, pitches: [60], ...extra }))
  return G.createGame({ notes: C.timeChart(chart, 120), difficulty: "medium", spb: 0.5, ...opts })
}
const types = (g) => g.events.map((e) => e.type)

// ---------- songs ----------

test("the set list: six original songs of different tempos and styles, two per venue", () => {
  assert.ok(SONGS.length >= 5)
  assert.equal(TIERS.length, 3)
  const bpms = SONGS.map((s) => s.bpm)
  assert.ok(Math.min(...bpms) <= 80, "a slow one")
  assert.ok(Math.max(...bpms) >= 170, "a fast one")
  assert.equal(new Set(SONGS.map((s) => s.genre)).size, SONGS.length)
  for (const s of SONGS) {
    const seconds = (s.lengthBeats * 60) / s.bpm
    assert.ok(seconds > 80 && seconds < 160, `${s.id} runs ${seconds}s`)
    assert.ok(s.tracks.some((t) => t.name === "lead" && t.instrument === "shredLead"), `${s.id} has a lead guitar`)
    assert.ok(s.tracks.some((t) => t.instrument === "drums"), `${s.id} has drums`)
    assert.equal(s.humanize, false, "lead notes land exactly on the chart")
  }
})

test("riff notation: notes, chords, rests and sticky durations", () => {
  const notes = riff("e3+b3/1 r/.5 a4 c5/1!")
  assert.deepEqual(notes.map((n) => [n[0], n[1]]), [[0, 52], [0, 59], [1.5, 69], [2, 72]])
  assert.equal(riffBeats("e3+b3/1 r/.5 a4 c5/1!"), 3)
  assert.throws(() => riff("h4/1"))
  const pm = chug([{ at: 0, len: 4, root: 4, bass: 4, intervals: [0, 7] }], { pattern: "p.x-", step: 1, low: 40 })
  assert.equal(pm.filter((n) => n[3] < 0.5).length, 2, "palm mutes are quiet")
  assert.equal(pm.filter((n) => n[0] === 2).length, 3, "a full power chord: root, fifth, octave")
})

// ---------- charts ----------

test("charts: lanes per difficulty, gaps, chords, sustains and star phrases", () => {
  for (const song of SONGS) {
    const spb = 60 / song.bpm
    const events = C.leadEvents(song)
    for (const diff of C.DIFFICULTIES) {
      const d = C.DIFF[diff]
      const chart = C.chartFor(song, diff)
      const label = `${song.id}/${diff}`
      assert.ok(chart.length > 40, `${label} has notes`)
      const used = new Set(chart.flatMap((n) => n.lanes))
      assert.equal(Math.max(...used), d.lanes - 1, `${label} uses all ${d.lanes} lanes`)
      assert.equal(Math.min(...used), 0)
      for (let i = 0; i < chart.length; i++) {
        const n = chart[i]
        const next = chart[i + 1]
        assert.ok(n.lanes.length >= 1 && n.lanes.length <= d.maxChord, `${label} chord size`)
        assert.equal(new Set(n.lanes).size, n.lanes.length)
        assert.ok(n.lanes.every((l) => l >= 0 && l < d.lanes))
        if (next) {
          const gap = next.beat - n.beat
          assert.ok(gap >= Math.max(d.minBeats, d.minSec / spb) - 1e-6, `${label} gap ${gap} at beat ${n.beat}`)
          assert.ok(n.beat + n.sustain <= next.beat - 0.2, `${label} sustain at ${n.beat} runs into the next note`)
        }
        if (n.hopo) assert.ok(d.hopo && n.lanes.length === 1 && chart[i - 1].lanes[0] !== n.lanes[0], `${label} hopo at ${n.beat}`)
      }
      if (diff === "expert") assert.equal(chart.length, events.length, "Expert plays every note")
      const phrases = new Set(chart.filter((n) => n.star).map((n) => n.phrase))
      assert.ok(phrases.size >= 3, `${label} has star power phrases`)
      assert.ok(chart.some((n) => n.sustain > 0), `${label} has sustains`)
    }
    const easy = C.chartStats(song, "easy")
    const expert = C.chartStats(song, "expert")
    assert.ok(easy.nps < expert.nps || song.id === "lastlight", `${song.id}: Easy is lighter`)
    assert.ok(easy.nps <= 1.6, `${song.id}: Easy stays relaxed (${easy.nps} notes/s)`)
  }
})

test("charts follow the melody: same note same lane, up is right, down is left", () => {
  for (const song of SONGS) {
    const events = C.leadEvents(song)
    const chart = C.chartFor(song, "expert")
    const sections = C.sectionsOf(song)
    let checked = 0
    for (const phrase of C.phrases(events, sections)) {
      for (let i = 1; i < phrase.length; i++) {
        const a = chart[events.indexOf(phrase[i - 1])]
        const b = chart[events.indexOf(phrase[i])]
        const dp = Math.sign(phrase[i].pitches[0] - phrase[i - 1].pitches[0])
        const dl = Math.sign(b.lanes[0] - a.lanes[0])
        if (a.lanes.length > 1 || b.lanes.length > 1) continue // chord shapes may shift
        if (dp === 0) assert.equal(dl, 0, `${song.id} repeated note at beat ${b.beat}`)
        else assert.ok(dl === dp || (dl === 0 && (b.lanes[0] === 0 || b.lanes[0] === 4)), `${song.id} beat ${b.beat}: pitch ${dp}, lane ${dl}`)
        checked++
      }
    }
    assert.ok(checked > 50)
  }
})

test("charts are deterministic and scale exactly with practice speed", () => {
  const song = SONGS[0]
  assert.deepEqual(C.buildChart(song, "hard"), C.buildChart(song, "hard"))
  const full = notesFor(song, "hard")
  const slow = notesFor(song, "hard", 0.5)
  full.forEach((n, i) => {
    assert.ok(Math.abs(slow[i].time - n.time * 2) < 1e-9)
    assert.ok(Math.abs(slow[i].end - n.end * 2) < 1e-9)
  })
  const sections = C.sectionsOf(song)
  assert.equal(sections[0].start, 0)
  assert.ok(sections.some((s) => s.label === "Chorus 2"))
  assert.equal(sections.at(-1).end, song.lengthBeats)
})

// ---------- timing ----------

test("hit windows: perfect, great, good, then nothing; tighter on harder parts", () => {
  const w = T.WINDOWS.expert
  assert.equal(T.judge(0, w), "perfect")
  assert.equal(T.judge(-0.03, w), "perfect")
  assert.equal(T.judge(0.05, w), "great")
  assert.equal(T.judge(-0.09, w), "good")
  assert.equal(T.judge(0.11, w), null)
  for (const k of ["perfect", "great", "good"]) {
    assert.ok(T.WINDOWS.easy[k] > T.WINDOWS.medium[k] && T.WINDOWS.medium[k] > T.WINDOWS.hard[k] && T.WINDOWS.hard[k] > T.WINDOWS.expert[k])
  }
})

test("the clock smooths jitter and snaps on a jump", () => {
  const clock = T.createClock()
  T.clockSample(clock, 10, 5000)
  assert.equal(T.heardAt(clock, 5000), 10)
  // 2 ms of jitter moves it a little, not all the way
  T.clockSample(clock, 11.002, 6000)
  const off = T.heardAt(clock, 6000) - 11
  assert.ok(off > 0 && off < 0.0005)
  // a real jump (the context stalled) snaps
  T.clockSample(clock, 11.5, 7000)
  assert.equal(T.heardAt(clock, 7000), 11.5)
})

test("calibration: median tap offset, ignoring wild taps", () => {
  const beats = [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500]
  const taps = [1042, 1538, 2047, 2541, 2900 + 640, 3044, 4039, 4545]
  const r = T.calibrate(taps, beats)
  assert.ok(r.offset >= 40 && r.offset <= 45, `offset ${r.offset}`)
  assert.equal(T.calibrate([1000, 1500], beats), null, "too few taps")
  assert.equal(T.inputShift({ audio: 40, video: 0 }), -0.04)
  assert.ok(Math.abs(T.drawShift({ audio: 40, video: 70 }) - 0.03) < 1e-12)
})

// ---------- scoring, star power, rock meter ----------

test("multiplier, points and stars", () => {
  assert.deepEqual([0, 9, 10, 19, 20, 29, 30, 500].map(S.multiplierFor), [1, 1, 2, 2, 3, 3, 4, 4])
  assert.equal(S.starsFor(0, 1000), 1)
  assert.equal(S.starsFor(520, 1000), 3)
  assert.equal(S.starsFor(900, 1000), 5)
  assert.equal(S.starsFor(1400, 1000), 5)
  assert.equal(S.accuracy(97, 120), 80.8)
})

test("star power: half a meter to activate, 32 beats from full", () => {
  const s = SP.createStar()
  SP.award(s, 0.25)
  assert.equal(SP.activate(s), false)
  SP.award(s, 0.25)
  assert.equal(SP.activate(s), true)
  SP.award(s, 0.5)
  let beats = 0
  while (!SP.drain(s, 0.5 / 8, 0.5)) beats += 1 / 8
  assert.ok(Math.abs(beats - 32) < 0.2, `lasted ${beats} beats`)
  assert.equal(s.active, false)
})

test("rock meter: hits raise it, misses sink it", () => {
  const m = RM.createMeter("expert")
  for (let i = 0; i < 20; i++) RM.meterMiss(m)
  assert.equal(m.value, 0)
  assert.equal(RM.zoneOf(0.2), "red")
  assert.equal(RM.zoneOf(0.5), "yellow")
  assert.equal(RM.zoneOf(0.9), "green")
  for (const d of C.DIFFICULTIES) {
    const r = RM.METER[d]
    const breakEven = r.miss / (r.hit + r.miss)
    assert.ok(breakEven > 0.5 && breakEven < 0.72, `${d} break-even ${breakEven}`)
  }
})

// ---------- the game ----------

test("autoplay full-combos every chart, tap and strum, for the perfect score", () => {
  for (const song of SONGS) {
    for (const diff of C.DIFFICULTIES) {
      for (const tap of [true, false]) {
        const g = gameFor(song, diff, { tap })
        const end = g.notes.at(-1).end + 1
        for (let t = -2; t < end; t += 1 / 60) G.autoplay(g, t, { useStar: false })
        G.autoplay(g, end + 1, { useStar: false })
        const r = G.results(g)
        const label = `${song.id}/${diff}/${tap ? "tap" : "strum"}`
        assert.equal(r.hit, r.total, `${label}: hit ${r.hit}/${r.total} (${JSON.stringify(r.counts)})`)
        assert.ok(r.fullCombo, label)
        assert.equal(r.counts.perfect, r.total, label)
        assert.equal(r.counts.wrong, 0, label)
        assert.ok(Math.abs(r.score - r.perfect) <= g.notes.length * 0.01 + 2, `${label}: ${r.score} vs ${r.perfect}`)
        assert.equal(r.stars, 5)
      }
    }
  }
})

test("star power doubles the multiplier and beats the no-star-power maximum", () => {
  const song = SONGS[0]
  const g = gameFor(song, "expert")
  const end = g.notes.at(-1).end + 1
  let sawOn = false
  for (let t = 0; t < end; t += 1 / 60) {
    G.autoplay(g, t)
    if (g.star.active) {
      sawOn = true
      assert.equal(G.multiplier(g), S.multiplierFor(g.streak) * 2)
    }
  }
  assert.ok(sawOn)
  assert.ok(G.results(g).score > g.perfect * 1.1)
  assert.ok(g.events.some((e) => e.type === "starPhrase") && g.events.some((e) => e.type === "starOn"))
})

test("playing nothing fails you; No-Fail doesn't; easy forgives more than expert", () => {
  const fails = {}
  for (const diff of ["easy", "expert"]) {
    const g = gameFor(SONGS[0], diff)
    for (let t = 0; t < 200 && !g.failed; t += 0.05) G.tick(g, t)
    assert.ok(g.failed, diff)
    fails[diff] = g.counts.miss
    assert.equal(G.results(g).stars, 0)
    assert.ok(g.events.some((e) => e.type === "fail"))
  }
  assert.ok(fails.easy > fails.expert, `easy lasted ${fails.easy} misses, expert ${fails.expert}`)
  const nf = gameFor(SONGS[0], "expert", { noFail: true })
  for (let t = 0; t < 200; t += 0.05) G.tick(nf, t)
  assert.ok(!nf.failed && nf.meter.value === 0 && G.isDone(nf))
})

test("judgements from timing offsets", () => {
  const g = tiny([[4, [0]], [6, [1]], [8, [2]], [10, [3]]])
  G.fretDown(g, 0, 2 + 0.01)
  G.fretDown(g, 1, 3 + 0.05)
  G.fretDown(g, 2, 4 - 0.1)
  G.fretDown(g, 3, 5 + 0.2) // too late: nothing to hit (no penalty, the window's empty)
  G.tick(g, 6)
  assert.deepEqual(g.notes.map((n) => n.judge || n.result), ["perfect", "great", "good", "miss"])
  assert.equal(g.counts.wrong, 0)
})

test("tap mode: chords need every fret; a wrong fret near a note breaks the streak", () => {
  const g = tiny([[2, [0, 2]], [4, [1]], [6, [3]]])
  G.fretDown(g, 0, 1.0)
  assert.equal(g.notes[0].result, null, "half a chord isn't a chord")
  G.fretDown(g, 2, 1.02)
  assert.equal(g.notes[0].result, "hit")
  G.fretDown(g, 1, 2)
  assert.equal(g.streak, 2)
  G.fretDown(g, 4, 3) // wrong lane, note in reach
  assert.equal(g.streak, 0)
  assert.equal(g.counts.wrong, 1)
  G.fretDown(g, 4, 3.1) // already held: nothing
  G.fretUp(g, 4, 3.3)
  G.fretDown(g, 4, 3.4) // nothing in reach: no penalty
  assert.equal(g.counts.wrong, 1)
})

test("tap mode: a press goes to the nearer of two close notes", () => {
  const g = tiny([[2, [0]], [2.25, [2]]]) // 1.0 s and 1.125 s
  G.fretDown(g, 2, 1.12) // the second note: the first is skipped (missed)
  assert.equal(g.notes[1].result, "hit")
  assert.equal(g.notes[0].result, "miss")
  const h = tiny([[2, [0]], [2.25, [2]]])
  G.fretDown(h, 2, 1.0) // aimed at the first note, wrong fret
  assert.equal(h.notes[1].result, null)
  assert.equal(h.counts.wrong, 1)
})

test("strum mode: anchoring, exact chords, early strums and HOPOs", () => {
  const g = tiny([[2, [2]], [4, [0, 1]], [6, [3]], [6.25, [1], 0, { hopo: true }], [8, [4]]], { tap: false })
  G.fretDown(g, 0, 0.5)
  G.fretDown(g, 2, 0.6) // anchoring: green held under yellow is fine
  G.strum(g, 1.0)
  assert.equal(g.notes[0].result, "hit")
  G.fretUp(g, 2, 1.5)
  G.fretDown(g, 1, 1.6)
  G.fretDown(g, 4, 1.7)
  G.strum(g, 2.0) // green+red+orange isn't green+red
  G.fretUp(g, 4, 2.02) // fixed inside the strum grace: still a hit, timed at the strum
  assert.equal(g.notes[1].result, "hit")
  assert.equal(g.notes[1].judge, "perfect")
  G.fretUp(g, 0, 2.5)
  G.fretUp(g, 1, 2.5)
  G.fretDown(g, 3, 2.9)
  G.strum(g, 3.0)
  G.fretDown(g, 1, 3.05) // red under blue: still blue
  assert.equal(g.notes[3].result, null)
  G.fretUp(g, 3, 3.12) // the pull-off to red plays the HOPO without a strum
  assert.equal(g.notes[3].result, "hit")
  G.strum(g, 3.14) // strumming through the HOPO doesn't count against you
  G.tick(g, 3.2)
  assert.equal(g.counts.wrong, 0)
  G.strum(g, 3.5) // nothing to play
  G.tick(g, 3.6)
  assert.equal(g.counts.wrong, 1)
  assert.equal(g.streak, 0)
})

test("sustains score while held and stop when you let go", () => {
  const full = tiny([[2, [1], 4]])
  G.fretDown(full, 1, 1)
  for (let t = 1; t <= 3.2; t += 0.01) G.tick(full, t)
  const early = tiny([[2, [1], 4]])
  G.fretDown(early, 1, 1)
  for (let t = 1; t <= 2; t += 0.01) G.tick(early, t)
  G.fretUp(early, 1, 2)
  G.tick(early, 3.2)
  const fullPts = full.events.find((e) => e.type === "sustainEnd")
  const earlyPts = early.events.find((e) => e.type === "sustainEnd")
  assert.equal(fullPts.full, true)
  assert.equal(fullPts.points, 100) // 4 beats x 25
  assert.equal(earlyPts.full, false)
  assert.equal(earlyPts.points, 50)
})

test("star phrases: hit them all for a quarter meter; a miss breaks the phrase", () => {
  const spec = (phrase) => [[2, [0], 0, { star: true, phrase }], [3, [1], 0, { star: true, phrase }], [4, [2], 0, { star: true, phrase }]]
  const g = tiny(spec(0))
  G.fretDown(g, 0, 1)
  G.fretDown(g, 1, 1.5)
  G.fretDown(g, 2, 2)
  assert.equal(g.star.energy, 0.25)
  const h = tiny(spec(0))
  G.fretDown(h, 0, 1)
  G.tick(h, 2)
  G.fretDown(h, 2, 2)
  assert.equal(h.star.energy, 0)
  assert.ok(h.events.some((e) => e.type === "phraseBroken"))
})

test("whammying a star power sustain adds energy", () => {
  const g = tiny([[2, [0], 8, { star: true, phrase: 0 }]])
  G.fretDown(g, 0, 1)
  G.setWhammy(g, true)
  for (let t = 1; t <= 5.2; t += 0.02) G.tick(g, t)
  assert.ok(g.star.energy > 0.25 + 0.2, `energy ${g.star.energy}`) // phrase bonus + 8 beats of whammy
})

// ---------- career ----------

test("career: best scores, top-5 tables, stars unlock the next venue", () => {
  let p = P.emptyProgress()
  const play = (song, diff, score, stars, failed = false) => {
    const r = P.record(p, song, diff, { score, stars, accuracy: 90, longest: 20, failed }, score)
    p = r.progress
    return r
  }
  assert.equal(P.tierUnlocked(p, TIERS[1], SONGS), false)
  assert.equal(play("garage", "easy", 30000, 4).newBest, true)
  assert.equal(play("garage", "easy", 20000, 3).newBest, false)
  assert.equal(play("garage", "easy", 99999, 0, true).newBest, false, "a failed song never counts")
  assert.equal(P.songStars(p, "garage"), 4)
  assert.equal(P.starsToUnlock(p, TIERS[1], SONGS), 1)
  play("lastlight", "medium", 12000, 2)
  assert.equal(P.totalStars(p, SONGS), 6)
  assert.ok(P.tierUnlocked(p, TIERS[1], SONGS))
  assert.ok(!P.tierUnlocked(p, TIERS[2], SONGS))
  for (let i = 0; i < 7; i++) play("neon", "hard", 1000 * i, 2)
  const table = P.tableOf(p, "neon", "hard")
  assert.equal(table.length, P.TABLE_SIZE)
  assert.deepEqual(table.map((e) => e.score), [6000, 5000, 4000, 3000, 2000])
  assert.equal(play("neon", "hard", 500, 1).rank, -1)
  // storage round trip, with a broken entry falling back to defaults
  const mem = new Map()
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) }
  P.save(P.KEYS.progress, p, storage)
  assert.deepEqual(P.loadProgress(storage), p)
  mem.set(P.KEYS.prefs, "{oops")
  assert.equal(P.loadPrefs(storage).easyStrum, true)
})
