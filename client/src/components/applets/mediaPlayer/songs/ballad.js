import { build, prog, pad, bass, arp, mel, shift, soften } from "../compose"

// A mellow piano ballad for a rainy afternoon: a falling bass line, a simple song of a
// melody, strings that join on the second verse.

const introChords = prog("Fmaj7 G Em7 Am7")
const verseChords = prog("C G/B Am Em/G F C/E Dm7 G")
const chorusChords = prog("F G Em7 Am7 Dm7 G7sus4:2 G:2 C C")
const bridgeChords = prog("Am Em F C Dm Am F G")
const outroChords = prog("Fmaj7 G Csus2 C")

const verse = `e5/1.5 d5/.5 c5/1 g4/1 | d5/1.5 c5/.5 b4/2 | c5/1 e5/1 a5/1 g5/1 | g5/1.5 f5/.5 e5/2 |
  a4/1 c5/1 f5/1.5 e5/.5 | g5/2 e5/1 c5/1 | f5/1.5 e5/.5 d5/1 c5/1 | d5/3 r/1`

const chorus = `c6/1.5 a5/.5 f5/1 a5/1 | b5/1.5 g5/.5 d5/1 g5/1 | g5/1.5 e5/.5 b4/1 d5/1 | c5/1 e5/1 g5/2 |
  a5/1.5 g5/.5 f5/1 a5/1 | g5/1 c6/1 b5/1 d6/1 | e5/1 g5/1 c6/2 | c6/2 r/2`

const bridge = `e5/1 a5/1 c6/1.5 b5/.5 | b5/2 g5/1 e5/1 | f5/1 a5/1 c6/1.5 a5/.5 | g5/2 e5/2 |
  f5/1 a5/1 d6/1.5 c6/.5 | c6/2 a5/1 e5/1 | f5/1 a5/1 c6/1 a5/1 | d6/2 b5/1 g5/1`

// left hand: the bass note on the downbeat, a broken chord above it
const leftHand = (chords, vel = 0.42) => [
  ...bass(chords, { pattern: "R-------", step: 0.5, low: 36, vel: vel + 0.08, length: 1 }),
  ...arp(chords, { pattern: ".1232123", step: 0.5, center: 58, vel, length: 1.8 }),
]

export default build({
  id: "ballad",
  file: "RAINDAY.MID",
  title: "Rainy Window",
  description: "A mellow piano ballad",
  bpm: 72,
  tracks: {
    melody: { instrument: "piano", gain: 0.85, pan: 0.1, reverb: 0.4 },
    piano: { instrument: "piano", gain: 0.7, pan: -0.1, reverb: 0.4 },
    strings: { instrument: "strings", gain: 0.55, pan: -0.25, reverb: 0.55 },
    cello: { instrument: "strings", gain: 0.6, pan: 0.25, reverb: 0.5 },
    bass: { instrument: "fingerBass", gain: 0.45, reverb: 0.15 },
    bells: { instrument: "musicBox", gain: 0.3, pan: 0.4, reverb: 0.55 },
  },
  sections: {
    intro: {
      bars: 4,
      piano: leftHand(introChords, 0.38),
      melody: mel("c6/2 a5/2 | b5/2 d5/2 | g5/2 e5/2 | e5/4", { vel: 0.5 }),
    },
    verse: {
      bars: 8,
      melody: mel(verse, { vel: 0.66 }),
      piano: leftHand(verseChords),
    },
    chorus: {
      bars: 8,
      melody: mel(chorus, { vel: 0.72 }),
      piano: leftHand(chorusChords, 0.45),
      strings: pad(chorusChords, { center: 64, vel: 0.35 }),
      bass: bass(chorusChords, { pattern: "R-----5-", step: 0.5, low: 36, vel: 0.55 }),
    },
    bridge: {
      bars: 8,
      melody: mel(bridge, { vel: 0.7 }),
      piano: leftHand(bridgeChords, 0.44),
      strings: pad(bridgeChords, { center: 60, vel: 0.4 }),
      cello: soften(mel(bridge, { transpose: -24 }), 0.5),
      bass: bass(bridgeChords, { pattern: "R-------", step: 0.5, low: 36, vel: 0.5 }),
      bells: arp(bridgeChords, { pattern: "2...1...", step: 0.5, center: 84, vel: 0.3 }),
    },
    verse2: {
      bars: 8,
      melody: mel(verse, { vel: 0.66 }),
      piano: leftHand(verseChords, 0.4),
      strings: pad(verseChords, { center: 62, vel: 0.3 }),
      cello: mel("c4/4 b3/4 a3/4 g3/4 f3/4 e3/4 d3/4 g3/4", { vel: 0.4 }),
    },
    chorus2: {
      bars: 8,
      melody: mel(chorus, { vel: 0.78 }),
      piano: leftHand(chorusChords, 0.48),
      strings: [...pad(chorusChords, { center: 64, vel: 0.42 }), ...soften(mel(chorus, { transpose: -12 }), 0.4)],
      bass: bass(chorusChords, { pattern: "R---5---", step: 0.5, low: 36, vel: 0.6 }),
      bells: shift(arp(prog("C C"), { pattern: "0.1.2.3.", step: 0.5, center: 84, vel: 0.3 }), 24),
    },
    outro: {
      bars: 4,
      melody: mel("a5/2 g5/2 | g5/1 f5/1 d5/2 | d5/2 c5/2 | c5/4", { vel: 0.55 }),
      piano: [...leftHand(prog("Fmaj7 G Csus2"), 0.36), [12, 36, 4, 0.45], [12, 55, 4, 0.35], [12, 60, 4, 0.35], [12, 64, 4, 0.35]],
      strings: pad(outroChords, { center: 60, vel: 0.32 }),
      bells: shift(mel("g6/1 e6/1 c6/2", { vel: 0.3 }), 12),
    },
  },
  order: ["intro", "verse", "chorus", "bridge", "verse2", "chorus2", "outro"],
})
