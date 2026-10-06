import { createBus, getAudioContext } from "../../../utils/audio"
import { readContent } from "../../../utils/fs"

// Music for slideshows and Memories: three original tunes played live with Web Audio (chords,
// a bass and a little melody on a loop; nothing recorded, nothing downloaded), or one of your
// own sounds from drive C:. All of it goes through the shared bus, so the taskbar volume and
// mute apply. playMusic(id, { file }) -> { stop() }.

export const TUNES = [
  { id: "none", label: "No music" },
  { id: "sunny", label: "Sunny Day" },
  { id: "dreamy", label: "Daydream" },
  { id: "upbeat", label: "Road Trip" },
  { id: "file", label: "My own sound..." },
]

const bus = createBus({ gain: 0.38, threshold: -14 })
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12)

// chords as MIDI notes, one per bar; melody as [beat, midi] per bar (null = rest)
const SONGS = {
  sunny: {
    bpm: 104,
    chords: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]],
    bass: [36, 31, 33, 29],
    melody: [[[0, 76], [1, 74], [2, 72], [3, 74]], [[0, 74], [1.5, 71], [3, 67]], [[0, 72], [1, 76], [2, 79], [3, 77]], [[0, 77], [1, 76], [2, 74], [3, 72]]],
    wave: "triangle",
    pluck: true,
  },
  dreamy: {
    bpm: 72,
    chords: [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 65]],
    bass: [33, 29, 36, 31],
    melody: [[[0, 76], [2, 79]], [[0, 77], [2, 72]], [[0, 71], [2, 74]], [[0, 74], [3, 71]]],
    wave: "sine",
    pluck: false,
  },
  upbeat: {
    bpm: 124,
    chords: [[62, 66, 69], [59, 62, 66], [55, 59, 62], [57, 61, 64]],
    bass: [38, 35, 31, 33],
    melody: [[[0, 74], [0.5, 76], [1, 78], [2, 81], [3, 78]], [[0, 78], [1, 76], [2, 74], [3, 71]], [[0, 71], [1, 74], [2, 79], [3, 78]], [[0, 76], [1, 73], [2, 69], [3.5, 73]]],
    wave: "square",
    pluck: true,
    drums: true,
  },
}

const note = (ctx, out, { freq, at, len, type, gain, pluck }) => {
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.value = freq
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(gain, at + (pluck ? 0.01 : 0.25))
  g.gain.exponentialRampToValueAtTime(0.0008, at + len)
  osc.connect(g).connect(out)
  osc.start(at)
  osc.stop(at + len + 0.05)
}
const hat = (ctx, out, at, gain) => {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const hp = ctx.createBiquadFilter()
  hp.type = "highpass"
  hp.frequency.value = 6000
  const g = ctx.createGain()
  g.gain.value = gain
  src.connect(hp).connect(g).connect(out)
  src.start(at)
}

const playTune = (id) => {
  const song = SONGS[id]
  const b = bus()
  if (!song || !b) return { stop() {} }
  const { ctx, out } = b
  const master = ctx.createGain()
  master.gain.setValueAtTime(0, ctx.currentTime)
  master.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.5)
  master.connect(out)
  const beat = 60 / song.bpm
  let bar = 0
  let nextBar = ctx.currentTime + 0.1
  let stopped = false
  const schedule = () => {
    if (stopped) return
    while (nextBar < ctx.currentTime + 1.2) {
      const i = bar % song.chords.length
      const at = nextBar
      for (const m of song.chords[i]) {
        if (song.pluck) for (let k = 0; k < 4; k++) note(ctx, master, { freq: hz(m), at: at + k * beat + (m % 3) * 0.012, len: beat * 0.9, type: "triangle", gain: 0.05, pluck: true })
        else note(ctx, master, { freq: hz(m), at, len: beat * 4, type: "sine", gain: 0.06, pluck: false })
      }
      for (let k = 0; k < 4; k += song.pluck ? 1 : 2) note(ctx, master, { freq: hz(song.bass[i]), at: at + k * beat, len: beat * (song.pluck ? 0.8 : 1.9), type: "sine", gain: 0.16, pluck: true })
      for (const [t, m] of song.melody[i]) if (m) note(ctx, master, { freq: hz(m), at: at + t * beat, len: beat * (song.pluck ? 0.8 : 1.8), type: song.wave, gain: song.wave === "square" ? 0.035 : 0.09, pluck: song.pluck })
      if (song.drums) for (let k = 0; k < 8; k++) hat(ctx, master, at + k * beat * 0.5, k % 2 ? 0.05 : 0.09)
      nextBar += beat * 4
      bar++
    }
  }
  schedule()
  const timer = setInterval(schedule, 300)
  return {
    stop() {
      if (stopped) return
      stopped = true
      clearInterval(timer)
      try {
        master.gain.cancelScheduledValues(ctx.currentTime)
        master.gain.setValueAtTime(master.gain.value, ctx.currentTime)
        master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6)
        setTimeout(() => master.disconnect(), 800)
      } catch {
        // closed
      }
    },
  }
}

// a sound file on drive C: (a data URL), looped, through the shared bus
const playFile = (file) => {
  let stopped = false
  let audio = null
  let node = null
  ;(async () => {
    const data = await readContent(file)
    if (stopped || !data) return
    audio = new Audio(data)
    audio.loop = true
    const b = bus()
    try {
      if (b) {
        node = b.ctx.createMediaElementSource(audio)
        node.connect(b.out)
      }
    } catch {
      node = null
    }
    audio.play().catch(() => {})
  })()
  return {
    stop() {
      stopped = true
      if (audio) {
        audio.pause()
        audio.src = ""
      }
      try {
        node?.disconnect()
      } catch {
        // ignore
      }
    },
  }
}

export const playMusic = (id, { file = null } = {}) => {
  if (!id || id === "none") return { stop() {} }
  getAudioContext()
  if (id === "file") return file ? playFile(file) : { stop() {} }
  return playTune(id)
}
