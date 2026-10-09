// My Park activities with a friend (client park/acts/): the ask (tennis, H-O-R-S-E, a workout
// together), a yes makes a private "parkact" relay room for the two, the relay's checks.
const test = require("node:test")
const assert = require("node:assert")
const { createPark } = require("..")
const { cleanData, KINDS, ACT_MODES } = require("../together")
const { createRooms } = require("../../arcade/rooms")
const ROOM_GAMES = require("../../arcade/games")
const parkact = require("../../arcade/games/parkact")

const setup = () => {
  let t = 1_000_000
  const clock = { now: () => t, setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {}, advance: (ms) => (t += ms) }
  const inbox = new Map()
  const emit = (pid, event, payload) => (inbox.get(pid) || inbox.set(pid, []).get(pid)).push({ event, payload })
  const rooms = createRooms({ games: ROOM_GAMES, emit, emitVolatile: emit, clock })
  const park = createPark({ emit, emitVolatile: emit, rooms, clock })
  const me = (i) => ({ pid: `pid${i}`, name: ["", "Ava", "Ben", "Cal"][i], key: `key${i}` })
  const got = (pid, event) => (inbox.get(pid) || []).filter((m) => m.event === event).map((m) => m.payload)
  const at = (pid, x, z) => {
    clock.advance(200)
    park.pos(pid, [Math.round(x * 20), Math.round(z * 20), 0, 0, 0])
  }
  return { park, rooms, me, got, at, inbox }
}

test("an activity together: asked, said yes, a parkact room for the two, both told", () => {
  const { park, rooms, me, got, at } = setup()
  const a = park.join(me(1), { venue: "loscab" })
  const b = park.join(me(2), { venue: "loscab" })
  at("pid1", 0, 0)
  at("pid2", 2, 0)
  // the kinds and their data
  for (const k of ["tennis", "horse", "workout"]) assert.ok(KINDS[k]?.act, k)
  assert.deepEqual(cleanData("tennis", { spot: "tennis3", mode: "rally" }), { spot: "tennis3", mode: "rally" })
  assert.deepEqual(cleanData("tennis", { spot: "tennis3", mode: "golf" }), { spot: "tennis3", mode: "match" })
  assert.equal(cleanData("tennis", { spot: "<b>" }), null)
  assert.equal(cleanData("workout", {}), null)
  assert.deepEqual(ACT_MODES.horse, ["horse"])
  // too far apart
  at("pid2", 40, 0)
  assert.match(park.tgAsk("pid1", { to: b.you, kind: "tennis", data: { spot: "tennis1", mode: "match" } }).error, /Walk over/)
  at("pid2", 2, 0)
  const r = park.tgAsk("pid1", { to: b.you, kind: "tennis", data: { spot: "tennis1", mode: "match" } })
  assert.equal(r.ok, true)
  assert.equal(got("pid2", "park:ask").at(-1).kind, "tennis")
  // a no: nothing starts
  assert.equal(park.tgAnswer("pid2", { id: r.id, yes: false }).ok, true)
  assert.equal(got("pid1", "park:act").length, 0)
  // a yes: the room, both seated and playing, both told who hosts
  const r2 = park.tgAsk("pid1", { to: b.you, kind: "tennis", data: { spot: "tennis1", mode: "rally" } })
  assert.equal(park.tgAnswer("pid2", { id: r2.id, yes: true }).ok, true)
  const ga = got("pid1", "park:act").at(-1)
  const gb = got("pid2", "park:act").at(-1)
  assert.ok(ga && gb && ga.roomId === gb.roomId)
  assert.equal(ga.host, a.you)
  assert.equal(gb.host, a.you)
  assert.equal(ga.with, b.you)
  assert.equal(gb.with, a.you)
  assert.equal(ga.name, "Ben")
  assert.equal(ga.spot, "tennis1")
  assert.equal(ga.mode, "rally")
  assert.ok(Number.isInteger(ga.seed))
  const room = rooms.rooms.get(ga.roomId)
  assert.equal(room.game.id, "parkact")
  assert.equal(room.phase, "playing")
  assert.deepEqual(room.settings, { act: "tennis", mode: "rally", venue: "loscab", spot: "tennis1", seed: ga.seed, level: "normal" })
  // they're still in the park, walking (not "playing" a court)
  assert.equal(park.tgAsk("pid1", { to: b.you, kind: "hug" }).ok, true)
  // H-O-R-S-E and a workout too
  const h = park.tgAsk("pid2", { to: a.you, kind: "horse", data: { spot: "hoops1" } })
  assert.equal(park.tgAnswer("pid1", { id: h.id, yes: true }).ok, true)
  assert.equal(got("pid1", "park:act").at(-1).kind, "horse")
  assert.equal(got("pid1", "park:act").at(-1).host, b.you, "the asker hosts")
})

test("parkact: settings and relay messages are checked", () => {
  assert.deepEqual(parkact.validateSettings({ act: "horse", spot: "hoops2", venue: "sinaloa", seed: 7 }), { act: "horse", mode: "horse", venue: "sinaloa", spot: "hoops2", seed: 7, level: "normal" })
  assert.ok(parkact.validateSettings({ act: "golf" }).error)
  assert.ok(parkact.validateSettings({ act: "tennis", mode: "horse" }).error)
  assert.ok(parkact.validateSettings({ act: "tennis", spot: "../x" }).error)
  assert.equal(parkact.relay, true)
  assert.equal(parkact.filterRelay({ t: "hack" }), null)
  assert.equal(parkact.filterRelay([1, 2]), null)
  assert.deepEqual(parkact.filterRelay({ t: "swing", sw: { u: 0.123456, pace: 0.5, tap: false } }), { t: "swing", sw: { u: 0.123, pace: 0.5, tap: false } })
  assert.equal(parkact.filterRelay({ t: "shot", big: "x".repeat(5000) }).big.length, 60)
  // nesting and long arrays are cut down
  const deep = parkact.filterRelay({ t: "beat", a: { b: { c: { d: 1 } } }, list: Array.from({ length: 100 }, (_, i) => i) })
  assert.equal(deep.list.length, 24)
  assert.equal(deep.a.b, null)
})
