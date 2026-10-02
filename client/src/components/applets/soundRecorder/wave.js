// Sound Recorder's sound data: mono samples (Float32Array, -1..1) at 22,050 Hz, saved as a
// 16-bit PCM WAV in a data URL. Every effect and edit is a plain function from samples to
// new samples, so they can be tested without a browser.

export const RATE = 22050
export const MAX_SECONDS = 60
export const MAX_SAMPLES = RATE * MAX_SECONDS

const clamp = (v) => (v > 1 ? 1 : v < -1 ? -1 : v)

// ---- WAV ----

// samples -> the bytes of a 16-bit mono PCM .wav file
export const encodeWav = (samples, rate = RATE) => {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const text = (at, s) => [...s].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)))
  text(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, "WAVE")
  text(12, "fmt ")
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true) // bytes per second
  view.setUint16(32, 2, true) // bytes per frame
  view.setUint16(34, 16, true) // bits per sample
  text(36, "data")
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const v = clamp(samples[i])
    view.setInt16(44 + i * 2, v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff), true)
  }
  return bytes
}

// The bytes of a PCM .wav (8/16-bit, any channels and rate) -> { samples, rate } (mixed down
// to mono), or null if it isn't one this can read (then the browser's decoder is used)
export const decodeWav = (bytes) => {
  if (!bytes || bytes.length < 44) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3])
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null
  let fmt = null
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = tag(at)
    const size = view.getUint32(at + 4, true)
    const body = at + 8
    if (id === "fmt ") {
      fmt = { format: view.getUint16(body, true), channels: view.getUint16(body + 2, true), rate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) }
    } else if (id === "data" && fmt) {
      if (fmt.format !== 1 || (fmt.bits !== 16 && fmt.bits !== 8) || !fmt.channels) return null
      const frameBytes = (fmt.bits / 8) * fmt.channels
      const end = Math.min(bytes.length, body + size)
      const frames = Math.floor((end - body) / frameBytes)
      const samples = new Float32Array(frames)
      for (let f = 0; f < frames; f++) {
        let sum = 0
        for (let c = 0; c < fmt.channels; c++) {
          const p = body + f * frameBytes + (c * fmt.bits) / 8
          sum += fmt.bits === 16 ? view.getInt16(p, true) / 0x8000 : (bytes[p] - 128) / 128
        }
        samples[f] = sum / fmt.channels
      }
      return { samples, rate: fmt.rate }
    }
    at = body + size + (size & 1)
  }
  return null
}

const toBase64 = (bytes) => {
  if (typeof Buffer !== "undefined" && typeof btoa === "undefined") return Buffer.from(bytes).toString("base64")
  let out = ""
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(out)
}

const fromBase64 = (text) => {
  if (typeof Buffer !== "undefined" && typeof atob === "undefined") return new Uint8Array(Buffer.from(text, "base64"))
  const raw = atob(text)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

export const samplesToDataUrl = (samples) => `data:audio/wav;base64,${toBase64(encodeWav(samples))}`

// a data URL (what a sound file holds) -> its bytes, or null
export const dataUrlToBytes = (url) => {
  const m = /^data:audio\/(?:wav|x-wav|wave);base64,([A-Za-z0-9+/=\s]*)$/.exec(String(url || ""))
  if (!m) return null
  try {
    return fromBase64(m[1].replace(/\s+/g, ""))
  } catch {
    return null
  }
}

// ---- resampling ----

// linear interpolation to another rate (good enough for a 22 kHz voice recorder)
export const resample = (samples, from, to = RATE) => {
  if (from === to || !samples.length) return Float32Array.from(samples)
  const length = Math.max(1, Math.round((samples.length * to) / from))
  const out = new Float32Array(length)
  const step = from / to
  for (let i = 0; i < length; i++) {
    const x = i * step
    const a = Math.floor(x)
    const b = Math.min(a + 1, samples.length - 1)
    const t = x - a
    out[i] = (samples[Math.min(a, samples.length - 1)] || 0) * (1 - t) + (samples[b] || 0) * t
  }
  return out
}

// ---- effects (Effects menu) ----

export const changeVolume = (samples, factor) => samples.map((v) => clamp(v * factor))
export const increaseVolume = (samples) => changeVolume(samples, 1.25)
export const decreaseVolume = (samples) => changeVolume(samples, 1 / 1.25)

// twice as fast = half as long (and higher pitched, as in the original)
export const changeSpeed = (samples, factor) => resample(samples, factor, 1)
export const increaseSpeed = (samples) => changeSpeed(samples, 2)
export const decreaseSpeed = (samples) => changeSpeed(samples, 0.5)

// a quieter copy, a fifth of a second later (the sound doesn't get longer)
export const addEcho = (samples, rate = RATE, delay = 0.2, level = 0.4) => {
  const lag = Math.round(rate * delay)
  const out = Float32Array.from(samples)
  for (let i = lag; i < out.length; i++) out[i] = clamp(samples[i] + samples[i - lag] * level)
  return out
}

export const reverse = (samples) => Float32Array.from(samples).reverse()

// ---- edits (Edit menu); `at` is a sample index ----

export const deleteBefore = (samples, at) => samples.slice(Math.max(0, Math.min(at, samples.length)))
export const deleteAfter = (samples, at) => samples.slice(0, Math.max(0, Math.min(at, samples.length)))

export const insertAt = (samples, at, other) => {
  const p = Math.max(0, Math.min(at, samples.length))
  const out = new Float32Array(samples.length + other.length)
  out.set(samples.subarray(0, p), 0)
  out.set(other, p)
  out.set(samples.subarray(p), p + other.length)
  return out
}

// other mixed in from `at` (the sound gets longer if it runs past the end)
export const mixAt = (samples, at, other) => {
  const p = Math.max(0, Math.min(at, samples.length))
  const out = new Float32Array(Math.max(samples.length, p + other.length))
  out.set(samples, 0)
  for (let i = 0; i < other.length; i++) out[p + i] = clamp(out[p + i] + other[i])
  return out
}

// recording writes over what's there from `at` on, as in the original
export const overwriteAt = (samples, at, other) => {
  const p = Math.max(0, Math.min(at, samples.length))
  const out = new Float32Array(Math.max(samples.length, p + other.length))
  out.set(samples, 0)
  out.set(other, p)
  return out
}

// keep a sound within the length limit
export const limit = (samples, max = MAX_SAMPLES) => (samples.length > max ? samples.slice(0, max) : samples)

// ---- a synthesized sample (Edit > Insert Chime), so there's something to play with ----

export const chime = (rate = RATE) => {
  const notes = [659.25, 830.61, 987.77, 1318.51] // E5 G#5 B5 E6
  const each = Math.round(rate * 0.16)
  const tail = Math.round(rate * 0.5)
  const out = new Float32Array(each * notes.length + tail)
  notes.forEach((freq, n) => {
    const start = n * each
    for (let i = 0; start + i < out.length; i++) {
      const t = i / rate
      const env = Math.min(1, i / 60) * Math.exp(-t * 5)
      out[start + i] += 0.22 * env * (Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(4 * Math.PI * freq * t))
    }
  })
  return out.map(clamp)
}

// "1.25 sec." readouts
export const seconds = (count, rate = RATE) => `${(count / rate).toFixed(2)} sec.`
