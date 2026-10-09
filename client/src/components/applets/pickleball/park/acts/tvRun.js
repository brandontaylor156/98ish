// My Park > Watch TV, at a venue's TV (three.js): you sit on a seat that faces it (or stand in
// front of it), the camera looks at the set over your shoulder, and the set itself shows what
// you picked: your videos play on its screen (a video texture), a friend's live game opens
// Live Broadcast's watch screen, YouTube together opens Watch Together. Idle, a test card.
//
//   createTvRun({ spot, channel, live, pal, signedOn })

import * as THREE from "three"
import { channelsFor, listFor, seatFor } from "./tv.js"
import { mediaBlob } from "../../../../../utils/fs"

const testCard = (title) => {
  const c = document.createElement("canvas")
  c.width = 256
  c.height = 144
  const g = c.getContext("2d")
  const bars = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"]
  bars.forEach((b, i) => {
    g.fillStyle = b
    g.fillRect((i * 256) / 7, 0, 256 / 7 + 1, 100)
  })
  g.fillStyle = "#101418"
  g.fillRect(0, 100, 256, 44)
  g.fillStyle = "#fff"
  g.font = "bold 18px sans-serif"
  g.textAlign = "center"
  g.fillText("98ish TV", 128, 122)
  g.font = "12px sans-serif"
  g.fillText(title, 128, 138)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export const createTvRun = ({ spot, channel = "live", live = [], pal = null, signedOn = false, venueName = (id) => id } = {}) => {
  const tv = spot.tv
  const n = { x: Math.sin(tv.a), z: Math.cos(tv.a) }
  let api = null
  let screen = null
  let tex = null
  let video = null
  let url = null
  let seat = null
  let videos = []
  let ch = channel
  let playing = null
  let note = null
  let listeners = new Set()
  let lastHud = ""
  let hudT = 0
  const say = (text, sec = 2.4) => {
    note = { text, until: performance.now() + sec * 1000 }
    emitHud(true)
  }
  const setCard = (title) => {
    tex?.dispose()
    tex = testCard(title)
    if (screen) {
      screen.material.map = tex
      screen.material.needsUpdate = true
    }
  }
  const stopVideo = () => {
    if (video) {
      video.pause()
      video.removeAttribute("src")
      try {
        video.load()
      } catch {}
    }
    if (url) URL.revokeObjectURL(url)
    url = null
    video = null
    playing = null
  }
  const loadVideos = async () => {
    try {
      const { listVideos } = await import("../../../mediaPlayer/videoStore")
      videos = listVideos()
    } catch {
      videos = []
    }
    emitHud(true)
  }

  const hud = () => {
    const l = listFor(ch, { live, videos, venue: api?.venue, venueName, pal, signedOn })
    return {
      kind: "tv",
      court: spot.name,
      title: playing ? playing.name : ch === "live" ? "Live courts" : ch === "videos" ? "My videos" : "Watch Together",
      channel: ch,
      channels: channelsFor({ pal, signedOn }),
      msg: l.msg,
      list: l.list.map(({ video: _v, ...it }) => it),
      playing: playing ? { name: playing.name, paused: !!video?.paused } : null,
      note: note && performance.now() < note.until ? note.text : null,
      seated: !!seat,
    }
  }
  const emitHud = (force = false) => {
    const h = hud()
    const k = JSON.stringify(h)
    if (!force && k === lastHud) return
    lastHud = k
    for (const fn of listeners) fn(h)
  }

  const run = {
    kind: "tv",
    spot,
    start(a) {
      api = a
      // the screen: over the set's own, facing out of it
      const geo = new THREE.PlaneGeometry(tv.w, tv.h)
      screen = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }))
      screen.position.set(tv.x + n.x * 0.045, tv.y, tv.z + n.z * 0.045)
      screen.rotation.y = tv.a
      setCard(ch === "live" ? "Live courts" : "My videos")
      api.scene.add(screen)
      // a seat facing it, or stand
      seat = seatFor(tv, spot, api.seats(), (id) => api.seatTaken(id))
      const lookAt = { x: tv.x, y: tv.y, z: tv.z }
      api.meBody.drive = () => {
        if (seat) return { seat: { x: seat.x, y: seat.y, z: seat.z, yaw: seat.yaw }, look: lookAt, gear: "none" }
        const yaw = Math.atan2(tv.x - spot.x, tv.z - spot.z)
        return { sit: { x: spot.x, z: spot.z, vx: 0, vz: 0, facing: yaw, ball: { x: tv.x, y: tv.y, z: tv.z }, holding: false, swing: null, prep: null, high: null, charging: false, between: true, atNet: false, depth: 6, goal: null, hand: 1, twoHand: false, person: true, oppHit: null, want: { x: 0, z: 0 }, id: "tv", phase: "intro", phaseT: 0, point: 0, mate: null, across: null, receiving: false }, mood: { kind: "watch" }, gear: "none", key: "tv", y: spot.y || 0 }
      }
      loadVideos()
      emitHud(true)
    },
    step(dt) {
      hudT += dt
      if (hudT > 0.3) {
        hudT = 0
        emitHud()
      }
    },
    me() {
      if (seat) return { x: seat.x, z: seat.z, y: spot.y || 0, yaw: seat.yaw, vx: 0, vz: 0 }
      return { x: spot.x, z: spot.z, y: spot.y || 0, yaw: Math.atan2(tv.x - spot.x, tv.z - spot.z), vx: 0, vz: 0 }
    },
    // looking at the set from a few metres out, over your shoulder
    shot(dt, { portrait = true } = {}) {
      const side = { x: n.z, z: -n.x }
      const d = portrait ? 4.0 : 3.0
      const front = { x: tv.x + n.x * 0.3, z: tv.z + n.z * 0.3 }
      let cam = { x: tv.x + n.x * d + side.x * 0.8, z: tv.z + n.z * d + side.z * 0.8 }
      const t = api?.segHit?.(front, cam, 1.6)
      if (t !== null && t !== undefined) cam = { x: front.x + (cam.x - front.x) * Math.max(0.3, t - 0.08), z: front.z + (cam.z - front.z) * Math.max(0.3, t - 0.08) }
      const roof = spot.room ? (spot.y || 0) + 3.2 : 9
      // (the set in the upper part of the picture: the remote takes the bottom)
      return { cam: { x: cam.x, y: Math.min(roof - 0.3, tv.y + 0.3), z: cam.z }, look: { x: tv.x, y: tv.y - (portrait ? 0.75 : 0.3), z: tv.z }, fov: portrait ? 56 : 46, ease: 3 }
    },
    focus() {
      return { x: spot.x, y: spot.y || 0, z: spot.z }
    },
    setStick() {},
    key() {
      return false
    },
    // the channels; a video to play on the set
    channel(id) {
      ch = id
      if (id !== "videos") {
        stopVideo()
        setCard(id === "live" ? "Live courts" : "Watch Together")
      }
      emitHud(true)
    },
    async play(item) {
      const v = videos.find((x) => (x.key || x.name) === item.id)
      if (!v) return
      stopVideo()
      try {
        const blob = await mediaBlob(v.file)
        if (!blob) throw new Error("empty")
        url = URL.createObjectURL(blob)
        video = document.createElement("video")
        video.playsInline = true
        video.setAttribute("playsinline", "")
        video.src = url
        video.loop = false
        await video.play()
        tex?.dispose()
        tex = new THREE.VideoTexture(video)
        tex.colorSpace = THREE.SRGBColorSpace
        screen.material.map = tex
        screen.material.needsUpdate = true
        playing = { name: item.name }
        video.onended = () => {
          stopVideo()
          setCard("My videos")
          emitHud(true)
        }
      } catch {
        stopVideo()
        say("That video didn't play here. Try it in Media Player.")
      }
      emitHud(true)
    },
    pause() {
      if (!video) return
      if (video.paused) video.play().catch(() => {})
      else video.pause()
      emitHud(true)
    },
    stopVideo() {
      stopVideo()
      setCard("My videos")
      emitHud(true)
    },
    setLive(list) {
      live = list || []
      emitHud(true)
    },
    subscribe(fn) {
      listeners.add(fn)
      fn(hud())
      return () => listeners.delete(fn)
    },
    get state() {
      return { channel: ch, playing, seat: seat?.id || null, videos: videos.length }
    },
    stop() {
      stopVideo()
      if (screen) {
        api.scene.remove(screen)
        screen.geometry.dispose()
        screen.material.dispose()
      }
      tex?.dispose()
      listeners.clear()
    },
    exit() {
      return { x: spot.x, z: spot.z, y: spot.y || 0, yaw: Math.atan2(tv.x - spot.x, tv.z - spot.z) }
    },
    result() {
      return null
    },
  }
  return run
}
