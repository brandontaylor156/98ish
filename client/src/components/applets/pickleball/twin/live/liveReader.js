// Live Broadcast, the filming phone: the camera's frames read as they come (Twin Replay's
// pipeline: close crops round each tracked player, court tiles to find them, MediaPipe Pose
// in the worker, the tracker on the court), the microphone listened to for paddle pops, and
// out of it ~10 ticks a second and a hit event as each is decided. Nothing of the picture or
// the sound leaves the phone: only positions and hits (packet.js).

import { createAnalyzer } from "../core/analyze.js"
import { applyH } from "../core/homography.js"
import { courtRegion, fromCrop, mergePeople, playerBox, scanTiles } from "../core/regions.js"
import { footPoint, torsoColor } from "../core/tracker.js"
import { detectOnsets } from "../core/onsets.js"
import { startPose } from "../reader.js"
import { createLiveHits, createSlots } from "./liveHits.js"
import { encodeTick, TICK_HZ } from "./packet.js"

const WIDTH = 640
const RATE = 12000 // the sound, resampled (as Twin Replay reads it)
const KEEP_LM_S = 2.5 // landmarks kept on track samples (the swing finder looks back ~1.6 s)

// a camera picture as Calibrate wants it: { canvas, duration: 0, vw, vh }
export const snapshot = (video, width = WIDTH) => {
  const c = document.createElement("canvas")
  c.width = width
  c.height = Math.round((width * video.videoHeight) / Math.max(1, video.videoWidth))
  c.getContext("2d").drawImage(video, 0, 0, c.width, c.height)
  return { canvas: c, duration: 0, vw: video.videoWidth, vh: video.videoHeight }
}

// The microphone: a rolling few seconds at 12 kHz, its newest sample's time on our clock
const listen = (stream, clock) => {
  const tracks = stream?.getAudioTracks?.() || []
  if (!tracks.length) return null
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  const ctx = new AC()
  const src = ctx.createMediaStreamSource(new MediaStream(tracks))
  // (ScriptProcessor: old but everywhere, iPhone included; 4096 samples = ~85 ms chunks)
  const proc = ctx.createScriptProcessor(4096, 1, 1)
  const ring = new Float32Array(RATE * 4)
  let write = 0
  let filled = 0
  let endT = 0
  const step = ctx.sampleRate / RATE
  let carry = 0
  proc.onaudioprocess = (e) => {
    const x = e.inputBuffer.getChannelData(0)
    // (box-filter downsampling: enough for a ~3 kHz pop detector)
    for (let pos = carry; pos < x.length; pos += step) {
      const a = Math.floor(pos)
      const b = Math.min(x.length, Math.floor(pos + step))
      let sum = 0
      for (let k = a; k < b; k++) sum += x[k]
      ring[write] = sum / Math.max(1, b - a)
      write = (write + 1) % ring.length
      filled = Math.min(ring.length, filled + 1)
      carry = pos + step - x.length
    }
    endT = clock() - (ctx.baseLatency || 0)
  }
  src.connect(proc)
  // (a processor only runs when connected onward; a muted gain keeps it silent)
  const mute = ctx.createGain()
  mute.gain.value = 0
  proc.connect(mute)
  mute.connect(ctx.destination)
  if (ctx.state === "suspended") ctx.resume().catch(() => {})
  return {
    // the last `seconds` of sound and the time of its first sample
    window(seconds) {
      const n = Math.min(filled, Math.round(seconds * RATE))
      const out = new Float32Array(n)
      for (let i = 0; i < n; i++) out[i] = ring[(write - n + i + ring.length) % ring.length]
      return { samples: out, t0: endT - n / RATE }
    },
    get ok() {
      return filled > RATE * 0.5
    },
    close() {
      try {
        proc.disconnect()
        src.disconnect()
        mute.disconnect()
        ctx.close()
      } catch {
        // already closed
      }
    },
  }
}

// video: a playing <video> with the camera; taps: { id, u, v } (Calibrate's); players 2 | 4
// onTick(bytes, { t }), onHit(event), onFrame({ t, tracks, slots, W, H }), onStatus(text)
// -> { stop(), stats() }
export const startLive = async ({ video, stream, taps, players = 4, onTick, onHit, onFrame, onStatus, targetFps = 12, model = "lite", gpu = true }) => {
  const W = WIDTH
  const H = Math.round((W * video.videoHeight) / Math.max(1, video.videoWidth))
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H })
  const g = canvas.getContext("2d", { willReadFrequently: true })
  const SW = Math.min(video.videoWidth, 1280)
  const scale = SW / W
  const big = Object.assign(document.createElement("canvas"), { width: SW, height: Math.round(H * scale) })
  const bg = big.getContext("2d")
  const square = (px) => {
    const c = Object.assign(document.createElement("canvas"), { width: px, height: px })
    return { c, g: c.getContext("2d") }
  }
  const roiCut = square(256)
  const scanCut = square(320)
  const analyzer = createAnalyzer({ taps: taps.map((t) => ({ id: t.id, x: t.u * W, y: t.v * H })), players })
  const Hm = analyzer.calibration.H
  const Hinv = analyzer.calibration.Hinv
  const tiles = scanTiles(courtRegion(Hinv, W, H), Hinv, W, H)
  const specs = [
    { key: "roi", mode: "IMAGE", poses: 1 },
    { key: "scan", mode: "IMAGE", poses: 3 },
  ]
  let pose = await startPose({ model, players, gpu, specs, onStatus })
  const t0 = performance.now()
  const clock = () => (performance.now() - t0) / 1000
  const mic = listen(stream, clock)
  const hitsFinder = createLiveHits()
  const slots = createSlots({ players })
  let stopped = false
  let n = 0
  let lastScan = -99
  let lastFrameT = -99
  let scanAt = 0
  let lastPoll = 0
  let heardUntil = 0
  let poseMs = 0
  let peopleSeen = 0
  const recent = []
  let loopMs = 0
  let ticks = 0
  let bytes = 0
  let hitsSent = 0
  let switched = false
  const footAt = (p) => {
    const f = footPoint(p.lm)
    return f ? applyH(Hm, f[0], f[1]) : null
  }
  const read = async (box, cut, key, t) => {
    cut.g.fillStyle = "#000"
    cut.g.fillRect(0, 0, cut.c.width, cut.c.height)
    cut.g.drawImage(big, box.x * scale, box.y * scale, box.w * scale, box.h * scale, 0, 0, cut.c.width, cut.c.height)
    const bmp = await createImageBitmap(cut.c)
    return fromCrop(await pose.detect(bmp, t * 1000, cut.c.width, cut.c.height, key), box, cut.c.width, cut.c.height)
  }
  // ticks go out 10 a second whatever the model's pace: between its readings each player is
  // carried on along their velocity for up to 0.3 s (a slow phone still streams smoothly)
  const sendTick = (t) => {
    const byslot = []
    for (const tr of analyzer.tracks()) {
      const s = slots.slotOf(tr)
      const age = Math.max(0, t - tr.lastT)
      const ahead = Math.min(age, 0.3)
      // "seen": found in one of the last pictures read (on a slow phone a picture takes a while
      // to read, so how old its capture is says nothing)
      const seen = tr.lastT >= lastFrameT - 1 && t - lastFrameT < 6
      if (s !== null && s < players) byslot[s] = { x: tr.x + tr.vx * ahead, z: tr.z + tr.vz * ahead, vx: seen ? tr.vx : 0, vz: seen ? tr.vz : 0, seen }
    }
    const list = Array.from({ length: players }, (_, i) => byslot[i] || { x: 0, z: 0, seen: false })
    const pkt = encodeTick(t * 1000, list)
    ticks++
    bytes += pkt.length
    onTick?.(pkt, { t })
  }
  const loop = async () => {
    while (!stopped) {
      const l0 = performance.now()
      if (video.readyState < 2) {
        await new Promise((r) => setTimeout(r, 100))
        continue
      }
      const t = clock()
      bg.drawImage(video, 0, 0, big.width, big.height)
      g.drawImage(big, 0, 0, W, H)
      const img = g.getImageData(0, 0, W, H)
      const sample = (x, y) => {
        const xi = Math.round(x)
        const yi = Math.round(y)
        if (xi < 0 || yi < 0 || xi >= W || yi >= H) return null
        const k = (yi * W + xi) * 4
        return [img.data[k], img.data[k + 1], img.data[k + 2]]
      }
      const p0 = performance.now()
      let people = []
      const live = analyzer.tracks().filter((tr) => t - tr.lastT < 1)
      for (const tr of live) {
        const dt = Math.min(0.4, t - tr.lastT)
        const box = playerBox(Hinv, tr.x + tr.vx * dt, tr.z + tr.vz * dt, W, H)
        if (box) people = mergePeople(people, await read(box, roiCut, "roi", t), footAt)
      }
      // finding players: a few court tiles at a time, round the court (all of them only while
      // nobody's found yet): every frame while someone's missing, else every second or so
      const missing = live.length < players
      if (!live.length || (missing && t - lastScan > 0.4) || t - lastScan > 1.2) {
        lastScan = t
        const take = live.length ? Math.min(tiles.length, 3) : tiles.length
        for (let k = 0; k < take; k++) {
          const tile = tiles[scanAt++ % tiles.length]
          people = mergePeople(people, await read(tile, scanCut, "scan", t), footAt)
        }
      }
      poseMs += performance.now() - p0
      for (const p of people) p.color = torsoColor(p.lm, sample)
      analyzer.push(t, people)
      lastFrameT = t
      n++
      peopleSeen += people.length
      if (recent.length >= 12) recent.shift()
      recent.push([+t.toFixed(1), people.length, live.length, analyzer.tracks().map((tr) => +(t - tr.lastT).toFixed(1)).join('/')])
      // (old landmarks dropped: an hour of them would fill the phone's memory)
      for (const tr of analyzer.tracks()) {
        tr.lmCut ??= 0
        while (tr.lmCut < tr.samples.length && tr.samples[tr.lmCut].t < t - KEEP_LM_S) {
          tr.samples[tr.lmCut].lm = null
          tr.samples[tr.lmCut].world = null
          tr.lmCut++
        }
      }
      if (n === 6 && pose.delegate === "GPU" && poseMs / n > 350 && !switched) {
        switched = true
        pose.close()
        pose = await startPose({ model, players, gpu: false, specs, onStatus })
      }
      // the sound: new pops from the last 2.5 s
      if (mic?.ok && t - lastPoll > 0.3) {
        const w = mic.window(2.5)
        const found = detectOnsets(w.samples, RATE).map((o) => ({ ...o, t: o.t + w.t0 })).filter((o) => o.t > heardUntil + 0.05 && o.t < t - 0.15)
        if (found.length) {
          hitsFinder.push(found)
          heardUntil = found[found.length - 1].t
        }
      }
      if (t - lastPoll > 0.15) {
        lastPoll = t
        for (const h of hitsFinder.poll(t, analyzer.tracks().map((tr) => ({ ...tr, hand: 1 })), { sound: !!mic?.ok })) {
          const tr = analyzer.tracks().find((x) => x.id === h.player)
          const slot = tr ? slots.slotOf(tr) : null
          if (slot === null || slot >= players) continue
          hitsSent++
          onHit?.({ k: "hit", t: Math.round(h.t * 1000), p: slot, h: Math.round(h.height * 100), s: h.side, src: h.source })
        }
      }
      onFrame?.({ t, tracks: analyzer.tracks(), slots: slots.map, W, H })
      const spent = performance.now() - l0
      loopMs += spent
      // (no faster than the target: the phone stays cooler; slower phones just run flat out)
      const wait = 1000 / targetFps - spent
      if (wait > 4) await new Promise((r) => setTimeout(r, wait))
    }
  }
  const running = loop().catch((e) => onStatus?.(`Stopped: ${e.message}`))
  const ticker = setInterval(() => !stopped && n > 0 && sendTick(clock()), 1000 / TICK_HZ)
  return {
    clock,
    async stop() {
      stopped = true
      clearInterval(ticker)
      await running
      pose?.close()
      mic?.close()
    },
    stats: () => ({ people: +(peopleSeen / Math.max(1, n)).toFixed(2), recent, tracks: analyzer.tracks().length, seen: analyzer.tracks().filter((tr) => tr.lastT >= lastFrameT - 1).length, frames: n, fps: n / Math.max(0.001, clock()), poseMsPerFrame: poseMs / Math.max(1, n), loopMsPerFrame: loopMs / Math.max(1, n), ticks, bytes, hits: hitsSent, mic: !!mic?.ok, where: pose?.where, delegate: pose?.delegate }),
  }
}
