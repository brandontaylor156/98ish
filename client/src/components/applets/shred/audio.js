// Shred 98's sound: the band (the Media Player's synth plays drums, bass and keys), two
// synthesized electric guitars (the lead you play and a rhythm guitar), the crowd, and the
// game's effects. Songs are scheduled on the AudioContext clock with a short lookahead,
// and the game reads "song time as heard" from the same clock (timing.js), so the notes,
// the music and your inputs all agree.
//
// The lead guitar works like the real games: it plays along while you're hitting notes and
// cuts out (with a clank) when you miss, until you hit again.

import { createSynth } from "../mediaPlayer/synth.js"
import { compile, lowerBound } from "../mediaPlayer/sequencer.js"
import { createClock, clockSample, heardAt } from "./timing.js"
import { claimPlaybackSession, closeAudioContext, createAudioContext } from "../../../utils/audio.js"

const TICK_MS = 25
const LOOKAHEAD = 0.15
export const COUNT_IN_BEATS = 4
const START_DELAY = 0.08 // seconds from start() to the first sound

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12)

// soft-clipping curve for the amps
const driveCurve = (amount) => {
  const n = 2048
  const curve = new Float32Array(n)
  const k = amount
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x)) * 0.85 + Math.tanh(x * 2) * 0.15
  }
  return curve
}

const noiseBuffer = (ctx, seconds = 1.5) => {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  let seed = 424242
  for (let i = 0; i < len; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    d[i] = seed / 0x3fffffff - 1
  }
  return buf
}

const biquad = (ctx, type, freq, q = 0.7, gain = 0) => {
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  f.gain.value = gain
  return f
}

const gainOf = (ctx, v) => {
  const g = ctx.createGain()
  g.gain.value = v
  return g
}

// An amp: preamp drive into a soft clipper, then a speaker cabinet's EQ
const amp = (ctx, { drive, tone, level }) => {
  const input = gainOf(ctx, 1)
  const pre = gainOf(ctx, drive)
  const lowCut = biquad(ctx, "highpass", 110, 0.7)
  const shaper = ctx.createWaveShaper()
  shaper.curve = driveCurve(18)
  shaper.oversample = "4x"
  // clipping a lopsided wave (two saws and a square an octave down) leaves a DC offset,
  // which would thump every time the lead is cut: a speaker doesn't pass it anyway
  const dcBlock = biquad(ctx, "highpass", 30, 0.7)
  const scoop = biquad(ctx, "peaking", 720, 0.9, -4)
  const bite = biquad(ctx, "peaking", 2300, 1.1, 4.5)
  const cab = biquad(ctx, "lowpass", tone, 0.8)
  const cab2 = biquad(ctx, "lowpass", tone * 1.4, 0.5)
  const out = gainOf(ctx, level)
  input.connect(lowCut).connect(pre).connect(shaper).connect(dcBlock).connect(scoop).connect(bite).connect(cab).connect(cab2).connect(out)
  return { input, out }
}

// ---------- latency ----------
// Every sound reaches the speakers a little after it's scheduled: the band's mixer has two
// compressors (each looks 6 ms ahead), the amps' 4x oversampling adds a few ms more, and the
// effects have a compressor of their own. So each sound is scheduled that much early, to be
// heard right on the chart, the game clock and the calibration clicks. Measured once per
// sample rate by rendering a click through the same parts offline; until that's done (a
// moment after the game opens), the usual values.
export const DEFAULT_LATENCY = { band: 0.012, amp: 0.0044, sfx: 0.006 }
const latencies = new Map() // sampleRate -> { band, amp, sfx }
const measuring = new Map() // sampleRate -> Promise

// seconds until the click (at `at`) comes out: the first sample above `share` of the peak
const arrival = (buffer, at, share) => {
  const d = buffer.getChannelData(0)
  let peak = 0
  for (const v of d) peak = Math.max(peak, Math.abs(v))
  if (!peak) return null
  for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) >= peak * share) return i / buffer.sampleRate - at
  return null
}

export const latencyFor = (sampleRate) => latencies.get(sampleRate) || DEFAULT_LATENCY

export const measureLatency = (sampleRate) => {
  if (latencies.has(sampleRate)) return Promise.resolve(latencies.get(sampleRate))
  if (measuring.has(sampleRate)) return measuring.get(sampleRate)
  const OAC = typeof OfflineAudioContext !== "undefined" ? OfflineAudioContext : null
  if (!OAC) return Promise.resolve(DEFAULT_LATENCY)
  const at = 0.02
  const render = async (share, build) => {
    const ctx = new OAC(1, Math.ceil(sampleRate * 0.1), sampleRate)
    const buf = ctx.createBuffer(1, 1, sampleRate)
    buf.getChannelData(0)[0] = 0.5
    const click = ctx.createBufferSource()
    click.buffer = buf
    click.connect(build(ctx))
    click.start(at)
    return arrival(await ctx.startRendering(), at, share)
  }
  const job = Promise.all([
    // the band's mixer: compressor look-ahead is a pure delay
    render(0.01, (ctx) => {
      const synth = createSynth(ctx)
      synth.addTrack({ gain: 1, reverb: 0, delay: 0 })
      return synth.trackInput(0)
    }),
    // an amp: when the bulk of a click gets through the oversampling filters
    render(0.3, (ctx) => {
      const a = amp(ctx, { drive: 1, tone: 4600, level: 1 })
      a.out.connect(ctx.destination)
      return a.input
    }),
    render(0.01, (ctx) => {
      const comp = ctx.createDynamicsCompressor()
      comp.connect(ctx.destination)
      return comp
    }),
  ])
    .then(([band, ampDelay, sfx]) => {
      const ok = (v, d) => (Number.isFinite(v) && v >= 0 && v < 0.05 ? v : d)
      const l = { band: ok(band, DEFAULT_LATENCY.band), amp: ok(ampDelay, DEFAULT_LATENCY.amp), sfx: ok(sfx, DEFAULT_LATENCY.sfx) }
      latencies.set(sampleRate, l)
      return l
    })
    .catch(() => DEFAULT_LATENCY)
  measuring.set(sampleRate, job)
  return job
}

// `context`: render into an OfflineAudioContext instead (tests: renderOffline below)
export const createAudio = ({ context = null } = {}) => {
  const offline = !!context
  // its own low-latency context (made by utils/audio.js, so taps and coming back from the
  // background wake it like every other sound on the page)
  const ctx = context || createAudioContext({ latencyHint: "interactive" })
  if (!ctx) return null
  const releaseSession = offline ? () => {} : claimPlaybackSession()
  // how early each kind of sound is scheduled (see latency above)
  let lat = latencyFor(ctx.sampleRate)
  if (!offline) measureLatency(ctx.sampleRate).then((l) => (lat = l))
  const noise = noiseBuffer(ctx)
  const clock = createClock()

  // effects and the crowd go straight out, beside the band's mixer
  const sfxOut = gainOf(ctx, 0.8)
  const sfxComp = ctx.createDynamicsCompressor()
  sfxOut.connect(sfxComp).connect(ctx.destination)
  let master = 1
  let musicLevel = 0.9
  let sfxOn = true

  // the crowd: a bed of filtered noise that swells with how you're doing
  const crowdSrc = ctx.createBufferSource()
  crowdSrc.buffer = noise
  crowdSrc.loop = true
  const crowdBand = biquad(ctx, "bandpass", 1100, 0.6)
  const crowdFormant = biquad(ctx, "peaking", 520, 1.2, 6)
  const crowdGain = gainOf(ctx, 0)
  crowdSrc.connect(crowdBand).connect(crowdFormant).connect(crowdGain).connect(sfxOut)
  crowdSrc.start()
  // flubbed notes get their own little amp, so they sound while the lead is cut
  const clankAmp = amp(ctx, { drive: 9, tone: 3000, level: 0.5 })
  clankAmp.out.connect(sfxOut)

  // ---------- the band ----------
  let synth = null
  let song = null
  let events = []
  let duration = 0
  let index = 0
  let timer = null
  let playing = false
  let anchor = 0 // context time of song time 0
  let offset = 0 // song position while stopped
  let leadTrack = -1
  let rhythmTrack = -1
  let drumTrack = -1
  let lead = null
  let rhythm = null
  let whammy = null
  let leadVoices = new Set()
  let otherVoices = new Set()
  let countFrom = 0
  let previewTimer = null
  let lastWhammy = null
  let lastCrowd = null

  const setMusicGain = () => synth?.setVolume(master * musicLevel)

  const dropRigs = () => {
    try {
      whammy?.stop()
      whammy?.disconnect()
      lead?.gate.disconnect()
      rhythm?.amp.out.disconnect()
    } catch {}
    whammy = lead = rhythm = null
  }

  const buildRigs = () => {
    dropRigs()
    // the lead: medium gain, a gate the game opens and closes, whammy bends every voice
    const leadAmp = amp(ctx, { drive: 7, tone: 4600, level: 0.55 })
    const gate = gainOf(ctx, 1)
    leadAmp.out.connect(gate)
    if (leadTrack >= 0) gate.connect(synth.trackInput(leadTrack))
    whammy = ctx.createConstantSource ? ctx.createConstantSource() : null
    lastWhammy = null
    if (whammy) {
      whammy.offset.value = 0
      whammy.start()
    }
    lead = { amp: leadAmp, gate }
    const rhythmAmp = amp(ctx, { drive: 11, tone: 3600, level: 0.42 })
    if (rhythmTrack >= 0) rhythmAmp.out.connect(synth.trackInput(rhythmTrack))
    rhythm = { amp: rhythmAmp }
  }

  // one guitar string: two detuned saws and a touch of square, a pick click, a filter that
  // closes after the attack, and string vibrato on long notes
  const string = (out, t, dur, midi, vel, { palm = false, bend = true, bright = 1 } = {}) => {
    const f = midiToHz(midi)
    const vca = gainOf(ctx, 0)
    const lp = biquad(ctx, "lowpass", palm ? 900 : 5200 * bright, palm ? 1.4 : 1)
    lp.frequency.setValueAtTime(palm ? 900 : 6500 * bright, t)
    lp.frequency.setTargetAtTime(palm ? 420 : 2600 * bright, t + 0.005, palm ? 0.04 : 0.25)
    const oscs = [
      ["sawtooth", f, -5, 0.5],
      ["sawtooth", f, 6, 0.5],
      ["square", f * 0.5, 0, palm ? 0.35 : 0.18],
    ].map(([type, freq, cents, level]) => {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.setValueAtTime(freq, t)
      o.detune.setValueAtTime(cents, t)
      const g = gainOf(ctx, level)
      o.connect(g).connect(lp)
      return o
    })
    const wh = bend ? whammy : null
    const bent = wh ? oscs.map((o) => o.detune) : []
    for (const p of bent) wh.connect(p)
    const peak = Math.pow(Math.min(1, vel), 1.3) * (palm ? 0.7 : 0.55)
    const end = t + Math.max(0.03, dur)
    vca.gain.setValueAtTime(0, t)
    vca.gain.linearRampToValueAtTime(peak, t + 0.003)
    vca.gain.setTargetAtTime(peak * (palm ? 0.15 : 0.62), t + 0.003, palm ? 0.05 : 0.35)
    vca.gain.setTargetAtTime(0, end, 0.03)
    const stopAt = end + 0.2
    // a long note gets a little finger vibrato
    if (!palm && dur > 0.5) {
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 5.4
      const depth = gainOf(ctx, 0)
      depth.gain.setValueAtTime(0, t)
      depth.gain.setValueAtTime(0, t + 0.3)
      depth.gain.linearRampToValueAtTime(14, t + 0.7)
      lfo.connect(depth)
      for (const o of oscs) depth.connect(o.detune)
      oscs.push(lfo)
    }
    // the pick hitting the string
    const pick = ctx.createBufferSource()
    pick.buffer = noise
    const pickBand = biquad(ctx, "bandpass", palm ? 1200 : 3200, 1.5)
    const pickGain = gainOf(ctx, 0)
    pickGain.gain.setValueAtTime(peak * 0.5, t)
    pickGain.gain.setTargetAtTime(0, t, 0.006)
    pick.connect(pickBand).connect(pickGain).connect(vca)
    oscs.push(pick)
    lp.connect(vca).connect(out)
    for (const o of oscs) {
      o.start(t)
      o.stop(stopAt)
    }
    const voice = { oscs, vca, t, end: stopAt }
    oscs[0].onended = () => {
      leadVoices.delete(voice)
      otherVoices.delete(voice)
      try {
        vca.disconnect()
        for (const p of bent) wh.disconnect(p)
      } catch {}
    }
    return voice
  }

  // a note meant to be heard at context time `at`, started early by its path's latency
  const playEvent = (e, at, now) => {
    if (e.track === leadTrack) leadVoices.add(string(lead.amp.input, Math.max(now, at - lat.band - lat.amp), e.dur, e.midi, e.vel))
    else if (e.track === rhythmTrack) otherVoices.add(string(rhythm.amp.input, Math.max(now, at - lat.band - lat.amp), e.dur, e.midi, e.vel, { palm: e.vel < 0.5, bend: false, bright: 0.8 }))
    else synth.play(song.tracks[e.track].instrument, e.track, Math.max(now, at - lat.band), e.dur, e.midi, e.vel)
  }

  const tick = () => {
    timer = null
    if (!playing) return
    const now = ctx.currentTime
    const until = now + LOOKAHEAD - anchor
    // the count-in: sticks on each beat before the song starts
    const spb = 60 / song.bpm
    while (countFrom < 0 && countFrom * spb < until) {
      const at = anchor + countFrom * spb
      if (at >= now - 0.02 && drumTrack >= 0) synth.play("drums", drumTrack, Math.max(at - lat.band, now), 0.1, 37, countFrom === -COUNT_IN_BEATS ? 0.95 : 0.8)
      countFrom++
    }
    while (index < events.length && events[index].time < until) {
      const e = events[index++]
      const at = anchor + e.time
      if (at >= now - 0.03) playEvent(e, at, now)
    }
    if (now - anchor >= duration) {
      playing = false
      offset = duration
      return
    }
    if (offline) {
      // an OfflineAudioContext pauses at the next tick so it plays exactly like the live one
      const q = 128 / ctx.sampleRate
      const next = Math.ceil((now + TICK_MS / 1000) / q + 1e-6) * q
      if (next < ctx.length / ctx.sampleRate) ctx.suspend(next).then(() => {
        tick()
        ctx.resume()
      })
      return
    }
    timer = setTimeout(tick, TICK_MS)
  }

  const hushAll = () => {
    const now = ctx.currentTime
    for (const v of [...leadVoices, ...otherVoices]) {
      try {
        v.vca.gain.cancelScheduledValues(now)
        v.vca.gain.setTargetAtTime(0, now, 0.015)
        // a note queued but not started yet never starts; one ringing fades out
        for (const o of v.oscs) o.stop(v.t > now ? now : now + 0.1)
      } catch {}
    }
    leadVoices.clear()
    otherVoices.clear()
    synth?.hush(true)
  }

  const halt = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  const stopPreview = () => {
    if (previewTimer) clearTimeout(previewTimer)
    previewTimer = null
  }

  const api = {
    ctx,
    get song() {
      return song
    },
    get playing() {
      return playing
    },
    get duration() {
      return duration
    },
    get anchor() {
      return anchor
    },

    // Wake audio (call inside a click or key press: browsers only start sound then)
    unlock() {
      if (ctx.state !== "running") ctx.resume().catch(() => {})
    },

    // the song at a practice speed (1 = as written)
    load(next, rate = 1) {
      api.stop()
      stopPreview()
      // one mixer for the whole session (its reverb and echo would outlive a throwaway
      // one): clear its tracks and set them up for this song
      if (!synth) synth = createSynth(ctx, { bpm: next.bpm * rate })
      synth.reset()
      synth.setTempo(next.bpm * rate)
      song = { ...next, bpm: next.bpm * rate }
      const compiled = compile(song)
      events = compiled.events
      duration = compiled.duration
      leadTrack = rhythmTrack = drumTrack = -1
      song.tracks.forEach((t, i) => {
        synth.addTrack(t)
        if (t.instrument === "shredLead") leadTrack = i
        if (t.instrument === "shredRhythm") rhythmTrack = i
        if (t.instrument === "drums" && drumTrack < 0) drumTrack = i
      })
      buildRigs()
      setMusicGain()
    },

    // Start at song position `pos` seconds (negative: a count-in first)
    start(pos = 0) {
      if (!song) return
      halt()
      // restarting while playing (a practice loop, a jump): the notes already queued from the
      // old spot would ring over the new one
      if (playing) hushAll()
      api.unlock()
      synth.open()
      anchor = ctx.currentTime + START_DELAY - pos
      index = lowerBound(events, Math.max(0, pos))
      const spb = 60 / song.bpm
      countFrom = pos < 0 ? Math.max(-COUNT_IN_BEATS, Math.ceil(pos / spb - 1e-9)) : 0
      playing = true
      api.setLead(true)
      tick()
    },

    pause() {
      if (!playing) return offset
      offset = Math.max(0, ctx.currentTime - anchor)
      playing = false
      halt()
      hushAll()
      return offset
    },

    stop() {
      playing = false
      offset = 0
      halt()
      hushAll()
    },

    // A taste of a song on the song list: from its first chorus, faded in, for 14 seconds
    preview(next) {
      api.load(next)
      const chorus = next.markers.find((m) => m.name === "chorus") || next.markers[1] || next.markers[0]
      const at = (chorus.beat * 60) / next.bpm
      synth.setVolume(0)
      synth.setVolume(master * musicLevel * 0.7)
      api.start(at)
      previewTimer = setTimeout(() => {
        synth?.setVolume(0)
        previewTimer = setTimeout(() => api.stop(), 400)
      }, 14000)
    },
    stopPreview() {
      stopPreview()
      api.stop()
    },

    // ---------- the clock ----------
    // Context time heard at a performance.now() moment (ms)
    sampleClock(perfNow = performance.now()) {
      let heard = null
      if (ctx.getOutputTimestamp) {
        const ts = ctx.getOutputTimestamp()
        if (ts && ts.contextTime > 0 && ts.performanceTime > 0) heard = ts.contextTime + (perfNow - ts.performanceTime) / 1000
      }
      if (heard === null) heard = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0)
      clockSample(clock, heard, perfNow)
    },
    contextAt(perfMs) {
      if (clock.offset === null) api.sampleClock()
      return heardAt(clock, perfMs)
    },
    // the performance.now() moment a context time is heard
    perfAtContext(ctxTime) {
      if (clock.offset === null) api.sampleClock()
      return (ctxTime - clock.offset) * 1000
    },
    // song time (s) as heard at a performance.now() moment; while paused, where it stopped
    songTimeAt(perfMs) {
      if (!playing) return offset
      return api.contextAt(perfMs) - anchor
    },

    // ---------- the lead guitar ----------
    setLead(on, when = ctx.currentTime) {
      if (!lead) return
      const g = lead.gate.gain
      const at = Math.max(ctx.currentTime, when)
      g.cancelScheduledValues(at)
      g.setTargetAtTime(on ? 1 : 0, at, on ? 0.004 : 0.012)
    },
    // whammy: 0..1 bends the lead down up to a whole step
    // (called every frame: it only schedules a change when the value moves, so the
    // param's timeline can't pile up while nothing is listening to it)
    setWhammy(amount) {
      const cents = Math.round(-200 * Math.max(0, Math.min(1, amount)))
      if (!whammy || cents === lastWhammy) return
      lastWhammy = cents
      whammy.offset.cancelScheduledValues(ctx.currentTime)
      whammy.offset.setTargetAtTime(cents, ctx.currentTime, 0.02)
    },

    // ---------- effects ----------
    // a missed note: the muted, out-of-tune scrape of a flubbed strum
    clank() {
      if (!sfxOn) return
      const t = ctx.currentTime + 0.005
      for (const midi of [40, 46, 51]) otherVoices.add(string(clankAmp.input, t, 0.07, midi + Math.random() * 0.6, 0.6, { palm: true, bend: false }))
    },
    sfx(kind) {
      if (!sfxOn) return
      const t = ctx.currentTime + 0.005
      const tone = (type, from, to, dur, level, at = t) => {
        const o = ctx.createOscillator()
        o.type = type
        o.frequency.setValueAtTime(from, at)
        if (to !== from) o.frequency.exponentialRampToValueAtTime(to, at + dur)
        const g = gainOf(ctx, 0)
        g.gain.setValueAtTime(0, at)
        g.gain.linearRampToValueAtTime(level, at + 0.005)
        g.gain.setTargetAtTime(0, at + 0.01, dur / 3)
        o.connect(g).connect(sfxOut)
        o.start(at)
        o.stop(at + dur * 2 + 0.05)
      }
      const whoosh = (from, to, dur, level, q = 2) => {
        const src = ctx.createBufferSource()
        src.buffer = noise
        const f = biquad(ctx, "bandpass", from, q)
        f.frequency.exponentialRampToValueAtTime(to, t + dur)
        const g = gainOf(ctx, 0)
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(level, t + dur * 0.6)
        g.gain.setTargetAtTime(0, t + dur * 0.7, dur / 4)
        src.connect(f).connect(g).connect(sfxOut)
        src.start(t)
        src.stop(t + dur * 1.6)
      }
      switch (kind) {
        case "move":
          tone("square", 880, 880, 0.03, 0.05)
          break
        case "select":
          tone("triangle", 660, 1320, 0.08, 0.14)
          tone("square", 990, 990, 0.05, 0.04, t + 0.04)
          break
        case "back":
          tone("triangle", 660, 330, 0.08, 0.12)
          break
        case "starReady":
          for (const [i, f] of [1046, 1318, 1568, 2093].entries()) tone("sine", f, f, 0.18, 0.12, t + i * 0.06)
          break
        case "phrase":
          for (const [i, f] of [1568, 2093].entries()) tone("sine", f, f, 0.14, 0.1, t + i * 0.05)
          break
        case "starOn":
          whoosh(300, 6000, 0.55, 0.5, 1.4)
          for (const f of [523, 659, 784, 1046]) tone("sawtooth", f, f * 1.01, 0.6, 0.035, t + 0.3)
          api.cheer(1.2)
          break
        case "fail":
          tone("sawtooth", 220, 40, 1.4, 0.18)
          tone("sawtooth", 233, 42, 1.4, 0.12)
          whoosh(900, 200, 1.2, 0.35, 0.8)
          break
        case "count":
          tone("square", 1200, 1200, 0.03, 0.08)
          break
        case "applause":
          api.cheer(2.5)
          for (let i = 0; i < 70; i++) {
            const at = t + Math.random() * 3
            const src = ctx.createBufferSource()
            src.buffer = noise
            const f = biquad(ctx, "bandpass", 1500 + Math.random() * 1500, 1.2)
            const g = gainOf(ctx, 0)
            g.gain.setValueAtTime(0.12 * Math.random() + 0.04, at)
            g.gain.setTargetAtTime(0, at + 0.004, 0.012)
            src.connect(f).connect(g).connect(sfxOut)
            src.start(at, Math.random())
            src.stop(at + 0.08)
          }
          break
        default:
      }
    },
    // the crowd: `level` 0..1 is how into it they are
    setCrowd(level) {
      // 0 is silence (menus, paused); anything above starts from a low murmur
      const v = sfxOn && level > 0 ? Math.round((0.012 + 0.05 * Math.min(1, level)) * 1000) / 1000 : 0
      if (v === lastCrowd) return
      lastCrowd = v
      crowdGain.gain.cancelScheduledValues(ctx.currentTime)
      crowdGain.gain.setTargetAtTime(v, ctx.currentTime, 0.6)
    },
    cheer(seconds = 1.5) {
      lastCrowd = null
      if (!sfxOn) return
      const t = ctx.currentTime
      const g = crowdGain.gain
      g.cancelScheduledValues(t)
      g.setTargetAtTime(0.16, t, 0.15)
      g.setTargetAtTime(0.04, t + seconds, 0.6)
    },

    // ---------- calibration ----------
    // a woodblock click, heard at a context time (seconds)
    clickAt(heard, accent = false) {
      // early by the effects' latency, so it's heard at `heard`
      const at = Math.max(ctx.currentTime, heard - lat.sfx)
      const o = ctx.createOscillator()
      o.type = "sine"
      o.frequency.setValueAtTime(accent ? 1900 : 1500, at)
      o.frequency.exponentialRampToValueAtTime(accent ? 1200 : 900, at + 0.03)
      const g = gainOf(ctx, 0)
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(0.5, at + 0.001)
      g.gain.setTargetAtTime(0, at + 0.002, 0.018)
      o.connect(g).connect(sfxOut)
      o.start(at)
      o.stop(at + 0.15)
    },

    // the band's output level right now: { rms, peak } (for tests)
    levels() {
      if (!synth) return { rms: 0, peak: 0 }
      const data = new Float32Array(synth.analyser.fftSize)
      synth.analyser.getFloatTimeDomainData(data)
      let sum = 0
      let peak = 0
      for (const v of data) {
        sum += v * v
        peak = Math.max(peak, Math.abs(v))
      }
      return { rms: Math.sqrt(sum / data.length), peak, lead: lead ? lead.gate.gain.value : 0, voices: leadVoices.size + otherVoices.size + synth.activeVoices() }
    },

    setVolume(masterGain, music, sfx) {
      master = masterGain
      if (music !== undefined) musicLevel = music
      if (sfx !== undefined) sfxOn = sfx
      sfxOut.gain.setTargetAtTime(0.8 * masterGain, ctx.currentTime, 0.02)
      lastCrowd = null
      if (!sfxOn) crowdGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05)
      setMusicGain()
    },

    dispose() {
      api.stop()
      stopPreview()
      try {
        crowdSrc.stop()
      } catch {}
      dropRigs()
      synth?.destroy()
      closeAudioContext(ctx)
      releaseSession()
    },
  }
  return api
}

// Render part of a song offline through the same band, guitars and mixer (for tests):
// `seconds` from song position `start`; `only` keeps just the named tracks (e.g. ["lead"]).
// The lead plays as if every note were hit. Resolves to an AudioBuffer whose time 0 is
// song position `start` (the band's start delay is cut off).
export const renderOffline = async (song, { start = 0, seconds = 8, only = null, rate = 1, sampleRate = 44100 } = {}) => {
  await measureLatency(sampleRate)
  const pre = START_DELAY
  const ctx = new OfflineAudioContext(2, Math.ceil((seconds + pre) * sampleRate), sampleRate)
  const solo = only ? { ...song, tracks: song.tracks.map((t) => (only.includes(t.name) ? t : { ...t, notes: [] })) } : song
  const audio = createAudio({ context: ctx })
  audio.load(solo, rate)
  audio.start(start)
  const full = await ctx.startRendering()
  const cut = Math.round(pre * sampleRate)
  const out = new AudioBuffer({ numberOfChannels: 2, length: full.length - cut, sampleRate })
  for (let c = 0; c < 2; c++) out.copyToChannel(full.getChannelData(c).subarray(cut), c)
  return out
}
