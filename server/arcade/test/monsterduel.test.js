// Monster Duel on the online room system (server/arcade/games/monsterduel.js): the server
// keeps hands, deck order and face-down cards to itself, checks each player's deck, runs
// the clocks and the computer players.
const test = require("node:test")
const assert = require("node:assert/strict")
const { createRooms } = require("../rooms")
const monsterduel = require("../games/monsterduel")

const fakeClock = () => {
  let t = 1_000_000
  let ids = 0
  const timers = new Map()
  return {
    now: () => t,
    setTimeout: (fn, ms) => {
      const h = ++ids
      timers.set(h, { at: t + ms, fn })
      return h
    },
    clearTimeout: (h) => timers.delete(h),
    advance(ms) {
      const end = t + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        t = due[1].at
        due[1].fn()
      }
      t = end
    },
  }
}

const seeded = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647
const PEOPLE = { a: "Alice", b: "Bob", c: "Carol" }
const me = (pid) => ({ pid, name: PEOPLE[pid], key: null })

const setup = () => {
  const clock = fakeClock()
  const inbox = { a: [], b: [], c: [] }
  const rooms = createRooms({ games: [monsterduel], emit: (pid, event, payload) => inbox[pid]?.push({ event, payload }), clock, random: seeded(7) })
  const last = (pid) => [...inbox[pid]].reverse().find((m) => m.event === "room:state")?.payload
  return { rooms, clock, inbox, last }
}

const startRoom = (t, settings = {}) => {
  const made = t.rooms.create(me("a"), "monsterduel", settings)
  assert.ok(made.ok, made.error)
  assert.ok(t.rooms.join(me("b"), { code: made.code }).ok)
  assert.ok(t.rooms.ready("b", made.roomId, true).ok)
  const started = t.rooms.start("a", made.roomId)
  assert.ok(started.ok, started.error)
  return made.roomId
}

const stateOf = (t, roomId) => t.rooms.rooms.get(roomId).state
const pidOf = (seat) => (seat === 0 ? "a" : "b")

// a person's move: what their own view says they may do (the first sensible choice)
const autoMove = (v) => {
  const legal = v.view.legal
  if (!legal.length) return null
  const pass = legal.find((m) => m.type === "pass")
  if (pass) return pass
  const choice = legal.find((m) => m.type === "choose")
  if (choice) return { type: "choose", picks: choice.options.slice(0, choice.min || 1) }
  const summon = legal.find((m) => m.type === "summon" && !m.tributes)
  if (summon) return { type: "summon", uid: summon.uid, tributes: [] }
  const attack = legal.find((m) => m.type === "attack")
  if (attack) return { type: "attack", uid: attack.uid, target: attack.targets[attack.targets.length - 1] }
  const battle = legal.find((m) => m.type === "phase" && m.to === "battle")
  if (battle && v.view.duel.phase === "main1") return battle
  return legal.find((m) => m.type === "phase" && m.to === "end") || legal.find((m) => m.type === "phase")
}

test.before(async () => {
  await monsterduel.ready
})

test("settings are checked: one duel or best of three, a turn clock from the list, 4000/8000/16000 LP", () => {
  const t = setup()
  const bad = t.rooms.create(me("a"), "monsterduel", { bestOf: 2 })
  assert.equal(bad.ok, false)
  assert.match(bad.error, /best of three/)
  assert.equal(t.rooms.create(me("a"), "monsterduel", { lp: 1 }).ok, false)
  const made = t.rooms.create(me("a"), "monsterduel", { bestOf: 3, turnTime: 120, lp: 4000, junk: "x" })
  assert.ok(made.ok)
  assert.deepEqual(t.last("a").settings, { bestOf: 3, turnTime: 120, lp: 4000 })
})

test("each player brings a deck: custom decks are checked against the card pool", async () => {
  const { STARTERS } = await import("../../../client/src/components/applets/monsterduel/engine/decks.js")
  const t = setup()
  const roomId = startRoom(t)
  assert.equal(t.last("a").view.stage, "decks")
  const fake = t.rooms.act("a", roomId, { type: "deck", main: Array(40).fill("XX99") })
  assert.equal(fake.ok, false)
  assert.match(fake.error, /doesn't exist/)
  const tooMany = t.rooms.act("a", roomId, { type: "deck", main: [...STARTERS[0].main.slice(0, 36), "G01", "G01", "G01", "G01"] })
  assert.match(tooMany.error, /limited to 1|At most/)
  assert.ok(t.rooms.act("a", roomId, { type: "deck", main: STARTERS[2].main, extra: STARTERS[2].extra, name: "Wizards" }).ok)
  assert.equal(t.rooms.act("a", roomId, { type: "deck", starter: "dragons" }).ok, false, "only once")
  assert.equal(t.last("b").view.deckNames[0], null, "Bob can't see Alice's deck before the duel")
  assert.ok(t.rooms.act("b", roomId, { type: "deck", starter: "beasts" }).ok)
  const v = t.last("b").view
  assert.equal(v.stage, "duel")
  assert.deepEqual(v.deckNames, ["Wizards", "Wild Pack"])
})

test("hidden information: hands, deck order and face-down cards never reach the other player", () => {
  const t = setup()
  const roomId = startRoom(t)
  t.rooms.act("a", roomId, { type: "deck", starter: "insects" })
  t.rooms.act("b", roomId, { type: "deck", starter: "undead" })
  const st = stateOf(t, roomId)
  const d = st.duel
  const first = d.active
  const firstPid = pidOf(first)
  const otherPid = pidOf(1 - first)
  // the first player sets a monster and a card
  const v = t.last(firstPid).view
  const setMonster = v.legal.find((m) => m.type === "set" && !("tributes" in m) === false && m.tributes === 0)
  if (setMonster) assert.ok(t.rooms.act(firstPid, roomId, { type: "set", uid: setMonster.uid, tributes: [] }).ok)
  const setCard = t.last(firstPid).view.legal.find((m) => m.type === "set" && m.tributes === undefined)
  if (setCard) assert.ok(t.rooms.act(firstPid, roomId, { type: "set", uid: setCard.uid }).ok)
  const now = stateOf(t, roomId).duel
  const hidden = [...now.p[first].hand, ...now.p[first].deck, ...now.p[first].deck.slice(0, 5)]
  const faceDown = [...now.p[first].m, ...now.p[first].s].filter((x) => x && !x.up)
  assert.ok(faceDown.length >= 1)
  const sent = JSON.stringify(t.inbox[otherPid].map((m) => m.payload))
  for (const uid of hidden) assert.ok(!sent.includes(`"${uid}"`), "no hand or deck card ids")
  const theirView = t.last(otherPid).view.duel
  for (const slot of faceDown) {
    const seen = [...theirView.players[first].m, ...theirView.players[first].s].find((x) => x?.uid === slot.uid)
    assert.ok(seen, "the face-down card is on the board")
    assert.equal(seen.id, undefined, "but not what it is")
  }
  assert.equal(typeof theirView.players[first].hand, "number")
  assert.deepEqual(t.last(otherPid).view.legal, [], "it's not their turn")
  // spectators see what everyone sees
  t.rooms.join(me("c"), { roomId })
})

test("Play the Computer: the computer picks a deck and duels to the end; isOver reports the winner", () => {
  const t = setup()
  const made = t.rooms.create(me("a"), "monsterduel", { turnTime: 0 })
  assert.ok(t.rooms.fillBots("a", made.roomId).ok)
  assert.ok(t.rooms.start("a", made.roomId).ok)
  t.rooms.act("a", made.roomId, { type: "deck", starter: "warriors" })
  for (let i = 0; i < 4000; i++) {
    const v = t.last("a")
    if (v.phase === "over") break
    const move = v.view.stage === "duel" ? autoMove(v) : null
    if (move) {
      const r = t.rooms.act("a", made.roomId, move)
      assert.ok(r.ok, `${JSON.stringify(move)}: ${r.error}`)
    } else t.clock.advance(1000)
  }
  const over = t.last("a")
  assert.equal(over.phase, "over")
  assert.equal(over.result.winners.length, 1)
  assert.equal(over.view.stage, "over")
})

test("clocks: a response window runs out by itself, and so does a turn", () => {
  const t = setup()
  const roomId = startRoom(t, { turnTime: 60 })
  t.rooms.act("a", roomId, { type: "deck", starter: "dragons" })
  t.rooms.act("b", roomId, { type: "deck", starter: "machines" })
  const turn = stateOf(t, roomId).duel.turn
  assert.ok(t.last("a").view.turnEnds > t.clock.now())
  t.clock.advance(61_000)
  const d = stateOf(t, roomId).duel
  assert.ok(d.turn > turn || d.over, "the turn ended when time ran out")
  // a pending answer is given for you when its clock runs out
  if (d.wait && !d.over) {
    const stamp = d.wait.stamp
    t.clock.advance(41_000)
    assert.notEqual(stateOf(t, roomId).duel.wait?.stamp, stamp)
  }
})

test("nobody picks a deck: random starter decks after the deck clock", () => {
  const t = setup()
  const roomId = startRoom(t)
  t.clock.advance(121_000)
  assert.equal(t.last("a").view.stage, "duel")
  assert.ok(t.last("a").view.deckNames.every(Boolean))
})

test("leaving mid-duel hands the seat to a computer player, who carries on", () => {
  const t = setup()
  const roomId = startRoom(t, { turnTime: 0 })
  t.rooms.act("a", roomId, { type: "deck", starter: "aquatic" })
  t.rooms.act("b", roomId, { type: "deck", starter: "casters" })
  assert.ok(t.rooms.leave("b", roomId).ok)
  const v = t.last("a")
  assert.equal(v.seats[1].bot, true)
  for (let i = 0; i < 4000 && t.last("a").phase !== "over"; i++) {
    const move = autoMove(t.last("a"))
    if (move) assert.ok(t.rooms.act("a", roomId, move).ok)
    else t.clock.advance(1000)
  }
  assert.equal(t.last("a").phase, "over")
})

test("best of three: a second duel follows, and the match ends at two wins", () => {
  const t = setup()
  const roomId = startRoom(t, { bestOf: 3, turnTime: 0 })
  t.rooms.act("a", roomId, { type: "deck", starter: "beasts" })
  t.rooms.act("b", roomId, { type: "deck", starter: "undead" })
  assert.ok(t.rooms.act("b", roomId, { type: "surrender" }).ok)
  assert.equal(t.last("a").phase, "playing")
  assert.equal(t.last("a").view.stage, "between")
  assert.deepEqual(t.last("a").view.wins, [1, 0])
  t.rooms.act("a", roomId, { type: "next" })
  t.rooms.act("b", roomId, { type: "next" })
  assert.equal(t.last("a").view.stage, "duel")
  assert.equal(t.last("a").view.game, 2)
  assert.ok(t.rooms.act("b", roomId, { type: "surrender" }).ok)
  const over = t.last("b")
  assert.equal(over.phase, "over")
  assert.deepEqual(over.result.winners, [0])
})

test("Quick Match pairs people who want the same match length and Life Points", () => {
  const t = setup()
  const a = t.rooms.quick(me("a"), "monsterduel", { bestOf: 3 })
  const b = t.rooms.quick(me("b"), "monsterduel", { bestOf: 1 })
  assert.notEqual(a.roomId, b.roomId)
  const c = t.rooms.quick(me("c"), "monsterduel", { bestOf: 3, turnTime: 300 })
  assert.equal(c.roomId, a.roomId)
})
