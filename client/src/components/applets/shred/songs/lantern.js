import { build, prog, loop, pad, bass, drums, shift, riff, chug, groove } from "./kit.js"

// Galloping heavy metal in E minor: a twin-guitar style gallop riff, a chugging verse, an
// epic chorus, a solo full of fast runs and a half-time breakdown.

const gallop = `e3/.5 e3/.25 e3 g3/.5 e3/.25 e3 a3/.5 e3/.25 e3 b3/.5 a3 |
  e3/.5 e3/.25 e3 g3/.5 e3/.25 e3 f#3/.5 g3 a3 b3 |
  c4+g4/1 c4+g4/.5 c4+g4 r b3 c4 b3 | d4+a4/1.5 d4+a4/.5 f#4 e4 d4 a3`

const intro = `${gallop} | ${gallop.split("|").slice(0, 3).join("|")} | b3+f#4/2 b3+f#4/1 a#3/.5 b3`

const verse = `e3+b3/.5 r e3+b3 r g3 a3 b3/1 | c4+g4/.5 r c4+g4 r b3 a3 g3/1 |
  d4+a4/.5 r d4+a4 r a3 b3 c4 d4 | e3+b3/2 g4/.5 f#4 e4 d4 |
  e3+b3/.5 r e3+b3 r g3 a3 b3/1 | c4+g4/.5 r c4+g4 r e4 d4 c4/1 |
  b3+f#4/1 b3+f#4 a3/.5 b3 c4 d#4 | b3+f#4/4`

const chorus = `e4/1 g4 c5/1.5 b4/.5 | a4/1 f#4 d5/2 | b4/1.5 a4/.5 g4/1 e4 | e4/3 r/1 |
  e4/1 g4 c5/1.5 d5/.5 | e5/1 d5 a4/2 | b4/.5 c5 d#5/1 f#5/2 | b3+f#4/2 b3+f#4/.5 b3+f#4 r/1`

const solo = `e5/.25 f#5 g5 a5 b5/.5 g5 e5/1 b4 | c5/.25 d5 e5 g5 c6/1 b5/.5 g5 e5/1 |
  d5/.5 f#5 a5 d6 c6/.25 b5 a5 f#5 d5/1 | b4/.25 c5 d#5 f#5 b5/1 a5/.5 f#5 d#5/1 |
  g5/.25 f#5 e5 b4 g5 f#5 e5 b4 e5/2 | e5/.25 g5 c6 e6 d6/.5 c6 g5/1 e5 |
  f#5/.25 a5 d6 a5 f#5 d5 a4 d5 f#5/2 | b4+f#5/4`

const breakdown = `e3+b3/1 r/.5 e3+b3 f3+c4/1.5 r/.5 | e3+b3/1 r/.5 e3+b3 f3+c4/1.5 r/.5 |
  e3+b3/1 r/.5 e3+b3 f3+c4/1.5 r/.5 | e3+b3/.5 e3+b3 f3+c4 f3+c4 e3+b3 e3+b3 f3+c4/1`

const outro = `e3+b3/1 e3+b3/.5 e3+b3 g3 a3 b3/1 | c4+g4/2 d4+a4 |
  e3/.5 e3/.25 e3 g3/.5 e3/.25 e3 a3/.5 b3 c4 d4 | e3+b3/4`

const beat = { k: "x.x.x.x.x.x.x.x.", s: "....x.......x...", h: "x.x.x.x.x.x.x.x." }
const gallopKick = { k: "x.xxx.xxx.xxx.xx", s: "....x.......x...", y: "x.x.x.x.x.x.x.x." }
const double = { k: "xxxxxxxxxxxxxxxx", s: "....x.......x...", c: "x.......x......." }
const halfTime = { k: "x.x.....x.x.....", s: "........x.......", c: "x...x...x...x..." }
const fill = { s: "x.x.x.x.", t: "........xx......", l: "..........xx.xxx" }

const C = {
  intro: prog("Em Em C D Em Em C B"),
  verse: prog("Em C D Em Em C B B"),
  chorus: prog("C D Em Em C D B B"),
  solo: loop(prog("Em C D B"), 2),
  breakdown: prog("Em Em Em Em"),
  outro: prog("Em C:2 D:2 Em Em"),
}

const song = build({
  id: "lantern",
  title: "Iron Lantern",
  artist: "Graveyard Shift",
  description: "Galloping metal in E minor",
  bpm: 152,
  humanize: false,
  tracks: {
    lead: { instrument: "shredLead", gain: 0.8, pan: 0.15, reverb: 0.2, delay: 0.12 },
    rhythm: { instrument: "shredRhythm", gain: 0.62, pan: -0.38, reverb: 0.1 },
    choir: { instrument: "strings", gain: 0.36, pan: 0.3, reverb: 0.5 },
    bass: { instrument: "fingerBass", gain: 0.8, reverb: 0.02 },
    drums: { instrument: "drums", gain: 0.72, reverb: 0.12 },
  },
  sections: {
    intro: {
      bars: 8,
      lead: riff(intro),
      rhythm: chug(C.intro, { pattern: "p.ppp.ppp.ppp.pp", step: 0.25, low: 40, vel: 0.75 }),
      bass: bass(C.intro, { pattern: "R.RRR.RRR.RRR.RR", step: 0.25, low: 28, vel: 0.78 }),
      drums: groove(drums, gallopKick, fill),
    },
    verse: {
      bars: 8,
      lead: riff(verse),
      rhythm: chug(C.verse, { pattern: "pppppppp", low: 40, vel: 0.78 }),
      bass: bass(C.verse, { pattern: "RRRRRRRR", low: 28, vel: 0.8 }),
      drums: groove(drums, beat, fill),
    },
    chorus: {
      bars: 8,
      lead: riff(chorus, { vel: 0.86 }),
      rhythm: chug(C.chorus, { pattern: "x-x-x-xx", low: 40, vel: 0.64 }),
      choir: pad(C.chorus, { center: 64, vel: 0.45 }),
      bass: bass(C.chorus, { pattern: "RRRRRRRR", low: 28, vel: 0.84 }),
      drums: groove(drums, double, fill, 8, { vel: 0.78 }),
    },
    solo: {
      bars: 8,
      lead: riff(solo, { vel: 0.88 }),
      rhythm: chug(C.solo, { pattern: "p.ppp.ppp.ppp.pp", step: 0.25, low: 40, vel: 0.7 }),
      choir: pad(C.solo, { center: 62, vel: 0.36 }),
      bass: bass(C.solo, { pattern: "R.RRR.RRR.RRR.RR", step: 0.25, low: 28, vel: 0.78 }),
      drums: groove(drums, gallopKick, fill),
    },
    breakdown: {
      bars: 4,
      lead: riff(breakdown),
      rhythm: chug(prog("Em:2 F:2 Em:2 F:2 Em:2 F:2 Em:2 F:2"), { pattern: "x-.x", low: 40, vel: 0.72, step: 0.5 }),
      bass: bass(prog("Em:2 F:2 Em:2 F:2 Em:2 F:2 Em:2 F:2"), { pattern: "R-.R", low: 28, vel: 0.85 }),
      drums: groove(drums, halfTime, null, 4, { vel: 0.85 }),
    },
    outro: {
      bars: 4,
      lead: riff(outro),
      rhythm: chug(C.outro, { pattern: "x-pxx-px", low: 40, vel: 0.68 }),
      choir: pad(C.outro, { center: 62, vel: 0.4 }),
      bass: bass(C.outro, { pattern: "RRRRRRRR", low: 28, vel: 0.84 }),
      drums: [[0, 49, 1, 0.9], ...drums(beat, { beats: 12, vel: 0.82 }), [12, 49, 4, 1], [12, 36, 1, 1], [12, 38, 1, 0.9]],
    },
  },
  order: ["intro", "verse", "chorus", "verse", "chorus", "solo", "breakdown", "chorus", "outro"],
})

export default {
  ...song,
  genre: "Heavy Metal",
  year: 1985,
  palette: { a: 0xff2a1a, b: 0xffa31a, sky: 0x160505 },
}
