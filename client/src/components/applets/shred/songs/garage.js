import { build, prog, loop, pad, bass, drums, shift, riff, chug, groove } from "./kit.js"

// Classic garage rock in A: a bluesy hook you can hum, chord stabs answered by licks in the
// verse, a big singing chorus and a pentatonic solo. The first song in the set list.

const hook = `e4/.5 e4 g4 a4/1 g4/.5 e4 d4 | e4/.5 e4 g4 a4 c5 a4 g4/1 |
  d4+a4/1.5 d4+a4/.5 r c4 d4/1 | e4+b4/2 r/.5 g4 f#4 e4`

const verse = `a3+e4/1 r/1 a3+e4/.5 a3+e4 r/1 | r/.5 c5 a4 c5 d5/1 c5/.5 a4 |
  d4+a4/1 r/1 d4+a4/.5 d4+a4 r/1 | r/.5 e5 d5 c5 a4/1.5 r/.5 |
  a3+e4/1 r/1 a3+e4/.5 a3+e4 r/1 | r/.5 c5 a4 c5 d5 e5 d5 c5 |
  e4+b4/1.5 e4+b4/.5 r/1 e4+b4/1 | d4+a4/2 c5/.5 b4 a4/1`

const chorus = `f#4/1 a4 d5/1.5 c#5/.5 | c#5/1 a4 e4/2 | e4/.5 f#4 g#4/1 b4 e5 | c#5/3 r/1 |
  f#4/1 a4 d5/1.5 e5/.5 | f#5/1 e5 c#5 a4 | b4/.5 c#5 b4 a4 g#4/1 e4 | e4+b4/1 e4+b4 e4+b4 r`

const solo = `a4/.5 c5 d5 e5 g5 e5 d5 c5 | d5/1 c5/.5 a4 g4/1 a4 |
  e5/.25 g5 e5 d5 c5 d5 c5 a4 c5/1 a4 | a4/3 r/1 |
  a5/.5 g5 e5 d5 e5 d5 c5 a4 | c5/.5 d5 e5/1 g5 e5 |
  a5/.25 g5 e5 g5 a5 g5 e5 d5 e5/.5 d5 c5 a4 | e4+b4/1.5 e4+b4/.5 e4+b4/2`

const outro = `e4/.5 e4 g4 a4/1 g4/.5 e4 d4 | e4/.5 e4 g4 a4 c5 a4 g4/1 | d4+a4/2 e4+b4 | a3+e4/4`

const rock = { k: "x.......x.x.....", s: "....x.......x...", h: "x.x.x.x.x.x.x.x." }
const big = { k: "x.....x.x.x.....", s: "....x.......x...", y: "x.x.x.x.x.x.x.x." }
const fill = { k: "x.......", s: "....x.x.", m: "........xx......", t: "..........xx.xx." }

const C = {
  intro: prog("A A D E"),
  verse: prog("A A D A A A E D"),
  chorus: prog("D A E A D A E E"),
  solo: prog("A G D A A G D E"),
  outro: prog("A A D:2 E:2 A"),
}

const song = build({
  id: "garage",
  title: "Garage Days",
  artist: "The Loose Fuses",
  description: "Classic rock in A",
  bpm: 126,
  humanize: false,
  tracks: {
    lead: { instrument: "shredLead", gain: 0.82, pan: 0.12, reverb: 0.22, delay: 0.12 },
    rhythm: { instrument: "shredRhythm", gain: 0.6, pan: -0.32, reverb: 0.14 },
    organ: { instrument: "organ", gain: 0.72, pan: 0.36, reverb: 0.3 },
    bass: { instrument: "fingerBass", gain: 0.78, reverb: 0.04 },
    drums: { instrument: "drums", gain: 0.7, reverb: 0.14 },
  },
  sections: {
    intro: {
      bars: 4,
      rhythm: chug(C.intro, { pattern: "x-------", low: 45, vel: 0.7 }),
      bass: bass(C.intro, { pattern: "R-------", low: 33, vel: 0.7 }),
      drums: [...drums({ h: "x.x.x.x.x.x.x.x.", k: "x.......x......." }, { beats: 12, vel: 0.6 }), ...shift(drums(fill, { beats: 4, vel: 0.8 }), 12)],
    },
    riff: {
      bars: 4,
      lead: riff(hook),
      rhythm: chug(C.intro, { pattern: "x-px-px-", low: 45, vel: 0.62 }),
      bass: bass(C.intro, { pattern: "R.RR5.R.", low: 33, vel: 0.8 }),
      drums: groove(drums, rock, fill, 4),
    },
    verse: {
      bars: 8,
      lead: riff(verse),
      rhythm: chug(C.verse, { pattern: "pppppppp", low: 45, vel: 0.7 }),
      bass: bass(C.verse, { pattern: "R.RRR.R5", low: 33, vel: 0.78 }),
      drums: groove(drums, rock, fill),
    },
    chorus: {
      bars: 8,
      lead: riff(chorus, { vel: 0.85 }),
      rhythm: chug(C.chorus, { pattern: "x-x-x-xx", low: 40, vel: 0.66 }),
      organ: pad(C.chorus, { center: 62, vel: 0.5 }),
      bass: bass(C.chorus, { pattern: "RRRRRRRR", low: 33, vel: 0.8 }),
      drums: groove(drums, big, fill),
    },
    solo: {
      bars: 8,
      lead: riff(solo, { vel: 0.85 }),
      rhythm: chug(C.solo, { pattern: "x-px-px-", low: 43, vel: 0.62 }),
      organ: pad(C.solo, { center: 60, vel: 0.4 }),
      bass: bass(C.solo, { pattern: "R.RR5.R8", low: 31, vel: 0.8 }),
      drums: groove(drums, big, fill),
    },
    outro: {
      bars: 4,
      lead: riff(outro),
      rhythm: chug(C.outro, { pattern: "x-px-px-", low: 45, vel: 0.64 }),
      organ: pad(C.outro, { center: 62, vel: 0.45 }),
      bass: bass(C.outro, { pattern: "R.RR5.R.", low: 33, vel: 0.8 }),
      drums: [[0, 49, 1, 0.85], ...drums(rock, { beats: 12, vel: 0.8 }), [12, 49, 4, 0.95], [12, 36, 1, 0.95], [12, 38, 1, 0.8]],
    },
  },
  order: ["intro", "riff", "verse", "chorus", "riff", "verse", "chorus", "solo", "chorus", "outro"],
})

export default {
  ...song,
  genre: "Classic Rock",
  year: 1994,
  palette: { a: 0xff7a1a, b: 0xffc23a, sky: 0x2a1408 },
}
