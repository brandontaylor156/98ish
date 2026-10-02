import { build, prog, loop, pad, bass, arp, mel, drums, shift } from "../compose"

// Windows down, sun going down: chiming guitar arpeggios, a driving eighth-note bass and a
// singing lead over a long straight road in E minor.

const verseChords = loop(prog("Em C G D"), 2)
const chorusChords = loop(prog("C G D Em"), 2)
const bridgeChords = loop(prog("Am C Em D"), 2)
const outroChords = prog("C G D:2 C:2 Em:8")

const verse = `b4/1.5 g4/.5 e4/1 g4/1 | e5/1.5 d5/.5 c5/1 b4/1 | d5/1.5 b4/.5 g4/1 a4/1 | a4/3 r/1 |
  b4/1.5 g4/.5 e4/1 g4/1 | c5/1 e5/1 g5/1 e5/1 | d5/1.5 b4/.5 g4/1 b4/1 | a4/2 f#4/1 a4/1`

const chorus = `e5/1 g5/1 g5/1.5 e5/.5 | d5/1 b4/1 d5/2 | f#5/1 a5/1 a5/1.5 f#5/.5 | g5/1.5 e5/.5 e5/2 |
  e5/1 g5/1 c6/1.5 b5/.5 | b5/1 a5/.5 g5/.5 d5/2 | d5/1 f#5/1 a5/1 b5/1 | g5/1 f#5/1 e5/2`

const bridge = `c5/2 e5/2 | g5/3 e5/1 | b4/2 e5/2 | f#5/3 d5/1 |
  c5/2 a4/2 | e5/2 g5/2 | g5/1 f#5/1 e5/1 b4/1 | a4/2 d5/2`

const rock = { k: "x.......x.x.....", s: "....x.......x...", h: "x.x.x.x.x.x.x.x." }
const rockBig = { k: "x.......x.x.....", s: "....x.......x...", h: "x.x.x.x.x.x.x.x.", o: "..............x." }
const fillBar = { k: "x.......", s: "....x.x.", m: "........xx......", t: "..........xx.xx." }

// eight bars of a beat, crash on the one, a tom fill in the last bar
const groove = (lanes, bars = 8, crash = true) => [
  ...(crash ? [[0, 49, 1, 0.8]] : []),
  ...drums(lanes, { beats: (bars - 1) * 4, vel: 0.8 }),
  ...shift(drums(fillBar, { beats: 4, vel: 0.8 }), (bars - 1) * 4),
]

const guitar = (chords, vel = 0.42) => arp(chords, { pattern: "01213121", step: 0.5, center: 64, vel, length: 1.6 })

export default build({
  id: "highway",
  file: "HIGHWAY.MID",
  title: "Desert Highway",
  description: "A sunset road trip in E minor",
  bpm: 116,
  tracks: {
    lead: { instrument: "sawLead", gain: 0.75, pan: 0.05, reverb: 0.3, delay: 0.25 },
    guitar: { instrument: "pluck", gain: 0.7, pan: -0.35, reverb: 0.3, delay: 0.15 },
    organ: { instrument: "organ", gain: 0.6, pan: 0.3, reverb: 0.25 },
    bass: { instrument: "fingerBass", gain: 0.7, reverb: 0.05 },
    drums: { instrument: "drums", gain: 0.62, reverb: 0.15 },
  },
  sections: {
    intro: {
      bars: 4,
      guitar: guitar(prog("Em C G D")),
      bass: bass(prog("Em C G D"), { pattern: "R-------R---R---", step: 0.25, low: 40, vel: 0.6 }),
      drums: [...drums({ h: "x.x.x.x.x.x.x.x." }, { beats: 12, vel: 0.55 }), ...shift(drums(fillBar, { beats: 4, vel: 0.7 }), 12)],
    },
    verse: {
      bars: 8,
      lead: mel(verse, { vel: 0.72 }),
      guitar: guitar(verseChords),
      bass: bass(verseChords, { pattern: "RRRRRR5R", step: 0.5, low: 40, vel: 0.7 }),
      drums: groove(rock),
    },
    chorus: {
      bars: 8,
      lead: mel(chorus, { vel: 0.8 }),
      guitar: guitar(chorusChords, 0.38),
      organ: pad(chorusChords, { center: 60, vel: 0.5 }),
      bass: bass(chorusChords, { pattern: "RRRRRRR8", step: 0.5, low: 36, vel: 0.75 }),
      drums: groove(rockBig),
    },
    bridge: {
      bars: 8,
      lead: mel(bridge, { vel: 0.74 }),
      guitar: arp(bridgeChords, { pattern: "0.1.2.3.", step: 0.5, center: 64, vel: 0.4, length: 2 }),
      organ: pad(bridgeChords, { center: 55, vel: 0.45 }),
      bass: bass(bridgeChords, { pattern: "R--R--5-", step: 0.5, low: 33, vel: 0.7 }),
      drums: groove({ k: "x.........x.....", s: "....x.......x...", y: "x.x.x.x.x.x.x.x." }),
    },
    outro: {
      bars: 5,
      lead: mel("e5/1 g5/1 c6/2 | b5/1 a5/.5 g5/.5 d5/2 | f#5/2 e5/1 g5/1 | e5/8", { vel: 0.72 }),
      guitar: guitar(outroChords, 0.35),
      organ: pad(outroChords, { center: 60, vel: 0.45 }),
      bass: [...bass(prog("C G D:2 C:2"), { pattern: "RRRRRRRR", step: 0.5, low: 36, vel: 0.7 }), [12, 40, 7, 0.8]],
      drums: [[0, 49, 1, 0.8], ...drums(rock, { beats: 12, vel: 0.7 }), [12, 49, 3, 0.9], [12, 36, 1, 0.9]],
    },
  },
  order: ["intro", "verse", "chorus", "verse", "chorus", "bridge", "chorus", "outro"],
})

