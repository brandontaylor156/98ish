// The sounds a Visual Basic 98 program can play (Sound.Play "tada"), synthesized on 98ish's
// shared audio bus (utils/gameSynth.js): they follow the taskbar volume and mute and the
// "Play system sounds" setting. The program never touches audio itself.
import { createSynth } from "../../../utils/gameSynth"

let synth = null
const kit = {
  ding: ({ tone }) => tone(880, { len: 0.35, type: "sine", vol: 0.3 }),
  chord: ({ tone }) => [523, 659, 784].forEach((f) => tone(f, { len: 0.5, type: "triangle", vol: 0.16 })),
  tada: ({ tone }) => [392, 523, 659, 784].forEach((f, i) => tone(f, { at: i * 0.08, len: 0.5, type: "triangle", vol: 0.18 })),
  click: ({ noise }) => noise({ len: 0.04, vol: 0.3, freq: 3000, type: "highpass" }),
  pop: ({ tone }) => tone(600, { len: 0.08, to: 1400, type: "sine", vol: 0.3 }),
  boing: ({ tone }) => tone(180, { len: 0.35, to: 520, type: "triangle", vol: 0.28 }),
  win: ({ tone }) => [523, 659, 784, 1047].forEach((f, i) => tone(f, { at: i * 0.1, len: 0.18, type: "square", vol: 0.1 })),
  lose: ({ tone }) => [392, 330, 262].forEach((f, i) => tone(f, { at: i * 0.16, len: 0.22, type: "square", vol: 0.1 })),
  chimes: ({ tone }) => [1047, 1319, 1568].forEach((f, i) => tone(f, { at: i * 0.12, len: 0.6, type: "sine", vol: 0.14 })),
  notify: ({ tone }) => [988, 1319].forEach((f, i) => tone(f, { at: i * 0.1, len: 0.15, type: "sine", vol: 0.2 })),
}

export const playVbSound = (name) => {
  const make = kit[name] || kit.ding
  synth ??= createSynth({ gain: 0.6 })
  synth.play(make)
}
