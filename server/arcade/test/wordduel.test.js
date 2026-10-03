// Word Duel on the online room system (server/arcade/games/wordduel.js): the server keeps
// the secret words to itself, judges guesses, runs the clocks and the computer players,
// and the room's settings decide its seats and whether people may watch.
const test = require("node:test")
const assert = require("node:assert/strict")
const { createRooms } = require("../rooms")
const wordduel = require("../games/wordduel")

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
const PEOPLE = { a: "Alice", b: "Bob", c: "Carol", d: "Dave" }
const me = (pid) => ({ pid, name: PEOPLE[pid], key: null })

const setup = () => {
  const clock = fakeClock()
  const inbox = { a: [], b: [], c: [], d: [] }
  const rooms = createRooms({ games: [wordduel], emit: (pid, event, payload) => inbox[pid]?.push({ event, payload }), clock, random: seeded(11) })
  const last = (pid) => [...inbox[pid]].reverse().find((m) => m.event === "room:state")?.payload
  return { rooms, clock, inbox, last }
}

// a private room with these settings, everyone in and ready, started
const startRoom = (t, settings, pids = ["a", "b"]) => {
  const made = t.rooms.create(me(pids[0]), "wordduel", settings)
  assert.ok(made.ok, made.error)
  for (const pid of pids.slice(1)) {
    assert.ok(t.rooms.join(me(pid), { code: made.code }).ok)
    assert.ok(t.rooms.ready(pid, made.roomId, true).ok)
  }
  const started = t.rooms.start(pids[0], made.roomId)
  assert.ok(started.ok, started.error)
  return made.roomId
}

const stateOf = (t, roomId) => t.rooms.rooms.get(roomId).state

test.before(async () => {
  await wordduel.ready
})

test("the room's seats follow the players setting, and shrinking below the people there is refused", () => {
  const t = setup()
  const made = t.rooms.create(me("a"), "wordduel", { players: 3 })
  assert.equal(t.last("a").seats.length, 3)
  assert.equal(t.last("a").max, 3)
  t.rooms.join(me("b"), { code: made.code })
  t.rooms.join(me("c"), { code: made.code })
  assert.equal(t.rooms.join(me("d"), { code: made.code }).spectator, true)
  const refused = t.rooms.setSettings("a", made.roomId, { players: 2 })
  assert.equal(refused.ok, false)
  assert.match(refused.error, /more than that allows/)
  assert.ok(t.rooms.setSettings("a", made.roomId, { players: 6 }).ok)
  assert.equal(t.last("a").seats.length, 6)
  assert.equal(t.last("a").seats.filter(Boolean).length, 3)
})

test("settings are cleaned up and a list needs words of the right length", () => {
  const t = setup()
  const bad = t.rooms.create(me("a"), "wordduel", { source: "list", list: "cat dog", length: 5 })
  assert.equal(bad.ok, false)
  assert.match(bad.error, /5-letter/)
  const made = t.rooms.create(me("a"), "wordduel", { length: 99, guesses: -4, boards: 3, format: "nope" })
  assert.ok(made.ok)
  const s = t.last("a").settings
  assert.equal(s.length, 7)
  assert.equal(s.guesses, 4)
  assert.equal(s.boards, 1)
  assert.equal(s.format, "race")
})

test("race: the answer never reaches a browser before the round is over, and the server judges guesses", () => {
  const t = setup()
  const roomId = startRoom(t, { format: "race", players: 2, scoring: "time", show: "colors" })
  const answer = stateOf(t, roomId).sets[0].boards[0].answer
  assert.equal(stateOf(t, roomId).sets[1].boards[0].answer, answer, "the same word for both")
  const leaks = () => ["a", "b"].some((pid) => t.inbox[pid].some((m) => JSON.stringify(m.payload).includes(`"${answer}"`)))
  assert.equal(leaks(), false)

  // a word that isn't a word, then one that is (but wrong)
  assert.equal(t.rooms.act("a", roomId, { type: "guess", word: "zzzzz" }).error, "Not in word list")
  assert.equal(t.rooms.act("a", roomId, { type: "guess", word: "abc" }).error, "Not enough letters")
  const wrong = ["crane", "slate", "pious", "dumpy"].find((w) => w !== answer)
  assert.ok(t.rooms.act("a", roomId, { type: "guess", word: wrong }).ok)
  const mine = t.last("a").view.sets[t.last("a").view.mine]
  assert.equal(mine.boards[0].rows[0].word, wrong)
  assert.equal(mine.boards[0].rows[0].colors.length, 5)
  // Bob sees Alice's colors but not her letters
  const bobView = t.last("b").view
  const alice = bobView.sets.find((s) => s.seats.includes(0))
  assert.equal(alice.boards[0].rows[0].word, undefined)
  assert.equal(alice.boards[0].rows[0].colors, mine.boards[0].rows[0].colors)
  assert.equal(leaks(), false)

  // Bob solves it first and takes the race
  assert.ok(t.rooms.act("b", roomId, { type: "guess", word: answer }).ok)
  const over = t.last("a")
  assert.equal(over.phase, "over")
  assert.deepEqual(over.result.winners, [1])
  assert.deepEqual(over.view.history[0].answers[0], [answer])
})

test("a hard-mode room refuses guesses that ignore what's been revealed", () => {
  const t = setup()
  const roomId = startRoom(t, { format: "race", players: 2, hard: true })
  stateOf(t, roomId).sets[0].boards[0].answer = "crane"
  assert.ok(t.rooms.act("a", roomId, { type: "guess", word: "trace" }).ok)
  assert.equal(t.last("a").view.sets[0].boards[0].rows[0].colors, "bggyg")
  assert.equal(t.rooms.act("a", roomId, { type: "guess", word: "plumb" }).error, "2nd letter must be R")
  assert.equal(t.rooms.act("a", roomId, { type: "guess", word: "graze" }).error, "Guess must contain C")
  assert.ok(t.rooms.act("a", roomId, { type: "guess", word: "brace" }).ok)
})

test("Battle Royale with computer players: rounds knock people out until one is left", () => {
  const t = setup()
  const made = t.rooms.create(me("a"), "wordduel", { format: "royale", players: 5, timer: "round", timerSecs: 60, bots: "hard" })
  assert.ok(t.rooms.fillBots("a", made.roomId).ok)
  assert.equal(t.last("a").seats.filter((s) => s?.bot).length, 4)
  assert.ok(t.rooms.start("a", made.roomId).ok)
  // Alice never guesses: she's out after the first round, then the computers fight it out
  for (let i = 0; i < 400 && t.last("a").phase === "playing"; i++) t.clock.advance(5000)
  const end = t.last("a")
  assert.equal(end.phase, "over")
  assert.equal(end.result.winners.length, 1)
  assert.notEqual(end.result.winners[0], 0)
  assert.equal(end.view.teams.filter((x) => x.alive).length, 1)
  assert.ok(end.view.history.length >= 2)
  assert.ok(end.view.history[0].out.includes(0), "Alice timed out in round one")
})

test("a custom word: player 1 types it, only they see it, and the others race to it", () => {
  const t = setup()
  const roomId = startRoom(t, { format: "race", players: 3, source: "custom" }, ["a", "b", "c"])
  assert.equal(t.last("a").view.phase, "pick")
  assert.equal(t.last("a").view.pick.you, true)
  assert.equal(t.last("b").view.pick.you, false)
  assert.equal(t.rooms.act("b", roomId, { type: "pick", word: "plumb" }).error, "Someone else is picking the word.")
  assert.equal(t.rooms.act("a", roomId, { type: "pick", word: "qzxvj" }).error, "That isn't in the word list.")
  assert.equal(t.rooms.act("b", roomId, { type: "guess", word: "crane" }).error, "Waiting for the word to be picked.")
  assert.ok(t.rooms.act("a", roomId, { type: "pick", word: "Plumb" }).ok)
  assert.equal(t.last("a").view.secret, "plumb")
  for (const pid of ["b", "c"]) assert.equal(JSON.stringify(t.last(pid)).includes("plumb"), false, `${pid} can't see it`)
  // Alice watches; she can't guess her own word
  assert.match(t.rooms.act("a", roomId, { type: "guess", word: "crane" }).error, /You picked the word/)
  assert.ok(t.rooms.act("c", roomId, { type: "guess", word: "crane" }).ok)
  assert.ok(t.rooms.act("b", roomId, { type: "guess", word: "plumb" }).ok)
  // Carol keeps going until she's out of guesses
  for (const w of ["slate", "pious", "dying", "wreck", "fjord"]) t.rooms.act("c", roomId, { type: "guess", word: w })
  const end = t.last("b")
  assert.equal(end.phase, "over")
  assert.deepEqual(end.result.winners, [1])
})

test("nobody solves a custom word: the one who picked it wins", () => {
  const t = setup()
  const roomId = startRoom(t, { format: "race", players: 2, source: "custom", guesses: 4 })
  t.rooms.act("a", roomId, { type: "pick", word: "fjord" })
  for (const w of ["crane", "slate", "pious", "dumpy"]) assert.ok(t.rooms.act("b", roomId, { type: "guess", word: w }).ok)
  const end = t.last("a")
  assert.equal(end.phase, "over")
  assert.deepEqual(end.result.winners, [0])
  assert.equal(end.result.reason, "stumped")
})

test("Sabotage: each player picks a common word for the other", () => {
  const t = setup()
  const roomId = startRoom(t, { format: "sabotage", players: 2 })
  assert.match(t.rooms.act("a", roomId, { type: "pick", word: "zzzzz" }).error, /common word/)
  assert.ok(t.rooms.act("a", roomId, { type: "pick", word: "crane" }).ok)
  assert.equal(t.last("a").view.phase, "pick")
  assert.ok(t.rooms.act("b", roomId, { type: "pick", word: "slate" }).ok)
  assert.equal(t.last("a").view.phase, "play")
  const st = stateOf(t, roomId)
  assert.equal(st.sets.find((s) => s.seats.includes(1)).boards[0].answer, "crane", "Bob guesses Alice's word")
  assert.equal(st.sets.find((s) => s.seats.includes(0)).boards[0].answer, "slate")
  assert.equal(JSON.stringify(t.last("a").view).includes("slate"), false)
  assert.equal(t.last("a").view.secret, "crane")
})

test("Duel Turns: one board, guesses take turns", () => {
  const t = setup()
  const roomId = startRoom(t, { format: "turns", players: 2, rounds: 1 })
  stateOf(t, roomId).sets[0].boards[0].answer = "fjord"
  const v = t.last("a").view
  const first = v.sets[0].turnSeat
  const other = first === 0 ? "b" : "a"
  const mover = first === 0 ? "a" : "b"
  assert.match(t.rooms.act(other, roomId, { type: "guess", word: "crane" }).error, /turn/)
  assert.ok(t.rooms.act(mover, roomId, { type: "guess", word: "crane" }).ok)
  assert.equal(t.last("a").view.sets[0].turnSeat, 1 - first)
  // the other player solves it and scores
  assert.ok(t.rooms.act(other, roomId, { type: "guess", word: "fjord" }).ok)
  const end = t.last("a")
  assert.equal(end.phase, "over")
  assert.deepEqual(end.result.winners, [1 - first])
})

test("a guess clock: running out costs a guess", () => {
  const t = setup()
  const roomId = startRoom(t, { format: "race", players: 2, timer: "guess", timerSecs: 15 })
  assert.ok(t.last("a").view.sets[0].deadline > 0)
  t.clock.advance(15_500)
  const v = t.last("a").view
  assert.equal(v.sets[0].words, 1)
  assert.equal(v.sets[0].boards[0].rows[0].word, null)
})

test("rooms can turn spectators off", () => {
  const t = setup()
  const made = t.rooms.create(me("a"), "wordduel", { players: 2, spectators: false })
  t.rooms.join(me("b"), { code: made.code })
  t.rooms.ready("b", made.roomId, true)
  t.rooms.start("a", made.roomId)
  const r = t.rooms.join(me("c"), { code: made.code })
  assert.equal(r.ok, false)
  const t2 = setup()
  const made2 = t2.rooms.create(me("a"), "wordduel", { players: 1 })
  t2.rooms.start("a", made2.roomId)
  assert.equal(t2.rooms.join(me("c"), { code: made2.code }).spectator, true)
})

test("ticks with nothing to do send nothing", () => {
  const t = setup()
  startRoom(t, { format: "race", players: 2 })
  const before = t.inbox.a.length
  t.clock.advance(10_000)
  assert.equal(t.inbox.a.length, before)
})
