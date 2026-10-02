import { build, prog, loop, pad, bass, arp, mel, drums, shift, soften } from "../compose"

// Synth-pop for a dance floor lit in pink and teal: four on the floor, octave bass, a
// glassy arpeggio echoing off the walls and a hook you'll hum on the bus home.

const verseChords = loop(prog("Am F C G"), 2)
const preChords = prog("Dm Em F G")
const chorusChords = prog("F G Em Am F G Am Am")
const breakChords = prog("F G Am Am")

const verse = `e5/.5 e5/.5 r/.5 e5/.5 d5/.5 c5/.5 d5/1 | c5/1.5 a4/.5 a4/2 | r/.5 e5/.5 g5/.5 e5/.5 d5/.5 c5/.5 d5/1 | d5/2 b4/1 g4/1 |
  e5/.5 e5/.5 r/.5 e5/.5 g5/.5 e5/.5 d5/1 | c5/1.5 d5/.5 c5/1 a4/1 | g4/.5 c5/.5 e5/.5 g5/.5 a5/1 g5/1 | g5/2 r/2`

const pre = `f5/1 e5/1 d5/1 a4/1 | g5/1 e5/1 b4/2 | a5/1 g5/1 f5/1 c5/1 | b4/1 d5/1 g5/1 b5/1`

const hook = `a5/.75 a5/.75 g5/.5 a5/1 c6/1 | b5/.75 g5/.75 d5/.5 g5/2 | g5/.75 e5/.75 b4/.5 e5/1 g5/1 | a5/2 r/1 e5/1 |
  a5/.75 a5/.75 g5/.5 a5/1 c6/1 | d6/.75 b5/.75 g5/.5 d6/1 b5/1 | c6/1.5 b5/.5 a5/1 e5/1 | a5/4`

const four = { k: "x...x...x...x...", p: "....x.......x...", h: "..x...x...x...x." }
const fourBig = { k: "x...x...x...x...", p: "....x.......x...", h: "g.x.g.x.g.x.g.x.", o: "..............x." }
const build16 = { k: "x...x...x...x...", s: "....x...x.x.xxxx" }

const octave = (chords, vel = 0.75) => bass(chords, { pattern: "R8R8R8R8", step: 0.5, low: 33, vel, length: 0.7 })
const sparkle = (chords, vel = 0.32) => arp(chords, { pattern: "0121 2321 0121 2343", step: 0.25, center: 72, vel, length: 0.8 })

export default build({
  id: "neonpop",
  file: "NEONPOP.MID",
  title: "Neon Nights",
  description: "Synth-pop with a hook and four on the floor",
  bpm: 122,
  tracks: {
    lead: { instrument: "sawLead", gain: 1, pan: 0, reverb: 0.3, delay: 0.3 },
    arp: { instrument: "pluck", gain: 0.7, pan: 0.35, reverb: 0.25, delay: 0.45 },
    pad: { instrument: "warmPad", gain: 0.55, pan: -0.3, reverb: 0.4 },
    stabs: { instrument: "chipSquare", gain: 0.45, pan: -0.15, reverb: 0.3, delay: 0.2 },
    bass: { instrument: "synthBass", gain: 0.72, reverb: 0 },
    drums: { instrument: "drums", gain: 0.6, reverb: 0.12 },
  },
  sections: {
    intro: {
      bars: 8,
      arp: sparkle(loop(prog("Am F C G"), 2)),
      pad: shift(pad(prog("Am F C G"), { center: 60, vel: 0.5 }), 16),
      bass: shift(octave(prog("Am F C G"), 0.6), 16),
      drums: [
        ...drums({ k: "x...x...x...x..." }, { beats: 16, vel: 0.65 }),
        ...shift(drums(four, { beats: 12, vel: 0.75 }), 16),
        ...shift(drums(build16, { beats: 4, vel: 0.75 }), 28),
      ],
    },
    verse: {
      bars: 8,
      lead: mel(verse, { vel: 0.72 }),
      arp: sparkle(verseChords, 0.26),
      pad: pad(verseChords, { center: 60, vel: 0.4 }),
      bass: octave(verseChords),
      drums: [[0, 49, 1, 0.7], ...drums(four, { beats: 32, vel: 0.78 })],
    },
    pre: {
      bars: 4,
      lead: mel(pre, { vel: 0.75 }),
      stabs: arp(preChords, { pattern: "0.12.0.1", step: 0.5, center: 67, vel: 0.5, length: 0.5 }),
      pad: pad(preChords, { center: 62, vel: 0.45 }),
      bass: bass(preChords, { pattern: "RRRRRRRR", step: 0.5, low: 36, vel: 0.72, length: 0.6 }),
      drums: [...drums(four, { beats: 12, vel: 0.78 }), ...shift(drums(build16, { beats: 4, vel: 0.8 }), 12)],
    },
    chorus: {
      bars: 8,
      lead: mel(hook, { vel: 0.82 }),
      stabs: soften(mel(hook, { transpose: -12 }), 0.6),
      arp: sparkle(chorusChords),
      pad: pad(chorusChords, { center: 64, vel: 0.5 }),
      bass: octave(chorusChords, 0.8),
      drums: [[0, 49, 1, 0.85], ...drums(fourBig, { beats: 32, vel: 0.82 })],
    },
    chorus2: {
      bars: 8,
      lead: mel(hook, { vel: 0.86 }),
      stabs: soften(mel(hook, { transpose: 12 }), 0.45),
      arp: sparkle(chorusChords, 0.36),
      pad: pad(chorusChords, { center: 64, vel: 0.55 }),
      bass: octave(chorusChords, 0.82),
      drums: [[0, 49, 1, 0.9], ...drums(fourBig, { beats: 32, vel: 0.85 }), [16, 49, 1, 0.75]],
    },
    break: {
      bars: 4,
      pad: pad(breakChords, { center: 60, vel: 0.55 }),
      arp: sparkle(breakChords, 0.3),
      drums: [...drums({ p: "....x.......x..." }, { beats: 12, vel: 0.6 }), ...shift(drums(build16, { beats: 4, vel: 0.8 }), 12)],
    },
    outro: {
      bars: 4,
      arp: sparkle(breakChords, 0.28),
      pad: pad(prog("F G Am:8"), { center: 60, vel: 0.5 }),
      bass: [...octave(prog("F G"), 0.7), [8, 33, 6, 0.75]],
      lead: mel("c6/1.5 b5/.5 a5/1 e5/1 | d5/2 b4/2 | a4/8", { vel: 0.65 }),
      drums: [[0, 49, 1, 0.8], ...drums(four, { beats: 8, vel: 0.7 }), [8, 49, 3, 0.8], [8, 36, 1, 0.85]],
    },
  },
  order: ["intro", "verse", "pre", "chorus", "break", "verse", "pre", "chorus", "chorus2", "outro"],
})
