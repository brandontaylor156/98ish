import { build, prog, loop, pad, bass, arp, drums, shift, riff, chug, groove } from "./kit.js"

// A slow power ballad in D: picked arpeggios and strings under a guitar that sings like a
// voice, long notes to hold, then the band comes in for the chorus and a soaring solo.

const intro = `d5/2 c#5/1 a4 | b4/3 a4/.5 f#4 | g4/2 a4/1 b4 | a4/4`

const verse = `f#4/1.5 e4/.5 d4/1 e4 | e4/1.5 c#4/.5 a3/2 | d4/1 f#4 b4/1.5 a4/.5 | g4/3 r/1 |
  f#4/1.5 e4/.5 d4/1 a4 | c#5/1.5 b4/.5 a4/2 | b4/1 d5 f#5/1.5 e5/.5 | d5/2 e5/1 r`

const chorus = `d5/1 e5 f#5/1.5 g5/.5 | f#5/2 e5/1 d5 | e5/1.5 a4/.5 c#5/1 e5 | d5/3 b4/1 |
  g4/.5 b4 d5/1 g5/1.5 f#5/.5 | f#5/1 d5 a4/2 | a4/.5 c#5 e5/1 a5/1.5 g5/.5 | a4+e5/4`

const solo = `f#5/1.5 e5/.5 d5 c#5 b4/1 | d5/.5 e5 g5/1 b5/2 | a5/.5 f#5 d5 a4 d5/1 f#5 |
  e5/.25 f#5 e5 c#5 a4/1 e5/2 | f#5/.25 g5 f#5 e5 d5/.5 b4 f#5/2 | g5/1 b5 d6/2 |
  c#6/.5 b5 a5 f#5 d5/1 a5 | a4+e5/4`

const outro = `d5/2 c#5/1 a4 | b4/3 a4/1 | g4/2 f#4/1 e4 | d4+a4/4`

const half = { k: "x.......x.......", s: "........x.......", h: "x.x.x.x.x.x.x.x." }
const full = { k: "x.......x.x.....", s: "....x.......x...", y: "x.x.x.x.x.x.x.x." }
const fill = { k: "x.......", s: "....x.x.", t: "........xx......", l: "..........xx.xx." }

const C = {
  verse: loop(prog("D A/C# Bm G"), 2),
  chorus: prog("G D A Bm G D A A"),
  solo: loop(prog("Bm G D A"), 2),
  outro: prog("D A/C# Bm G"),
}
const picked = (chords, vel = 0.4) => arp(chords, { pattern: "01231213", step: 0.5, center: 62, vel, length: 1.8 })

const song = build({
  id: "lastlight",
  title: "Last Light",
  artist: "Velvet Avalanche",
  description: "A slow power ballad in D",
  bpm: 74,
  humanize: false,
  tracks: {
    lead: { instrument: "shredLead", gain: 0.8, pan: 0.08, reverb: 0.38, delay: 0.28 },
    rhythm: { instrument: "shredRhythm", gain: 0.5, pan: -0.3, reverb: 0.25 },
    picked: { instrument: "pluck", gain: 0.72, pan: -0.25, reverb: 0.35, delay: 0.15 },
    strings: { instrument: "strings", gain: 0.5, pan: 0.3, reverb: 0.5 },
    bass: { instrument: "fingerBass", gain: 0.75, reverb: 0.06 },
    drums: { instrument: "drums", gain: 0.66, reverb: 0.3 },
  },
  sections: {
    intro: {
      bars: 4,
      lead: riff(intro, { vel: 0.72 }),
      picked: picked(C.outro, 0.45),
      strings: pad(C.outro, { center: 60, vel: 0.32 }),
    },
    verse: {
      bars: 8,
      lead: riff(verse, { vel: 0.72 }),
      picked: picked(C.verse),
      strings: shift(pad(prog("D A/C# Bm G"), { center: 60, vel: 0.3 }), 16),
      bass: bass(C.verse, { pattern: "R-------", step: 0.5, low: 38, vel: 0.62 }),
      drums: [...drums({ r: "........x.......", h: "x...x...x...x..." }, { beats: 28, vel: 0.5 }), ...shift(drums(fill, { beats: 4, vel: 0.65 }), 28)],
    },
    chorus: {
      bars: 8,
      lead: riff(chorus, { vel: 0.85 }),
      rhythm: chug(C.chorus, { pattern: "x-------", low: 43, vel: 0.62 }),
      picked: picked(C.chorus, 0.3),
      strings: pad(C.chorus, { center: 64, vel: 0.42 }),
      bass: bass(C.chorus, { pattern: "R---R-5-", low: 31, vel: 0.75 }),
      drums: groove(drums, half, fill, 8, { vel: 0.78 }),
    },
    solo: {
      bars: 8,
      lead: riff(solo, { vel: 0.88 }),
      rhythm: chug(C.solo, { pattern: "x---x-x-", low: 43, vel: 0.6 }),
      strings: pad(C.solo, { center: 62, vel: 0.4 }),
      bass: bass(C.solo, { pattern: "R--R--5-", low: 31, vel: 0.78 }),
      drums: groove(drums, full, fill, 8, { vel: 0.78 }),
    },
    outro: {
      bars: 4,
      lead: riff(outro, { vel: 0.72 }),
      picked: picked(C.outro, 0.38),
      strings: pad(C.outro, { center: 60, vel: 0.36 }),
      bass: bass(C.outro, { pattern: "R-------", low: 38, vel: 0.6 }),
      drums: [[0, 49, 2, 0.6], ...drums({ r: "........x.......", h: "x...x...x...x..." }, { beats: 12, vel: 0.45 }), [12, 49, 4, 0.7], [12, 36, 1, 0.7]],
    },
  },
  order: ["intro", "verse", "chorus", "solo", "chorus", "outro"],
})

export default {
  ...song,
  genre: "Power Ballad",
  year: 1989,
  palette: { a: 0xff4f9a, b: 0xb98bff, sky: 0x1a0c22 },
}
