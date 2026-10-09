// My Park "Together": asking and saying yes (consent), breaking away, games as a team.
const test = require("node:test")
const assert = require("node:assert")
const { createPark } = require("..")
const { cleanData, KINDS } = require("../together")
const { createRooms } = require("../../arcade/rooms")
const ROOM_GAMES = require("../../arcade/games")
const pickleball = require("../../arcade/games/pickleball")

const fakeClock = () => {
  let t = 1_000_000
  let nextId = 1
  const timers = new Map()
  return {
    now: () => t,
    setTimeout: (fn, ms) => (timers.set(nextId, { fn, at: t + ms, every: 0 }), nextId++),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, ms) => (timers.set(nextId, { fn, at: t + ms, every: ms }), nextId++),
    clearInterval: (id) => timers.delete(id),
    advance(ms) {
      const end = t + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        const [id, x] = due
        t = x.at
        if (x.every) x.at += x.every
        else timers.delete(id)
        x.fn()
      }
      t = end
    },
  }
}

const setup = ({ blockedPairs = [] } = {}) => {
  const clock = fakeClock()
  const inbox = new Map()
  const emit = (pid, event, payload) => (inbox.get(pid) || inbox.set(pid, []).get(pid)).push({ event, payload })
  const rooms = createRooms({ games: ROOM_GAMES, emit, emitVolatile: emit, clock })
  const blocked = (a, b) => blockedPairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
  const park = createPark({ emit, emitVolatile: emit, rooms, clock, blocked })
  const me = (i, signed = true) => ({ pid: `pid${i}`, name: ["", "Ava", "Ben", "Cal", "Dee"][i], key: signed ? `key${i}` : null })
  const got = (pid, event) => (inbox.get(pid) || []).filter((m) => m.event === event).map((m) => m.payload)
  const last = (pid, event) => got(pid, event).at(-1)
  // stand someone at (x, z) metres
  const at = (pid, x, z) => {
    clock.advance(200)
    assert.equal(park.pos(pid, [Math.round(x * 20), Math.round(z * 20), 0, 0, 0]), true)
  }
  return { clock, park, rooms, me, got, last, at, inbox }
}

test("asking: signed-on people near each other, never blocked, cleaned data", () => {
  const { park, me, at, last } = setup({ blockedPairs: [["pid1", "pid3"]] })
  const a = park.join(me(1), {})
  const b = park.join(me(2), {})
  park.join(me(3), {})
  park.join(me(4, false), {})
  at("pid1", 0, 0)
  at("pid2", 1, 0)
  at("pid3", 1, 1)
  at("pid4", 2, 0)
  assert.equal(park.tgAsk("pid1", { to: b.you, kind: "dance-off" }).ok, false)
  assert.equal(park.tgAsk("pid1", { to: a.you, kind: "hand" }).ok, false) // yourself
  assert.match(park.tgAsk("pid1", { to: 4, kind: "hand" }).error, /signed on/) // a guest
  assert.equal(park.tgAsk("pid1", { to: 3, kind: "hand" }).ok, false) // blocked
  assert.equal(last("pid3", "park:ask"), undefined)
  const r = park.tgAsk("pid1", { to: b.you, kind: "hand" })
  assert.equal(r.ok, true)
  assert.deepEqual(last("pid2", "park:ask"), { id: r.id, from: a.you, name: "Ava", kind: "hand", data: {} })
  // too far for holding hands
  at("pid2", 30, 0)
  assert.match(park.tgAsk("pid1", { to: b.you, kind: "hug" }).error, /Walk over/)
  // seats: two different short ids
  assert.deepEqual(cleanData("sit", { seats: ["b3:0", "b3:1"] }), { seats: ["b3:0", "b3:1"] })
  assert.equal(cleanData("sit", { seats: ["b3:0", "b3:0"] }), null)
  assert.equal(cleanData("sunset", { seats: ["<script>", "x"] }), null)
  assert.deepEqual(cleanData("team", { court: 2 }), { court: 2 })
  assert.deepEqual(cleanData("team", { court: "2" }), { court: null })
  assert.deepEqual(cleanData("hug", { evil: 1 }), {})
  assert.ok(Object.keys(KINDS).length >= 12)
  park.stop()
})

test("consent: nothing starts without a yes; no stays private; asks expire", () => {
  const { park, me, at, got, last, clock } = setup()
  const a = park.join(me(1), {})
  const b = park.join(me(2), {})
  const c = park.join(me(3), {})
  at("pid1", 0, 0)
  at("pid2", 1, 0)
  at("pid3", 2, 2)
  const r = park.tgAsk("pid1", { to: b.you, kind: "hand" })
  // nobody hears of a link before the yes
  assert.equal(got("pid1", "park:link").length + got("pid2", "park:link").length + got("pid3", "park:link").length, 0)
  // only the one asked can answer
  assert.equal(park.tgAnswer("pid3", { id: r.id, yes: true }).ok, false)
  assert.equal(park.tgAnswer("pid1", { id: r.id, yes: true }).ok, false)
  assert.equal(park.tgAnswer("pid2", { id: r.id, yes: false }).ok, true)
  assert.deepEqual(last("pid1", "park:answer"), { id: r.id, yes: false, num: b.you })
  assert.equal(got("pid3", "park:answer").length, 0) // a no is between the two
  assert.equal(got("pid3", "park:link").length, 0)
  // answered once: gone
  assert.equal(park.tgAnswer("pid2", { id: r.id, yes: true }).ok, false)
  // an ask left waiting expires
  const r2 = park.tgAsk("pid1", { to: b.you, kind: "selfie" })
  clock.advance(31_000)
  at("pid1", 0, 0)
  at("pid2", 1, 0)
  assert.match(park.tgAnswer("pid2", { id: r2.id, yes: true }).error, /gone/)
  assert.equal(got("pid2", "park:tg").length, 0)
  // a yes: everyone in the park sees the hug (the two and the bystander)
  const r3 = park.tgAsk("pid1", { to: b.you, kind: "hug" })
  assert.equal(park.tgAnswer("pid2", { id: r3.id, yes: true }).ok, true)
  for (const pid of ["pid1", "pid2", "pid3"]) assert.deepEqual(last(pid, "park:tg"), { kind: "hug", a: a.you, b: b.you, data: {} })
  assert.equal(last("pid1", "park:answer").yes, true)
  // either can stop something they said yes to; a stranger can't stop it for them
  assert.equal(park.tgEnd("pid2", { to: a.you, kind: "date" }).ok, true)
  assert.deepEqual(last("pid1", "park:tgend"), { from: b.you, kind: "date" })
  assert.equal(park.tgEnd("pid3", { to: a.you, kind: "date" }).ok, false)
  assert.equal(c.ok, true)
  park.stop()
})

test("walking together: hold hands / follow, and either one breaks away at any time", () => {
  const { park, me, at, last } = setup()
  const a = park.join(me(1), {})
  const b = park.join(me(2), {})
  park.join(me(3), {})
  at("pid1", 0, 0)
  at("pid2", 1, 0)
  // hold hands: Ava asked, Ava leads
  const r = park.tgAsk("pid1", { to: b.you, kind: "hand" })
  park.tgAnswer("pid2", { id: r.id, yes: true })
  assert.deepEqual(last("pid3", "park:link"), { a: a.you, b: b.you, kind: "hand", lead: a.you, by: null })
  // Ben's own stick: he lets go (his browser says so); everyone sees it end
  assert.equal(park.tgUnlink("pid2").ok, true)
  assert.deepEqual(last("pid1", "park:link"), { a: a.you, b: b.you, kind: null, lead: null, by: b.you })
  assert.deepEqual(last("pid3", "park:link"), { a: a.you, b: b.you, kind: null, lead: null, by: b.you })
  // follow: Ben asks to follow Ava; Ava leads
  const f = park.tgAsk("pid2", { to: a.you, kind: "follow" })
  park.tgAnswer("pid1", { id: f.id, yes: true })
  assert.deepEqual(last("pid1", "park:link"), { a: b.you, b: a.you, kind: "follow", lead: a.you, by: null })
  // the leader can stop it too
  park.tgUnlink("pid1")
  assert.equal(last("pid2", "park:link").kind, null)
  // walking apart ends it
  const h = park.tgAsk("pid1", { to: b.you, kind: "hand" })
  park.tgAnswer("pid2", { id: h.id, yes: true })
  at("pid2", 30, 0)
  assert.deepEqual(last("pid1", "park:link"), { a: a.you, b: b.you, kind: null, lead: null, by: null })
  // and leaving the park
  at("pid2", 1, 0)
  const h2 = park.tgAsk("pid1", { to: b.you, kind: "hand" })
  park.tgAnswer("pid2", { id: h2.id, yes: true })
  park.leave("pid2")
  assert.equal(last("pid1", "park:link").kind, null)
  park.stop()
})

test("playing as a team: mixed doubles vs the computers on the court asked for; a co-op rally drill", () => {
  const { park, me, at, last, rooms } = setup()
  const a = park.join(me(1), {})
  const b = park.join(me(2), {})
  at("pid1", 0, 0)
  at("pid2", 1, 0)
  // holding hands, then a game: the link ends as they go on
  const h = park.tgAsk("pid1", { to: b.you, kind: "hand" })
  park.tgAnswer("pid2", { id: h.id, yes: true })
  const r = park.tgAsk("pid1", { to: b.you, kind: "team", data: { court: 2 } })
  assert.equal(park.tgAnswer("pid2", { id: r.id, yes: true }).ok, true)
  const go = last("pid1", "park:go")
  assert.equal(go.court, 2)
  assert.equal(go.kind, "room")
  assert.equal(go.together, "team")
  assert.deepEqual(last("pid2", "park:go"), go)
  const room = rooms.rooms.get(go.roomId)
  assert.equal(room.settings.teams, "us")
  assert.equal(room.settings.format, "doubles")
  assert.equal(room.phase, "playing")
  assert.equal(last("pid1", "park:link").kind, null)
  // the court is busy; while playing, no more asks
  assert.equal(park.instances.get(a.park).courts[2].game.kind, "room")
  assert.match(park.tgAsk("pid1", { to: b.you, kind: "hug" }).error, /playing/)
  park.done("pid1", 2)
  park.done("pid2", 2)
  assert.equal(park.instances.get(a.park).courts[2].game, null)
  // a rally drill: a two-person Free rally room; a busy court asked for -> another free one
  park.instances.get(a.park).courts[0].game = { kind: "solo", players: ["x"], score: [0, 0], since: 0 }
  const d = park.tgAsk("pid2", { to: a.you, kind: "rally", data: { court: 0 } })
  park.tgAnswer("pid1", { id: d.id, yes: true })
  const go2 = last("pid2", "park:go")
  assert.notEqual(go2.court, 0)
  assert.equal(go2.together, "rally")
  const room2 = rooms.rooms.get(go2.roomId)
  assert.equal(room2.settings.mode, "drill")
  assert.equal(room2.settings.drill, "rally")
  park.stop()
})

test("room settings: 'us' only for doubles matches", () => {
  assert.equal(pickleball.validateSettings({ format: "doubles", teams: "us" }).teams, "us")
  assert.equal(pickleball.validateSettings({ format: "singles", teams: "us" }).teams, undefined)
  assert.equal(pickleball.validateSettings({ format: "doubles", teams: "us", mode: "drill", drill: "rally" }).teams, undefined)
  assert.ok(pickleball.validateSettings({ teams: "everyone" }).error)
  assert.equal(pickleball.validateSettings({ format: "doubles" }).teams, undefined)
})
