import test from "node:test"
import assert from "node:assert/strict"
import { listenerRelative, distanceGain, pickPeers, courtGain, cursorPan, duckStep, talking, VOICE } from "./spatial.js"
import { tuneOpus } from "./mesh.js"

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

test("a voice is placed relative to where you face: ahead is -Z, your right is +X", () => {
  // facing +z (yaw 0): a voice 5 m ahead, one 3 m to the right (-x in the world)
  const me = { x: 0, z: 0, yaw: 0 }
  const ahead = listenerRelative(me, { x: 0, z: 5 })
  assert.ok(near(ahead.x, 0) && near(ahead.z, -5))
  const right = listenerRelative(me, { x: -3, z: 0 })
  assert.ok(near(right.x, 3) && near(right.z, 0))
  // turn around (yaw pi): the same voices are behind and to the left
  const back = listenerRelative({ ...me, yaw: Math.PI }, { x: 0, z: 5 })
  assert.ok(near(back.z, 5, 1e-9))
  const left = listenerRelative({ ...me, yaw: Math.PI }, { x: -3, z: 0 })
  assert.ok(near(left.x, -3, 1e-9))
  // facing +x (yaw pi/2): a voice at +x is straight ahead; moving the listener shifts it
  const east = listenerRelative({ x: 10, z: 2, yaw: Math.PI / 2 }, { x: 14, z: 2 })
  assert.ok(near(east.x, 0, 1e-9) && near(east.z, -4, 1e-9))
})

test("loudness falls with distance and is silent past the fade", () => {
  assert.equal(distanceGain(0), 1)
  assert.equal(distanceGain(VOICE.ref), 1)
  const g = [2, 5, 8, 11, 14, 16].map((d) => distanceGain(d))
  for (let i = 1; i < g.length; i++) assert.ok(g[i] < g[i - 1], `quieter at ${i}`)
  assert.ok(distanceGain(15) < 0.06, "barely there at ~15 m")
  assert.equal(distanceGain(VOICE.fadeTo), 0)
  assert.equal(distanceGain(40), 0)
  assert.equal(distanceGain(NaN), 0)
})

test("whom to connect to: the nearest few within range, and no flapping at the edge", () => {
  const me = { x: 0, z: 0 }
  const people = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, x: (i + 1) * 3, z: 0 })) // 3, 6, ... 30 m
  const first = pickPeers(me, people)
  assert.deepEqual([...first].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6], "the 6 nearest")
  // nobody beyond 25 m gets a new connection
  const far = pickPeers(me, [{ id: 9, x: 27, z: 0 }])
  assert.equal(far.size, 0)
  // someone already connected walks to 28 m: kept (within keep and among the nearest 8)
  const kept = pickPeers(me, [{ id: 9, x: 28, z: 0 }], new Set([9]))
  assert.ok(kept.has(9))
  // ...but not past `keep`
  assert.equal(pickPeers(me, [{ id: 9, x: 31, z: 0 }], new Set([9])).size, 0)
  // people without a position are skipped
  assert.equal(pickPeers(me, [{ id: 1 }]).size, 0)
})

test("court mode, Come Over panning, Watch Together ducking, talking detection", () => {
  assert.equal(courtGain(3, null), 1)
  assert.equal(courtGain(3, [3, 4]), 1)
  assert.equal(courtGain(9, [3, 4]), VOICE.courtOthers)
  const r = cursorPan({ x: 0.2, y: 0.5 }, { x: 0.9, y: 0.5 })
  assert.equal(r.pan, 1)
  const l = cursorPan({ x: 0.8, y: 0.5 }, { x: 0.5, y: 0.5 })
  assert.ok(l.pan < 0 && l.gain < 1 && l.gain > 0.8)
  assert.deepEqual(cursorPan({ x: 0.5, y: 0.5 }, null), { pan: 0, gain: 1 })
  // ducking: down fast while someone talks, back up slowly
  let v = 1
  for (let i = 0; i < 5; i++) v = duckStep(v, true, 0.1)
  assert.ok(v < 0.4, `ducked to ${v}`)
  let up = v
  up = duckStep(up, false, 0.1)
  assert.ok(up > v && up < 0.5, "comes back slowly")
  for (let i = 0; i < 60; i++) up = duckStep(up, false, 0.1)
  assert.ok(up > 0.99)
  assert.equal(talking(0.05), true)
  assert.equal(talking(0.02), false)
  assert.equal(talking(0.02, true), true, "hysteresis keeps a word going")
})

test("Opus is asked for mono ~32 kbps with error correction", () => {
  const sdp = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111 0\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1\r\na=rtpmap:0 PCMU/8000\r\n"
  const out = tuneOpus(sdp)
  assert.match(out, /a=fmtp:111 minptime=10;useinbandfec=1;maxaveragebitrate=32000;stereo=0;usedtx=1/)
  // no fmtp line yet: one is added
  const bare = tuneOpus("v=0\r\na=rtpmap:109 opus/48000/2\r\n")
  assert.match(bare, /a=fmtp:109 maxaveragebitrate=32000;stereo=0;useinbandfec=1;usedtx=1/)
  // no opus: unchanged
  assert.equal(tuneOpus("v=0\r\na=rtpmap:0 PCMU/8000\r\n"), "v=0\r\na=rtpmap:0 PCMU/8000\r\n")
})

// ---------- 2026-10-09: connections that can't get through, and saying so ----------
import { createMesh, RESTART_AFTER_MS, FAIL_AFTER_MS, RETRY_MS } from "./mesh.js"
import { voiceStatus } from "./status.js"

// a stand-in RTCPeerConnection that never gets anywhere (like two networks with no route
// between them and no relay), with a fake clock
const fakeWorld = () => {
  let t = 0
  let timers = []
  const clock = {
    now: () => t,
    setTimeout: (fn, ms) => {
      const h = { at: t + ms, fn }
      timers.push(h)
      return h
    },
    clearTimeout: (h) => (timers = timers.filter((x) => x !== h)),
    advance: (ms) => {
      const end = t + ms
      for (;;) {
        const next = timers.filter((h) => h.at <= end).sort((a, b) => a.at - b.at)[0]
        if (!next) break
        timers = timers.filter((h) => h !== next)
        t = next.at
        next.fn()
      }
      t = end
    },
  }
  const made = []
  class Peer {
    constructor(cfg) {
      this.cfg = cfg
      this.connectionState = "new"
      this.signalingState = "stable"
      this.restarts = 0
      this.closed = false
      made.push(this)
    }
    addTransceiver() {}
    getTransceivers() {
      return []
    }
    addTrack() {
      return { getParameters: () => ({}) }
    }
    restartIce() {
      this.restarts++
    }
    close() {
      this.closed = true
      this.connectionState = "closed"
    }
  }
  return { clock, Peer, made }
}

test("a connection that never gets through: one ICE restart, then given up, both told, retried after a while", () => {
  const { clock, Peer, made } = fakeWorld()
  const sent = []
  const fails = []
  const mesh = createMesh({ me: 1, transport: { send: (to, kind) => (sent.push([to, kind]), Promise.resolve({ ok: true })) }, iceServers: [{ urls: ["stun:x"] }], onFail: (id, info) => fails.push([id, info]), Peer, timers: clock, now: clock.now })
  mesh.want([2])
  assert.equal(made.length, 1)
  clock.advance(RESTART_AFTER_MS + 1)
  assert.equal(made[0].restarts, 1, "one ICE restart")
  clock.advance(FAIL_AFTER_MS - RESTART_AFTER_MS)
  assert.deepEqual(fails, [[2, { turn: false }]], "given up, and no relay was offered")
  assert.ok(made[0].closed)
  assert.ok(sent.some(([to, kind]) => to === 2 && kind === "bye"), "the other side is told")
  mesh.want([2])
  assert.equal(made.length, 1, "not hammered again at once")
  clock.advance(RETRY_MS)
  mesh.want([2])
  assert.equal(made.length, 2, "tried again later")
  // a relay offered: the reason changes
  const { clock: c2, Peer: P2 } = fakeWorld()
  const f2 = []
  const m2 = createMesh({ me: 1, transport: { send: () => Promise.resolve({ ok: true }) }, iceServers: [{ urls: ["turns:relay.example:443"], username: "u", credential: "c" }], onFail: (id, info) => f2.push(info), Peer: P2, timers: c2, now: c2.now })
  m2.want([5])
  c2.advance(FAIL_AFTER_MS + 1)
  assert.deepEqual(f2, [{ turn: true }])
})

test("their goodbye on a connection that never got through counts as a failure; an early one doesn't", async () => {
  const { clock, Peer } = fakeWorld()
  const fails = []
  const mesh = createMesh({ me: 1, transport: { send: () => Promise.resolve({ ok: true }) }, onFail: (id) => fails.push(id), Peer, timers: clock, now: clock.now })
  mesh.want([2, 3])
  await mesh.signal(3, "bye", null) // right away: they just walked off
  clock.advance(RESTART_AFTER_MS + 500)
  await mesh.signal(2, "bye", null)
  assert.deepEqual(fails, [2])
  mesh.want([2, 3])
  assert.deepEqual(mesh.peers.map((p) => p.id).sort(), [3], "2 waits, 3 is tried again")
})

test("voice status in words: the problem first, then connecting, hearing, too far, nobody", () => {
  const names = { 2: "Ali", 3: "Bea", 4: "Cy" }
  assert.equal(voiceStatus({ status: "off" }).line, "")
  assert.match(voiceStatus({ status: "error", error: "Microphone blocked." }).line, /Microphone blocked/)
  const base = { status: "on", peers: {}, problems: {}, far: [] }
  assert.match(voiceStatus(base, names).line, /Nobody near you/)
  assert.match(voiceStatus({ ...base, far: [3] }, names).line, /^Bea has voice on but is too far away/)
  assert.match(voiceStatus({ ...base, peers: { 2: { state: "connecting" } } }, names).line, /^Connecting to Ali/)
  assert.equal(voiceStatus({ ...base, peers: { 2: { state: "connected" }, 4: { state: "connected" } } }, names).hearing, 2)
  const relay = voiceStatus({ ...base, peers: { 4: { state: "connected" } }, problems: { 2: { turn: false } } }, names)
  assert.equal(relay.problem, true)
  assert.match(relay.line, /^Voice couldn't connect to Ali: one of you is on a network that needs a relay/)
  assert.match(voiceStatus({ ...base, problems: { 2: { turn: true }, 3: { turn: true } } }, names).line, /^Voice couldn't connect to Ali and Bea\. Trying again soon\./)
})
