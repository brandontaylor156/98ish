const test = require("node:test")
const assert = require("node:assert/strict")
const { createVoiceRelay, cleanSignal, SIGNALS_PER_10S } = require("../relay")
const { createPark } = require("../../park")

const SDP = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\n"

const relayWithLog = (opts = {}) => {
  const sent = []
  let t = 0
  const relay = createVoiceRelay({ prefix: "x", emit: (to, event, payload) => sent.push({ to, event, payload }), now: () => t, ...opts })
  return { relay, sent, tick: (ms) => (t += ms) }
}

test("signals are cleaned: only offer/answer/ice/bye, size-capped, nothing extra", () => {
  assert.deepEqual(cleanSignal("offer", { type: "offer", sdp: SDP, extra: 1 }), { kind: "offer", data: { type: "offer", sdp: SDP } })
  assert.equal(cleanSignal("offer", { sdp: "not sdp" }), null)
  assert.equal(cleanSignal("offer", { sdp: "v=0" + "a".repeat(20000) }), null)
  assert.deepEqual(cleanSignal("ice", { candidate: "candidate:1 1 udp 1 1.2.3.4 5 typ host", sdpMid: "0", sdpMLineIndex: 0, junk: "x" }), {
    kind: "ice",
    data: { candidate: "candidate:1 1 udp 1 1.2.3.4 5 typ host", sdpMid: "0", sdpMLineIndex: 0 },
  })
  assert.deepEqual(cleanSignal("ice", { candidate: "" }), { kind: "ice", data: { candidate: "" } })
  assert.deepEqual(cleanSignal("bye", { anything: 1 }), { kind: "bye", data: null })
  assert.equal(cleanSignal("video", {}), null)
  assert.equal(cleanSignal("ice", { candidate: 5 }), null)
})

test("voice on/off announces the list; signals pass only between two people with voice on in that room", () => {
  const { relay, sent } = relayWithLog()
  assert.deepEqual(relay.set("r1", "a", true).on, ["a"])
  relay.set("r1", "b", true)
  assert.deepEqual(sent.filter((s) => s.event === "x:vc").at(-1).payload, { room: "r1", on: ["a", "b"] })
  assert.deepEqual(relay.signal("r1", "a", "b", { kind: "offer", data: { sdp: SDP } }), { ok: true })
  assert.deepEqual(sent.at(-1), { to: "b", event: "x:sig", payload: { room: "r1", from: "a", kind: "offer", data: { type: "offer", sdp: SDP } } })
  // not to yourself, not to someone without voice, not in another room, not from someone without voice
  assert.equal(relay.signal("r1", "a", "a", { kind: "bye" }).ok, false)
  assert.equal(relay.signal("r1", "a", "c", { kind: "bye" }).ok, false)
  assert.equal(relay.signal("r2", "a", "b", { kind: "bye" }).ok, false)
  assert.equal(relay.signal("r1", "c", "a", { kind: "bye" }).ok, false)
  // off: gone from the list, signals refused
  relay.set("r1", "b", false)
  assert.deepEqual(relay.members("r1"), ["a"])
  assert.equal(relay.signal("r1", "a", "b", { kind: "bye" }).ok, false)
  // leave and drop clear everything
  relay.set("r1", "b", true)
  relay.leave("a")
  assert.deepEqual(relay.members("r1"), ["b"])
  relay.drop("r1")
  assert.deepEqual(relay.members("r1"), [])
  assert.equal(relay.rooms.size, 0)
})

test("caps: people per room and signals per 10 seconds", () => {
  const { relay, tick } = relayWithLog({ maxPerRoom: 2 })
  relay.set("r", "a", true)
  relay.set("r", "b", true)
  assert.equal(relay.set("r", "c", true).ok, false)
  let ok = 0
  for (let i = 0; i < SIGNALS_PER_10S + 10; i++) if (relay.signal("r", "a", "b", { kind: "bye" }).ok) ok++
  assert.equal(ok, SIGNALS_PER_10S)
  tick(10_001)
  assert.equal(relay.signal("r", "a", "b", { kind: "bye" }).ok, true)
})

test("My Park: voice by park number, only inside your park, gone when you leave, ICE config on", async () => {
  const sent = []
  const park = createPark({ emit: (pid, event, payload) => sent.push({ pid, event, payload }), ice: { config: async () => ({ iceServers: [{ urls: "stun:x" }], turn: false }) } })
  try {
    const a = park.join({ pid: "A", name: "Alice" }, { venue: "loscab" })
    const b = park.join({ pid: "B", name: "Bob" }, { venue: "loscab" })
    const c = park.join({ pid: "C", name: "Cara" }, { venue: "smash" }) // another venue: another park
    assert.equal(a.park, b.park)
    assert.notEqual(c.park, a.park)
    const ra = await park.voiceOn("A", true)
    assert.equal(ra.ok, true)
    assert.deepEqual(ra.ice.iceServers, [{ urls: "stun:x" }])
    await park.voiceOn("B", true)
    await park.voiceOn("C", true)
    assert.deepEqual(sent.filter((s) => s.pid === "A" && s.event === "park:vc").at(-1).payload.on, [a.you, b.you])
    // A -> B by number reaches B's browser; A -> C (other park) is refused
    assert.equal(park.voiceSignal("A", { to: b.you, kind: "offer", data: { sdp: SDP } }).ok, true)
    const got = sent.at(-1)
    assert.equal(got.pid, "B")
    assert.equal(got.event, "park:sig")
    assert.equal(got.payload.from, a.you)
    assert.equal(park.voiceSignal("A", { to: c.you, kind: "bye" }).ok, false)
    assert.equal(park.voiceSignal("A", { to: "B", kind: "bye" }).ok, false)
    // Bob leaves: off the list, and Alice is told
    park.leave("B")
    assert.deepEqual(sent.filter((s) => s.pid === "A" && s.event === "park:vc").at(-1).payload.on, [a.you])
    assert.equal(park.voiceSignal("A", { to: b.you, kind: "bye" }).ok, false)
    // voice off answers without ICE
    const off = await park.voiceOn("A", false)
    assert.equal(off.ok, true)
    assert.equal(off.ice, undefined)
    // not in a park: refused
    assert.equal((await park.voiceOn("Z", true)).ok, false)
  } finally {
    park.stop()
  }
})
