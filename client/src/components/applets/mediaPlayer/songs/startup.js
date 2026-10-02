import { build, prog, pad, comp, bass, arp, mel, drums, shift, soften } from "../compose"

// A bright brass fanfare: a call, a march theme, a lyrical string strain, then the theme
// again a step higher and a big finish.

const introChords = prog("C G F:2 C:2 G")
const themeChords = prog("C Em F C Am Dm7 G7sus4:2 G7:2 C")
const stringChords = prog("Am Am/G F G Am Em F G:2 A7:2")
const repriseChords = prog("D F#m G D Bm Em7 A7sus4:2 A7:2 D")
const endChords = prog("G:2 A:2 D D")

const theme = `e5/1 g5/1 c6/1.5 b5/.5 | b5/1 g5/1 e5/2 | a5/1 c6/1 f5/1.5 a5/.5 | g5/3 r/1 |
  a5/.5 b5/.5 c6/1 e5/1 a5/1 | f5/1 a5/1 d5/1 c5/1 | c5/1 d5/1 b4/1 d5/1 | c5/4`

const strain = `e5/1.5 d5/.5 c5/1 b4/1 | c5/1 e5/1 a5/2 | a5/1.5 g5/.5 f5/1 e5/1 | d5/3 r/1 |
  c5/1 e5/1 a5/1 c6/1 | b5/2 g5/1 e5/1 | a5/1 c6/1 f6/1.5 e6/.5 | d6/2 c#6/1 e6/1`

const march = { k: "x.......x.......", s: "....x..x....x.xx" }
const marchBig = { k: "x.......x.......", s: "x...x..x..x.x.xx", h: "x.x.x.x.x.x.x.x." }

// a timpani roll that swells into the downbeat
const roll = (from, beats, pitch, v0 = 0.3, v1 = 0.85) =>
  Array.from({ length: beats * 4 }, (_, i) => [from + i * 0.25, pitch, 0.3, v0 + ((v1 - v0) * i) / (beats * 4)])

export default build({
  id: "startup",
  file: "STARTUP.MID",
  title: "Power On!",
  description: "A bright brass fanfare for switching on",
  bpm: 104,
  tracks: {
    brass: { instrument: "brass", gain: 0.85, pan: 0.1, reverb: 0.3 },
    horns: { instrument: "brass", gain: 0.5, pan: -0.25, reverb: 0.35 },
    strings: { instrument: "strings", gain: 0.6, pan: -0.1, reverb: 0.45 },
    bass: { instrument: "fingerBass", gain: 0.45, reverb: 0.05 },
    timpani: { instrument: "timpani", gain: 0.7, pan: 0.2, reverb: 0.3 },
    bells: { instrument: "bells", gain: 0.35, pan: 0.35, reverb: 0.5 },
    drums: { instrument: "drums", gain: 0.55, reverb: 0.2 },
  },
  sections: {
    intro: {
      bars: 4,
      brass: mel("r/1 g4/.5 g4/.5 c5/1 e5/1 | d5/.75 c5/.25 d5/1 g5/2 | f5/1 e5/.5 d5/.5 e5/1 c5/1 | d5/4", { vel: 0.85 }),
      horns: comp(introChords, { rhythm: "X-.xX-..", step: 0.5, center: 58, vel: 0.6, length: 0.85 }),
      strings: pad(introChords, { center: 55, vel: 0.45 }),
      timpani: [...roll(0, 1, 36, 0.2, 0.7), [4, 43, 1, 0.8], [8, 41, 1, 0.75], [12, 43, 0.5, 0.6], ...roll(13, 3, 43, 0.25, 0.9)],
      drums: drums({ c: "x..............." }, { beats: 4 }),
    },
    theme: {
      bars: 8,
      brass: mel(theme, { vel: 0.8 }),
      horns: comp(themeChords, { rhythm: "X-.xX-..", step: 0.5, center: 57, vel: 0.5, length: 0.8 }),
      strings: pad(themeChords, { center: 62, vel: 0.35 }),
      bass: bass(themeChords, { pattern: "R.5.R.5.", step: 0.5, low: 36, vel: 0.7 }),
      timpani: [[0, 36, 1, 0.8], [16, 36, 1, 0.7], [28, 43, 0.5, 0.6], [30, 43, 0.5, 0.7], [31, 43, 0.5, 0.8]],
      drums: [...drums({ c: "x..............." }, { beats: 4 }), ...drums(march, { beats: 32, vel: 0.7 })],
    },
    strain: {
      bars: 8,
      strings: [...mel(strain, { vel: 0.75 }), ...pad(stringChords, { center: 57, vel: 0.35 })],
      horns: soften(pad(stringChords, { center: 64, vel: 0.4 }), 0.8),
      bells: arp(stringChords, { pattern: "0.1.2.1.", step: 0.5, center: 76, vel: 0.35 }),
      bass: bass(stringChords, { pattern: "R---5---", step: 0.5, low: 33, vel: 0.65 }),
      timpani: roll(28, 4, 45, 0.2, 0.85),
      drums: shift(drums({ s: "xxxxXxxxXxxxXXXX" }, { beats: 4, vel: 0.6 }), 28),
    },
    reprise: {
      bars: 8,
      brass: mel(theme, { vel: 0.9, transpose: 2 }),
      horns: comp(repriseChords, { rhythm: "X-.xX-..", step: 0.5, center: 60, vel: 0.6, length: 0.8 }),
      strings: [...pad(repriseChords, { center: 64, vel: 0.4 }), ...soften(mel(theme, { transpose: -10 }), 0.45)],
      bells: arp(repriseChords, { pattern: "0123", step: 0.5, center: 79, vel: 0.3 }),
      bass: bass(repriseChords, { pattern: "R.5.R.58", step: 0.5, low: 38, vel: 0.75 }),
      timpani: [[0, 38, 1, 0.9], [8, 45, 1, 0.7], [16, 38, 1, 0.8], [24, 45, 1, 0.7], ...roll(28, 4, 45, 0.3, 0.9)],
      drums: [...drums({ c: "x..............." }, { beats: 4 }), ...drums(marchBig, { beats: 32, vel: 0.75 })],
    },
    ending: {
      bars: 3,
      brass: mel("b5/2 c#6/2 | d6/8!", { vel: 0.9 }),
      horns: [...comp(prog("G:2 A:2"), { rhythm: "X---", step: 0.5, center: 62, vel: 0.65 }), ...shift(pad(prog("D:8"), { center: 62, vel: 0.65 }), 4)],
      strings: pad(endChords, { center: 60, vel: 0.5 }),
      bells: shift(mel("d6/.5 f#6/.5 a6/.5 d7/2.5", { vel: 0.45 }), 4),
      bass: [[0, 43, 2, 0.75], [2, 45, 2, 0.75], [4, 38, 8, 0.85]],
      timpani: [...roll(0, 4, 45, 0.3, 0.9), [4, 38, 3, 1], ...roll(8, 3, 38, 0.2, 0.7), [11, 38, 1, 0.9]],
      drums: [...drums({ c: "x..............." }, { beats: 4 }), [4, 49, 2, 1], [4, 36, 1, 1], [11, 49, 2, 0.9], [11, 36, 1, 0.9]],
    },
  },
  order: ["intro", "theme", "strain", "reprise", "ending"],
})
