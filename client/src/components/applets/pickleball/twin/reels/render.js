// Instant Replay Reels: renders a timeline (timeline.js) into a video file on the device with
// Mediabunny (WebCodecs): no server, no ffmpeg.wasm. Frames are drawn on one canvas and
// handed to the encoder as they're made (the encoder holds them, never the whole film).
//   footage    decoded from the filmed video with Mediabunny's CanvasSink
//   cutin      the Twin Replay engine plays the rally on a broadcast camera; each frame it draws
//              is copied the moment it's drawn (engine.onRendered)
//   challenge  the engine's Hawk-Eye view (twinChallenge) of the bounce, slowed down
//   title/end  cards drawn here
// renderReel(...) -> { blob, mime, ext, duration, frames, ms }

import { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource, AudioBufferSource, Input, BlobSource, ALL_FORMATS, CanvasSink, QUALITY_MEDIUM, canEncodeVideo, canEncodeAudio } from "mediabunny"
import { fadeAt } from "./timeline.js"
import { layout, drawBug, drawBadge, drawLower, drawCall, drawCard, contain } from "./overlay.js"
import { MPH, callText, nameOf } from "./moments.js"
import { popTimes, renderSoundtrack } from "./soundtrack.js"

export class Cancelled extends Error {}

// what this browser can make: MP4 (H.264 + AAC), else WebM (VP9/VP8 + Opus), else nothing
export const pickFormat = async (W, H) => {
  if ((await canEncodeVideo("avc", { width: W, height: H })) && (await canEncodeAudio("aac"))) return { video: "avc", audio: "aac", mime: "video/mp4", ext: "mp4", format: () => new Mp4OutputFormat({ fastStart: "in-memory" }) }
  for (const v of ["vp9", "vp8"]) {
    if ((await canEncodeVideo(v, { width: W, height: H })) && (await canEncodeAudio("opus"))) return { video: v, audio: "opus", mime: "video/webm", ext: "webm", format: () => new WebMOutputFormat() }
  }
  return null
}

// prepare(moment): loads that rally into the engine (Twin Replay plays one rally at a time)
export const renderReel = async ({ timeline, analysis, game, video = null, engine = null, prepare = null, W = 1280, H = 720, fps = 30, onProgress = () => {}, signal = null }) => {
  const started = performance.now()
  const fmt = await pickFormat(W, H)
  if (!fmt) throw new Error("This browser can't make videos (no video encoder). Try Safari on iOS 17+ or a recent Chrome.")
  const canvas = document.createElement("canvas")
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext("2d", { alpha: false })
  const L = layout(W, H)
  const target = new BufferTarget()
  const output = new Output({ format: fmt.format(), target })
  const vsrc = new CanvasSource(canvas, { codec: fmt.video, quality: QUALITY_MEDIUM, keyFrameInterval: 2 })
  const asrc = new AudioBufferSource({ codec: fmt.audio, quality: QUALITY_MEDIUM })
  output.addVideoTrack(vsrc, { frameRate: fps })
  output.addAudioTrack(asrc)
  await output.start()
  const total = timeline.duration
  let frames = 0
  const check = () => {
    if (signal?.aborted) throw new Cancelled("Cancelled")
  }
  const progress = (t, what) => onProgress({ t, total, pct: Math.min(99, Math.round((t / total) * 100)), what })
  const title = game?.title || game?.name || "Highlights"

  const fadeOver = (seg, t) => {
    const a = fadeAt(seg, t)
    if (a > 0) {
      g.fillStyle = `rgba(0,0,0,${a.toFixed(3)})`
      g.fillRect(0, 0, W, H)
    }
  }
  const momentText = (m) => {
    const who = m.fastest ? nameOf(analysis, m.fastest.player) : ""
    return { title: m.best ? "Point of the game" : m.label, sub: [m.tags.map((x) => x.text).join(" · "), who && m.fastest ? `fastest: ${who}` : ""].filter(Boolean).join("   ") }
  }
  const overlays = (seg) => {
    const m = seg.m
    const idx = timeline.moments.indexOf(m) + 1
    drawBug(g, L, { title, line: `Highlight ${idx} of ${timeline.moments.length}` })
    if (m.fastest) drawBadge(g, L, `${Math.round(m.fastest.speed * MPH)} mph`)
    drawLower(g, L, momentText(m))
  }
  const add = async (ts, dur) => {
    check()
    await vsrc.add(ts, dur)
    frames++
  }

  // ---- cards ----
  const card = async (seg, opts) => {
    const n = Math.max(1, Math.round(seg.dur * fps))
    for (let i = 0; i < n; i++) {
      const t = seg.start + i / fps
      drawCard(g, W, H, L, opts)
      fadeOver(seg, t)
      await add(t, 1 / fps)
    }
    progress(seg.start + seg.dur, opts.title)
  }

  // ---- footage ----
  let input = null
  let sink = null
  if (video && timeline.segments.some((s) => s.kind === "footage")) {
    input = new Input({ source: new BlobSource(video), formats: ALL_FORMATS })
    const track = await input.getPrimaryVideoTrack()
    if (track) sink = new CanvasSink(track, { poolSize: 2 })
  }
  const footage = async (seg) => {
    if (!sink) return blank(seg, "Video unavailable")
    let last = seg.start - 1
    for await (const wc of sink.canvases(seg.t0, seg.t1)) {
      const t = seg.start + (wc.timestamp - seg.t0)
      if (t < last + 0.5 / fps) continue
      last = t
      g.fillStyle = "#000"
      g.fillRect(0, 0, W, H)
      const r = contain(wc.canvas.width, wc.canvas.height, W, H)
      g.drawImage(wc.canvas, r.x, r.y, r.w, r.h)
      overlays(seg)
      fadeOver(seg, t)
      await add(t, Math.max(1 / fps, wc.duration || 1 / fps))
      progress(t, "Your video")
    }
  }
  const blank = async (seg, text) => {
    const n = Math.max(1, Math.round(seg.dur * fps))
    for (let i = 0; i < n; i++) {
      const t = seg.start + i / fps
      g.fillStyle = "#000"
      g.fillRect(0, 0, W, H)
      g.fillStyle = "#888"
      g.font = `${L.text}px sans-serif`
      g.fillText(text, L.pad, H / 2)
      await add(t, 1 / fps)
    }
  }

  // ---- the engine (3D cut-ins and challenges) ----
  // replay seconds of the first tracked frame (the engine seeks from it)
  let firstAt = null
  const ensureFirst = () => {
    if (firstAt != null || !engine) return
    engine.twinSeek(0)
    firstAt = engine.twinState()?.at ?? 0
  }
  let loaded = null
  const load = async (seg) => {
    if (!prepare || loaded === seg.m) return
    await prepare(seg.m)
    loaded = seg.m
    firstAt = null
  }
  const capture = (seg, { speed = 1, cam = "broadcast", challenge = null, slow = 1 }) =>
    new Promise((resolve, reject) => {
      if (!engine?.twinState?.()) return resolve(blank(seg, "3D replay unavailable"))
      ensureFirst()
      engine.twinControl({ paused: true, cam, speed })
      engine.twinSeek(Math.max(0, seg.t0 - firstAt))
      if (challenge) engine.twinChallenge(challenge)
      const start = seg.t0 - firstAt
      let lastT = -1
      let pending = null
      let done = false
      const finish = (err) => {
        if (done) return
        done = true
        engine.onRendered(null)
        engine.twinControl({ paused: true })
        if (challenge) engine.twinChallenge(null)
        clearTimeout(guard)
        if (err) reject(err)
        else (pending || Promise.resolve()).then(() => resolve(), reject)
      }
      // (never hang: a stalled replay ends the segment)
      const guard = setTimeout(() => finish(), (seg.dur + 8) * 1000)
      engine.onRendered((cnv, tRel) => {
        if (done || tRel == null) return
        if (signal?.aborted) return finish(new Cancelled("Cancelled"))
        const local = (tRel - start) / slow
        if (local >= seg.dur) return finish()
        if (local < 0 || pending) return
        const t = seg.start + local
        if (t < lastT + 0.9 / fps) return
        lastT = t
        g.drawImage(cnv, 0, 0, cnv.width, cnv.height, ...Object.values(cover(cnv.width, cnv.height, W, H)))
        overlays(seg)
        if (challenge) drawCall(g, L, callText(seg.m.call), seg.m.call.close ? null : seg.m.call.verdict)
        fadeOver(seg, t)
        // (the encoder copies the canvas now; it may make us wait a frame)
        pending = add(t, 1 / fps).then(() => {
          pending = null
          progress(t, challenge ? "Hawk-Eye" : "3D replay")
        }, finish)
      })
      engine.twinControl({ paused: false, speed })
    })

  try {
    for (const seg of timeline.segments) {
      check()
      if (seg.kind === "title") await card(seg, { title, lines: [`${timeline.moments.length} highlights`, new Date(game?.created || Date.now()).toLocaleDateString()] })
      else if (seg.kind === "end") await card(seg, { title: "That's the game", lines: endLines(analysis) })
      else if (seg.kind === "footage") await footage(seg)
      else if (seg.kind === "cutin") {
        await load(seg)
        await capture(seg, { speed: 1, cam: "broadcast" })
      } else if (seg.kind === "challenge") {
        const slow = (seg.t1 - seg.t0) / seg.dur
        await load(seg)
        await capture(seg, { speed: slow, cam: "broadcast", slow, challenge: { x: seg.m.call.x, z: seg.m.call.z, verdict: seg.m.call.verdict } })
      }
    }
    // the soundtrack, in one piece
    onProgress({ t: total, total, pct: 99, what: "Music" })
    const audio = await renderSoundtrack(total, popTimes(timeline))
    check()
    await asrc.add(audio)
    vsrc.close()
    asrc.close()
    await output.finalize()
  } catch (error) {
    try {
      engine?.onRendered(null)
      await output.cancel()
    } catch {}
    throw error
  } finally {
    input?.dispose?.()
  }
  const blob = new Blob([target.buffer], { type: fmt.mime })
  onProgress({ t: total, total, pct: 100, what: "Done" })
  return { blob, mime: fmt.mime, ext: fmt.ext, duration: total, frames, ms: Math.round(performance.now() - started) }
}

// fill W x H from a source (cover: crop the edges), as drawImage's last four arguments
const cover = (w, h, W, H) => {
  const k = Math.max(W / w, H / h)
  const dw = w * k
  const dh = h * k
  return { x: (W - dw) / 2, y: (H - dh) / 2, w: dw, h: dh }
}

const endLines = (analysis) => {
  const rallies = analysis?.rallies || []
  const shots = rallies.reduce((n, r) => n + (r.hits?.length || 0), 0)
  const longest = rallies.reduce((n, r) => Math.max(n, r.hits?.length || 0), 0)
  let fastest = null
  for (const r of rallies) for (const h of r.hits || []) if (h.ball?.speed && (!fastest || h.ball.speed > fastest.speed)) fastest = { speed: h.ball.speed, player: h.player }
  return [`${rallies.length} rallies · ${shots} shots`, `Longest rally: ${longest} shots`, fastest ? `Fastest shot: ${Math.round(fastest.speed * MPH)} mph (${nameOf(analysis, fastest.player)})` : "", "Made with Pickleball 98"].filter(Boolean)
}
