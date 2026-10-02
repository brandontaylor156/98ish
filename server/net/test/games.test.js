const test = require("node:test")
const assert = require("node:assert/strict")
const { createGames } = require("../games")

const setup = (delays = { botPass: 0, botPlay: 0, trick: 0, nextHand: 0 }) => {
  const inbox = { a: [], b: [], c: [] }
  const games = createGames({ emit: (pid, event, payload) => inbox[pid]?.push({ event, payload }), delays })
  const last = (pid, event) => inbox[pid].filter((m) => m.event === event).at(-1)?.payload
  return { games, inbox, last }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

test("invite, accept and play checkers to a resignation, then a rematch with colors swapped", () => {
  const { games, last } = setup()
  const inv = games.invite({ from: "a", fromName: "Alice", to: "b", toName: "Bob", game: "checkers" })
  assert.ok(inv.ok)
  assert.equal(last("b", "net:invited").from, "Alice")
  assert.equal(games.invite({ from: "a", fromName: "Alice", to: "b", toName: "Bob", game: "checkers" }).ok, false) // no duplicates
  const acc = games.replyInvite("b", inv.inviteId, true)
  assert.ok(acc.ok)
  assert.equal(last("a", "net:inviteResult").status, "accepted")
  const va = last("a", "net:match")
  const vb = last("b", "net:match")
  assert.notEqual(va.you, vb.you)
  const blackPid = va.you === "b" ? "a" : "b"
  const redPid = blackPid === "a" ? "b" : "a"
  const bv = last(blackPid, "net:match")
  assert.equal(bv.legal.length, 7)
  assert.equal(last(redPid, "net:match").legal.length, 0)
  assert.equal(games.checkersMove(redPid, acc.matchId, bv.legal[0]).ok, false) // not your turn
  assert.ok(games.checkersMove(blackPid, acc.matchId, bv.legal[0]).ok)
  assert.equal(last(redPid, "net:match").legal.length, 7)
  games.draw(redPid, acc.matchId, "offer")
  assert.equal(last(blackPid, "net:match").drawOffer, "them")
  games.draw(blackPid, acc.matchId, "decline")
  assert.equal(last(blackPid, "net:match").drawOffer, null)
  games.resign(redPid, acc.matchId)
  assert.equal(last(blackPid, "net:match").result.youWon, true)
  games.rematch("a", acc.matchId)
  assert.deepEqual(last("b", "net:match").rematch, { you: false, them: true })
  games.rematch("b", acc.matchId)
  const again = last(blackPid, "net:match")
  assert.equal(again.result, null)
  assert.equal(again.you, "r") // swapped
  assert.equal(again.round, 2)
})

test("declined and expired invitations tell the inviter", () => {
  const { games, last } = setup()
  const inv = games.invite({ from: "a", fromName: "Alice", to: "b", toName: "Bob", game: "race", options: { level: "expert" } })
  assert.equal(last("b", "net:invited").options.level, "expert")
  games.replyInvite("b", inv.inviteId, false)
  assert.equal(last("a", "net:inviteResult").status, "declined")
  assert.equal(games.replyInvite("b", inv.inviteId, true).ok, false)
  assert.equal(games.invite({ from: "a", fromName: "A", to: "a", toName: "A", game: "race" }).ok, false)
  assert.equal(games.invite({ from: "a", fromName: "A", to: "b", toName: "B", game: "chess" }).ok, false)
})

test("minesweeper race: same seed for both, progress shared, first to clear wins", () => {
  const { games, last } = setup()
  const inv = games.invite({ from: "a", fromName: "Alice", to: "b", toName: "Bob", game: "race", options: { level: "beginner" } })
  const { matchId } = games.replyInvite("b", inv.inviteId, true)
  const m = games.matches.get(matchId)
  m.startAt = Date.now() - 1 // skip the countdown
  assert.equal(last("a", "net:match").seed, last("b", "net:match").seed)
  assert.ok(games.raceProgressUpdate("a", matchId, { revealed: 30, flags: 2, status: "playing" }).ok)
  assert.equal(last("b", "net:match").them.revealed, 30)
  assert.equal(games.raceProgressUpdate("a", matchId, { revealed: 10, flags: 2, status: "playing" }).ok, false) // can't go backwards
  assert.equal(games.raceProgressUpdate("a", matchId, { revealed: 50, flags: 2, status: "won" }).ok, false) // 71 safe cells
  assert.ok(games.raceProgressUpdate("b", matchId, { revealed: 71, flags: 10, status: "won", time: 12000 }).ok)
  assert.equal(last("b", "net:match").result.youWon, true)
  assert.equal(last("a", "net:match").result.winnerName, "Bob")
})

test("race: hitting a mine loses", () => {
  const { games, last } = setup()
  const inv = games.invite({ from: "a", fromName: "Alice", to: "b", toName: "Bob", game: "race" })
  const { matchId } = games.replyInvite("b", inv.inviteId, true)
  games.matches.get(matchId).startAt = Date.now() - 1
  games.raceProgressUpdate("a", matchId, { revealed: 5, flags: 0, status: "lost" })
  assert.equal(last("b", "net:match").result.youWon, true)
  assert.equal(last("b", "net:match").result.reason, "mine")
})

test("leaving or dropping mid-game forfeits", () => {
  const { games, last } = setup()
  const inv = games.invite({ from: "a", fromName: "Alice", to: "b", toName: "Bob", game: "checkers" })
  const { matchId } = games.replyInvite("b", inv.inviteId, true)
  games.setAway("a", true)
  assert.equal(last("b", "net:match").away, true)
  games.setAway("a", false)
  assert.equal(last("b", "net:match").away, false)
  games.drop("a")
  const view = last("b", "net:match")
  assert.equal(view.result.youWon, true)
  assert.equal(view.left, true)
  assert.equal(games.rematch("b", matchId).ok, false)
  games.leave("b", matchId)
  assert.equal(games.matches.size, 0)
})

test("hearts: host invites one human, computers fill the rest, a whole game plays out", async () => {
  const { games, last, inbox } = setup()
  const { matchId } = games.createTable("a", "Alice")
  assert.equal(last("a", "net:match").phase, "lobby")
  const inv = games.invite({ from: "a", fromName: "Alice", to: "b", toName: "Bob", game: "hearts", matchId })
  assert.ok(inv.ok)
  assert.deepEqual(last("a", "net:match").pending, ["Bob"])
  assert.equal(games.startTable("b", matchId).ok, false) // only the host deals
  assert.ok(games.replyInvite("b", inv.inviteId, true).ok)
  assert.equal(last("b", "net:match").you, 1)
  assert.ok(games.startTable("a", matchId).ok)
  const seats = last("a", "net:match").seats
  assert.deepEqual(seats.map((s) => s.bot), [false, false, true, true])

  // Both humans play like bots would, through the public API
  const hearts = require("../hearts")
  let guard = 0
  while (guard++ < 4000) {
    const m = games.matches.get(matchId)
    if (!m || m.state.phase === "gameOver") break
    for (const pid of ["a", "b"]) {
      const v = last(pid, "net:match")
      if (v.phase === "passing" && !v.passed) assert.ok(games.heartsPass(pid, matchId, hearts.botPass(v.hand)).ok)
      if (v.phase === "playing" && v.turn === v.you && v.legal.length) {
        const card = hearts.botPlay(m.state, v.you)
        const r = games.heartsPlay(pid, matchId, card)
        assert.ok(r.ok, r.error)
      }
    }
    await wait(1)
  }
  const final = last("a", "net:match")
  assert.equal(final.phase, "gameOver")
  assert.ok(final.winners.length >= 1)
  assert.ok(inbox.b.length > 50)
})

test("hearts: a player who leaves is replaced by a computer", async () => {
  const { games, last } = setup({ botPass: 0, botPlay: 0, trick: 0, nextHand: 10_000 })
  const { matchId } = games.createTable("a", "Alice")
  const inv = games.invite({ from: "a", fromName: "Alice", to: "b", toName: "Bob", game: "hearts", matchId })
  games.replyInvite("b", inv.inviteId, true)
  games.startTable("a", matchId)
  games.leave("b", matchId)
  const v = last("a", "net:match")
  assert.equal(v.seats[1].bot, true)
  assert.match(v.seats[1].name, /Bob \(computer\)/)
  games.leave("a", matchId)
  assert.equal(games.matches.size, 0)
})

test("hearts: the host closing the lobby tells the guests", () => {
  const { games, last } = setup()
  const { matchId } = games.createTable("a", "Alice")
  const inv = games.invite({ from: "a", fromName: "Alice", to: "b", toName: "Bob", game: "hearts", matchId })
  games.replyInvite("b", inv.inviteId, true)
  games.leave("a", matchId)
  assert.equal(last("b", "net:matchGone").id, matchId)
})
