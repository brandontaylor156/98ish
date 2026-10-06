// Imposter: the rules (client/src/components/applets/imposter/rules.js) and the room system
// running them (server/arcade/games/imposter.js): roles, clues, votes and ties, the
// imposter's guess, scoring, no-imposter rounds, players leaving, and views that never
// show a player more than their own card.
const test = require("node:test")
const assert = require("node:assert/strict")
const { createRooms } = require("../rooms")
const imposter = require("../games/imposter")

let R = null
test.before(async () => {
  await imposter.ready
  R = await import("../../../client/src/components/applets/imposter/rules.js")
})

const seeded = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647
const NAMES = ["Ann", "Ben", "Cat", "Dan", "Eve", "Fay", "Gus", "Hal"]

const makeCtx = (now = 1_000_000) => {
  const timers = new Map()
  return { now, random: seeded(5), timers, after: (ms, action, key = "timer") => timers.set(key, { ms, action }), cancel: (key = "timer") => timers.set(key, null) }
}

// a game with n players; `imposters` forces who the imposters are
const game = (n, settings = {}, imposters = null) => {
  const players = NAMES.slice(0, n).map((name, id) => ({ id, name }))
  const ctx = makeCtx()
  let s = R.create({ players, settings: { clueRounds: 1, discussTime: -1, ...settings }, random: seeded(9), now: ctx.now, after: ctx.after })
  if (imposters) s = { ...s, round: { ...s.round, imposters } }
  return { s, ctx }
}
const act = (s, seat, a, ctx = makeCtx()) => {
  const next = R.action(s, seat, a, ctx)
  assert.ok(!next.error, `${seat} ${JSON.stringify(a)}: ${next.error}`)
  return next
}
const ackAll = (s) => s.names.reduce((st, _, i) => act(st, i, { type: "ack" }), s)
const clueAll = (s) => {
  while (s.phase === "clues") {
    const v = R.view(s, 0)
    s = act(s, v.speaker, { type: "clue", text: `clue ${s.round.clues.length}` })
  }
  return s
}
const voteAll = (s, votes) => Object.entries(votes).reduce((st, [seat, target]) => act(st, Number(seat), { type: "vote", target }), s)

test("settings: cleaned and capped, presets apply, every category has words", () => {
  const s = R.validateSettings({ players: 99, imposters: -3, categories: ["food", "nope"], clueTime: 9999, voteStyle: "weird", zeroChance: 30, allowSkip: false, length: "score", scoring: false })
  assert.equal(s.players, 20)
  assert.equal(s.imposters, 1)
  assert.deepEqual(s.categories, ["food"])
  assert.equal(s.clueTime, 180)
  assert.equal(s.voteStyle, "secret")
  assert.equal(s.allowSkip, true, "no-imposter rounds need a skip")
  assert.equal(s.length, "rounds", "score games need scoring")
  const chaos = R.presetSettings("chaos", { ...R.DEFAULTS, players: 10 })
  assert.equal(chaos.randomImposters, true)
  assert.equal(chaos.players, 10)
  for (const id of R.validateSettings({ categories: ["food", "animals", "space", "computers"] }).categories) assert.ok(R.wordPool({ ...R.DEFAULTS, categories: [id] }).length >= 12, id)
  // custom words: parsed, capped, can be the only source
  const custom = R.validateSettings({ custom: "Moon pie:Cupcake\nRocket\n\n" + "x\n".repeat(100), customOnly: true })
  assert.ok(custom.customOnly)
  assert.equal(R.wordPool(custom).length <= 60, true)
  assert.equal(R.wordPool(custom)[0].word, "Moon pie")
  assert.equal(R.wordPool(custom)[0].close, "Cupcake")
})

test("roles: the imposter count is capped and views show only your own card", () => {
  const { s } = game(5, { imposters: 9 })
  assert.equal(s.round.imposters.length, 2, "5 players: at most 2 imposters")
  for (let seat = 0; seat < 5; seat++) {
    const v = R.view(s, seat)
    const imp = s.round.imposters.includes(seat)
    assert.equal(v.card.role, imp ? "imposter" : "crew")
    assert.equal(v.card.word, imp ? null : s.round.word)
    assert.equal(v.result, undefined, "nobody sees the imposter list")
    assert.ok(!JSON.stringify(v).includes(`"imposters":[`), "nobody sees the imposter list")
    if (imp) assert.ok(!JSON.stringify(v).includes(`"${s.round.word}"`), "the imposter never gets the word")
  }
  assert.equal(R.view(s, null).card, null, "spectators get no card")
})

test("imposter info variants: hint, decoy, undercover, partners", () => {
  const word = (settings) => {
    const { s } = game(6, { imposters: 2, ...settings }, [1, 4])
    return { s, v: R.view(s, 1) }
  }
  let { s, v } = word({ imposterInfo: "hint" })
  assert.equal(v.card.hint, s.round.close)
  ;({ s, v } = word({ imposterInfo: "decoy" }))
  assert.equal(v.card.role, "imposter")
  assert.equal(v.card.word, s.round.close)
  ;({ s, v } = word({ imposterInfo: "undercover" }))
  assert.equal(v.card.role, "crew", "undercover imposters aren't told")
  assert.equal(v.card.word, s.round.close)
  ;({ s, v } = word({ imposterInfo: "none", impostersKnow: true }))
  assert.equal(v.card.category, null)
  assert.deepEqual(v.partners, [4])
})

test("imposter doesn't speak first; clues go round in order; the crew can't say the word", () => {
  for (let seed = 1; seed < 30; seed++) {
    const players = NAMES.slice(0, 4).map((name, id) => ({ id, name }))
    const s = R.create({ players, settings: {}, random: seeded(seed), now: 0 })
    assert.ok(!s.round.imposters.includes(s.round.order[0]))
  }
  let { s } = game(4, { clueRounds: 2, clueMode: "typed" }, [2])
  s = ackAll(s)
  assert.equal(s.phase, "clues")
  const speaker = R.view(s, 0).speaker
  const notYou = (speaker + 1) % 4
  assert.equal(R.action(s, notYou, { type: "clue", text: "hi" }).error, "It isn't your turn.")
  assert.equal(R.action(s, speaker, { type: "clue", text: "" }).error, "Type a clue first.")
  if (speaker !== 2) assert.match(R.action(s, speaker, { type: "clue", text: `my ${s.round.word}s` }).error, /word itself/)
  s = clueAll(s)
  assert.equal(s.round.clues.length, 8, "two rounds of four")
  assert.equal(s.phase, "vote", "no discussion: straight to the vote")
})

test("vote: the imposter caught -> guess phase; a wrong guess means the crew wins and scores", () => {
  let { s } = game(4, { guessWhen: "caught", guessStyle: "choice" }, [3])
  s = clueAll(ackAll(s))
  s = voteAll(s, { 0: 3, 1: 3, 2: 1, 3: 0 })
  assert.equal(s.phase, "guess")
  const v3 = R.view(s, 3)
  assert.ok(v3.choices.includes(s.round.word) && v3.choices.length >= 2)
  assert.equal(R.view(s, 0).choices, undefined, "only the guesser sees the choices")
  const wrong = v3.choices.find((w) => w !== s.round.word)
  s = act(s, 3, { type: "guess", word: wrong })
  assert.equal(s.phase, "result")
  assert.equal(s.round.outcome, "crew")
  // crew +1 each, +1 more for voting the imposter (Ann, Ben)
  assert.deepEqual(s.scores, [2, 2, 1, 0])
})

test("vote: a right guess steals the round", () => {
  let { s } = game(4, {}, [3])
  s = voteAll(clueAll(ackAll(s)), { 0: 3, 1: 3, 2: 3, 3: 0 })
  s = act(s, 3, { type: "guess", word: s.round.word.toUpperCase() + "s" })
  assert.equal(s.round.outcome, "stolen")
  assert.deepEqual(s.scores, [0, 0, 0, 3])
})

test("vote: the wrong person out -> the imposters win; secret votes stay hidden until the end", () => {
  let { s } = game(5, { guessWhen: "off" }, [4])
  s = clueAll(ackAll(s))
  s = act(s, 0, { type: "vote", target: 1 })
  assert.deepEqual(R.view(s, 2).votes, {}, "secret: others' votes are hidden")
  assert.deepEqual(R.view(s, 0).votes, { 0: 1 })
  assert.equal(R.action(s, 2, { type: "vote", target: 2 }).error, "You can't vote for yourself.")
  s = voteAll(s, { 1: 2, 2: 1, 3: 1, 4: 1 })
  assert.equal(s.round.outcome, "imposters")
  assert.deepEqual(s.round.ejected, [1])
  assert.deepEqual(s.scores, [0, 0, 0, 0, 2])
  assert.deepEqual(R.view(s, 2).result.imposters, [4])
})

test("ties: revote among the tied, then each tie rule", () => {
  let { s } = game(4, { tieRule: "revote", guessWhen: "off" }, [3])
  s = voteAll(clueAll(ackAll(s)), { 0: 3, 1: 2, 2: 3, 3: 2 })
  assert.equal(s.phase, "vote")
  assert.deepEqual(s.round.candidates, [2, 3].sort())
  assert.equal(R.action(s, 0, { type: "vote", target: 1 }).error, "You can't vote for that.")
  s = voteAll(s, { 0: 3, 1: 3, 2: 3, 3: 2 })
  assert.equal(s.round.outcome, "crew")

  const tie = (rule) => {
    let { s } = game(4, { tieRule: rule, guessWhen: "off" }, [3])
    return voteAll(clueAll(ackAll(s)), { 0: 3, 1: 2, 2: 3, 3: 2 })
  }
  assert.equal(tie("noone").round.outcome, "imposters")
  assert.deepEqual(tie("noone").round.ejected, [])
  assert.deepEqual(tie("all").round.ejected.sort(), [2, 3])
  assert.equal(tie("all").round.outcome, "crew")
  assert.equal(tie("random").round.ejected.length, 1)
})

test("zero imposters: 'no one' wins for everyone who said so; voting someone out loses", () => {
  let { s } = game(4, { zeroChance: 50 }, [])
  s = clueAll(ackAll(s))
  assert.equal(R.view(s, 0).card.role, "crew")
  let a = voteAll(s, { 0: -1, 1: -1, 2: -1, 3: 1 })
  assert.equal(a.round.outcome, "none-win")
  assert.deepEqual(a.scores, [1, 1, 1, 0])
  let b = voteAll(s, { 0: 1, 1: 0, 2: 1, 3: 1 })
  assert.equal(b.round.outcome, "none-lose")
})

test("group voting: one pick decides for the whole table", () => {
  let { s } = game(4, { voteStyle: "group", guessWhen: "off" }, [2])
  s = clueAll(ackAll(s))
  s = act(s, 0, { type: "vote", target: 2 })
  assert.equal(s.phase, "result")
  assert.equal(s.round.outcome, "crew")
})

test("elimination: a wrong vote sends the rest back to clues; catching every imposter wins", () => {
  let { s } = game(6, { voteMode: "elimination", imposters: 2, guessWhen: "off" }, [4, 5])
  s = voteAll(clueAll(ackAll(s)), { 0: 1, 1: 0, 2: 1, 3: 1, 4: 1, 5: 1 })
  assert.equal(s.phase, "clues", "Ben was crew: go again")
  assert.deepEqual(s.round.out, [1])
  assert.equal(R.action(s, 1, { type: "vote", target: 0 }).error, "It isn't time to vote.")
  s = clueAll(s)
  assert.ok(!s.round.clues.slice(6).some((c) => c.seat === 1), "the ejected player gives no clues")
  s = voteAll(s, { 0: 4, 2: 4, 3: 4, 4: 0, 5: 0 })
  assert.equal(s.phase, "clues")
  s = voteAll(clueAll(s), { 0: 5, 2: 5, 3: 5, 5: 0 })
  assert.equal(s.round.outcome, "crew")
})

test("anytime guess: right steals, wrong hands the crew the round; undercover can't", () => {
  let { s } = game(4, { guessWhen: "anytime" }, [1])
  s = ackAll(s)
  assert.equal(R.action(s, 0, { type: "guess", word: "x" }).error, "Only an imposter can guess the word.")
  const right = act(s, 1, { type: "guess", word: s.round.word })
  assert.equal(right.round.outcome, "stolen")
  const wrong = act(s, 1, { type: "guess", word: "zzz" })
  assert.equal(wrong.round.outcome, "crew")
})

test("timers: clue and vote clocks move the game on; stale timers do nothing", () => {
  let { s } = game(4, { clueTime: 20, voteTime: 30, guessWhen: "off" }, [3])
  const ctx = makeCtx()
  s = s.names.reduce((st, _, i) => R.action(st, i, { type: "ack" }, ctx), s)
  const t = ctx.timers.get("phase")
  assert.equal(t.ms, 20_000)
  const old = t.action
  s = R.action(s, null, t.action, ctx)
  assert.equal(s.round.clues.length, 1)
  assert.equal(s.round.clues[0].text, "")
  assert.equal(R.action(s, null, old, ctx), s, "stale")
  while (s.phase === "clues") s = R.action(s, null, ctx.timers.get("phase").action, ctx)
  assert.equal(s.phase, "vote")
  s = R.action(s, 0, { type: "vote", target: 3 }, ctx)
  s = R.action(s, null, ctx.timers.get("phase").action, ctx)
  assert.equal(s.phase, "result", "missing votes abstain")
  assert.deepEqual(s.round.ejected, [3])
})

test("game length: rounds and score targets end the game; 'end' any time between rounds", () => {
  let { s } = game(4, { length: "rounds", lengthN: 2, guessWhen: "off" }, [3])
  s = voteAll(clueAll(ackAll(s)), { 0: 3, 1: 3, 2: 3, 3: 0 })
  assert.equal(s.gameDone, false)
  s = act(s, 0, { type: "next" })
  assert.equal(s.roundNo, 2)
  assert.equal(s.phase, "reveal")
  assert.notEqual(s.round.word, undefined)
  s = clueAll(ackAll(s))
  const imp = s.round.imposters[0]
  const crew = [0, 1, 2, 3].filter((i) => i !== imp)
  s = voteAll(s, Object.fromEntries([...crew.map((i) => [i, imp]), [imp, crew[0]]]))
  assert.equal(s.gameDone, true)
  s = act(s, 1, { type: "next" })
  assert.ok(R.isOver(s))
  assert.ok(s.over.winners.length >= 1)

  let e = game(4, { length: "endless" }, [3]).s
  assert.equal(R.action(e, 0, { type: "end" }).error, "Finish the round first.")
})

test("a player leaving: dropped from the turn order; the game ends below 3", () => {
  let { s } = game(4, { guessWhen: "off" }, [3])
  s = ackAll(s)
  const speaker = R.view(s, 0).speaker
  s = R.onLeave(s, speaker, makeCtx())
  assert.ok(R.view(s, 0).speaker !== speaker)
  assert.ok(!R.isOver(s))
  const crewLeft = [0, 1, 2].filter((i) => i !== speaker)[0]
  s = R.onLeave(s, crewLeft, makeCtx())
  assert.ok(R.isOver(s), "two players left")
  // the imposter leaving hands the crew the round
  let t = ackAll(game(4, {}, [2]).s)
  t = R.onLeave(t, 2, makeCtx())
  assert.equal(t.round.outcome, "crew")
})

test("word matching is forgiving", () => {
  assert.ok(R.sameWord("Hot Dog", "hotdogs"))
  assert.ok(R.sameWord("Bus", "buses"))
  assert.ok(R.sameWord("Piñata", "pinata"))
  assert.ok(!R.sameWord("cat", "catch"))
  assert.ok(R.saysWord("big pizzas here", "Pizza"))
  assert.ok(!R.saysWord("catch it", "Cat"))
  assert.ok(R.saysWord("a hot dog stand", "Hot dog"))
})

// ---------- on the room system ----------

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

test("online: a 3-player room plays a round; each browser only sees its own card", () => {
  const inbox = {}
  const rooms = createRooms({ games: [imposter], emit: (pid, event, payload) => (inbox[pid] ||= []).push({ event, payload }), emitVolatile: () => {}, clock: fakeClock(), random: seeded(3) })
  const last = (pid) => [...(inbox[pid] || [])].reverse().find((m) => m.event === "room:state")?.payload
  const me = (pid) => ({ pid, name: pid.toUpperCase(), key: null })
  const made = rooms.create(me("a"), "imposter", { players: 3, clueRounds: 1, discussTime: -1, guessWhen: "off" })
  assert.ok(made.ok, made.error)
  assert.equal(last("a").seats.length, 3)
  assert.equal(last("a").canFillBots, false, "no computer players")
  for (const p of ["b", "c"]) {
    assert.ok(rooms.join(me(p), { code: made.code }).ok)
    assert.ok(rooms.ready(p, made.roomId, true).ok)
  }
  assert.ok(rooms.start("a", made.roomId).ok)
  const pids = ["a", "b", "c"]
  const cards = pids.map((p) => last(p).view.card)
  assert.equal(cards.filter((c) => c.role === "imposter").length, 1)
  const word = cards.find((c) => c.role === "crew").word
  const impPid = pids[cards.findIndex((c) => c.role === "imposter")]
  assert.ok(!JSON.stringify(last(impPid)).includes(word), "the imposter's browser never gets the word")
  for (const p of pids) assert.ok(rooms.act(p, made.roomId, { type: "ack" }).ok)
  while (last("a").view.phase === "clues") {
    const sp = last("a").view.speaker
    assert.ok(rooms.act(pids[sp], made.roomId, { type: "clue" }).ok)
  }
  assert.equal(last("a").view.phase, "vote")
  const impSeat = pids.indexOf(impPid)
  for (const p of pids) {
    const seat = pids.indexOf(p)
    const target = seat === impSeat ? (seat + 1) % 3 : impSeat
    assert.ok(rooms.act(p, made.roomId, { type: "vote", target }).ok)
  }
  const v = last("b").view
  assert.equal(v.phase, "result")
  assert.equal(v.result.outcome, "crew")
  assert.equal(v.result.word, word)
})
