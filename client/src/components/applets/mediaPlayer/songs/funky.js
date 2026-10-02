import { build, prog, loop, pad, comp, bass, mel, drums, shift, soften } from "../compose"

// A sixteenth-note funk groove in E: popping bass, a scratchy clavinet, organ chords,
// horn riffs and a chorus that opens up into major sevenths.

const verseChords = loop(prog("E9 E9 A9 E9"), 2)
const chorusChords = loop(prog("Amaj7 G#m7 F#m7 B9sus4:2 B7#9:2"), 2)
const breakChords = prog("E9 E9 E9 E9")

// the horn riff: two bars over E9; its first bar moves up a fourth for the A9
const riff1 = "b4/.5 d5/.25 e5/.25 r/.5 g5/.25 g#5/.25 r/.5 b5/.5 r/1"
const riff2 = "d6/.25 r/.25 b5/.25 r/.25 a5/.5 g#5/.5 e5/1 r/1"
const hornRiff = [...mel(riff1), ...mel(riff2, { at: 4 }), ...mel(riff1, { at: 8, transpose: 5 }), ...mel(riff2, { at: 12 })]

const answer = `e5/.5 g5/.5 a5/.5 b5/1 a5/.5 g5/.5 e5/.5 | d5/.5 e5/1.5 r/2 |
  c#6/.5 b5/.5 a5/.5 g5/1 e5/.5 g5/.5 a5/.5 | g#5/.5 a5/.5 b5/1 r/2`

const chorus = `c#6/1.5 b5/.5 a5/1 g#5/1 | b5/1.5 g#5/.5 f#5/1 d#5/1 | e5/1 f#5/1 a5/1 c#6/1 | c#6/1 e6/1 d6/1 a5/1 |
  e6/1.5 c#6/.5 b5/1 a5/1 | g#5/1.5 b5/.5 d#6/1 b5/1 | a5/1 c#6/1 e6/2 | e6/1 c#6/1 b5/2`

const funkBeat = { k: "x.....x...x..x..", s: "....x..g.g..x..g", h: "xxxxxxxxxxxxxxxx", o: "..............x." }
const chorusBeat = { k: "x.....x...x.....", s: "....x..g.g..x..g", h: "x.x.x.x.x.x.x.x.", o: "..x...x...x...x." }
const fillBar = { k: "x.....x.", s: "....x.xx", t: "........xx..", m: "..........xx.xx." }

const pop = (chords, vel = 0.8) => bass(chords, { pattern: "X..rR.8...R.b.5.", step: 0.25, low: 28, vel, length: 0.7 })
const scratch = (chords, vel = 0.5) => comp(chords, { rhythm: "x.gx.xg.x.gx.x.g", step: 0.25, center: 66, vel, length: 0.5 })

const eight = (lanes, vel = 0.8) => [...drums(lanes, { beats: 28, vel }), ...shift(drums(fillBar, { beats: 4, vel }), 28)]

export default build({
  id: "funky",
  file: "GROOVE.MID",
  title: "Groove Machine",
  description: "A sixteenth-note funk workout with horns",
  bpm: 102,
  swing: { grid: 0.25, amount: 0.14 },
  tracks: {
    horns: { instrument: "brass", gain: 0.95, pan: 0.2, reverb: 0.25 },
    lead: { instrument: "organ", gain: 0.9, pan: -0.1, reverb: 0.25 },
    clav: { instrument: "clav", gain: 0.7, pan: -0.35, reverb: 0.12 },
    organ: { instrument: "organ", gain: 0.5, pan: 0.35, reverb: 0.25 },
    keys: { instrument: "epiano", gain: 0.5, pan: 0.1, reverb: 0.3 },
    bass: { instrument: "slapBass", gain: 0.75, reverb: 0 },
    drums: { instrument: "drums", gain: 0.52, reverb: 0.12 },
  },
  sections: {
    intro: {
      bars: 4,
      bass: pop(breakChords),
      clav: shift(scratch(prog("E9 E9")), 8),
      drums: [...drums(funkBeat, { beats: 12, vel: 0.78 }), ...shift(drums(fillBar, { beats: 4, vel: 0.8 }), 12)],
    },
    verse: {
      bars: 8,
      horns: hornRiff,
      lead: shift(mel(answer, { vel: 0.7 }), 16),
      clav: scratch(verseChords),
      organ: comp(verseChords, { rhythm: "....x.......x...", step: 0.25, center: 60, vel: 0.5, length: 0.6 }),
      bass: pop(verseChords),
      drums: [[0, 49, 1, 0.75], ...eight(funkBeat)],
    },
    chorus: {
      bars: 8,
      horns: mel(chorus, { vel: 0.78 }),
      keys: comp(chorusChords, { rhythm: "X--.x--.", step: 0.5, center: 64, vel: 0.5 }),
      organ: pad(chorusChords, { center: 60, vel: 0.45 }),
      clav: soften(scratch(chorusChords), 0.75),
      bass: bass(chorusChords, { pattern: "R..R..R.5..R7.8.", step: 0.25, low: 33, vel: 0.8, length: 0.7 }),
      drums: [[0, 49, 1, 0.85], ...eight(chorusBeat, 0.82)],
    },
    breakdown: {
      bars: 4,
      bass: pop(breakChords, 0.85),
      organ: soften(comp(breakChords, { rhythm: "x-..............", step: 0.25, center: 60, vel: 0.5 }), 0.9),
      drums: [...drums({ k: "x.....x...x..x..", s: "....x.......x...", h: "x.x.x.x.x.x.x.x." }, { beats: 12, vel: 0.75 }), ...shift(drums({ s: "x.x.x.x.xxxxXXXX" }, { beats: 4, vel: 0.8 }), 12)],
      horns: shift(mel("e5/.25 r/.25 e5/.25 r/.25 g5/.5 g#5/.5 b5/1 r/1", { vel: 0.85 }), 12),
    },
    outro: {
      bars: 4,
      horns: [...hornRiff.filter(([b]) => b < 8), ...mel("e5/.25 r/.25 g5/.25 r/.25 b5/.25 r/.25 e6/2.5!", { at: 12, vel: 0.85 })],
      clav: scratch(prog("E9 E9 A9")),
      organ: [...pad(prog("E9:8 A9:4"), { center: 60, vel: 0.45 }), ...shift(pad(prog("E9:4"), { center: 62, vel: 0.55 }), 13.5)],
      bass: [...pop(prog("E9 E9 A9")), [12, 28, 0.25, 0.9], [12.5, 35, 0.25, 0.8], [13, 40, 0.25, 0.85], [13.5, 28, 2, 0.95]],
      drums: [...drums(funkBeat, { beats: 12, vel: 0.8 }), [12, 38, 0.25, 0.9], [12.5, 38, 0.25, 0.9], [13, 38, 0.25, 0.9], [13.5, 49, 2, 1], [13.5, 36, 1, 1]],
    },
  },
  order: ["intro", "verse", "chorus", "verse", "chorus", "breakdown", "chorus", "outro"],
})
