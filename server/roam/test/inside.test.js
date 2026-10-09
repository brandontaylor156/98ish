// Explore: going inside (a private office/home by invitation, a public store), the shared cart,
// solo emotes everyone sees, things put down in town, and doing things together by consent.
const test = require("node:test")
const assert = require("node:assert/strict")
const { createRoam } = require("..")
const { ORIGIN, STRIDE } = require("../inside")

const setup = () => {
  let now = 1000
  const clock = { now: () => now, setInterval: () => 1, clearInterval: () => {} }
  const out = []
  const roam = createRoam({ emit: (pid, event, payload) => out.push({ pid, event, payload }), clock, ice: { config: async () => ({ iceServers: [], turn: false }) } })
  const who = (pid, name = pid, key = pid) => ({ pid, name, key })
  return { roam, out, who, tick: (ms) => (now += ms), sent: (pid, event) => out.filter((m) => m.pid === pid && m.event === event) }
}

test("a private office: only the owner, then whoever they invite; both in the same room and slot", () => {
  const { roam, who, sent } = setup()
  const a = roam.join(who("a", "Ava"), { town: "valencia" })
  const b = roam.join(who("b", "Ben"), { town: "valencia" })
  const r = roam.enterRoom("a", { kind: "office", label: "Work", seed: 42 })
  assert.ok(r.ok, r.error)
  assert.equal(r.kind, "office")
  assert.deepEqual(r.origin, { x: ORIGIN.x + r.slot * STRIDE, z: ORIGIN.z })
  assert.equal(sent("b", "roam:in")[0].payload.room, r.room, "the town knows Ava went in (her figure goes)")
  // Ben can't walk in uninvited
  assert.equal(roam.enterRoom("b", { room: r.room }).ok, false)
  assert.equal(roam.inviteIn("b", { num: a.you }).ok, false, "only the owner invites")
  assert.ok(roam.inviteIn("a", { num: b.you }).ok)
  const inv = sent("b", "roam:invite")[0].payload
  assert.equal(inv.name, "Ava")
  assert.equal(inv.kind, "office")
  const rb = roam.enterRoom("b", { room: inv.room })
  assert.ok(rb.ok)
  assert.equal(rb.slot, r.slot)
  assert.equal(rb.seed, 42)
  assert.deepEqual(rb.people, [a.you])
  // the cart/TV/sitting talk goes to the room only
  const c = roam.join(who("c", "Cy"), { town: "valencia" })
  assert.ok(roam.sayIn("a", { kind: "tv", data: { on: true } }).ok)
  assert.equal(sent("b", "roam:say")[0].payload.data.on, true)
  assert.equal(sent("c", "roam:say").length, 0)
  assert.equal(roam.sayIn("a", { kind: "hack", data: 1 }).ok, false)
  // leaving: Ava out, Ben still in; the room goes when empty and its slot is free again
  roam.exitRoom("a")
  roam.exitRoom("b")
  const again = roam.enterRoom("c", { kind: "home" })
  assert.equal(again.slot, r.slot)
  void c
})

test("a public store: one room per building, anyone walks in; the shared cart reaches the other shopper", () => {
  const { roam, who, sent } = setup()
  roam.join(who("a", "Ava"), { town: "valencia" })
  const b = roam.join(who("b", "Ben"), { town: "valencia" })
  const ra = roam.enterRoom("a", { kind: "club", key: "16:11236:26100:7" })
  const rb = roam.enterRoom("b", { kind: "club", key: "16:11236:26100:7" })
  assert.equal(ra.room, rb.room)
  assert.equal(roam.enterRoom("a", { kind: "club" }).ok, false, "which building?")
  roam.sayIn("b", { kind: "cart", data: { op: "add", uid: "u1", id: "grill", by: "Ben" } })
  assert.equal(sent("a", "roam:say").at(-1).payload.data.id, "grill")
  assert.equal(sent("a", "roam:say").at(-1).payload.from, b.you)
})

test("emotes: everyone in town sees a wave; unknown ones and floods refused", () => {
  const { roam, who, sent } = setup()
  const a = roam.join(who("a", "Ava"), { town: "valencia" })
  roam.join(who("b", "Ben"), { town: "valencia" })
  assert.ok(roam.emote("a", { kind: "wave" }).ok)
  assert.deepEqual(sent("b", "roam:emote")[0].payload, { num: a.you, kind: "wave" })
  assert.equal(roam.emote("a", { kind: "rude" }).ok, false)
  let ok = 0
  for (let i = 0; i < 30; i++) ok += roam.emote("a", { kind: "cheer" }).ok ? 1 : 0
  assert.ok(ok < 13)
})

test("things put down: seen by all, 4 each (the oldest picked up), gone when you leave", () => {
  const { roam, who, sent } = setup()
  roam.join(who("a", "Ava"), { town: "valencia" })
  roam.join(who("b", "Ben"), { town: "valencia" })
  const g = roam.placeIt("a", { kind: "grill", x: 10, z: 20, yaw: 1 })
  assert.ok(g.ok)
  assert.equal(sent("b", "roam:placed")[0].payload.item.kind, "grill")
  assert.equal(roam.placeIt("a", { kind: "tank", x: 0, z: 0, yaw: 0 }).ok, false)
  for (const k of ["cooler", "umbrella", "chairs", "blanket"]) roam.placeIt("a", { kind: k, x: 1, z: 1, yaw: 0 })
  assert.equal(sent("b", "roam:unplaced")[0].payload.id, g.item.id)
  // a newcomer sees what's out
  const c = roam.join(who("c", "Cy"), { town: "valencia" })
  assert.equal(c.placed.length, 4)
  assert.equal(roam.unplaceIt("c", { id: c.placed[0].id }).ok, false, "only your own")
  roam.leave("a")
  assert.equal(roam.join(who("d", "Di"), { town: "valencia" }).placed.length, 0)
})

test("together in town: a hug only after a yes, close by, signed on; holding hands links the two", () => {
  const { roam, who, sent } = setup()
  const a = roam.join(who("a", "Ava"), { town: "valencia" })
  const b = roam.join(who("b", "Ben"), { town: "valencia" })
  roam.pos("a", [0, 0, 0, 0, 0, 0])
  roam.pos("b", [30, 0, 0, 0, 0, 0]) // 3 m apart
  // things My Park has but town doesn't
  assert.equal(roam.tgAsk("a", { to: b.you, kind: "team" }).ok, false)
  const ask = roam.tgAsk("a", { to: b.you, kind: "hug" })
  assert.ok(ask.ok, ask.error)
  assert.equal(sent("b", "roam:ask")[0].payload.kind, "hug")
  assert.equal(sent("a", "roam:tg").length, 0, "nothing happens before a yes")
  assert.ok(roam.tgAnswer("b", { id: ask.id, yes: true }).ok)
  assert.deepEqual(sent("a", "roam:tg")[0].payload, { kind: "hug", a: a.you, b: b.you, data: {} })
  // a no
  const ask2 = roam.tgAsk("a", { to: b.you, kind: "dance" })
  roam.tgAnswer("b", { id: ask2.id, yes: false })
  assert.equal(sent("a", "roam:answer").at(-1).payload.yes, false)
  // too far for a hug
  roam.pos("b", [300, 0, 0, 0, 0, 0])
  assert.equal(roam.tgAsk("a", { to: b.you, kind: "hug" }).ok, false)
  // holding hands: linked, and drifting apart ends it
  roam.pos("b", [30, 0, 0, 0, 0, 0])
  const h = roam.tgAsk("a", { to: b.you, kind: "hand" })
  roam.tgAnswer("b", { id: h.id, yes: true })
  assert.equal(sent("b", "roam:link").at(-1).payload.kind, "hand")
  roam.pos("b", [400, 0, 0, 0, 0, 0])
  assert.equal(sent("b", "roam:link").at(-1).payload.kind, null)
  // guests (no account) can't
  const g = roam.join({ pid: "g", name: "Guest", key: null }, { town: "valencia" })
  roam.pos("g", [10, 0, 0, 0, 0, 0])
  assert.equal(roam.tgAsk("a", { to: g.you, kind: "hug" }).ok, false)
})
