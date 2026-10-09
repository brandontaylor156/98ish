// Roam's ONE door into 98ish (docs/open-world.md "Architecture"). Everything else in
// client/src/roam/ knows nothing about 98ish; a standalone app would replace this file with its
// own host (a figure maker, a sky, a store, a connection) and keep the rest.
//
// What 98ish lends the open world:
// - figures: Pickleball 98's athletes (your Locker Room look) walking with its animation;
// - the sky: My Park's Real Sky (true sun and weather for the town);
// - the network: the shared 98ish connection (server/roam), with the account's name;
// - voice: the spatial voice of My Park (utils/voice), same as in the park;
// - a per-person store (98ish's per-user localStorage) for the finds.

import { useEffect, useRef, useState } from "react"
import { createAnim, updateAnim } from "../components/applets/pickleball/anim.js"
import { liftPose } from "../components/applets/pickleball/park/lift.js"
import { createRealSky } from "../components/applets/pickleball/park/realsky.js"
import { dayLook, hourOf, realLook } from "../components/applets/pickleball/park/sky.js"
import { CLEAR, cachedWeather, fetchWeather } from "../components/applets/pickleball/park/weather.js"
import { loadHDRI } from "../components/applets/pickleball/park/environment.js"
import { surfaceUniform } from "../components/applets/pickleball/park/surfaces.js"
import { treeKit } from "../components/applets/pickleball/park/detail.js"
import { parkLook } from "../components/applets/pickleball/park/regulars.js"
import { useNet } from "../components/applets/network/NetContext"
import { createVoiceSession, voiceSupported } from "../utils/voice/session.js"
import { hashStr, rng } from "./sim/parked.js"

// the walking situation anim.js wants for someone just walking about (My Park's walkSituation)
const walkSituation = (s, key, t, look) => {
  const fx = Math.sin(s.yaw)
  const fz = Math.cos(s.yaw)
  return { x: s.x, z: s.z, vx: s.vx || 0, vz: s.vz || 0, facing: s.yaw, ball: { x: s.x + fx * 3, y: 1.1, z: s.z + fz * 3 }, holding: false, swing: null, prep: null, charging: false, between: true, atNet: false, goal: null, hand: look?.plays === "left" ? -1 : 1, twoHand: look?.backhand === "two", oppHit: null, want: { x: s.vx || 0, z: s.vz || 0 }, id: key, phase: "intro", phaseT: t % 20, point: 0, mate: null, across: null, receiving: false }
}

// engineCtx: Pickleball's api.worldContext() ({ makeFigure, quality, renderer })
export const makeHost98 = ({ engineCtx, me = {}, sky = { real: true, mode: "real" } } = {}) => {
  const quality = engineCtx?.quality || "medium"
  let n = 0
  const store = {
    get(key) {
      try {
        const v = localStorage.getItem(`98ish.${key}`)
        return v ? JSON.parse(v) : null
      } catch {
        return null
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(`98ish.${key}`, JSON.stringify(value))
      } catch {
        // (storage full or blocked)
      }
    },
  }
  let weather = null
  let wxAt = 0
  return {
    me,
    store,
    anisotropy: Math.min(4, engineCtx?.renderer?.capabilities?.getMaxAnisotropy?.() || 1),
    fetch: (...a) => globalThis.fetch(...a),
    // a real sky for car paint and glass to reflect: My Park's CC0 outdoor HDRI (Poly Haven
    // "Park Parking", normalized; docs/venue-realism.md round 3)
    environment: () => loadHDRI(false),
    // the venues' CC0 surface textures (stucco, concrete, roof tile, grass, asphalt) as shared
    // uniforms, and the venues' trees (docs/venue-realism.md); none on Low (the plain look)
    surface: quality === "low" ? null : (kind) => surfaceUniform(kind, engineCtx?.renderer),
    trees: quality === "low" ? null : () => treeKit(),
    // a person: you, a friend, or (lite: true) someone walking by, animated more cheaply (no
    // motion matching: the walk cycle only)
    figure(look, { lite = false } = {}) {
      if (!engineCtx?.makeFigure) return null
      const fig = engineCtx.makeFigure(look || {}, { shadows: false })
      const key = `roam${++n}`
      let anim = null
      let t = 0
      let at = null
      return {
        group: fig.group,
        update(s, dt) {
          const step = Math.min(0.1, dt)
          t += step
          // (a jump: out of a car, or a friend's first position: the animation starts afresh)
          if (at && Math.hypot(at.x - s.x, at.z - s.z) > 4) anim = null
          at = { x: s.x, z: s.z }
          if (!anim) anim = createAnim(s.x, s.z, s.yaw)
          anim.useMM = !!fig.skinned && !lite
          anim.mmEvery = 0.2
          fig.apply(liftPose(updateAnim(anim, walkSituation(s, key, t, look), step), s.y || 0), step)
        },
        dispose: () => {
          fig.group.removeFromParent()
          fig.dispose()
        },
      }
    },
    npcLook: (id) => {
      const r = rng(hashStr(`npc:${id}`))
      return parkLook(r, r() < 0.5 ? "m" : "f")
    },
    sky: {
      create: ({ radius, phone }) => (quality === "low" ? null : createRealSky({ radius, quality, phone })),
      // the look now at a place: Real Sky's true sun and the day's weather (Open-Meteo, cached),
      // or the classic hour-based look on Low / with Real Sky off
      look: (place, { hour = null } = {}) => {
        const date = new Date()
        if (hour !== null) date.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0)
        if (!sky.real || quality === "low") return dayLook(hour ?? hourOf())
        if (Date.now() - wxAt > 20 * 60_000) {
          wxAt = Date.now()
          fetchWeather(place).then((w) => (weather = w)).catch(() => {})
        }
        return realLook({ date, lat: place.lat, lon: place.lon, weather: weather || cachedWeather(place) || CLEAR })
      },
    },
  }
}

// Roam online over 98ish's shared connection (server/roam): joins the town while you're in it
// and passes everything to the world (setNet / netJoined / netEvent). -> { joined, n, people, error }
const EVENTS = ["roam:m", "roam:person", "roam:gone", "roam:car", "roam:ride"]
export const useRoamNet = ({ world, active, look }) => {
  const net = useNet()
  const socket = net?.socket
  const online = net?.status === "online"
  const lookRef = useRef(look)
  lookRef.current = look
  const [state, setState] = useState({ joined: false, n: null, people: 0, error: null })
  useEffect(() => {
    if (!active || !world || !socket || !online) return
    let live = true
    const handlers = Object.fromEntries(EVENTS.map((ev) => [ev, (d) => world.netEvent(ev, d)]))
    for (const [ev, fn] of Object.entries(handlers)) socket.on(ev, fn)
    world.setNet({
      request: (event, payload) => net.request(event, payload),
      volatile: (event, payload) => socket.connected && socket.volatile.emit(event, payload),
    })
    net.request("roam:join", { town: world.town.id, look: lookRef.current }).then((r) => {
      if (!live) return
      if (r?.ok) {
        world.netJoined(r)
        setState({ joined: true, n: r.n, people: (r.people?.length || 0) + 1, error: null })
      } else {
        world.setNet(null)
        setState({ joined: false, n: null, people: 0, error: r?.error || null })
      }
    })
    return () => {
      live = false
      for (const [ev, fn] of Object.entries(handlers)) socket.off(ev, fn)
      if (socket.connected) socket.emit("roam:leave", {}, () => {})
      world.setNet(null)
      setState({ joined: false, n: null, people: 0, error: null })
    }
  }, [active, world, socket, online])
  return state
}

// spatial voice in the town (the same voice as My Park; signaling through server/roam)
export const useRoamVoice = ({ world, joined, n }) => {
  const net = useNet()
  const socket = net?.socket
  const [state, setState] = useState({ status: "off", peers: {}, on: [] })
  const sessionRef = useRef(null)
  useEffect(() => {
    if (!world || !joined || !socket) return
    const space = {
      get me() {
        return world.voicePlace().me
      },
      mode: "world",
      join: (on) => net.request("roam:vc", { on }),
      send: (to, kind, data) => net.request("roam:sig", { to, kind, data }),
      listen: (onList, onSignal) => {
        const list = (d) => onList(d?.on || [])
        const sig = (d) => d && onSignal(d.from, d.kind, d.data)
        socket.on("roam:vc", list)
        socket.on("roam:sig", sig)
        return () => {
          socket.off("roam:vc", list)
          socket.off("roam:sig", sig)
        }
      },
      place: () => world.voicePlace(),
    }
    const session = createVoiceSession({ space })
    sessionRef.current = session
    const off = session.subscribe((s) => setState(s))
    return () => {
      off()
      session.stop()
      sessionRef.current = null
      setState({ status: "off", peers: {}, on: [] })
    }
  }, [world, joined, n, socket])
  const toggle = () => {
    const s = sessionRef.current
    if (!s) return
    if (s.state.status === "on" || s.state.status === "starting" || s.state.status === "paused") s.stop()
    else s.start()
  }
  return { supported: voiceSupported() && !!joined, state, toggle, session: sessionRef.current }
}
