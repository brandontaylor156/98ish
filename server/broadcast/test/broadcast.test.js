// node --test server/broadcast/test/broadcast.test.js
const test = require("node:test")
const assert = require("node:assert/strict")
const { createBroadcasts, validTick, cleanEvent } = require("..")

// a tick as packet.js makes it: u8 1 | u8 n | u32 t | n x 7 bytes
const tick = (tMs, n = 4) => {
  const b = Buffer.alloc(6 + 7 * n)
  b[0] = 1
  b[1] = n
  b.writeUInt32LE(tMs, 2)
  for (let i = 0; i < n; i++) b.writeInt16LE(i * 100, 6 + i * 7)
  return b
}

const setup = ({ limits = {} } = {}) => {
  let clock = 1_000_000
  const sent = [] // [pid, event, payload]
  const live = [] // bc:live notices: [key, info]
  const pushes = []
  const user = (screenName, buddies = [], blocked = []) => ({ screenName, groups: [{ name: "Buddies", buddies }], blocked })
  const sessions = new Map([
    ["brandon", { user: user("Brandon", ["Kim", "Sam", "Blocky"]), socket: { emit: (e, d) => e === "bc:live" && live.push(["brandon", d]) } }],
    ["kim", { user: user("Kim", ["Brandon"]), socket: { emit: (e, d) => e === "bc:live" && live.push(["kim", d]) } }],
    ["sam", { user: user("Sam", []), socket: { emit: (e, d) => e === "bc:live" && live.push(["sam", d]) } }],
    ["blocky", { user: user("Blocky", ["Brandon"], ["brandon"]), socket: { emit: (e, d) => e === "bc:live" && live.push(["blocky", d]) } }],
    ["eve", { user: user("Eve", ["Brandon"]), socket: { emit: () => {} } }],
  ])
  const bc = createBroadcasts({
    emit: (pid, event, payload) => sent.push([pid, event, payload]),
    aim: () => ({ sessions }),
    notify: (key, msg) => pushes.push([key, msg]),
    now: () => clock,
    limits,
  })
  const me = (pid, key, name) => ({ pid, key, name })
  return { bc, sent, live, pushes, me, advance: (ms) => (clock += ms), sessionsMap: sessions }
}

test("ticks and events are checked; bad ones are dropped", () => {
  assert.ok(validTick(tick(5)))
  assert.ok(validTick(tick(5, 2)))
  assert.ok(!validTick(Buffer.from([2, 0, 0, 0, 0, 0])))
  assert.ok(!validTick(Buffer.alloc(200)))
  assert.ok(!validTick(tick(5).subarray(0, 20)))
  assert.ok(!validTick("nope"))
  assert.equal(cleanEvent({ k: "hit", p: 7 }), null)
  assert.equal(cleanEvent({ k: "eval", code: "x" }), null)
  assert.equal(cleanEvent({ k: "roster", players: [{ name: "a".repeat(80) }] }).players[0].name.length, 32)
})

test("a broadcast: buddies are told, ticks relay to viewers, late joiners get the last minute", () => {
  const { bc, sent, live, pushes, me, advance } = setup()
  const host = me("p1", "brandon", "Brandon")
  const r = bc.start(host, { title: "Saturday doubles", venue: "loscab", court: "7", players: [{ name: "Brandon" }, { name: "Kim" }, { name: "Sam", team: 1 }, { name: "Lee", team: 1 }], venueName: "Los Cab", courtName: "Court 7" })
  assert.ok(r.ok && /^[0-9a-f]{12}$/.test(r.id))
  // Kim and Sam (buddies) told; Blocky blocked Brandon: not told
  assert.deepEqual(live.map((l) => l[0]).sort(), ["kim", "sam"])
  assert.deepEqual(pushes.map((p) => p[0]).sort(), ["kim", "sam"])
  assert.match(pushes[0][1].title, /Brandon is live at Los Cab, Court 7/)
  assert.match(pushes[0][1].url, new RegExp(`live=${r.id}`))
  // 90 s of ticks at 10 a second
  for (let i = 0; i < 900; i++) {
    bc.tick("p1", tick(i * 100))
    advance(100)
  }
  bc.event(host, { k: "hit", t: 80000, p: 1, h: 90, s: "fh", src: "sound" })
  bc.event(host, { k: "score", a: 3, b: 2, call: "3-2-1" })
  // Kim (a buddy) watches: about the last 60 s come with it, plus the score and the hit
  const w = bc.watch(me("p2", "kim", "Kim"), { id: r.id })
  assert.ok(w.ok, w.error)
  assert.equal(w.ring.length % 34, 0)
  const n = w.ring.length / 34
  assert.ok(n >= 590 && n <= 610, `ring ${n}`)
  assert.equal(w.ring.readUInt32LE(w.ring.length - 34 + 2), 89900)
  assert.ok(w.events.some((e) => e.k === "hit") && w.events.some((e) => e.k === "score" && e.a === 3))
  assert.equal(w.info.title, "Saturday doubles")
  // new ticks reach Kim
  sent.length = 0
  bc.tick("p1", tick(90000))
  assert.ok(sent.some(([pid, ev, d]) => pid === "p2" && ev === "bc:t" && d.length === 34))
  // a viewer can't send ticks or events
  sent.length = 0
  bc.tick("p2", tick(1))
  assert.equal(sent.length, 0)
  assert.equal(bc.event(me("p2", "kim", "Kim"), { k: "score", a: 9 }).ok, false)
  // reactions go round (rate limited to one a second)
  assert.equal(bc.react(me("p2", "kim", "Kim"), { e: "🔥" }).ok, true)
  assert.equal(bc.react(me("p2", "kim", "Kim"), { e: "🔥" }).ok, false)
  assert.equal(bc.react(me("p2", "kim", "Kim"), { e: "<script>" }).ok, false)
  // the host stops: viewers are told; it's gone
  sent.length = 0
  bc.stop(host)
  assert.ok(sent.some(([pid, ev]) => pid === "p2" && ev === "bc:end"))
  assert.equal(bc.watch(me("p2", "kim", "Kim"), { id: r.id }).ok, false)
  // a second broadcast within 30 minutes: told live, but no second push
  const r2 = bc.start(host, { title: "again", players: [] })
  assert.ok(r2.ok)
  assert.equal(pushes.length, 2)
})

test("who may watch: buddies and the link, not strangers or blocked people; caps", () => {
  const { bc, me } = setup({ limits: { maxViewers: 2, maxBroadcasts: 2 } })
  const r = bc.start(me("p1", "brandon", "Brandon"), { players: [] })
  // Eve has Brandon as a buddy but isn't on Brandon's list: no
  assert.equal(bc.watch(me("p5", "eve", "Eve"), { id: r.id }).ok, false)
  // a guest with the link's code: yes
  assert.equal(bc.watch(me("p6", null, "GUEST-1"), { code: r.code }).ok, true)
  // blocked: not even with the code
  assert.equal(bc.watch(me("p7", "blocky", "Blocky"), { code: r.code }).ok, false)
  // the list shows Brandon's game to Kim, not to Eve
  assert.equal(bc.list(me("p2", "kim", "Kim")).live.length, 1)
  assert.equal(bc.list(me("p5", "eve", "Eve")).live.length, 0)
  // viewer cap
  assert.equal(bc.watch(me("p2", "kim", "Kim"), { id: r.id }).ok, true)
  assert.equal(bc.watch(me("p3", "sam", "Sam"), { id: r.id }).ok, false)
  // broadcast cap
  assert.ok(bc.start(me("p8", "sam", "Sam"), { players: [] }).ok)
  assert.equal(bc.start(me("p9", "kim", "Kim"), { players: [] }).ok, false)
  // the host leaving the network ends it; viewers dropping frees their seat
  bc.drop("p2")
  assert.equal(bc.broadcasts.get(r.id).viewers.size, 1)
  bc.drop("p1")
  assert.equal(bc.broadcasts.has(r.id), false)
})

test("ticks are rate limited and the bandwidth stays small", () => {
  const { bc, me, advance } = setup()
  const r = bc.start(me("p1", "brandon", "Brandon"), { players: [] })
  bc.watch(me("p2", "kim", "Kim"), { id: r.id })
  // 100 ticks in the same instant: at most 25 get through
  for (let i = 0; i < 100; i++) bc.tick("p1", tick(i))
  assert.equal(bc.stats().ticksIn, 25)
  advance(1000)
  // an hour at 10 ticks a second, one viewer: bytes in + out
  const before = bc.stats()
  for (let i = 0; i < 36000; i++) {
    bc.tick("p1", tick(i * 100))
    advance(100)
  }
  const s = bc.stats()
  const mb = (s.bytesIn - before.bytesIn + s.bytesOut - before.bytesOut) / 1024 / 1024
  assert.ok(mb < 3, `${mb.toFixed(2)} MB of payload an hour with one viewer`)
})
