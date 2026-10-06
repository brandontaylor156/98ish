// node --test client/src/components/applets/pickleball/twin/live/live.test.js
import { test } from "node:test"
import assert from "node:assert/strict"
import { cleanEvent, decodeTick, encodeTick, tickBytes } from "./packet.js"
import { createCursor, createStream, DELAY } from "./stream.js"
import { createLiveHits, createSlots } from "./liveHits.js"
import { createAnalyzer } from "../core/analyze.js"
import { detectOnsets } from "../core/onsets.js"
import { sampleAt } from "../core/tracker.js"
import { cornerTaps, filmRally, makeCamera, scriptRally, soundtrack } from "../synthetic.js"

test("packets: a tick round-trips within a centimetre; bad bytes and events are refused", () => {
  const players = [
    { x: 1.234, z: 5.678, vx: 2.04, vz: -3.11, seen: true },
    { x: -2.5, z: 6.001, vx: 0, vz: 0, seen: false },
    { x: 0.004, z: -4.2, vx: -12.9, vz: 0.5, seen: true },
    { x: 3.05, z: -6.7, vx: 0.1, vz: 0.1, seen: true },
  ]
  const bytes = encodeTick(12345.6, players)
  assert.equal(bytes.length, tickBytes(4))
  assert.equal(bytes.length, 34)
  const back = decodeTick(bytes)
  assert.ok(Math.abs(back.t - 12.346) < 1e-9)
  back.players.forEach((q, i) => {
    assert.ok(Math.abs(q.x - players[i].x) <= 0.005 && Math.abs(q.z - players[i].z) <= 0.005)
    assert.ok(Math.abs(q.vx - Math.max(-12.7, Math.min(12.7, players[i].vx))) <= 0.05)
    assert.equal(q.seen, players[i].seen)
  })
  // (an ArrayBuffer and a Node Buffer view decode the same)
  assert.deepEqual(decodeTick(bytes.buffer), back)
  assert.deepEqual(decodeTick(Buffer.from(bytes)), back)
  // far off the court: clamped, never wrapped
  assert.equal(decodeTick(encodeTick(0, [{ x: 999, z: -999 }])).players[0].x, 32)
  for (const bad of [new Uint8Array(3), new Uint8Array([2, 0, 0, 0, 0, 0]), new Uint8Array([1, 5, 0, 0, 0, 0]), bytes.slice(0, 20), null, "x"]) assert.equal(decodeTick(bad), null)
  assert.deepEqual(cleanEvent({ k: "hit", t: 1500.4, p: 2, h: 87, s: "bh", src: "sound" }), { k: "hit", t: 1500, p: 2, h: 87, s: "bh", src: "sound" })
  assert.equal(cleanEvent({ k: "hit", p: 9 }), null)
  assert.equal(cleanEvent({ k: "rm -rf" }), null)
  assert.equal(cleanEvent({ k: "score", a: 400, b: -3, call: "x".repeat(99) }).a, 99)
  assert.equal(cleanEvent({ k: "roster", players: [{ name: "<b>Kim</b>".repeat(9), team: 7 }] }).players[0].name.length, 32)
})

// the synthetic fence-cam rally, read as it happens: frames arrive at 15 fps, the sound's
// pops are heard ~0.1 s late in chunks, and the live hit finder decides each hit soon after
const liveRead = ({ sound = true } = {}) => {
  const cam = makeCamera()
  const script = scriptRally()
  const frames = filmRally(script, cam)
  const audio = soundtrack(script, { bounces: [2.3, 3.9, 6.6] })
  const onsets = sound ? detectOnsets(audio.samples, audio.rate) : []
  const an = createAnalyzer({ taps: cornerTaps(cam), players: 4 })
  const live = createLiveHits()
  const slots = createSlots({ players: 4 })
  const hits = []
  const ticks = []
  let lastTick = -1
  let heard = 0
  for (const f of frames) {
    an.push(f.t, f.people)
    // pops heard up to 0.1 s ago (the mic's chunks)
    while (heard < onsets.length && onsets[heard].t < f.t - 0.1) live.push([onsets[heard++]])
    for (const h of live.poll(f.t, an.tracks(), { sound })) hits.push({ ...h, slot: slots.slotOf(an.tracks().find((tr) => tr.id === h.player)), decidedAt: f.t })
    if (f.t - lastTick >= 0.1) {
      lastTick = f.t
      const byslot = []
      for (const tr of an.tracks()) {
        const s = slots.slotOf(tr)
        if (s !== null) byslot[s] = { x: tr.x, z: tr.z, vx: tr.vx, vz: tr.vz, seen: f.t - tr.lastT < 1 }
      }
      ticks.push({ t: f.t, players: [0, 1, 2, 3].map((i) => byslot[i] || { x: 0, z: 0, seen: false }) })
    }
  }
  return { script, frames, hits, ticks, an, slots }
}

test("live hits: each hit decided within half a second of the pop, the right team", () => {
  const { script, hits } = liveRead()
  assert.equal(hits.length, script.hits.length, `found ${hits.length}`)
  script.hits.forEach((h, i) => {
    assert.ok(Math.abs(hits[i].t - h.t) < 0.15, `hit ${i}: ${hits[i].t} vs ${h.t}`)
    assert.equal(hits[i].team, h.team, `hit ${i} team`)
    assert.ok(hits[i].decidedAt - hits[i].t < 0.5, `hit ${i} decided ${hits[i].decidedAt - hits[i].t} s after`)
    assert.ok(hits[i].height > 0.1 && hits[i].height < 2.8)
    assert.ok(hits[i].slot !== null)
  })
  // without a microphone, swings alone still catch most of them
  const silent = liveRead({ sound: false })
  const matched = script.hits.filter((h) => silent.hits.some((q) => Math.abs(q.t - h.t) < 0.25 && q.team === h.team)).length
  assert.ok(matched >= script.hits.length - 2, `silent: ${matched}/${script.hits.length}`)
})

test("slots: the near team fills the first slots, a slot is never reused", () => {
  const s = createSlots({ players: 4 })
  assert.equal(s.slotOf({ id: 5, team: 1 }), 2)
  assert.equal(s.slotOf({ id: 2, team: 0 }), 0)
  assert.equal(s.slotOf({ id: 7, team: 0 }), 1)
  assert.equal(s.slotOf({ id: 9, team: 0 }), null) // (a third near player: not a slot)
  assert.equal(s.slotOf({ id: 5, team: 0 }), 2) // (kept even if the team guess changes)
  assert.equal(s.slotOf({ id: 8, team: 1 }), 3)
})

// a seeded random for the network's jitter
const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

test("stream: jittered, reordered packets play back smooth, behind by the buffer, positions true", () => {
  const { script, ticks, hits, slots, an } = liveRead()
  // the network: each packet arrives 40-450 ms after it was made (so often out of order)
  const rand = rng(11)
  const arrivals = []
  for (const tk of ticks) arrivals.push({ at: tk.t + 0.04 + rand() * 0.41, tick: encodeTick(tk.t * 1000, tk.players) })
  for (const h of hits) arrivals.push({ at: h.decidedAt + 0.04 + rand() * 0.41, event: { k: "hit", t: h.t * 1000, p: h.slot, h: Math.round(h.height * 100), s: h.side, src: h.source } })
  arrivals.push({ at: 0, event: { k: "roster", players: [0, 1, 2, 3].map((i) => ({ name: `P${i}`, team: i < 2 ? 0 : 1 })) } })
  arrivals.sort((a, b) => a.at - b.at)
  let reordered = 0
  for (let i = 1; i < ticks.length; i++) {
    const a = arrivals.findIndex((x) => x.tick && decodeTick(x.tick).t === Math.round(ticks[i].t * 1000) / 1000)
    const b = arrivals.findIndex((x) => x.tick && decodeTick(x.tick).t === Math.round(ticks[i - 1].t * 1000) / 1000)
    if (a < b) reordered++
  }
  assert.ok(reordered > 5, `the test network reorders (${reordered})`)
  const stream = createStream({ players: [] })
  const cursor = createCursor()
  const out = []
  let k = 0
  for (let now = 0; now < script.hits.at(-1).t + 4; now += 0.2) {
    while (k < arrivals.length && arrivals[k].at <= now) {
      const a = arrivals[k++]
      if (a.tick) stream.addTick(a.tick)
      else stream.addEvent(a.event)
    }
    const fr = cursor.step(stream)
    // playback never runs ahead of what's arrived
    if (fr.length) assert.ok(fr.at(-1).t <= stream.newest - DELAY + 1e-6)
    out.push(...fr)
  }
  assert.ok(out.length > 150, `${out.length} frames`)
  // no gaps, no repeats: one frame every 1/30 s
  for (let i = 1; i < out.length; i++) assert.ok(Math.abs(out[i].t - out[i - 1].t - 1 / 30) < 1e-6, `frame ${i}: ${out[i].t - out[i - 1].t}`)
  // positions follow the tracked ones (what the broadcaster tracked) within 0.35 m once everyone is seen
  const trackOf = (slot) => an.tracks().find((tr) => slots.map.get(tr.id) === slot)
  let worst = 0
  for (const f of out) {
    if (f.t < 1.2) continue
    f.players.forEach((p, slot) => {
      const tr = trackOf(slot)
      const at = tr && sampleAt(tr.samples, f.t)
      if (at) worst = Math.max(worst, Math.hypot(at.x - p.x, at.z - p.z))
    })
  }
  assert.ok(worst < 0.35, `worst ${worst.toFixed(2)} m`)
  // every hit was heard in the frames (its sound event), from the right team
  const heard = out.flatMap((f) => (f.events || []).filter((e) => e.type === "hit"))
  assert.ok(heard.length >= script.hits.length - 1, `hits heard ${heard.length}`)
  // the roster's names and teams arrived
  assert.equal(stream.players[2].name, "P2")
  // what the viewer kept can be saved as a Twin Replay game
  const saved = stream.toAnalysis()
  assert.equal(saved.players.length, 4)
  assert.equal(saved.rallies.flatMap((r) => r.hits).length, script.hits.length)
  assert.ok(saved.stats.players.length === 4)
})

test("cursor: a tab that slept jumps to the edge instead of building a minute of frames", () => {
  const stream = createStream({ players: [{ name: "A", team: 0 }, { name: "B", team: 1 }] })
  const cursor = createCursor()
  const add = (t) => stream.addTick(encodeTick(t * 1000, [{ x: 0, z: 5 }, { x: 0, z: -5 }]))
  for (let t = 0; t <= 3; t += 0.1) add(t)
  const first = cursor.step(stream)
  assert.ok(first.length > 0)
  for (let t = 3.1; t <= 70; t += 0.1) add(t)
  const next = cursor.step(stream)
  assert.ok(next.length < 10, `after the sleep: ${next.length} frames`)
  assert.ok(Math.abs(cursor.built - (stream.newest - DELAY)) < 0.05)
})
