import { build, prog, loop, bass, arp, mel, drums, shift, soften } from "../compose"

// An 8-bit romp: pulse-wave lead, square-wave arpeggios, a bouncing triangle bass and a
// noise-channel drum kit, like a cartridge from under the TV.

const aChords = loop(prog("G Em C D"), 2)
const bChords = prog("Em C G D Em C D7 D7")
const cChords = prog("C D Bm Em C D G G")

const themeA = `g5/.5 b5/.5 d6/.5 b5/.5 g5/.5 d5/.5 g5/1 | e5/.5 g5/.5 b5/.5 e6/.5 d6/1 b5/1 |
  c6/.5 e6/.5 g6/.5 e6/.5 c6/.5 g5/.5 a5/.5 b5/.5 | a5/1 f#5/.5 a5/.5 d6/2 |
  b5/.5 d6/.5 g6/1 f#6/.5 e6/.5 d6/1 | e6/1 b5/1 g5/1 b5/1 | c6/.5 b5/.5 a5/.5 g5/.5 e5/1 g5/1 | f#5/.5 g5/.5 a5/1 d5/2`

const themeB = `b5/.75 b5/.75 a5/.5 g5/1 e5/1 | e5/.75 g5/.75 c6/.5 e6/2 | d6/.75 b5/.75 g5/.5 d6/1 b5/1 | a5/3 r/1 |
  g5/.75 a5/.75 b5/.5 e6/1 d6/1 | c6/.75 b5/.75 g5/.5 e5/1 g5/1 | a5/.5 b5/.5 c6/.5 b5/.5 a5/1 f#5/1 | d6/.5 d6/.5 d6/.5 r/.5 d6/2`

const themeC = `e5/1.5 g5/.5 c6/2 | f#5/1.5 a5/.5 d6/2 | f#5/1 b5/1 d6/1 f#6/1 | g6/1 e6/1 b5/2 |
  c6/1 e6/1 g6/1.5 e6/.5 | f#6/1 d6/1 a5/2 | g6/.5 f#6/.5 e6/.5 d6/.5 b5/.5 a5/.5 g5/1 | g5/.5 b5/.5 d6/.5 g6/.5 g6/2`

const beat = { k: "x.....x.x.......", s: "....x.......x...", h: "x.x.x.x.x.x.x.x." }
const beatBusy = { k: "x.....x.x.x.....", s: "....x.......x.xx", h: "xxx.xxx.xxx.xxx." }
const fill = { s: "x.x.xxx.xxxxxxxx", k: "x...x...x...x..." }

const bounce = (chords, vel = 0.8) => bass(chords, { pattern: "R8R8R8R8", step: 0.5, low: 31, vel, length: 0.8 })
const blips = (chords, vel = 0.4) => arp(chords, { pattern: "0120 1201 2012 0120", step: 0.25, center: 67, vel, length: 0.7 })

const eightBars = (lanes, vel = 0.8) => [...drums(lanes, { beats: 28, vel }), ...shift(drums(fill, { beats: 4, vel }), 28)]

export default build({
  id: "chiptune",
  file: "8BITRUN.MID",
  title: "Pixel Dash",
  description: "A chiptune romp in the style of an 8-bit cartridge",
  bpm: 150,
  humanize: false,
  tracks: {
    lead: { instrument: "chipPulse", gain: 0.8, pan: 0.1, reverb: 0.08 },
    harmony: { instrument: "chipSquare", gain: 0.55, pan: -0.25, reverb: 0.08 },
    arp: { instrument: "chipSquare", gain: 0.8, pan: 0.3, reverb: 0.05, delay: 0.1 },
    bass: { instrument: "chipTriangle", gain: 0.85, reverb: 0 },
    drums: { instrument: "chipDrums", gain: 1, reverb: 0.04 },
  },
  sections: {
    intro: {
      bars: 4,
      arp: blips(prog("G Em C D"), 0.55),
      bass: [...bass(prog("G Em"), { pattern: "R...R...", step: 0.5, low: 31, vel: 0.7, length: 0.8 }), ...shift(bounce(prog("C D"), 0.75), 8)],
      drums: [...drums({ h: "x.x.x.x.x.x.x.x." }, { beats: 12, vel: 0.6 }), ...shift(drums(fill, { beats: 4, vel: 0.75 }), 12)],
    },
    a: {
      bars: 8,
      lead: mel(themeA, { vel: 0.8, length: 0.85 }),
      arp: blips(aChords, 0.3),
      bass: bounce(aChords),
      drums: eightBars(beat),
    },
    a2: {
      bars: 8,
      lead: mel(themeA, { vel: 0.82, length: 0.85 }),
      harmony: soften(mel(themeA, { transpose: -12, length: 0.6 }), 0.65),
      arp: blips(aChords, 0.26),
      bass: bounce(aChords),
      drums: eightBars(beatBusy),
    },
    b: {
      bars: 8,
      lead: mel(themeB, { vel: 0.82, length: 0.85 }),
      harmony: arp(bChords, { pattern: "0.1.2.1.", step: 0.5, center: 62, vel: 0.5, length: 0.5 }),
      bass: bass(bChords, { pattern: "R.R85.R8", step: 0.5, low: 31, vel: 0.8, length: 0.8 }),
      drums: eightBars(beat),
    },
    c: {
      bars: 8,
      lead: mel(themeC, { vel: 0.84, length: 0.88 }),
      harmony: soften(mel(themeC, { transpose: -12, length: 0.7 }), 0.6),
      arp: blips(cChords, 0.3),
      bass: bounce(cChords, 0.85),
      drums: eightBars(beatBusy),
    },
    outro: {
      bars: 3,
      lead: mel("g5/.5 b5/.5 d6/.5 g6/.5 b6/.5 d7/.5 g7/1 | r/4 | g5/.5 g5/.5 g5/.5 r/.5 g5/2", { vel: 0.8 }),
      arp: blips(prog("G C:2 D:2"), 0.3),
      bass: [...bounce(prog("G C:2 D:2")), [8, 31, 0.4, 0.8], [8.5, 31, 0.4, 0.8], [9, 31, 0.4, 0.8], [10, 31, 2, 0.85]],
      drums: [...drums(beatBusy, { beats: 8, vel: 0.8 }), [8, 36, 0.4, 0.9], [8.5, 36, 0.4, 0.9], [9, 36, 0.4, 0.9], [10, 36, 0.4, 1], [10, 38, 0.4, 1]],
    },
  },
  order: ["intro", "a", "a2", "b", "a", "c", "b", "a2", "outro"],
})
