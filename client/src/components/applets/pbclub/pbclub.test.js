import test from "node:test"
import assert from "node:assert/strict"
import * as sc from "./scoring.js"
import * as core from "./clubCore.js"
import * as rot from "./rotation.js"

const play = (state, winners) => {
  let s = state
  const events = []
  for (const w of winners) {
    const r = sc.rally(s, w)
    s = r.state
    events.push(r.events)
  }
  return { s, events }
}

test("side-out doubles: 0-0-2 start, second server, side outs, server switching courts", () => {
  let s = sc.newGame({ format: "doubles", scoring: "sideout", to: 11, first: 0 })
  assert.equal(sc.call(s), "0-0-2")
  assert.deepEqual(sc.serverSpot(s), { team: 0, player: 0, side: "right" })
  assert.deepEqual(sc.receiverSpot(s), { team: 1, player: 0, side: "right" })
  // team A scores twice: the server switches courts each point
  let r = sc.rally(s, 0)
  s = r.state
  assert.equal(sc.call(s), "1-0-2")
  assert.deepEqual(r.events, ["point"])
  assert.equal(sc.serverSpot(s).side, "left")
  s = sc.rally(s, 0).state
  assert.equal(sc.serverSpot(s).side, "right")
  // A loses a rally as the (only) second server: side out, B's right-court player serves
  r = sc.rally(s, 1)
  s = r.state
  assert.deepEqual(r.events, ["sideout"])
  assert.equal(sc.call(s), "0-2-1")
  assert.deepEqual(sc.serverSpot(s), { team: 1, player: 0, side: "right" })
  // B loses one: second server (the partner, from where they stand: the left court)
  r = sc.rally(s, 0)
  s = r.state
  assert.deepEqual(r.events, ["second"])
  assert.equal(sc.call(s), "0-2-2")
  assert.deepEqual(sc.serverSpot(s), { team: 1, player: 1, side: "left" })
  // the second server scores: switches to the right
  s = sc.rally(s, 1).state
  assert.equal(sc.call(s), "1-2-2")
  assert.deepEqual(sc.serverSpot(s), { team: 1, player: 1, side: "right" })
  // second server loses: side out to A, whoever is in A's right court serves first
  s = sc.rally(s, 0).state
  assert.equal(sc.call(s), "2-1-1")
  assert.equal(sc.serverSpot(s).team, 0)
  assert.equal(sc.serverSpot(s).side, "right")
  assert.equal(sc.serverSpot(s).player, s.pos[0][0])
})

test("side-out: win by 2, switch ends at 6, game point and the spoken call", () => {
  let s = sc.newGame({ format: "singles", scoring: "sideout", to: 11 })
  assert.equal(sc.call(s), "0-0")
  // singles: serve from the right on an even score, left on odd
  s = sc.rally(s, 0).state
  assert.equal(sc.serverSpot(s).side, "left")
  let all = []
  for (let i = 0; i < 4; i++) {
    const r = sc.rally(s, 0)
    s = r.state
    all.push(...r.events)
  }
  assert.ok(!all.includes("switch"))
  const r6 = sc.rally(s, 0)
  s = r6.state
  assert.ok(r6.events.includes("switch"), "switch ends when the first side reaches 6")
  assert.equal(sc.call(s), "6-0")
  // to 10-0, then game point; 10-10 needs two in a row
  for (let i = 0; i < 4; i++) s = sc.rally(s, 0).state
  assert.equal(sc.call(s), "10-0")
  assert.ok(sc.gamePoint(s, 0))
  assert.ok(!sc.gamePoint(s, 1), "the receiver can't score in side-out")
  assert.equal(sc.sayCall(s, ["gamepoint"]), "10, 0. Game point.")
  // side out, B to 10
  s = sc.rally(s, 1).state
  for (let i = 0; i < 10; i++) s = sc.rally(s, 1).state
  assert.equal(sc.call(s), "10-10")
  assert.ok(!sc.gamePoint(s, 1) || s.score[1] + 1 - s.score[0] >= 2 === false)
  s = sc.rally(s, 1).state
  assert.equal(sc.call(s), "11-10")
  assert.equal(s.over, false, "win by 2")
  const end = sc.rally(s, 1)
  assert.equal(end.state.over, true)
  assert.equal(end.state.winner, 1)
  assert.ok(end.events.includes("game"))
  assert.match(sc.sayCall(end.state, end.events, ["Ann", "Bo"]), /Bo wins, 12 to 10/)
  // nothing happens after the end
  assert.equal(sc.rally(end.state, 0).state, end.state)
})

test("rally scoring: every rally scores, one server per turn by score parity; freeze", () => {
  let { s } = play(sc.newGame({ format: "doubles", scoring: "rally", to: 15 }), [1])
  assert.deepEqual(s.score, [0, 1])
  assert.equal(s.serving, 1)
  assert.equal(sc.call(s), "1-0")
  // B's score is odd: the player in B's left court serves
  assert.equal(sc.serverSpot(s).side, "left")
  s = sc.rally(s, 1).state // B serves and scores: the server switches courts, now even, right
  assert.equal(sc.serverSpot(s).side, "right")
  assert.equal(sc.serverSpot(s).player, sc.serverSpot(sc.rally(s, 1).state).player)
  // freeze: at 14-x the receiving team can't win the game on a rally they didn't serve
  let f = sc.newGame({ format: "singles", scoring: "rally", to: 11, freeze: true })
  for (let i = 0; i < 10; i++) f = sc.rally(f, 0).state
  f = sc.rally(f, 1).state // B serves now, 10-1
  assert.equal(f.serving, 1)
  const r = sc.rally(f, 0)
  assert.deepEqual(r.state.score, [10, 1], "A only gets the serve back")
  assert.ok(r.events.includes("frozen"))
  const won = sc.rally(r.state, 0)
  assert.equal(won.state.over, true)
  // without freeze the receiver wins outright
  let g = sc.newGame({ format: "singles", scoring: "rally", to: 11 })
  for (let i = 0; i < 10; i++) g = sc.rally(g, 0).state
  g = sc.rally(g, 1).state
  assert.equal(sc.rally(g, 0).state.over, true)
})

test("best-of matches", () => {
  assert.deepEqual(sc.matchState([[11, 5]], 1), { won: [1, 0], need: 1, over: true, winner: 0 })
  assert.equal(sc.matchState([[11, 5], [7, 11]], 3).over, false)
  assert.equal(sc.matchState([[11, 5], [7, 11], [9, 11]], 3).winner, 1)
})

const T0 = Date.UTC(2026, 9, 1)
const M = (id, teams, games, extra = {}) => ({ id, at: T0 + Number.parseInt(id, 16), kind: teams[0].length === 1 ? "singles" : "doubles", teams: teams.map((t) => t.map((k) => (k.startsWith("g:") ? { g: k.slice(2) } : { k }))), games, status: "confirmed", ...extra })

test("cleanMatch and statuses", () => {
  const now = T0 + 1000
  assert.equal(core.cleanMatch({ kind: "doubles", teams: [[{ k: "a" }], [{ k: "b" }, { k: "c" }]], games: [[11, 3]], at: now }, now).ok, false)
  assert.equal(core.cleanMatch({ kind: "doubles", teams: [[{ k: "a" }, { k: "a" }], [{ k: "b" }, { k: "c" }]], games: [[11, 3]], at: now }, now).ok, false)
  assert.equal(core.cleanMatch({ kind: "singles", teams: [[{ k: "a" }], [{ k: "b" }]], games: [[11, 11]], at: now }, now).ok, false)
  assert.equal(core.cleanMatch({ kind: "singles", teams: [[{ k: "a" }], [{ k: "b" }]], games: [[11, 9], [9, 11]], at: now }, now).ok, false, "nobody won")
  assert.equal(core.cleanMatch({ kind: "singles", teams: [[{ k: "a" }], [{ k: "b" }]], games: [[11, 9]], at: now + 3_600_000 }, now).ok, false, "the future")
  const ok = core.cleanMatch({ kind: "doubles", teams: [[{ k: "a" }, { g: "Uncle Bob" }], [{ k: "b" }, { k: "c" }]], games: [[11, 9]], at: now, venue: { id: "loscab" }, note: "x".repeat(500) }, now)
  assert.equal(ok.ok, true)
  assert.equal(ok.match.note.length, core.LIMITS.matchNote)
  assert.deepEqual(ok.match.venue, { id: "loscab" })
  // a guest anywhere: unrated; otherwise pending until an opponent confirms
  assert.equal(core.startStatus(ok.match, "a"), "unrated")
  const m = { ...ok.match, teams: [[{ k: "a" }, { k: "d" }], [{ k: "b" }, { k: "c" }]], by: "a", status: "pending" }
  assert.equal(core.startStatus(m, "a"), "pending")
  assert.equal(core.canConfirm(m, "d"), false, "your partner can't confirm")
  assert.equal(core.canConfirm(m, "b"), true)
  assert.equal(core.canConfirm(m, "a"), false)
  assert.equal(core.expireStatus({ ...m, createdAt: now }, now + 8 * core.DAY), "expired")
})

test("ratings: winners go up, partner-adjusted, margin, guests unrated, seasons", () => {
  const matches = [
    M("01", [["a", "b"], ["c", "d"]], [[11, 2]]),
    M("02", [["a", "c"], ["b", "d"]], [[11, 9]]),
    M("03", [["a"], ["b"]], [[11, 5], [11, 7]]),
    M("04", [["a", "g:Guest"], ["c", "d"]], [[11, 0]]),
    M("05", [["c", "d"], ["a", "b"]], [[11, 4]], { status: "pending" }),
  ]
  const r = core.computeRatings(matches)
  assert.ok(r.doubles["k:a"].r > 1500)
  assert.ok(r.doubles["k:d"].r < 1500)
  assert.equal(r.doubles["k:a"].games, 2, "the guest match and the pending one don't count")
  assert.equal(r.singles["k:a"].games, 2)
  assert.ok(r.singles["k:a"].r > r.singles["k:b"].r)
  // zero-sum-ish between equal players, and a blowout moves more than a close game
  const close = core.computeRatings([M("01", [["a"], ["b"]], [[11, 10]])]).singles
  const blow = core.computeRatings([M("01", [["a"], ["b"]], [[11, 0]])]).singles
  assert.ok(blow["k:a"].r - 1500 > close["k:a"].r - 1500)
  assert.equal(close["k:a"].r - 1500, 1500 - close["k:b"].r)
  // partner-adjusted: the stronger partner gains less from the same win
  const history = [M("01", [["a", "p0"], ["x0", "q0"]], [[11, 0]]), M("02", [["a", "p1"], ["x1", "q1"]], [[11, 0]])]
  const before = core.computeRatings(history).doubles["k:a"].r
  const after = core.computeRatings([...history, M("09", [["a", "b"], ["c", "d"]], [[11, 5]])]).doubles
  assert.ok(before > 1500)
  assert.ok(after["k:b"].r - 1500 > after["k:a"].r - before, "the weaker partner gains more")
  // seasons: only matches since
  const season = core.computeRatings(matches, { since: T0 + 3 })
  assert.equal(season.singles["k:a"].games, 2)
  assert.equal(season.doubles["k:a"], undefined)
  assert.equal(core.levelOf(1500), 3.5)
  assert.equal(core.levelOf(1700), 4.5)
  assert.equal(core.levelOf(9999), 6.5)
  assert.equal(core.ladder(r.doubles)[0].id, "k:a")
})

test("stats: record, streaks, head-to-head, partners, form", () => {
  const ms = [
    M("01", [["a", "b"], ["c", "d"]], [[11, 2]]),
    M("02", [["a", "b"], ["c", "d"]], [[11, 9]]),
    M("03", [["a", "c"], ["b", "d"]], [[5, 11]]),
    M("04", [["a", "g:Guest"], ["c", "d"]], [[11, 0]], { status: "unrated" }),
    M("05", [["a", "b"], ["c", "d"]], [[4, 11]], { status: "disputed" }),
  ]
  const s = core.statsFor("a", ms, { b: "Bea", c: "Cy" })
  assert.equal(s.matches, 4)
  assert.equal(s.w, 3)
  assert.equal(s.l, 1)
  assert.equal(s.streak, 1)
  assert.equal(s.best, 2)
  assert.equal(s.form, "WWLW")
  assert.deepEqual(s.partners["k:b"], { name: "Bea", w: 2, l: 0, diff: 11 })
  assert.equal(s.partners["g:Guest"].w, 1)
  assert.deepEqual([s.opponents["k:d"].w, s.opponents["k:d"].l], [3, 1])
  assert.equal(s.pf, 11 + 11 + 5 + 11)
  assert.equal(core.streakText(-2), "L2")
})

test("sessions: cleaning, RSVP order, waitlist moves up", () => {
  const now = T0
  assert.equal(core.cleanSession({ venue: null, start: now + 1000 }, now).ok, false)
  assert.equal(core.cleanSession({ venue: { id: "loscab" }, start: now + 400 * core.DAY }, now).ok, false)
  const c = core.cleanSession({ venue: { id: "wolfbear" }, start: now + 3_600_000, max: 99, skill: { min: 3.5, max: 3.0 } }, now)
  assert.equal(c.ok, true)
  assert.equal(c.session.max, core.LIMITS.sessionPlayers)
  assert.equal(c.session.skill, null, "min above max is dropped")
  assert.equal(c.session.title, "Open play at Wolf + Bear")
  const s = { max: 2, rsvps: { a: { s: "in", at: 3 }, b: { s: "in", at: 1 }, c: { s: "in", at: 2 }, d: { s: "maybe", at: 4 }, e: { s: "out", at: 5 } } }
  assert.deepEqual(core.rsvpLists(s), { in: ["b", "c"], waitlist: ["a"], maybe: ["d"], out: ["e"] })
  assert.equal(core.rsvpOf(s, "a"), "waitlist")
  s.rsvps.b = { s: "out", at: 6 }
  assert.equal(core.rsvpOf(s, "a"), "in", "someone dropping out moves the waitlist up")
  assert.match(core.mapsLinks({ id: "smash" }).google, /California%20SMASH/)
})

test("rotations: fair sit-outs, few repeat partners, king of the court, mixed groups", () => {
  const players = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]
  const rs = rot.rounds(players, 10, { courts: 2, seed: 42 })
  for (const r of rs) {
    assert.equal(r.courts.length, 2)
    assert.equal(r.sitting.length, 2)
    const on = r.courts.flatMap((c) => c.teams.flat())
    assert.equal(new Set([...on, ...r.sitting]).size, 10, "everyone exactly once")
  }
  const t = rot.tally(rs)
  const sat = players.map((p) => t.sat[p] || 0)
  assert.ok(Math.max(...sat) - Math.min(...sat) <= 1, `sit-outs even: ${sat}`)
  const repeats = Object.values(t.partners).filter((n) => n > 1).length
  assert.ok(repeats <= 4, `few repeat partners (${repeats})`)
  // same seed, same courts on every phone
  assert.deepEqual(rot.rounds(players, 3, { courts: 2, seed: 7 }), rot.rounds(players, 3, { courts: 2, seed: 7 }))
  // fewer than 4: nobody plays
  assert.deepEqual(rot.nextRound([], ["a", "b", "c"], {}), { courts: [], sitting: ["a", "b", "c"] })
  // king: winners move up and split, top winners stay
  const eight = players.slice(0, 8)
  const first = rot.nextRound([], eight, { courts: 2, seed: 3 })
  const king = rot.nextRound([first], eight, { mode: "king", courts: 2, seed: 3, results: [0, 1] })
  const top = king.courts[0].teams.flat()
  for (const p of [...first.courts[0].teams[0], ...first.courts[1].teams[1]]) assert.ok(top.includes(p), `${p} moved up / stayed`)
  for (const tm of king.courts[0].teams) assert.ok(!(first.courts[0].teams[0].includes(tm[0]) && first.courts[0].teams[0].includes(tm[1])), "winners split up")
  // king with someone sitting: they come in at the bottom
  const nine = players.slice(0, 9)
  const k1 = rot.nextRound([], nine, { courts: 2, seed: 5 })
  const k2 = rot.nextRound([k1], nine, { mode: "king", courts: 2, seed: 5, results: [0, 0] })
  assert.ok(k2.courts[1].teams.flat().includes(k1.sitting[0]))
  assert.equal(k2.sitting.length, 1)
  // mixed: one from each group per team
  const groups = { a: "A", b: "A", c: "A", d: "A", e: "B", f: "B", g: "B", h: "B" }
  for (const r of rot.rounds(eight, 4, { mode: "mixed", groups, courts: 2, seed: 9 })) for (const c of r.courts) for (const tm of c.teams) assert.notEqual(groups[tm[0]], groups[tm[1]])
})
