// My Park leisure on the server: what's in your hand (park:hold), a sip / a splash / a race's
// time (park:fx), the Together kinds (swim, tub, treat: by consent), and the account's park finds
// (Vince's car keys: server/park/finds.js) with Delete My Account's step.
const test = require("node:test")
const assert = require("node:assert")
const { createPark } = require("..")
const { cleanData, KINDS } = require("../together")
const { createParkFinds, memoryFindsStore, FINDS } = require("../finds")

const setup = () => {
  const inbox = new Map()
  const emit = (pid, event, payload) => (inbox.get(pid) || inbox.set(pid, []).get(pid)).push({ event, payload })
  const park = createPark({ emit, emitVolatile: emit })
  const got = (pid, event) => (inbox.get(pid) || []).filter((m) => m.event === event).map((m) => m.payload)
  return { park, got, inbox }
}

test("park:hold: what you're eating or drinking, shown to everyone and to whoever joins", () => {
  const { park, got } = setup()
  const a = { pid: "a", name: "Ava", key: "ava" }
  const b = { pid: "b", name: "Ben", key: "ben" }
  park.join(a, { venue: "loscab" })
  park.join(b, { venue: "loscab" })
  assert.equal(park.hold("a", { item: "mango" }).ok, true)
  const seen = got("b", "park:person").filter((p) => p.name === "Ava").pop()
  assert.equal(seen.held, "mango")
  // (only ids that look like the menu's; anything else is nothing in hand)
  park.hold("a", { item: "<script>" })
  assert.equal(got("b", "park:person").filter((p) => p.name === "Ava").pop().held, null)
  park.hold("a", { item: "fizz" })
  // someone joining later sees it in the people list
  const c = { pid: "c", name: "Cal", key: null }
  const r = park.join(c, { venue: "loscab" })
  assert.equal(r.people.find((p) => p.name === "Ava").held, "fizz")
})

test("park:fx: a sip, a splash, a swim race's time; nonsense refused", () => {
  const { park, got } = setup()
  park.join({ pid: "a", name: "Ava", key: "ava" }, { venue: "paseo" })
  park.join({ pid: "b", name: "Ben", key: "ben" }, { venue: "paseo" })
  assert.equal(park.fx("a", { emote: "sip" }).ok, true)
  assert.equal(park.fx("a", { emote: "splash" }).ok, true)
  assert.equal(park.fx("a", { lap: 34812 }).ok, true)
  assert.equal(park.fx("a", { lap: -5 }).ok, false)
  assert.equal(park.fx("a", { lap: 9e9 }).ok, false)
  assert.equal(park.fx("a", { emote: "moonwalk" }).ok, false)
  const fx = got("b", "park:fx")
  assert.deepEqual(fx.map((f) => f.emote || f.lap), ["sip", "splash", 34812])
})

test("Together's leisure kinds: swim (together or a race), the hot tub's two seats, a treat", () => {
  for (const k of ["swim", "tub", "treat"]) assert.ok(KINDS[k], k)
  assert.deepEqual(cleanData("swim", { spot: "swim1", mode: "race" }), { spot: "swim1", mode: "race" })
  assert.deepEqual(cleanData("swim", { spot: "swim1", mode: "dive" }), { spot: "swim1", mode: "together" })
  assert.equal(cleanData("swim", { spot: "../x" }), null)
  assert.deepEqual(cleanData("tub", { spot: "tub1", seats: ["tub0", "tub1"] }), { spot: "tub1", seats: ["tub0", "tub1"] })
  assert.equal(cleanData("tub", { spot: "tub1", seats: ["tub0", "tub0"] }), null)
  assert.equal(cleanData("tub", { spot: "tub1", seats: ["bench3", "tub1"] }), null)
  assert.deepEqual(cleanData("treat", { item: "lemonade", price: 0 }), { item: "lemonade" })
  assert.equal(cleanData("treat", { item: "free money" }), null)
  // (a treat only face to face; a swim from anywhere round the pool)
  assert.ok(KINDS.treat.near <= 8 && KINDS.swim.near >= 30)
})

test("a treat is asked first; a yes tells both (the asker pays then), a no only the asker", () => {
  const { park, got } = setup()
  const a = { pid: "a", name: "Ava", key: "ava" }
  const b = { pid: "b", name: "Ben", key: "ben" }
  park.join(a, { venue: "smash" })
  park.join(b, { venue: "smash" })
  park.pos("a", [0, 0, 0, 0, 0])
  park.pos("b", [40, 0, 0, 0, 0])
  const ask = park.tgAsk("a", { to: 2, kind: "treat", data: { item: "lemonade" } })
  assert.equal(ask.ok, true, ask.error)
  const asked = got("b", "park:ask").pop()
  assert.equal(asked.kind, "treat")
  assert.deepEqual(asked.data, { item: "lemonade" })
  assert.equal(park.tgAnswer("b", { id: asked.id, yes: true }).ok, true)
  const tgA = got("a", "park:tg").pop()
  const tgB = got("b", "park:tg").pop()
  assert.equal(tgA.kind, "treat")
  assert.equal(tgB.kind, "treat")
  // a no: nothing starts
  const ask2 = park.tgAsk("a", { to: 2, kind: "treat", data: { item: "fries" } })
  const asked2 = got("b", "park:ask").pop()
  park.tgAnswer("b", { id: asked2.id, yes: false })
  assert.equal(got("a", "park:answer").pop().yes, false)
  assert.equal(got("b", "park:tg").length, 1)
  void ask2
})

test("park finds: per account, only known finds, kept once, erased with the account", async () => {
  const store = memoryFindsStore()
  let t = 1000
  const finds = createParkFinds({ store, now: () => t })
  assert.deepEqual(FINDS, ["keys"])
  assert.deepEqual(await finds.get("ava"), { ok: true, finds: {} })
  assert.equal((await finds.get("")).ok, false)
  const r = await finds.add("ava", "keys", { venue: "smash" })
  assert.equal(r.ok && r.fresh, true)
  assert.deepEqual(r.finds.keys, { at: 1000, venue: "smash" })
  t = 2000
  const again = await finds.add("ava", "keys", { venue: "loscab" })
  assert.equal(again.fresh, false)
  assert.equal(again.finds.keys.at, 1000, "the first find stays")
  assert.equal((await finds.add("ava", "gold", {})).ok, false)
  // (a venue that isn't a venue id isn't kept)
  await finds.add("ben", "keys", { venue: "<b>" })
  assert.equal((await finds.get("ben")).finds.keys.venue, null)
  // Delete My Account
  assert.deepEqual(await finds.eraseAccount({ key: "ava" }), { removed: true })
  assert.deepEqual(await finds.get("ava"), { ok: true, finds: {} })
  assert.deepEqual(await finds.eraseAccount({ key: "ava" }), { removed: false }, "again: nothing left")
  assert.equal(store.docs.has("ben"), true, "only that account")
})

test("park finds over the park's sockets: signed on only", async () => {
  const finds = createParkFinds({ store: memoryFindsStore() })
  const inbox = []
  const park = createPark({ emit: () => {}, finds })
  // a fake socket: the handlers wire() registers, called as the client would
  const handlers = {}
  const socket = { on: (ev, fn) => (handlers[ev] = fn) }
  let who = { pid: "a", name: "Ava", key: "ava" }
  park.wire(socket, () => ({ pid: "a" }), () => who)
  const call = (ev, payload) => new Promise((res) => handlers[ev](payload, res))
  assert.equal((await call("park:find", { id: "keys", venue: "wolfbear" })).ok, true)
  assert.equal((await call("park:finds", {})).finds.keys.venue, "wolfbear")
  who = { pid: "b", name: "Guest", key: null }
  assert.equal((await call("park:finds", {})).ok, false)
  void inbox
})
