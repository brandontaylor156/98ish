import { build, prog, loop, pad, bass, drums, shift, riff, chug, groove } from "./kit.js"

// The encore: arena rock in B minor with a rolling sixteenth-note riff, a fist-in-the-air
// chorus and a sixteen-bar solo of sweeps and runs.

const intro = `b3+f#4/2 b3+f#4 | g3+d4/2 g3+d4 | d4+a4/2 d4+a4 | a3+e4/1 a3+e4 a3+e4/.5 a3+e4 a3+e4 a3+e4`

const hook = `b3/.5 d4/.25 f#4 b4/.5 a4/.25 f#4 d4/.5 f#4 b3/1 | g3/.5 b3/.25 d4 g4/.5 f#4/.25 d4 b3/.5 d4 g3/1 |
  d4/.5 f#4/.25 a4 d5/.5 c#5/.25 a4 f#4/.5 a4 d4/1 | a3/.5 c#4/.25 e4 a4/1 e4/.5 c#4 e4/1`

const verse = `f#4/1 f#4/.5 e4 d4/1 b3 | d4/1 d4/.5 e4 g4/2 | f#4/1 a4 d5 c#5/.5 a4 | c#5/2 b4/1 a4 |
  f#4/1 f#4/.5 e4 d4/1 f#4 | b4/1 a4/.5 g4 b4/2 | a4/.5 b4 a4 f#4 d5/1 e5 | e5/2 c#5/1 a4`

const chorus = `d5/1 d5/.5 e5 f#5/1 g5 | e5/1 e5/.5 f#5 a5/2 | f#5/1.5 e5/.5 d5/1 b4 | b4/3 r/1 |
  d5/1 d5/.5 e5 f#5/1 b5 | a5/1 g5/.5 f#5 e5/2 | f#5/1 a5 d6/2 | c#6/1 a#5 f#5/2`

const sweep = `b4/.25 d5 f#5 b5 f#5 d5 b4 d5 f#5/1 b5 | g4/.25 b4 d5 g5 d5 b4 g4 b4 d5/1 g5 |
  a4/.25 d5 f#5 a5 f#5 d5 a4 d5 f#5/1 a5`

const solo = `${sweep} | e5/.5 c#5 a4 c#5 e5/1 a5 |
  b5/1 a5/.5 f#5 e5 d5 b4/1 | d5/.5 e5 g5/1 b5/1.5 a5/.5 | f#5/.5 e5 d5 e5 f#5 a5 d6/1 | c#6/2 a5/1 e5 |
  ${sweep} | a4/.25 c#5 e5 a5 c#6 a5 e5 c#5 a5/2 |
  b5/.25 a5 f#5 e5 d5 e5 f#5 a5 b5/2 | g5/.25 f#5 e5 d5 b4 d5 e5 g5 b5/2 |
  a5/.25 f#5 d5 f#5 a5 d6 c#6 a5 f#5/1 a5 | a4+e5/2 a4+e5/1 a4+e5`

const outro = `b3+f#4/1 b3+f#4 b3+f#4 b3+f#4 | g3+d4/2 a3+e4 | b3+f#4/4 | b3+f#4/4`

const rock = { k: "x.....x.x.x.....", s: "....x.......x...", h: "x.x.x.x.x.x.x.x." }
const big = { k: "x.x...x.x.x...x.", s: "....x.......x...", y: "x.x.x.x.x.x.x.x." }
const fill = { k: "x.......", s: "....x.xx", m: "........xx......", t: "..........xx.xx." }

const C = {
  intro: prog("Bm G D A"),
  hook: prog("Bm G D A"),
  verse: loop(prog("Bm G D A"), 2),
  chorus: prog("G A Bm Bm G A D F#"),
  solo: loop(prog("Bm G D A"), 4),
  outro: prog("Bm G:2 A:2 Bm Bm"),
}

const song = build({
  id: "voltage",
  title: "Voltage Cathedral",
  artist: "Stained Glass Thunder",
  description: "Arena rock in B minor",
  bpm: 140,
  humanize: false,
  tracks: {
    lead: { instrument: "shredLead", gain: 0.8, pan: 0.1, reverb: 0.26, delay: 0.16 },
    rhythm: { instrument: "shredRhythm", gain: 0.6, pan: -0.36, reverb: 0.12 },
    organ: { instrument: "organ", gain: 0.34, pan: 0.36, reverb: 0.35 },
    bass: { instrument: "fingerBass", gain: 0.8, reverb: 0.03 },
    drums: { instrument: "drums", gain: 0.72, reverb: 0.16 },
  },
  sections: {
    intro: {
      bars: 4,
      lead: riff(intro),
      rhythm: chug(C.intro, { pattern: "x---x---", low: 42, vel: 0.66 }),
      bass: bass(C.intro, { pattern: "R---R---", low: 30, vel: 0.75 }),
      drums: [...drums({ c: "x.......x.......", k: "x.......x......." }, { beats: 12, vel: 0.7 }), ...shift(drums(fill, { beats: 4, vel: 0.85 }), 12)],
    },
    hook: {
      bars: 4,
      lead: riff(hook),
      rhythm: chug(C.hook, { pattern: "x-pxx-px", low: 42, vel: 0.62 }),
      bass: bass(C.hook, { pattern: "R.RR5.R.", low: 30, vel: 0.8 }),
      drums: groove(drums, rock, fill, 4),
    },
    verse: {
      bars: 8,
      lead: riff(verse, { vel: 0.8 }),
      rhythm: chug(C.verse, { pattern: "pppppppp", low: 42, vel: 0.72 }),
      bass: bass(C.verse, { pattern: "RRRRRRRR", low: 30, vel: 0.8 }),
      drums: groove(drums, rock, fill),
    },
    chorus: {
      bars: 8,
      lead: riff(chorus, { vel: 0.86 }),
      rhythm: chug(C.chorus, { pattern: "x-x-x-xx", low: 40, vel: 0.64 }),
      organ: pad(C.chorus, { center: 64, vel: 0.48 }),
      bass: bass(C.chorus, { pattern: "RRRRRRR8", low: 30, vel: 0.84 }),
      drums: groove(drums, big, fill),
    },
    solo: {
      bars: 16,
      lead: riff(solo, { vel: 0.88 }),
      rhythm: chug(C.solo, { pattern: "x-pxx-px", low: 42, vel: 0.6 }),
      organ: pad(C.solo, { center: 62, vel: 0.38 }),
      bass: bass(C.solo, { pattern: "R.RR5.R8", low: 30, vel: 0.8 }),
      drums: [...groove(drums, big, fill), ...shift(groove(drums, big, fill), 32)],
    },
    outro: {
      bars: 4,
      lead: riff(outro),
      rhythm: chug(C.outro, { pattern: "x-x-x-x-", low: 42, vel: 0.66 }),
      organ: pad(C.outro, { center: 62, vel: 0.45 }),
      bass: bass(C.outro, { pattern: "RRRRRRRR", low: 30, vel: 0.84 }),
      drums: [[0, 49, 1, 0.9], ...drums(big, { beats: 8, vel: 0.85 }), [8, 49, 4, 1], [8, 36, 1, 1], [8, 38, 1, 0.9]],
    },
  },
  order: ["intro", "hook", "verse", "chorus", "hook", "verse", "chorus", "solo", "chorus", "outro"],
})

export default {
  ...song,
  genre: "Arena Rock",
  year: 1991,
  palette: { a: 0x2a8cff, b: 0xe8f0ff, sky: 0x050a1c },
}
