const test = require("node:test")
const assert = require("node:assert")
const { createPark, pickInstance, cleanPos, cleanRep, rateFor, CAP, LINE_COUNT } = require("..")
const { createRooms } = require("../../arcade/rooms")
const ROOM_GAMES = require("../../arcade/games")

// a clock the test moves by hand: timers and intervals run when it's advanced
const fakeClock = () => {
  let t = 1_000_000
  let nextId = 1
  const timers = new Map()
  const c = {
    now: () => t,
    setTimeout: (fn, ms) => {
      const id = nextId++
      timers.set(id, { fn, at: t + ms, every: 0 })
      return id
    },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, ms) => {
      const id = nextId++
      timers.set(id, { fn, at: t + ms, every: ms })
      return id
    },
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
  return c
}

const setup = (opts = {}) => {
  const clock = fakeClock()
  const inbox = new Map() // pid -> [{ event, payload, fast }]
  const emit = (pid, event, payload) => (inbox.get(pid) || inbox.set(pid, []).get(pid)).push({ event, payload })
  const emitVolatile = (pid, event, payload) => (inbox.get(pid) || inbox.set(pid, []).get(pid)).push({ event, payload, fast: true })
  const rooms = createRooms({ games: ROOM_GAMES, emit, emitVolatile, clock })
  const park = createPark({ emit, emitVolatile, rooms, clock, ...opts })
  const me = (i) => ({ pid: `pid${i}`, name: `Person${i}`, key: null })
  const got = (pid, event) => (inbox.get(pid) || []).filter((m) => m.event === event)
  const clear = () => inbox.clear()
  return { clock, park, rooms, me, got, clear, inbox }
}

test("instances: the fullest park with room, a new one when full", () => {
  assert.equal(pickInstance([], 16), null)
  assert.deepEqual(pickInstance([{ n: 1, size: 3 }, { n: 2, size: 9 }], 16), { n: 2, size: 9 })
  assert.deepEqual(pickInstance([{ n: 1, size: 16 }, { n: 2, size: 4 }], 16), { n: 2, size: 4 })
  assert.equal(pickInstance([{ n: 1, size: 16 }], 16), null)
  assert.deepEqual(pickInstance([{ n: 3, size: 5 }, { n: 1, size: 5 }], 16), { n: 1, size: 5 })
  const { park, me } = setup({ cap: 3 })
  const parks = [0, 1, 2, 3, 4].map((i) => park.join(me(i), {}).park)
  assert.deepEqual(parks, [1, 1, 1, 2, 2])
  assert.equal(CAP, 16)
  park.stop()
})

test("join and leave: everyone hears about it; the park closes when empty", () => {
  const { park, me, got } = setup()
  const a = park.join(me(1), { look: { body: "f", shirt: "#ff0000", nonsense: 1 }, rep: { level: 2, wins: 5, losses: 1 } })
  assert.equal(a.ok, true)
  assert.equal(a.you, 1)
  assert.deepEqual(a.people, [])
  assert.equal(a.courts.length, 4)
  const b = park.join(me(2), {})
  assert.equal(b.people.length, 1)
  assert.equal(b.people[0].name, "Person1")
  assert.equal(b.people[0].look.shirt, "#ff0000")
  assert.equal(b.people[0].look.nonsense, undefined)
  assert.equal(b.people[0].rep.level, 2)
  assert.equal(got("pid1", "park:person").length, 1)
  park.leave("pid2")
  assert.deepEqual(got("pid1", "park:gone").map((m) => m.payload), [{ num: 2 }])
  park.leave("pid1")
  assert.equal(park.instances.size, 0)
  park.stop()
})

test("positions: checked, clamped to the park, batched and rate limited", () => {
  assert.equal(cleanPos([1, 2, 3]), null)
  assert.equal(cleanPos([1.5, 2, 3, 4, 5]), null)
  assert.equal(cleanPos(["1", 2, 3, 4, 5]), null)
  assert.deepEqual(cleanPos([99999, -99999, 300, 200, 99]), [Math.round(47.5 * 20), Math.round(-15.5 * 20), 255, 90, 15])
  assert.deepEqual(cleanRep({ level: 9, wins: -3 }), { level: 4, wins: 0, losses: 0, streak: 0 })
  const { park, me, got, clock } = setup()
  park.join(me(1), {})
  park.join(me(2), {})
  park.join(me(3), {})
  assert.equal(park.pos("pid1", [100, 20, 64, 14, 1]), true)
  assert.equal(park.pos("pid1", [100, 20, 64, 14]), false)
  assert.equal(park.pos("nobody", [100, 20, 64, 14, 1]), false)
  clock.advance(200)
  const to2 = got("pid2", "park:m")
  assert.equal(to2.length, 1)
  assert.equal(to2[0].fast, true)
  assert.deepEqual(to2[0].payload.m, [[1, 100, 20, 64, 14, 1]])
  // (your own position isn't sent back to you)
  assert.equal(got("pid1", "park:m").length, 0)
  // nothing new: nothing sent
  clock.advance(1000)
  assert.equal(got("pid2", "park:m").length, 1)
  // a flood is cut off
  let accepted = 0
  for (let i = 0; i < 100; i++) if (park.pos("pid3", [i, 0, 0, 0, 0])) accepted++
  assert.ok(accepted <= 30, `accepted ${accepted}`)
  park.stop()
})

test("emotes and lines: only known ones, rate limited", () => {
  const { park, me, got } = setup()
  park.join(me(1), {})
  park.join(me(2), {})
  assert.equal(park.fx("pid1", { emote: "cheer" }).ok, true)
  assert.equal(park.fx("pid1", { line: LINE_COUNT - 1 }).ok, true)
  assert.equal(park.fx("pid1", { line: LINE_COUNT }).ok, false)
  assert.equal(park.fx("pid1", { emote: "<script>" }).ok, false)
  assert.deepEqual(got("pid2", "park:fx").map((m) => m.payload), [{ num: 1, emote: "cheer" }, { num: 1, line: LINE_COUNT - 1 }])
  let ok = 0
  for (let i = 0; i < 20; i++) if (park.fx("pid1", { emote: "pump" }).ok) ok++
  assert.ok(ok < 10)
  park.stop()
})

test("call next: one rack at a time, in order; the front goes on when the court frees", () => {
  const { park, me, got } = setup({ rooms: null })
  for (let i = 1; i <= 3; i++) park.join(me(i), {})
  assert.equal(park.call("pid1", 2).position, 0)
  assert.equal(park.call("pid2", 2).position, 1)
  assert.equal(park.call("pid1", 2).position, 0) // (again: same place)
  assert.equal(park.call("pid3", 0).position, 0)
  // moving your paddle to another rack takes it out of the first
  park.call("pid3", 2)
  const courts = got("pid1", "park:courts").at(-1).payload
  assert.deepEqual(courts[0].q, [])
  assert.deepEqual(courts[2].q, [1, 2, 3])
  assert.equal(park.call("pid1", 9).ok, false)
  // only someone in the rack can say their court is free
  assert.equal(park.up("pid1", 1).ok, false)
  park.uncall("pid3")
  assert.deepEqual(got("pid1", "park:courts").at(-1).payload[2].q, [1, 2])
  park.stop()
})

test("a solo turn: the court is busy until the game is done", () => {
  const { park, me, got } = setup()
  park.join(me(1), {})
  park.join(me(2), {})
  park.call("pid1", 1)
  const r = park.up("pid1", 1)
  assert.equal(r.kind, "solo")
  assert.deepEqual(got("pid1", "park:go").map((m) => m.payload), [{ court: 1, kind: "solo" }])
  let view = got("pid2", "park:courts").at(-1).payload[1]
  assert.deepEqual(view.g, { k: "solo", p: [1], s: [0, 0] })
  assert.equal(park.up("pid1", 1).ok, false) // busy
  assert.equal(park.score("pid1", 1, [5, 3]).ok, true)
  assert.equal(park.score("pid2", 1, [9, 9]).ok, false) // (not theirs)
  assert.deepEqual(got("pid2", "park:courts").at(-1).payload[1].g.s, [5, 3])
  assert.equal(park.done("pid1", 1).ok, true)
  view = got("pid2", "park:courts").at(-1).payload[1]
  assert.equal(view.g, null)
  park.stop()
})

test("two people at a rack: a Pickleball room, seated and started (match handoff)", () => {
  const { park, me, got, rooms, clock } = setup()
  park.join(me(1), {})
  park.join(me(2), {})
  park.join(me(3), {})
  park.call("pid1", 3)
  park.call("pid2", 3)
  const r = park.up("pid2", 3)
  assert.equal(r.kind, "room")
  const room = rooms.rooms.get(r.roomId)
  assert.ok(room)
  assert.equal(room.game.id, "pickleball")
  assert.equal(room.phase, "playing")
  assert.equal(room.settings.venue, "park")
  assert.deepEqual(room.seats.filter(Boolean).map((s) => s.pid), ["pid1", "pid2"])
  for (const pid of ["pid1", "pid2"]) {
    const go = got(pid, "park:go")
    assert.equal(go.length, 1)
    assert.equal(go[0].payload.roomId, r.roomId)
    assert.equal(go[0].payload.started, true)
    // (and the room's own state reached them: the game opens on its own)
    assert.ok(got(pid, "room:state").some((m) => m.payload.phase === "playing"))
  }
  assert.deepEqual(got("pid3", "park:courts").at(-1).payload[3].g.p, [1, 2])
  // the host finishes the game: the court frees
  rooms.finishRelay("pid1", r.roomId, { winners: [0], reason: "11-6", scores: [11, 6] })
  clock.advance(4000)
  assert.equal(got("pid3", "park:courts").at(-1).payload[3].g, null)
  park.stop()
})

test("leaving mid-game or in a queue frees the spot", () => {
  const { park, me, got } = setup({ rooms: null })
  park.join(me(1), {})
  park.join(me(2), {})
  park.call("pid1", 0)
  park.up("pid1", 0)
  park.call("pid2", 0)
  park.drop("pid1")
  const view = got("pid2", "park:courts").at(-1).payload[0]
  assert.equal(view.g, null)
  assert.deepEqual(view.q, [2])
  park.stop()
})

test("the traffic meter: batches slow down when the month runs high", () => {
  assert.equal(rateFor(null, 100), "normal")
  assert.equal(rateFor(50, 100), "normal")
  assert.equal(rateFor(85, 100), "low")
  assert.equal(rateFor(97, 100), "min")
  let total = 10
  const { park, me, got, clock } = setup({ meterTotal: () => total, capBytes: 100 })
  const j = park.join(me(1), {})
  assert.equal(j.rate, "normal")
  park.join(me(2), {})
  total = 90
  assert.equal(park.checkRate(), "low")
  assert.deepEqual(got("pid2", "park:rate").at(-1).payload, { rate: "low" })
  // at "low", a position goes out within 400 ms, not 160
  park.pos("pid1", [1, 1, 1, 1, 1])
  clock.advance(200)
  assert.equal(got("pid2", "park:m").length, 0)
  clock.advance(250)
  assert.equal(got("pid2", "park:m").length, 1)
  park.stop()
})

test("bytes per minute: a park of four people walking", () => {
  const { park, me, clock } = setup()
  for (let i = 1; i <= 4; i++) park.join(me(i), {})
  const before = park.stats().bytes
  // each sends 6 positions a second for a minute
  for (let ms = 0; ms < 60_000; ms += 167) {
    for (let i = 1; i <= 4; i++) park.pos(`pid${i}`, [Math.round(ms / 50) % 900, i * 40, 64, 31, 1])
    clock.advance(167)
  }
  const perPerson = (park.stats().bytes - before) / 4
  // (about 6 batches a second with three others in each)
  assert.ok(perPerson < 60_000, `${perPerson} bytes a minute each`)
  console.log(`[park] ~${Math.round(perPerson / 1024)} KB a minute sent to each of 4 walking people`)
  park.stop()
})

test("venues: each real venue has its own parks, its own courts and bounds; unknown venues are Riverside", () => {
  const { VENUES, venueOf } = require("..")
  const { park, me, got } = setup()
  assert.ok(VENUES.loscab && VENUES.smash && VENUES.riverside, "the venue table (tools/venues/build-venues.mjs)")
  const a = park.join(me(1), { venue: "loscab" })
  const b = park.join(me(2), { venue: "loscab" })
  const c = park.join(me(3), { venue: "smash" })
  const d = park.join(me(4), { venue: "nowhere" })
  assert.equal(a.venue, "loscab")
  assert.equal(a.park, b.park, "friends at the same venue meet")
  assert.notEqual(c.park, a.park, "a different venue, a different park")
  assert.equal(d.venue, "riverside")
  assert.equal(venueOf({}), "riverside")
  assert.equal(a.courts.length, VENUES.loscab.courts)
  assert.equal(c.courts.length, VENUES.smash.courts)
  // only the people at that venue hear about each other
  assert.equal(got("pid1", "park:person").length, 1)
  assert.equal(got("pid3", "park:person").length, 0)
  // positions are clamped to that venue's own (bigger) bounds, not Riverside's
  const x = Math.round((VENUES.loscab.bounds.x1 - 1) * 20)
  assert.ok(park.pos("pid1", [x, 0, 0, 0, 0]) !== false)
  const inst = park.instances.get(a.park)
  assert.equal(inst.people.get("pid1").pos[0], x)
  // a court number past that venue's courts is refused
  assert.equal(park.call("pid3", { court: VENUES.smash.courts })?.ok, false)
  park.stop()
})

test("park:counts: how many are in each real venue's parks (numbers only; Riverside and empty ones left out)", () => {
  const { park, me } = setup()
  park.join(me(1), { venue: "loscab" })
  park.join(me(2), { venue: "loscab" })
  park.join(me(3), { venue: "smash" })
  park.join(me(4), {})
  assert.deepStrictEqual(park.counts(), { ok: true, counts: { loscab: 2, smash: 1 } })
  park.leave("pid3")
  assert.deepStrictEqual(park.counts().counts, { loscab: 2 })
})
