// My Park leisure inside the park's world (world.js makes one; three.js for the water): the
// places (spots.js), the water on the pools and in the hot tub (water.js), what people hold
// (held.js, menu.js), people online swimming or soaking, and the vending machine's easter egg:
// Vince, a regular who hangs about by the drinks machine fanning himself. Give him a cold drink
// from it and he hands you the keys to his car (the Sundowner GT, parked by the Paseo Club in
// Explore Valencia: client/src/roam/).
//
// The world asks: action() (the context button's offer here), doAction(a), step(dt),
// remoteAct(body, act, sample), remoteHeld(body, item), remoteFx(body, emote), and holds the
// water for the swim and tub runs (swimRun.js, tubRun.js).

import { ACTS } from "../interp.js"
import { setMood } from "../../anim.js"
import { parkLook } from "../regulars.js"
import { leisureAt, leisureSpots } from "./spots.js"
import { itemById, itemName, verbFor } from "./menu.js"
import { swimPose, tubPose } from "./poses.js"

// the two acts the leisure runs send in park:pos (interp.js ACTS; 8 is "up a floor")
export const LEISURE_ACTS = { swim: ACTS.swim, tub: ACTS.tub }

export const VINCE = { name: "Vince" }
// what Vince says: before (hot, thirsty, a hint at the car), when you walk up with a cold one,
// and after
export const VINCE_LINES = {
  hot: ["Whew. Hot one today.", "Man, I'd trade anything for something cold.", "Left my water bottle in the car. Again.", "Is it just me or is it boiling in here?", "So. Thirsty."],
  see: (item) => `Is that a cold ${item}? Oh, that looks good.`,
  thanks: "For me? You're a lifesaver!",
  keys: "Here, you've earned these. My car's keys: the Sundowner's parked by the Paseo Club in Valencia. Take her for a spin.",
  again: ["Thanks again for the drink!", "Enjoying the Sundowner?", "Still the best drink I ever had."],
}

const mulberry = (a) => () => {
  a |= 0
  a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// where Vince stands: beside the machine, on open ground, facing out into the room
export const vinceHome = (spot, blocked = () => false) => {
  const m = spot.machine || spot
  const fx = Math.sin(m.a || 0)
  const fz = Math.cos(m.a || 0)
  // (out in front of the machine, a step to one side or the other)
  for (const side of [1, -1, 1.6, -1.6]) {
    for (const out of [2.4, 2.0, 3.0]) {
      const x = m.x + fx * out - fz * side * 1.6
      const z = m.z + fz * out + fx * side * 1.6
      if (!blocked(x, z, 0.35)) return { x, z, yaw: Math.atan2(fx, fz) }
    }
  }
  return { x: spot.x - fz * 1.4, z: spot.z + fx * 1.4, yaw: Math.atan2(fx, fz) }
}

export const createLeisureSide = ({ layout, scene, quality = "medium", phone = false, clock, me, meBody, makeBody, speak, net, onEvent, blocked = () => false, found = () => ({}), people = () => [] }) => {
  const spots = layout?.spec?.scene ? leisureSpots(layout) : []
  const pools = spots.filter((s) => s.kind === "swim")
  const tubs = spots.filter((s) => s.kind === "tub")
  let water = null
  // (the water only where there's a pool or a tub; made on first use: three.js import is async)
  const waterReady = pools.length || tubs.length ? import("./water.js").then(({ createWater }) => (water = createWater(scene, { pools, tubs, quality }))) : Promise.resolve(null)
  const lightOf = (look) => ({ light: Math.max(0.55, Math.min(1, look?.ground ?? 1)), sunDir: look?.sun?.dir || null, sky: look?.sky?.[1] ?? null })

  // ---- Vince, by the drinks machine (only where there's a sourced one) ----
  const machine = spots.find((s) => s.kind === "vending" && s.egg) || null
  let vince = null
  if (machine) {
    const home = vinceHome(machine, blocked)
    const look = parkLook(mulberry(0x51ce), "m")
    look.hat = "cap"
    const b = makeBody("npc:vince", look, VINCE.name, { npc: true })
    b.x = home.x
    b.z = home.z
    b.y = machine.y || 0
    b.yaw = home.yaw
    vince = { b, home, fanAt: -9, saidAt: -99, hintAt: -99, got: false, lines: 0 }
  }
  const myHeld = () => meBody.held || null
  const keepMood = (b, kind) => {
    b.mood = { kind, variant: 0, at: clock(), keep: true }
    if (b.anim) setMood(b.anim, kind, 0, true)
  }
  const dropMood = (b) => {
    if (b.mood?.keep && (b.mood.kind === "carry" || b.mood.kind === "sip")) b.mood = null
    if (b.anim?.mood?.kind === "carry" || b.anim?.mood?.kind === "sip") b.anim.mood = null
  }

  // ---- holding something ----
  const setHeldOn = (b, id) => {
    b.held = id || null
    b.sipUntil = 0
    if (b.held) keepMood(b, "carry")
    else dropMood(b)
  }
  const sipOn = (b) => {
    if (!b.held) return
    keepMood(b, "sip")
    b.sipUntil = clock() + 1.7
  }

  const api = {
    spots,
    get water() {
      return water
    },
    waterReady,
    get vince() {
      return vince ? { x: vince.b.x, z: vince.b.z, got: vince.got, name: VINCE.name } : null
    },
    // (his body, for the tests)
    get vinceBody() {
      return vince?.b || null
    },
    machine,
    // a hot tub seat someone online is on
    seatTaken(seat) {
      for (const b of people()) if (b.leisureAct === "tub" && Math.hypot(b.x - seat.x, b.z - seat.z) < 0.45) return true
      return false
    },
    // ---- you ----
    setHeld(id) {
      setHeldOn(meBody, itemById(id) ? id : null)
      net()?.emit("park:hold", { item: meBody.held })
    },
    sip() {
      if (!meBody.held) return
      sipOn(meBody)
      net()?.emit("park:fx", { emote: "sip" })
    },
    get held() {
      return myHeld()
    },
    // ---- the context button ----
    action() {
      const w = me().walker
      // (Vince: you walk up with a cold one from the machine)
      const h = myHeld()
      if (vince && !vince.got && h && itemById(h)?.machine && Math.hypot(vince.b.x - w.x, vince.b.z - w.z) < 2.8) return { kind: "leisure", what: "give", label: `Give ${VINCE.name} your ${itemName(h)}`, detail: "He looks thirsty" }
      const at = leisureAt(spots, w.x, w.z, w.y || 0)
      if (!at) return null
      const s = at.spot
      return { kind: "leisure", what: s.kind, spot: s.id, label: s.label, detail: s.detail, d: at.d }
    },
    doAction(a, pal = null) {
      if (a.what === "give") return api.give()
      const spot = spots.find((s) => s.id === a.spot)
      if (spot) onEvent({ type: "leisure", spot, pal })
      return true
    },
    // you hand Vince the drink: he drinks it and hands you his keys
    give() {
      if (!vince || vince.got || !myHeld()) return false
      const item = myHeld()
      api.setHeld(null)
      vince.got = true
      setHeldOn(vince.b, item)
      vince.b.yaw = Math.atan2(me().walker.x - vince.b.x, me().walker.z - vince.b.z)
      speak(vince.b, VINCE_LINES.thanks)
      vince.thanksAt = clock()
      const already = !!found()?.keys
      vince.keysAt = clock() + 2.2
      vince.keysAlready = already
      onEvent({ type: "leisureGive", item, already })
      return true
    },
    // ---- people online ----
    remoteAct(b, act) {
      const kind = act === LEISURE_ACTS.swim ? "swim" : act === LEISURE_ACTS.tub ? "tub" : null
      if (kind === b.leisureAct) return
      b.leisureAct = kind
      if (!kind) {
        if (b.leisureDrive) b.drive = null
        b.leisureDrive = false
        return
      }
      b.leisureDrive = true
      if (kind === "swim") {
        b.drive = () => ({ pose: swimPose({ x: b.x, z: b.z, yaw: b.yaw, t: clock() + (b.num || 0), style: (b.speed || 0) > 0.25 ? "free" : "tread", speed: Math.min(1, (b.speed || 0) / 1.4) }), gear: "none", key: "swim" })
      } else {
        const tub = tubs.find((t) => Math.hypot(t.x - b.x, t.z - b.z) < t.R + 0.5)
        b.drive = () => ({ pose: tubPose({ x: b.x, y: 0.02, z: b.z, yaw: b.yaw }, tub ? { x: tub.x, y: 0.8, z: tub.z } : { x: b.x, y: 1, z: b.z + 1 }, { rim: tub?.rim || 0.5, t: clock() }), gear: "none", key: "tub" })
      }
    },
    remoteHeld(b, item) {
      const id = itemById(item) ? item : null
      if ((b.held || null) !== id) setHeldOn(b, id)
    },
    remoteFx(b, emote) {
      if (emote === "sip") sipOn(b)
      else if (emote === "splash") water?.splash(b.x, b.z, 1.2)
    },
    // ---- every frame ----
    step(dt, look) {
      const t = clock()
      if (water) water.step(dt, lightOf(look))
      // (a sip lasts a moment, then the item's carried again)
      for (const b of [meBody, vince?.b]) if (b?.held && b.sipUntil && t > b.sipUntil) {
        b.sipUntil = 0
        keepMood(b, "carry")
      }
      if (vince) stepVince(dt, t)
    },
    // people swimming online leave rings behind them
    rippleFor(b, dt) {
      if (!water || b.leisureAct !== "swim") return
      b.rippleT = (b.rippleT || 0) - dt
      if (b.rippleT > 0) return
      b.rippleT = (b.speed || 0) > 0.25 ? 0.8 : 1.6
      water.ripple(b.x, b.z, (b.speed || 0) > 0.25 ? 0.35 : 0.18)
    },
    dispose() {
      water?.dispose()
      water = null
    },
  }

  const stepVince = (dt, t) => {
    const v = vince
    const b = v.b
    const w = me().walker
    const d = Math.hypot(b.x - w.x, b.z - w.z)
    b.speed = 0
    b.vx = 0
    b.vz = 0
    // (he turns to you when you're close, else he looks out into the room)
    const want = d < 8 ? Math.atan2(w.x - b.x, w.z - b.z) : v.home.yaw
    const dy = Math.atan2(Math.sin(want - b.yaw), Math.cos(want - b.yaw))
    b.yaw += dy * Math.min(1, dt * 3)
    if (!v.got) {
      // hot and bothered: fanning himself every few seconds
      if (t - v.fanAt > 4.5) {
        v.fanAt = t
        b.mood = { kind: "fan", variant: 0, at: t }
      }
      const h = myHeld()
      if (d < 6 && h && itemById(h)?.machine && t - v.hintAt > 12) {
        v.hintAt = t
        speak(b, VINCE_LINES.see(itemName(h)))
      } else if (d < 7 && t - v.saidAt > 22) {
        v.saidAt = t
        speak(b, VINCE_LINES.hot[v.lines++ % VINCE_LINES.hot.length])
      }
      return
    }
    // after: he drinks it, and hands over the keys
    if (v.keysAt && t > v.keysAt) {
      v.keysAt = 0
      if (!v.keysAlready) {
        speak(b, VINCE_LINES.keys)
        onEvent({ type: "leisureKeys", from: VINCE.name, venue: layout.id || "" })
      } else speak(b, VINCE_LINES.again[0])
    }
    if (b.held && !b.sipUntil && t - (v.sipAt || 0) > 5) {
      v.sipAt = t
      sipOn(b)
    }
    if (d < 4 && t - v.saidAt > 30 && !v.keysAt) {
      v.saidAt = t
      speak(b, VINCE_LINES.again[v.lines++ % VINCE_LINES.again.length])
    }
  }
  void phone
  void verbFor
  return api
}
