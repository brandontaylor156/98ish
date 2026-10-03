import { build, prog, loop, pad, bass, arp, drums, shift, riff, chug, groove } from "./kit.js"

// Synthwave in A minor: pulsing octave bass, a glassy arpeggio, big gated snares and a lead
// guitar that cruises over it all like a sports car under purple streetlights.

const intro = `r/16 | a4/2 c5/1 e5 | f5/3 e5/1 | e5/1 d5 c5 g4 | b4/4`

const verse = `e4/.75 a4/.75 c5/.5 b4/1 a4 | c5/.75 a4/.75 f4/.5 a4/2 | g4/.75 c5/.75 e5/.5 d5/1 c5 | b4/2 g4/1 d5 |
  e5/.75 c5/.75 a4/.5 e5/1 g5 | f5/1.5 e5/.5 c5/2 | e5/.5 d5 c5 g4 e5/1 g5 | g5/2 f5/1 d5`

const chorus = `a4/.5 c5 f5/1 e5 c5 | d5/1 g5 b5/1.5 a5/.5 | a5/3 e5/1 | c5/.5 d5 e5/1 a4/2 |
  a4/.5 c5 f5/1 a5 g5 | g5/1 f5/.5 e5 d5/2 | c5/.5 e5 g5/1 c6/2 | b5/1 g#5 e5/2`

const solo = `a5/.25 g5 e5 c5 e5/.5 a5 c6/2 | a5/.5 f5 c5 a4 f5/1 e5 |
  g5/.25 e5 c5 g4 c5 e5 g5 c6 e6/2 | d6/1 b5 g5/2 |
  a5/.5 e5 a5 c6 b5 a5 e5/1 | f5/.5 a5 c6/1 a5/.5 f5 c5/1 |
  e5/.25 f5 g5 a5 b5 c6 d6 e6 c6/1 g5 | g4+d5/4`

const outro = `a4/2 c5/1 e5 | f5/2 e5/1 c5 | d5/2 b4/1 g4 | a4+e5/4`

const gated = { k: "x.......x.......", s: "....x.......x...", h: "x.x.x.x.x.x.x.x." }
const drive = { k: "x...x...x...x...", s: "....x.......x...", h: "..x...x...x...x.", o: "..............x." }
const fill = { k: "x.......", s: "....x...", t: "........x.x.....", l: "............x.x." }

const C = {
  intro: loop(prog("Am F C G"), 2),
  verse: loop(prog("Am F C G"), 2),
  chorus: prog("F G Am Am F G C E"),
  solo: loop(prog("Am F C G"), 2),
  outro: prog("Am F G Am"),
}
const pulse = (chords, vel = 0.7) => bass(chords, { pattern: "R8R8R8R8", step: 0.5, low: 33, vel, length: 0.6 })
const glass = (chords, vel = 0.28) => arp(chords, { pattern: "0121 2321 0121 2343", step: 0.25, center: 72, vel, length: 0.7 })

const song = build({
  id: "neon",
  title: "Neon Overdrive",
  artist: "Midnight Arcade",
  description: "Synthwave in A minor",
  bpm: 108,
  humanize: false,
  tracks: {
    lead: { instrument: "shredLead", gain: 0.8, pan: 0.05, reverb: 0.32, delay: 0.3 },
    rhythm: { instrument: "shredRhythm", gain: 0.42, pan: -0.35, reverb: 0.2 },
    arp: { instrument: "pluck", gain: 1, pan: 0.35, reverb: 0.3, delay: 0.45 },
    pad: { instrument: "warmPad", gain: 0.5, pan: -0.2, reverb: 0.45 },
    bass: { instrument: "synthBass", gain: 0.72, reverb: 0 },
    drums: { instrument: "drums", gain: 0.66, reverb: 0.35 },
  },
  sections: {
    intro: {
      bars: 8,
      lead: riff(intro, { vel: 0.75 }),
      arp: glass(C.intro),
      pad: pad(C.intro, { center: 60, vel: 0.45 }),
      bass: shift(pulse(prog("Am F C G"), 0.6), 16),
      drums: [...shift(drums(gated, { beats: 12, vel: 0.7 }), 16), ...shift(drums(fill, { beats: 4, vel: 0.75 }), 28)],
    },
    verse: {
      bars: 8,
      lead: riff(verse, { vel: 0.78 }),
      arp: glass(C.verse, 0.22),
      pad: pad(C.verse, { center: 60, vel: 0.36 }),
      bass: pulse(C.verse),
      drums: groove(drums, gated, fill),
    },
    chorus: {
      bars: 8,
      lead: riff(chorus, { vel: 0.85 }),
      rhythm: chug(C.chorus, { pattern: "x-------", low: 41, vel: 0.6 }),
      arp: glass(C.chorus, 0.24),
      pad: pad(C.chorus, { center: 64, vel: 0.42 }),
      bass: pulse(C.chorus, 0.78),
      drums: groove(drums, drive, fill),
    },
    solo: {
      bars: 8,
      lead: riff(solo, { vel: 0.88 }),
      rhythm: chug(C.solo, { pattern: "x---x-x-", low: 41, vel: 0.55 }),
      arp: glass(C.solo, 0.22),
      pad: pad(C.solo, { center: 60, vel: 0.36 }),
      bass: pulse(C.solo, 0.78),
      drums: groove(drums, drive, fill),
    },
    outro: {
      bars: 4,
      lead: riff(outro, { vel: 0.78 }),
      arp: glass(C.outro, 0.24),
      pad: pad(C.outro, { center: 60, vel: 0.42 }),
      bass: pulse(C.outro, 0.7),
      drums: [[0, 49, 1, 0.8], ...drums(gated, { beats: 12, vel: 0.7 }), [12, 49, 4, 0.85], [12, 36, 1, 0.9]],
    },
  },
  order: ["intro", "verse", "chorus", "verse", "chorus", "solo", "chorus", "outro"],
})

export default {
  ...song,
  genre: "Synthwave",
  year: 1986,
  palette: { a: 0xff3df2, b: 0x29e6ff, sky: 0x12052a },
}
