import { build, prog, pad, bass, arp, mel, drums, shift, soften } from "../compose"

// Floating through a nebula: slow-swelling pads in D lydian, bells drifting across the
// stereo field, a music-box arpeggio echoing into the distance.

const aChords = prog("Dmaj9:8 E/D:8 Bm7:8 Gmaj7#11:8")
const bChords = prog("Gmaj7#11:8 F#m7:8 Em9:8 Asus4:4 A:4")
const introChords = prog("Dmaj9:8 E/D:8")
const outroChords = prog("Gmaj7#11:8 Dmaj9:16")

const bellsA = `a5/2 f#5/1 e5/1 | c#6/4 | b5/2 g#5/2 | e5/4 | f#5/2 d5/2 | a5/4 | b5/2 c#6/2 | f#5/4`
const bellsB = `b5/2 a5/2 f#5/4 | a5/2 c#6/2 e6/4 | g5/2 f#5/2 b5/4 | d6/4 c#6/4`
const fluteA = `d5/2 e5/2 f#5/4 | e5/2 g#5/2 b5/4 | a5/2 f#5/2 d5/4 | c#5/2 d5/2 f#5/4`

const drone = (chords, vel = 0.5) => bass(chords, { pattern: "R-------", step: 1, low: 38, vel, length: 1 })
const music = (chords, vel = 0.28) => arp(chords, { pattern: "01234321", step: 0.5, center: 74, vel, length: 1.5 })

export default build({
  id: "ambient",
  file: "NEBULA.MID",
  title: "Nebula Drift",
  description: "Slow ambient pads and drifting bells",
  bpm: 64,
  tracks: {
    pad: { instrument: "warmPad", gain: 0.9, pan: -0.15, reverb: 0.6 },
    drone: { instrument: "warmPad", gain: 0.6, pan: 0.1, reverb: 0.5 },
    strings: { instrument: "strings", gain: 0.5, pan: 0.3, reverb: 0.6 },
    bells: { instrument: "bells", gain: 0.65, pan: 0.4, reverb: 0.6, delay: 0.4 },
    box: { instrument: "musicBox", gain: 0.6, pan: -0.4, reverb: 0.5, delay: 0.5 },
    flute: { instrument: "flute", gain: 0.7, pan: 0.05, reverb: 0.55, delay: 0.25 },
    shaker: { instrument: "drums", gain: 0.8, pan: 0.2, reverb: 0.3 },
  },
  sections: {
    intro: {
      bars: 4,
      pad: pad(introChords, { center: 62, vel: 0.5 }),
      drone: drone(introChords, 0.45),
      bells: shift(mel("a5/4 | e5/4", { vel: 0.35 }), 8),
    },
    a: {
      bars: 8,
      pad: pad(aChords, { center: 62, vel: 0.55 }),
      drone: drone(aChords),
      bells: mel(bellsA, { vel: 0.5 }),
    },
    b: {
      bars: 8,
      pad: pad(bChords, { center: 60, vel: 0.55 }),
      drone: drone(bChords),
      strings: pad(bChords, { center: 72, vel: 0.35 }),
      bells: mel(bellsB, { vel: 0.5 }),
      box: soften(music(bChords), 0.8),
      shaker: drums({ w: "x.xgx.xgx.xgx.xg" }, { beats: 32, vel: 0.35 }),
    },
    a2: {
      bars: 8,
      pad: pad(aChords, { center: 62, vel: 0.55 }),
      drone: drone(aChords),
      flute: mel(fluteA, { vel: 0.6 }),
      bells: soften(mel(bellsA, { transpose: 12 }), 0.55),
      box: music(aChords),
      shaker: drums({ w: "x.xgx.xgx.xgx.xg" }, { beats: 32, vel: 0.32 }),
    },
    outro: {
      bars: 6,
      pad: pad(outroChords, { center: 62, vel: 0.5 }),
      drone: drone(outroChords, 0.45),
      strings: pad(outroChords, { center: 74, vel: 0.28 }),
      box: soften(music(prog("Gmaj7#11:8 Dmaj9:8")), 0.8),
      bells: mel("b5/2 c#6/2 f#6/4 | a5/4 e6/4 | d6/8", { vel: 0.4 }),
    },
  },
  order: ["intro", "a", "b", "a2", "outro"],
})
