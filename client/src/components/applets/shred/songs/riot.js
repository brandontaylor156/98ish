import { build, prog, loop, bass, drums, shift, riff, chug, groove } from "./kit.js"

// Three chords and a basement full of kids: fast down-picked punk in E with power chord
// stabs, a shout-along chorus and a breakdown before the last two choruses.

const intro = `e3+b3/2 e3+b3 | e3+b3/1 e3+b3 e3+b3 e3+b3 | a3+e4/2 b3+f#4 |
  b3+f#4/.5 b3+f#4 b3+f#4 b3+f#4 b3+f#4 b3+f#4 b3+f#4 b3+f#4`

const verse = `e3+b3/1 e3+b3 e3+b3/.5 e3+b3 e3+b3/1 | r/.5 g#3 b3 e4 d#4 e4 b3/1 |
  a3+e4/1 a3+e4 a3+e4/.5 a3+e4 r/1 | b3+f#4/1 b3+f#4/.5 b3+f#4 b3+f#4/1 a3+e4 |
  e3+b3/1 e3+b3 e3+b3/.5 e3+b3 e3+b3/1 | r/.5 g#3 b3 e4 f#4 g#4 f#4/1 |
  a3+e4/1 a3+e4 a3+e4/.5 a3+e4 r/1 | b3+f#4/2 b3+f#4`

const verse2 = `b3/.5 b3 b3 b3 g#3/1 e3 | g#3/.5 b3 e4/1 d#4/.5 e4 b3/1 |
  c#4/.5 c#4 c#4 c#4 e4/1 c#4 | d#4/.5 d#4 f#4/1 b3/2 |
  b3/.5 b3 b3 b3 g#3/1 e3 | g#3/.5 b3 e4/1 f#4/.5 g#4 e4/1 |
  a4/.5 g#4 f#4 e4 c#4/1 e4 | f#4/1 d#4 b3+f#4/2`

const chorus = `c#4/.5 e4 e4 e4 f#4/1 e4 | d#4/1 f#4 b4/2 | g#4/.5 b4 b4 b4 c#5/1 b4 | g#4/1 e4 c#4/2 |
  c#4/.5 e4 e4 e4 a4/1 g#4 | f#4/1 d#4 b3/2 | e4+b4/1 e4+b4/.5 e4+b4 e4+b4/1 e4+b4 |
  e4+b4/.5 r b3 c#4 d#4 e4 f#4 g#4`

const bridge = `c#4+g#4/2 a3+e4 | e3+b3/2 b3+f#4 | c#4+g#4/2 a3+e4 | e3+b3/2 b3+f#4 |
  c#4+g#4/2 a3+e4 | e3+b3/2 b3+f#4 | c#4+g#4/1 c#4+g#4 a3+e4 a3+e4 |
  b3+f#4/.5 b3+f#4 b3+f#4 b3+f#4 b3+f#4 b3+f#4 b3+f#4 b3+f#4`

const outro = `e3+b3/1 e3+b3 e3+b3 e3+b3 | a3+e4/1 a3+e4 a3+e4 a3+e4 | b3+f#4/1 b3+f#4 b3+f#4 b3+f#4 | e3+b3/4`

const skank = { k: "x...x...x...x...", s: "..x...x...x...x.", h: "x.x.x.x.x.x.x.x." }
const drive = { k: "x.x.x.x.x.x.x.x.", s: "....x.......x...", y: "x.x.x.x.x.x.x.x." }
const fill = { s: "x.x.x.x.", t: "........x.x.....", l: "............x.x." }
const halfTime = { k: "x.....x.x.......", s: "........x.......", o: "x...x...x...x..." }

const C = {
  intro: prog("E E A B"),
  verse: loop(prog("E E A B"), 2),
  chorus: prog("A B E C#m A B E E"),
  bridge: loop(prog("C#m A E B"), 2),
  outro: prog("E A B E"),
}

const song = build({
  id: "riot",
  title: "Basement Riot",
  artist: "Pixel Riot",
  description: "Fast punk in E",
  bpm: 184,
  humanize: false,
  tracks: {
    lead: { instrument: "shredLead", gain: 0.8, pan: 0.15, reverb: 0.12 },
    rhythm: { instrument: "shredRhythm", gain: 0.6, pan: -0.35, reverb: 0.08 },
    bass: { instrument: "fingerBass", gain: 0.8, reverb: 0.02 },
    drums: { instrument: "drums", gain: 0.72, reverb: 0.1 },
  },
  sections: {
    intro: {
      bars: 4,
      lead: riff(intro),
      rhythm: chug(C.intro, { pattern: "x---x---", low: 40, vel: 0.66 }),
      drums: [...drums({ c: "x.......x.......", k: "x.......x......." }, { beats: 12, vel: 0.7 }), ...shift(drums(fill, { beats: 4, vel: 0.85 }), 12)],
    },
    verse: {
      bars: 8,
      lead: riff(verse),
      rhythm: chug(C.verse, { pattern: "pppppppp", low: 40, vel: 0.72 }),
      bass: bass(C.verse, { pattern: "RRRRRRRR", low: 28, vel: 0.8 }),
      drums: groove(drums, skank, fill),
    },
    verse2: {
      bars: 8,
      lead: riff(verse2, { vel: 0.82 }),
      rhythm: chug(C.verse, { pattern: "xxxxxxxx", low: 40, vel: 0.62 }),
      bass: bass(C.verse, { pattern: "RRRRRRRR", low: 28, vel: 0.8 }),
      drums: groove(drums, skank, fill),
    },
    chorus: {
      bars: 8,
      lead: riff(chorus, { vel: 0.86 }),
      rhythm: chug(C.chorus, { pattern: "XxxxXxxx", low: 40, vel: 0.62 }),
      bass: bass(C.chorus, { pattern: "RRRRRRRR", low: 28, vel: 0.85 }),
      drums: groove(drums, drive, fill),
    },
    bridge: {
      bars: 8,
      lead: riff(bridge),
      rhythm: chug(C.bridge, { pattern: "pppppppp", low: 40, vel: 0.75 }),
      bass: bass(C.bridge, { pattern: "R-R-R-R-", low: 28, vel: 0.8 }),
      drums: groove(drums, halfTime, { s: "x.x.x.x.xxxxxxxx" }, 8, { vel: 0.8 }),
    },
    outro: {
      bars: 4,
      lead: riff(outro),
      rhythm: chug(C.outro, { pattern: "x-x-x-x-", low: 40, vel: 0.66 }),
      bass: bass(C.outro, { pattern: "RRRRRRRR", low: 28, vel: 0.85 }),
      drums: [[0, 49, 1, 0.9], ...drums(drive, { beats: 12, vel: 0.85 }), [12, 49, 4, 1], [12, 36, 1, 1], [12, 38, 1, 0.9]],
    },
  },
  order: ["intro", "verse", "verse2", "chorus", "verse", "chorus", "bridge", "chorus", "chorus", "outro"],
})

export default {
  ...song,
  genre: "Punk",
  year: 1996,
  palette: { a: 0x39ff6a, b: 0xff2d55, sky: 0x0b140d },
}
