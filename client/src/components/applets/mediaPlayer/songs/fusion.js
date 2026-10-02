import { build, prog, pad, comp, bass, arp, mel, drums, shift, soften } from "../compose"

// Laid-back jazz fusion in D: lush ninth chords on electric piano, a walking fretless-ish
// bass, brushed-feeling drums, a singing synth lead and a keyboard solo.

const aChords = prog("Gmaj9 F#m7 Em9 A13 Gmaj9 F#m7:2 B7#9:2 Em9 A13")
const bChords = prog("Bm9 Gmaj7 Em9 F#m7 Bm9 Gmaj7 Em9:2 F#m7:2 A13")
const introChords = prog("Gmaj9 F#m7 Em9 A13")
const outroChords = prog("Gmaj9 A13 Gmaj9:8 Dmaj9:8")

const themeA = `r/.5 f#5/.5 a5/.5 b5/1 a5/.5 f#5/1 | e5/1.5 c#5/.5 a4/2 | r/.5 g5/.5 f#5/.5 e5/.5 d5/1 b4/1 | c#5/2 r/1 e5/.5 f#5/.5 |
  a5/1.5 b5/.5 d6/1 b5/1 | a5/1 f#5/1 d6/1 a5/1 | g5/1.5 f#5/.5 e5/1 d5/1 | e5/3 r/1`

const themeB = `d5/1 c#5/.5 d5/.5 f#5/2 | b4/1 d5/1 f#5/1.5 e5/.5 | g5/1 f#5/1 e5/1 b4/1 | c#5/3 r/1 |
  d5/.5 e5/.5 f#5/1 a5/1 c#6/1 | b5/1.5 a5/.5 f#5/2 | g5/1 e5/1 a5/1 c#6/1 | e6/2 c#6/1 a5/1`

const solo = `b4/.5 d5/.5 e5/.5 f#5/.5 a5/.5 f#5/.5 e5/.5 d5/.5 | c#5/.5 e5/.5 a5/.5 c#6/.5 b5/1 a5/1 |
  g5/.5 f#5/.5 e5/.5 d5/.5 b4/.5 d5/.5 e5/1 | c#5/.5 e5/.5 f#5/.5 a5/.5 g5/1 e5/1 |
  d6/1.5 b5/.5 a5/.5 f#5/.5 a5/1 | a5/.5 f#5/.5 e5/.5 c#5/.5 d#5/.5 f#5/.5 a5/.5 d6/.5 |
  e6/1 d6/.5 b5/.5 g5/1 f#5/1 | e5/1 c#5/.5 e5/.5 a4/2`

const keys = (chords, vel = 0.5) => comp(chords, { rhythm: "X-.x--.x", step: 0.5, center: 62, vel, length: 0.85 })
const walk = (chords, vel = 0.72) => bass(chords, { pattern: "R-.R5-.n", step: 0.5, low: 38, vel })

const groove = { k: "x.....x...x.....", r: "....x.......x...", h: "x.x.x.x.x.x.x.x.", s: ".......g.....g.." }
const rideGroove = { k: "x.....x...x.....", s: "....x..g....x..g", y: "x.x.x.x.x.x.x.x.", h: "....x.......x..." }

export default build({
  id: "fusion",
  file: "FUSION.MID",
  title: "Rooftop Fusion",
  description: "Laid-back jazz fusion with a keyboard solo",
  bpm: 92,
  swing: { grid: 0.5, amount: 0.2 },
  tracks: {
    lead: { instrument: "sawLead", gain: 1, pan: 0.15, reverb: 0.35, delay: 0.3 },
    keys: { instrument: "epiano", gain: 0.65, pan: -0.2, reverb: 0.3 },
    solo: { instrument: "epiano", gain: 0.85, pan: 0.2, reverb: 0.3, delay: 0.15 },
    pad: { instrument: "strings", gain: 0.4, pan: -0.3, reverb: 0.5 },
    bells: { instrument: "bells", gain: 0.3, pan: 0.4, reverb: 0.5 },
    bass: { instrument: "fingerBass", gain: 0.75, reverb: 0.05 },
    drums: { instrument: "drums", gain: 0.5, reverb: 0.18 },
  },
  sections: {
    intro: {
      bars: 4,
      keys: keys(introChords, 0.45),
      bass: bass(introChords, { pattern: "R-------", step: 0.5, low: 38, vel: 0.6 }),
      drums: drums({ h: "x.x.x.x.x.x.x.x.", y: "x..............." }, { beats: 16, vel: 0.5 }),
    },
    a: {
      bars: 8,
      lead: mel(themeA, { vel: 0.72 }),
      keys: keys(aChords),
      bass: walk(aChords),
      drums: [[0, 49, 1, 0.6], ...drums(groove, { beats: 32, vel: 0.72 })],
    },
    a2: {
      bars: 8,
      lead: mel(themeA, { vel: 0.76 }),
      bells: soften(mel(themeA, { transpose: 12 }), 0.4),
      keys: keys(aChords),
      pad: pad(aChords, { center: 60, vel: 0.35 }),
      bass: walk(aChords),
      drums: drums(groove, { beats: 32, vel: 0.75 }),
    },
    b: {
      bars: 8,
      lead: mel(themeB, { vel: 0.78 }),
      keys: keys(bChords, 0.52),
      pad: pad(bChords, { center: 62, vel: 0.4 }),
      bass: walk(bChords),
      drums: [[0, 49, 1, 0.7], ...drums(rideGroove, { beats: 32, vel: 0.75 })],
    },
    solo: {
      bars: 8,
      solo: mel(solo, { vel: 0.68 }),
      keys: soften(keys(aChords), 0.8),
      pad: pad(aChords, { center: 57, vel: 0.35 }),
      bass: walk(aChords, 0.75),
      drums: [[0, 49, 1, 0.6], ...drums(rideGroove, { beats: 32, vel: 0.78 })],
    },
    outro: {
      bars: 6,
      lead: mel("a5/1.5 b5/.5 d6/1 b5/1 | e5/3 r/1 | f#5/8 | e5/1 f#5/1 a5/6", { vel: 0.7 }),
      keys: [...keys(prog("Gmaj9 A13")), ...shift(arp(prog("Gmaj9:8 Dmaj9:8"), { pattern: "0123", step: 0.5, center: 66, vel: 0.4, length: 3 }), 8)],
      pad: pad(outroChords, { center: 60, vel: 0.4 }),
      bells: shift(mel("a6/2 f#6/2 e6/4 | c#6/2 e6/2 f#6/4", { vel: 0.35 }), 8),
      bass: [...walk(prog("Gmaj9 A13")), [8, 43, 7.5, 0.65], [16, 38, 8, 0.7]],
      drums: [...drums(groove, { beats: 8, vel: 0.7 }), [8, 51, 2, 0.6], [16, 51, 4, 0.55], [16, 36, 1, 0.6]],
    },
  },
  order: ["intro", "a", "a2", "b", "solo", "a", "outro"],
})
