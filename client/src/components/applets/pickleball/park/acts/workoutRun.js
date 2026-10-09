// My Park > Work out, in a venue's gym (three.js + a little DOM): the rhythm workout
// (workout.js) with you doing the reps on the gym floor (anim.js moods, the treadmill for the
// sprints), the beat, the notes sliding to the ring, Perfect / Good / Miss, a streak.
//
//   createWorkoutRun({ spot, mode: "daily" | "quick" | "together", move, link, mate, camera })
//
// camera: "Real workout": the front camera counts your real reps (MediaPipe pose, loaded the
// first time, on the phone only; no picture leaves it); a counted rep is a hit, with more
// room on the timing than a tap.
// Together (link): the same workout, side by side, started together; each screen judges its
// own reps and sends its score once a second.

import { LEAD_S, MOVES, createWorkout, quickPlan, repCounter, todaysPlan } from "./workout.js"
import { sfx } from "./sound.js"

const TRAVEL = 1.6 // seconds a note slides before its ring
const SCORE_MS = 1000

// MediaPipe's web library sends Google a usage ping (odml.pa.googleapis.com/v1/log: no
// pictures, but still something leaving the phone). Real reps promise nothing leaves it, so
// those pings are dropped on this page once the camera's been turned on.
const TELEMETRY = /(^|\/\/)odml\.pa\.googleapis\.com\//
let telemetryBlocked = false
export const blockTelemetry = () => {
  if (telemetryBlocked || typeof window === "undefined") return
  telemetryBlocked = true
  const f = window.fetch
  if (f)
    window.fetch = function (input, init) {
      const u = typeof input === "string" ? input : input?.url || String(input || "")
      if (TELEMETRY.test(u)) return Promise.resolve(new Response(null, { status: 204 }))
      return f.call(this, input, init)
    }
  if (typeof XMLHttpRequest !== "undefined") {
    const open = XMLHttpRequest.prototype.open
    const send = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__drop98 = TELEMETRY.test(String(url))
      return open.call(this, method, url, ...rest)
    }
    XMLHttpRequest.prototype.send = function (...args) {
      if (this.__drop98) return undefined
      return send.apply(this, args)
    }
  }
  if (navigator.sendBeacon) {
    const beacon = navigator.sendBeacon.bind(navigator)
    navigator.sendBeacon = (url, data) => (TELEMETRY.test(String(url)) ? true : beacon(url, data))
  }
}

export const createWorkoutRun = ({ spot, mode = "daily", move = null, link = null, mate = null, camera = false, stats = {} } = {}) => {
  const online = !!link
  const myIdx = link ? link.team : 0
  const hasTread = !!spot.treadmill
  let plan = mode === "quick" ? quickPlan(move && MOVES[move] ? move : "squat") : todaysPlan(new Date(), { treadmill: hasTread })
  let w = createWorkout({ plan })
  let t0 = null // (performance.now() at the plan's zero; null until it starts)
  let api = null
  let mateBody = null
  let lane = null
  let dots = new Map()
  let listeners = new Set()
  let lastHud = ""
  let hudT = 0
  let judgeShow = null
  let note = null
  let over = null
  let lastBeat = -1
  let mateScore = null
  let scoreAt = 0
  let unsub = null
  let cam = { status: camera ? "starting" : "off", stream: null, video: null, lm: null, busy: false, counter: null, move: null, last: 0, error: null }
  const best = stats.workout?.best || 0
  const now = () => (t0 === null ? -LEAD_S : (performance.now() - t0) / 1000)
  const say = (text, sec = 1.4) => {
    note = { text, until: performance.now() + sec * 1000 }
    emitHud(true)
  }
  // where you stand: the gym's open floor (sprints: on the treadmill), facing into the room
  const floor = { x: spot.x, z: spot.z, y: spot.y || 0 }
  const roomMid = spot.roomPoly ? spot.roomPoly.reduce((a, q) => ({ x: a.x + q[0] / spot.roomPoly.length, z: a.z + q[1] / spot.roomPoly.length }), { x: 0, z: 0 }) : { x: spot.x + 1, z: spot.z }
  const faceFloor = Math.atan2(roomMid.x - floor.x, roomMid.z - floor.z) || 0
  const tread = spot.treadmill ? { x: spot.treadmill.x + Math.sin(spot.treadmill.a) * 0.15, z: spot.treadmill.z + Math.cos(spot.treadmill.a) * 0.15, y: (spot.y || 0) + 0.2, yaw: spot.treadmill.a + Math.PI } : null
  const placeNow = () => {
    const a = w.at(Math.max(0, now()))
    const s = a.set
    return MOVES[s.move].treadmill && tread ? { ...tread, run: true } : { ...floor, yaw: faceFloor, run: false }
  }

  // ---- bodies ----
  const driveFor = (who) => () => {
    const t = now()
    const a = w.at(Math.max(0, t))
    const at = placeNow()
    const side = who === "mate" ? 1.5 : 0
    const x = at.x + Math.cos(at.yaw) * side
    const z = at.z - Math.sin(at.yaw) * side
    const M = MOVES[a.set.move]
    const going = t >= LEAD_S - 0.5 && !a.resting && !over
    // (sprinting on the belt: the legs run, the body stays put)
    const run = going && M.treadmill && at.run
    const sp = run ? 6.5 : 0
    const mood = going && M.mood ? { kind: M.mood, p: a.p } : t < 0 || a.resting ? { kind: "watch" } : null
    const sit = { x, z, vx: Math.sin(at.yaw) * sp, vz: Math.cos(at.yaw) * sp, facing: at.yaw, ball: { x: x + Math.sin(at.yaw) * 3, y: 1.3, z: z + Math.cos(at.yaw) * 3 }, holding: false, swing: null, prep: null, high: null, charging: false, between: true, atNet: false, depth: 6, goal: null, hand: 1, twoHand: false, person: true, oppHit: null, want: { x: 0, z: 0 }, id: `wk-${who}`, phase: "intro", phaseT: 0, point: 0, mate: null, across: null, receiving: false }
    return { sit, gear: "none", mood, key: `wk-${who}-${at.run ? "t" : "f"}`, y: at.y || 0 }
  }
  const syncBodies = () => {
    const at = placeNow()
    for (const [b, side] of [[api.meBody, 0], [mateBody, 1.5]]) {
      if (!b) continue
      b.x = at.x + Math.cos(at.yaw) * side
      b.z = at.z - Math.sin(at.yaw) * side
      b.y = at.y || 0
      b.yaw = at.yaw
      b.vx = b.vz = 0
      b.speed = 0
    }
  }

  // ---- the lane: notes sliding to the ring (plain DOM, moved straight: no React per frame) ----
  const drawLane = (t) => {
    if (!lane) return
    const width = lane.clientWidth || 360
    const ringX = width * 0.18
    const seen = new Set()
    for (const n of w.notes) {
      const dt = n.t - t
      if (dt > TRAVEL || dt < -0.35) continue
      seen.add(n)
      let el = dots.get(n)
      if (!el) {
        el = document.createElement("div")
        el.className = `pkActNoteDot${n.input === "swipe" ? " is-swipe" : ""}`
        lane.appendChild(el)
        dots.set(n, el)
      }
      el.style.transform = `translateX(${(ringX + (dt / TRAVEL) * (width - ringX)).toFixed(1)}px)`
      el.classList.toggle("is-done", !!n.judged)
    }
    for (const [n, el] of dots) {
      if (seen.has(n)) continue
      el.remove()
      dots.delete(n)
    }
  }

  // ---- what you did ----
  const onJudge = (e) => {
    if (!e || e.type !== "judge") return
    if (e.kind === "miss") {
      if (e.streak === 0 && w.state.perfect + w.state.good > 0) sfx.miss()
    } else sfx.good(e.kind === "perfect")
    judgeShow = { kind: e.kind, text: e.kind === "perfect" ? "Perfect!" : e.kind === "good" ? "Good" : "Miss", id: Math.random() }
    emitHud(true)
  }
  const input = (kind) => {
    if (over || t0 === null) return false
    const t = now()
    const e = kind === "swipe" ? w.swipe(t) : w.tap(t)
    onJudge(e)
    return !!e
  }

  // ---- the camera: real reps (opt-in) ----
  const startCamera = async () => {
    blockTelemetry()
    try {
      cam.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 360 } }, audio: false })
      if (cam.video) cam.video.srcObject = cam.stream
      cam.status = "loading"
      emitHud(true)
      const { createLandmarker } = await import("../../twin/poseModel.js")
      cam.lm = await createLandmarker({ model: "lite", mode: "VIDEO" })
      cam.status = "on"
    } catch (err) {
      cam.status = "error"
      cam.error = err?.name === "NotAllowedError" ? "The camera wasn't allowed: tapping counts instead." : "The camera couldn't start: tapping counts instead."
      stopCamera()
    }
    emitHud(true)
  }
  const stopCamera = () => {
    for (const tr of cam.stream?.getTracks?.() || []) tr.stop()
    cam.stream = null
    try {
      cam.lm?.close?.()
    } catch {}
    cam.lm = null
  }
  const camStep = (t) => {
    if (cam.status !== "on" || cam.busy || !cam.video || cam.video.readyState < 2) return
    const nowMs = performance.now()
    if (nowMs - cam.last < 110) return
    cam.last = nowMs
    const a = w.at(Math.max(0, t))
    if (cam.move !== a.set.move) {
      cam.move = a.set.move
      cam.counter = repCounter(a.set.move)
    }
    cam.busy = true
    try {
      const v = cam.video
      const poses = cam.lm.detect(v, nowMs, v.videoWidth || 480, v.videoHeight || 360)
      if (poses[0] && cam.counter.push(poses[0].lm)) onJudge(w.real(t))
    } catch {
      // (a frame the model couldn't read)
    }
    cam.busy = false
  }

  // ---- the HUD ----
  const hud = () => {
    const t = now()
    const a = w.at(Math.max(0, t))
    const M = MOVES[a.set.move]
    const st = w.state
    const counting = t0 !== null && t < LEAD_S ? Math.ceil(LEAD_S - t) : null
    const waiting = t0 === null && online && !link.host
    return {
      kind: "workout",
      mode,
      online,
      host: !online || link.host,
      court: spot.name,
      big: `${st.score}`,
      small: `${st.perfect + st.good} reps · ${st.streak}x streak`,
      move: { name: M.name, icon: M.icon, input: M.input },
      set: a.resting && t > LEAD_S ? "Rest · next up" : `${plan.sets.length > 1 ? `Move ${a.index + 1} of ${plan.sets.length} · ` : ""}${Math.ceil(a.left)} s`,
      combo: st.streak,
      judge: judgeShow,
      tip: over ? null : waiting ? `Starting with ${mate?.name || "your friend"}...` : counting ? `${M.name}: ${M.how.toLowerCase()} · ${counting}` : t < LEAD_S + 4 ? `${M.input === "swipe" ? "Swipe down" : "Tap"} when the dot reaches the ring` : null,
      note: note && performance.now() < note.until ? note.text : cam.error && cam.status === "error" ? cam.error : null,
      camera: cam.status === "on" ? `📷 Counting your reps · ${w.state.real}` : cam.status === "loading" || cam.status === "starting" ? "📷 Starting the camera..." : null,
      cameraOn: cam.status !== "off" && cam.status !== "error",
      mate: mate ? { name: mate.name, score: mateScore?.s ?? 0, streak: mateScore?.k ?? 0 } : null,
      over,
    }
  }
  const emitHud = (force = false) => {
    const h = hud()
    const k = JSON.stringify(h)
    if (!force && k === lastHud) return
    lastHud = k
    for (const fn of listeners) fn(h)
  }

  const begin = () => {
    // (the plan's zero is now: its first LEAD_S seconds are the count-in)
    t0 = performance.now()
    lastBeat = -1
    over = null
    emitHud(true)
  }
  const finish = () => {
    const r = w.result()
    const newBest = r.score > best && r.reps > 0
    over = { won: null, title: mate ? (mateScore && mateScore.s > r.score ? `${mate.name} wins this one!` : "Workout done!") : "Workout done!", line: `${r.score} points`, reps: r.reps, perfect: r.perfect, streak: r.streak, newBest, pumped: r.reps > 0 }
    if (mate && mateScore) over.line = `You ${r.score} · ${mate.name} ${mateScore.s}`
    sfx.chime(true)
    if (online) link.send("done", { s: r.score, k: r.streak, r: r.reps })
    stopCamera()
    emitHud(true)
  }

  let helloAt = 0
  const onLink = (type, d) => {
    if (type === "hello" && link.host && t0 !== null) {
      // (the guest's screen is up: where the workout is, so it starts in step)
      link.send("ready", { day: plan.day || null, at: Math.round(now() * 1000) / 1000 })
    } else if (type === "ready" && !link.host) {
      // (the host's day: the same workout for the two of you)
      if (t0 === null && typeof d.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.day)) {
        const [y, m, dd] = d.day.split("-").map(Number)
        plan = todaysPlan(new Date(y, m - 1, dd), { treadmill: hasTread })
        w = createWorkout({ plan })
      }
      const at = Number(d.at)
      // (the host went again: a fresh workout here too)
      if (t0 !== null && (over || at === 0)) {
        w = createWorkout({ plan })
        for (const el of dots.values()) el.remove()
        dots.clear()
      }
      begin()
      // (the host is `at` seconds in: so are you, give or take the message's trip)
      if (Number.isFinite(at) && at > 0) t0 = performance.now() - (at + 0.05) * 1000
    } else if (type === "score" || type === "done") {
      mateScore = { s: Number(d.s) || 0, k: Number(d.k) || 0, r: Number(d.r) || 0 }
      if (type === "done" && over) over.line = `You ${w.state.score} · ${mate?.name || "Them"} ${mateScore.s}`
      emitHud(true)
    } else if (type === "again" && !link.host) {
      w = createWorkout({ plan })
      begin()
    }
  }

  const run = {
    kind: "workout",
    spot,
    start(a) {
      api = a
      api.meBody.drive = driveFor("me")
      if (mate) {
        mateBody = api.body("workMate", mate.look, mate.name)
        mateBody.drive = driveFor("mate")
      }
      if (link?.num !== undefined && link?.num !== null) api.hideRemote(link.num, true)
      if (link) unsub = link.on(onLink)
      if (camera) startCamera()
      // alone, or the host: go (the guest waits for the host's "ready")
      if (!online || link.host) {
        begin()
        if (online) link.send("ready", { day: plan.day || null })
      }
      syncBodies()
      emitHud(true)
    },
    step(dt) {
      const t = now()
      // (the guest: "I'm here" until the host says where the workout is)
      if (online && !link.host && t0 === null && performance.now() - helloAt > 1500) {
        helloAt = performance.now()
        link.send("hello", {})
      }
      if (t0 !== null && !over) {
        for (const e of w.step(t)) {
          if (e.type === "done") finish()
          else onJudge(e)
        }
        // the beat: a kick on every note, a hat between (and the count-in)
        const a = w.at(Math.max(0, t))
        const b = Math.floor(t / a.beat)
        if (b !== lastBeat) {
          lastBeat = b
          if (t < LEAD_S) sfx.offbeat()
          else if (!a.resting) {
            const onNote = w.notes.some((n) => Math.abs(n.t - b * a.beat) < 0.03)
            if (onNote) sfx.beat(true)
            else sfx.offbeat()
          }
        }
        camStep(t)
        if (online && performance.now() - scoreAt > SCORE_MS) {
          scoreAt = performance.now()
          link.send("score", { s: w.state.score, k: w.state.streak, r: w.state.perfect + w.state.good })
        }
      }
      drawLane(t)
      syncBodies()
      hudT += dt
      if (hudT > 0.15) {
        hudT = 0
        emitHud()
      }
    },
    me() {
      const at = placeNow()
      return { x: at.x, z: at.z, y: at.y || 0, yaw: at.yaw, vx: 0, vz: 0 }
    },
    // from the front and a little to the side, at chest height (your mate beside you in it)
    shot(dt, { portrait = true } = {}) {
      const at = placeNow()
      // (on the treadmill: from behind and above, clear of the machines either side)
      if (at.run) {
        const bx = at.x - Math.sin(at.yaw) * 2.6
        const bz = at.z - Math.cos(at.yaw) * 2.6
        return { cam: { x: bx, y: at.y + 2.3, z: bz }, look: { x: at.x + Math.sin(at.yaw) * 1.2, y: at.y + 0.8, z: at.z + Math.cos(at.yaw) * 1.2 }, fov: portrait ? 62 : 50, ease: 3 }
      }
      const side = mate ? 0.75 : 0
      const cx = at.x + Math.cos(at.yaw) * side
      const cz = at.z - Math.sin(at.yaw) * side
      const ang = at.yaw + 0.55
      const d = portrait ? (mate ? 4.4 : 3.4) : 3.0
      let cam = { x: cx + Math.sin(ang) * d, z: cz + Math.cos(ang) * d }
      const t = api?.segHit?.({ x: cx, z: cz }, cam, 1.6)
      if (t !== null && t !== undefined) cam = { x: cx + (cam.x - cx) * Math.max(0.35, t - 0.1), z: cz + (cam.z - cz) * Math.max(0.35, t - 0.1) }
      const y0 = at.y || 0
      return { cam: { x: cam.x, y: y0 + (portrait ? 1.75 : 1.55), z: cam.z }, look: { x: cx, y: y0 + 0.95, z: cz }, fov: portrait ? 62 : 50, ease: 3 }
    },
    focus() {
      const at = placeNow()
      return { x: at.x, y: at.y || 0, z: at.z }
    },
    setStick() {},
    key(code, down) {
      if (!down) return false
      if (code === "Space" || code === "Enter" || code === "KeyJ") return input("tap"), true
      if (code === "ArrowDown" || code === "KeyS") return input("swipe"), true
      return false
    },
    tap: () => input("tap"),
    swipe(sw) {
      if (sw?.down) return input("swipe")
      return input("tap")
    },
    attachLane(el) {
      if (lane === el) return
      for (const d of dots.values()) d.remove()
      dots.clear()
      lane = el
    },
    attachVideo(el) {
      cam.video = el
      if (el && cam.stream) el.srcObject = cam.stream
    },
    again() {
      if (online && !link.host) return
      w = createWorkout({ plan })
      for (const d of dots.values()) d.remove()
      dots.clear()
      if (camera) startCamera()
      begin()
      if (online) link.send("ready", { day: plan.day || null, at: 0 })
    },
    subscribe(fn) {
      listeners.add(fn)
      fn(hud())
      return () => listeners.delete(fn)
    },
    get state() {
      return { w, t: now(), plan, over }
    },
    stop() {
      unsub?.()
      stopCamera()
      if (link?.num !== undefined && link?.num !== null) api?.hideRemote(link.num, false)
      if (mateBody) api.drop(mateBody)
      for (const d of dots.values()) d.remove()
      dots.clear()
      listeners.clear()
    },
    exit() {
      return { x: floor.x, z: floor.z, y: floor.y, yaw: faceFloor }
    },
    result() {
      const r = w.result()
      if (!r.reps) return null
      return { kind: "workout", mode, reps: r.reps, perfect: r.perfect, streak: r.streak, score: r.score, real: r.real, daily: mode !== "quick" && !!over }
    },
  }
  return run
}
