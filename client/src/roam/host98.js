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
import { createAnim, updateAnim, setMood, seatedPose } from "../components/applets/pickleball/anim.js"
import { gearFig } from "../components/applets/pickleball/park/acts/gear.js"
import { holdFig } from "../components/applets/pickleball/park/leisure/held.js"
import { ITEMS as LEISURE_ITEMS } from "../components/applets/pickleball/park/leisure/menu.js"
import * as togetherRules from "../components/applets/pickleball/park/together.js"
import { createLife98 } from "../utils/roamLife.js"
import { liftPose } from "../components/applets/pickleball/park/lift.js"
import { createRealSky } from "../components/applets/pickleball/park/realsky.js"
import { dayLook, hourOf, realLook } from "../components/applets/pickleball/park/sky.js"
import { CLEAR, cachedWeather, fetchWeather } from "../components/applets/pickleball/park/weather.js"
import { loadHDRI } from "../components/applets/pickleball/park/environment.js"
import { surfaceUniform } from "../components/applets/pickleball/park/surfaces.js"
import { treeKit } from "../components/applets/pickleball/park/detail.js"
import { createChillMusic } from "../components/applets/pickleball/park/chillmusic.js"
import { createBus } from "../utils/audio.js"

// the car's horn: two detuned reeds (about 400 and 500 Hz, a little growl), held while pressed;
// under the taskbar volume (utils/audio.js)
const hornBus = createBus({ gain: 0.22, threshold: -18 })
const createHorn = () => {
  let voice = null
  return (on) => {
    const b = hornBus()
    const ctx = b?.ctx
    if (!ctx) return
    if (on && !voice) {
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, ctx.currentTime)
      g.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.02)
      const f = ctx.createBiquadFilter()
      f.type = "lowpass"
      f.frequency.value = 2200
      f.connect(g).connect(b.out)
      const oscs = [405, 507, 812].map((hz, i) => {
        const o = ctx.createOscillator()
        o.type = i === 2 ? "triangle" : "sawtooth"
        o.frequency.value = hz
        const og = ctx.createGain()
        og.gain.value = i === 2 ? 0.15 : 0.5
        o.connect(og).connect(f)
        o.start()
        return o
      })
      voice = { g, oscs }
    } else if (!on && voice) {
      const v = voice
      voice = null
      v.g.gain.setTargetAtTime(0, ctx.currentTime, 0.03)
      setTimeout(() => v.oscs.forEach((o) => o.stop()), 200)
    }
  }
}
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

const NO_PADDLE = new Set(["hug", "hold", "dance", "twirl", "thumbs", "point"])

// engineCtx: Pickleball's api.worldContext() ({ makeFigure, quality, renderer })
export const makeHost98 = ({ engineCtx, me = {}, sky = { real: true, mode: "real" }, aim = null, phone = false, towns = null, travel = null, equip = null } = {}) => {
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
    // what 98ish has unlocked in the open world: { sundowner: at } once Vince in My Park handed
    // you his car keys (park/leisure/useLeisure.jsx writes it; the account keeps it too)
    unlocks: () => store.get("roam.unlocks") || {},
    // My Park's rules for doing things together (park/together.js: where two stand for a hug,
    // walking hand in hand, the consent rules' breaking away); roam/life/social.js uses them
    together: togetherRules,
    // what a person can hold to eat or drink (My Park's leisure items: name, food or drink, sips)
    heldItems: LEISURE_ITEMS,
    // your Home/Work places, the Bag, gifts and the chip bank (utils/roamLife.js: on your 98
    // Messenger account, or this device when signed off), Pickleball 98's Locker Room, and going
    // to another town (the page: travel(townId, at))
    life: createLife98({ travel, equip }),
    // the other towns (the train between them): [{ id, name, station }]
    towns: () => (towns ? Object.values(towns).map((t) => ({ id: t.id, name: t.name, station: t.station || null })) : []),
    // the in-game phone's Messages: 98 Messenger (your buddies, and a quick message to one)
    messages: aim
      ? (() => {
          const A = () => (typeof aim === "function" ? aim() : aim) || {}
          return {
          me: () => A().me?.screenName || "",
          // buddies, online first -> [{ name, online }]
          buddies: () => {
            const seen = new Set()
            const out = []
            const meKey = (A().me?.screenName || "").toLowerCase()
            for (const g of A().me?.groups || [])
              for (const b of g.buddies || []) {
                const k = String(b).toLowerCase().replace(/\s+/g, "")
                if (seen.has(k) || k === meKey.replace(/\s+/g, "") || k === "smarterchild") continue
                seen.add(k)
                out.push({ name: b, online: !!A().presence?.[k]?.online })
              }
            return out.sort((a, b) => b.online - a.online || a.name.localeCompare(b.name))
          },
          send: async (name, text) => {
            try {
              const r = await A().sendIm(name, text)
              return r?.ok === false ? { ok: false, error: r.error || "Not sent." } : { ok: true }
            } catch (e) {
              return { ok: false, error: e?.message || "Not sent." }
            }
          },
          }
        })()
      : null,
    // the in-game phone's Camera: what the world shows now (or a selfie: the world's own lens turned
    // round to face you) saved to My Pictures (Photos)
    camera: engineCtx?.renderer
      ? {
          shoot: async (world, { selfie = false, place = "" } = {}) => {
            const r = engineCtx.renderer
            let url = null
            try {
              world.photoLens?.(selfie)
              world.frame?.(0)
              r.render(world.scene, world.camera)
              url = r.domElement.toDataURL("image/jpeg", 0.9)
            } finally {
              world.photoLens?.(null)
            }
            if (!url || url.length < 1000) return { ok: false, error: "The picture didn't come out." }
            const lib = await import("../components/applets/photos/library.js")
            const now = new Date()
            const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}.${String(now.getMinutes()).padStart(2, "0")}.${String(now.getSeconds()).padStart(2, "0")}`
            const name = `${selfie ? "Selfie" : "Photo"} in ${place || "town"} ${stamp}.jpg`.replace(/[\\/:*?"<>|]/g, "")
            const res = await lib.savePicture(lib.picturesFolder(), name, url)
            return res.ok ? { ok: true, name, url } : { ok: false, error: res.error || "Couldn't save it." }
          },
        }
      : null,
    anisotropy: Math.min(4, engineCtx?.renderer?.capabilities?.getMaxAnisotropy?.() || 1),
    fetch: (...a) => globalThis.fetch(...a),
    // a real sky for car paint and glass to reflect: My Park's CC0 outdoor HDRI (Poly Haven
    // "Park Parking", normalized; docs/venue-realism.md round 3)
    environment: () => loadHDRI(false),
    // the venues' CC0 surface textures (stucco, concrete, roof tile, grass, asphalt) as shared
    // uniforms, and the venues' trees (docs/venue-realism.md); none on Low (the plain look)
    surface: quality === "low" ? null : (kind) => surfaceUniform(kind, engineCtx?.renderer),
    trees: quality === "low" ? null : () => treeKit(),
    // the car's horn (held) and its radio: My Park's own lo-fi loop (park/chillmusic.js, made
    // with Web Audio, nothing downloaded)
    audio: (() => {
      let music = null
      const horn = createHorn()
      return {
        horn,
        radio(on) {
          if (on) (music ||= createChillMusic()).start()
          else music?.stop()
        },
      }
    })(),
    // a person: you, a friend, or (lite: true) someone walking by, animated more cheaply (no
    // motion matching: the walk cycle only)
    figure(look, { lite = false } = {}) {
      if (!engineCtx?.makeFigure) return null
      const fig = engineCtx.makeFigure(look || {}, { shadows: false })
      const key = `roam${++n}`
      let anim = null
      let t = 0
      let at = null
      // (Explore's emotes, doing things together, sitting and eating: roam/life/social.js)
      let mood = null // { kind, variant, keep, at }
      let seat = null // { x, y, z, yaw, ground? }
      let held = null
      const tmpLook = { x: 0, y: 1.2, z: 0 }
      return {
        group: fig.group,
        // a mood from anim.js (wave, thumbs, point, cheer, hug, highfive, twirl, dance, hold,
        // carry, sip...) or null; keep: until taken away
        setMood(kind, variant = 0, keep = false) {
          mood = kind ? { kind, variant, keep, fresh: true } : null
          if (!kind && anim) anim.mood = null
          // (the paddle goes away for a hug, holding hands, a dance, a twirl, a thumbs up, pointing;
          // a high five is a paddle tap and a wave can keep it)
          if (!held) gearFig(fig, NO_PADDLE.has(kind) ? "none" : "paddle")
        },
        get mood() {
          return anim?.mood ? anim.mood.kind : null
        },
        // sitting: on a chair or a couch (y: the seat's height), or on the ground (ground: true)
        setSeat(s) {
          seat = s || null
        },
        // something to eat or drink in the hand (My Park's held items), or null; the paddle
        // goes away while you hold it
        hold(id) {
          held = id || null
          gearFig(fig, held ? "none" : "paddle")
          holdFig(fig, held)
        },
        update(s, dt) {
          const step = Math.min(0.1, dt)
          t += step
          // (a jump: out of a car, or a friend's first position: the animation starts afresh)
          if (at && Math.hypot(at.x - s.x, at.z - s.z) > 4) anim = null
          at = { x: s.x, z: s.z }
          if (!anim) anim = createAnim(s.x, s.z, s.yaw)
          if (seat) {
            const fr = { x: Math.sin(seat.yaw), z: Math.cos(seat.yaw) }
            tmpLook.x = seat.x + fr.x * 3
            tmpLook.z = seat.z + fr.z * 3
            tmpLook.y = (seat.y || 0) + 1.1
            const y0 = s.y || 0
            fig.apply(seatedPose({ x: seat.x, y: y0 + (seat.ground ? 0.12 : seat.h ?? 0.45), z: seat.z, yaw: seat.yaw }, tmpLook, null, seat.ground ? { drop: 0.1, ahead: 0.62 } : { drop: (seat.h ?? 0.45) + 0.02, ahead: 0.42 }), step)
            return
          }
          if (mood?.fresh) {
            setMood(anim, mood.kind, mood.variant, mood.keep)
            mood.fresh = false
          }
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
const EVENTS = ["roam:m", "roam:person", "roam:gone", "roam:car", "roam:ride", "roam:seat", "roam:hop",
  // (going inside, emotes, things put down, doing things together: server/roam/inside.js and
  // park/together.js; gifts and shared places: server/roam/life.js over the same connection)
  "roam:in", "roam:invite", "roam:say", "roam:emote", "roam:placed", "roam:unplaced", "roam:ask", "roam:answer", "roam:link", "roam:tg", "roam:tgend", "roamlife:gift", "roamlife:shared", "roamlife:changed"]
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
