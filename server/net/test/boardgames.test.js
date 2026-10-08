// Reversi, Chess and Battleship matches on the server: invitations, turns, results,
// rematches, and Battleship's secret fleets
const test = require("node:test")
const assert = require("node:assert/strict")
const { createGames } = require("../games")
const { ready } = require("../rules")

const setup = () => {
  const inbox = { a: [], b: [] }
  const games = createGames({ emit: (pid, event, payload) => inbox[pid]?.push({ event, payload: JSON.parse(JSON.stringify(payload)) }) })
  const last = (pid, event = "net:match") => inbox[pid].filter((m) => m.event === event).at(-1)?.payload
  const start = (game) => {
    const inv = games.invite({ from: "a", fromName: "Alice", to: "b", toName: "Bob", game })
    assert.ok(inv.ok, inv.error)
    assert.equal(last("b", "net:invited").gameName, { reversi: "Reversi", chess: "Chess", battleship: "Battleship" }[game])
    const acc = games.replyInvite("b", inv.inviteId, true)
    assert.ok(acc.ok)
    return acc.matchId
  }
  return { games, inbox, last, start }
}

test.before(() => ready)

test("reversi: turns, legal moves only for the side to move, a whole game, rematch swaps colors", async () => {
  const { reversi } = await ready
  const { games, last, start } = setup()
  const id = start("reversi")
  const black = last("a").you === "b" ? "a" : "b"
  const white = black === "a" ? "b" : "a"
  assert.equal(last(black).legal.length, 4)
  assert.equal(last(white).legal.length, 0)
  assert.equal(games.gameMove(white, id, { square: 19 }).ok, false) // not your turn
  assert.equal(games.gameMove(black, id, { square: 0 }).ok, false) // flips nothing
  assert.equal(games.gameMove(black, id, { square: "19" }).ok, false) // not a number
  let guard = 0
  while (!last("a").result && guard++ < 100) {
    const pid = last("a").turn === last("a").you ? "a" : "b"
    const v = last(pid)
    assert.ok(v.legal.length > 0)
    assert.ok(games.gameMove(pid, id, { square: v.legal[0] }).ok)
  }
  const ra = last("a").result
  const rb = last("b").result
  assert.ok(ra && rb)
  const c = reversi.countDiscs(last("a").board)
  if (c.b === c.w) assert.ok(ra.draw && rb.draw)
  else assert.equal(ra.youWon, (c.b > c.w ? "b" : "w") === last("a").you)
  assert.equal(games.gameMove("a", id, { square: 0 }).ok, false)
  games.rematch("a", id)
  games.rematch("b", id)
  assert.equal(last(black).you, "w")
  assert.equal(last(black).round, 2)
  assert.equal(last(white).legal.length, 4) // now black: moves first
})

test("chess: scholar's mate through the server, draw offers, resign", async () => {
  const { chess } = await ready
  const { games, last, start } = setup()
  const id = start("chess")
  const white = last("a").you === "w" ? "a" : "b"
  const black = white === "a" ? "b" : "a"
  assert.equal(last(white).legal.length, 20)
  assert.equal(last(black).legal.length, 0)
  const sq = chess.squareIndex
  const mv = (pid, from, to, promotion) => games.gameMove(pid, id, { from: sq(from), to: sq(to), promotion })
  assert.equal(mv(black, "e7", "e5").ok, false)
  assert.equal(mv(white, "e2", "e5").ok, false)
  assert.ok(mv(white, "e2", "e4").ok)
  // a draw offer, declined by moving
  assert.ok(games.draw(white, id, "offer").ok)
  assert.equal(last(black).drawOffer, "them")
  assert.ok(mv(black, "e7", "e5").ok)
  assert.equal(last(white).drawOffer, null)
  assert.ok(mv(white, "f1", "c4").ok)
  assert.ok(mv(black, "b8", "c6").ok)
  assert.ok(mv(white, "d1", "h5").ok)
  assert.ok(mv(black, "g8", "f6").ok)
  assert.ok(mv(white, "h5", "f7").ok)
  const v = last(white)
  assert.deepEqual(v.sans, ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"])
  assert.equal(v.result.youWon, true)
  assert.equal(v.result.reason, "checkmate")
  assert.equal(last(black).result.youWon, false)
  // rematch: colors swap; then a draw by agreement and a resignation
  games.rematch("a", id)
  games.rematch("b", id)
  assert.equal(last(white).you, "b")
  assert.ok(games.draw(white, id, "offer").ok)
  assert.ok(games.draw(black, id, "accept").ok)
  assert.equal(last("a").result.draw, true)
  assert.equal(last("a").result.reason, "agreed")
  games.rematch("a", id)
  games.rematch("b", id)
  games.resign("a", id)
  assert.equal(last("b").result.youWon, true)
})

test("chess: a promotion through the server", async () => {
  const { chess } = await ready
  const { games, last, start } = setup()
  const id = start("chess")
  const white = last("a").you === "w" ? "a" : "b"
  const black = white === "a" ? "b" : "a"
  const sq = chess.squareIndex
  const line = [
    [white, "e2", "e4"], [black, "d7", "d5"], [white, "e4", "d5"], [black, "c7", "c6"], [white, "d5", "c6"],
    [black, "g8", "f6"], [white, "c6", "b7"], [black, "b8", "d7"],
  ]
  for (const [pid, from, to] of line) assert.ok(games.gameMove(pid, id, { from: sq(from), to: sq(to) }).ok, `${from}-${to}`)
  assert.ok(last(white).legal.some((m) => m.from === sq("b7") && m.to === sq("a8") && m.promotion))
  assert.ok(games.gameMove(white, id, { from: sq("b7"), to: sq("a8"), promotion: "n" }).ok)
  assert.equal(last(black).board[sq("a8")], "N")
  assert.equal(last(black).sans.at(-1), "bxa8=N")
})

test("battleship: placement, turns, sinking, and the other fleet is never sent until the end", async () => {
  const { battleship: bs } = await ready
  const { games, inbox, last, start } = setup()
  const id = start("battleship")
  const fleetA = bs.randomFleet()
  // (two random fleets share an identical ship ~3.5% of the time, and the leak check below
  // would then find your own ship's placement and call it the enemy's: re-roll until distinct)
  let fleetB = bs.randomFleet()
  const same = (f) => f.some((s) => fleetA.some((t) => JSON.stringify(s) === JSON.stringify(t)))
  while (same(fleetB)) fleetB = bs.randomFleet()
  assert.equal(last("a").phase, "placing")
  assert.equal(games.gameMove("a", id, { fleet: fleetA.slice(0, 3) }).ok, false)
  assert.equal(games.gameMove("a", id, { cell: 0 }).ok, false) // can't fire yet
  assert.ok(games.gameMove("a", id, { fleet: fleetA }).ok)
  assert.deepEqual(last("b").placed, { you: false, them: true })
  assert.ok(games.gameMove("b", id, { fleet: fleetB }).ok)
  assert.equal(last("a").phase, "playing")
  const first = last("a").yourTurn ? "a" : "b"
  assert.equal(last(first === "a" ? "b" : "a").yourTurn, false)

  // play it out: the first shooter fires at every cell of the other fleet, the other misses
  const second = first === "a" ? "b" : "a"
  const targetFleet = first === "a" ? fleetB : fleetA
  const targets = targetFleet.flatMap((s) => bs.cellsOf(s))
  const taken = new Set((first === "a" ? fleetA : fleetB).flatMap((s) => bs.cellsOf(s)))
  const misses = Array.from({ length: 100 }, (_, i) => i).filter((c) => !taken.has(c))
  for (const cell of targets) {
    assert.ok(games.gameMove(first, id, { cell }).ok)
    if (!last(first).result) assert.ok(games.gameMove(second, id, { cell: misses.shift() }).ok)
  }
  assert.equal(games.gameMove(second, id, { cell: misses.shift() }).ok, false) // over
  assert.equal(last(first).result.youWon, true)
  assert.equal(last(first).result.reason, "sunk")
  assert.equal(last(second).enemy.sunk.length, 0)
  assert.deepEqual(last(second).enemyFleet, targetFleet === fleetA ? fleetB : fleetA)

  // every payload either player got before the end: no enemy fleet, and no cell of an
  // enemy ship that wasn't already hit
  for (const [pid, own, theirs] of [["a", fleetA, fleetB], ["b", fleetB, fleetA]]) {
    for (const { event, payload } of inbox[pid]) {
      if (event !== "net:match" || payload.result) continue
      assert.equal(payload.enemyFleet, undefined)
      if (payload.own.fleet) assert.deepEqual(payload.own.fleet, own)
      const json = JSON.stringify(payload)
      for (const ship of theirs) {
        // the exact placement objects of the other side never appear
        assert.ok(!json.includes(JSON.stringify(ship)), `${pid} saw ${ship.id}`)
      }
      const hit = new Set(payload.enemy.shots.filter((s) => s.hit).map((s) => s.cell))
      for (const s of payload.enemy.sunk) for (const c of s.cells) assert.ok(hit.has(c))
    }
  }

  // rematch: the other side fires first
  games.rematch("a", id)
  games.rematch("b", id)
  assert.equal(last("a").phase, "placing")
  assert.equal(last(second).firstShot, "you")
})

test("battleship: resigning while placing ends the game", async () => {
  await ready
  const { games, last, start } = setup()
  const id = start("battleship")
  games.resign("b", id)
  assert.equal(last("a").result.youWon, true)
  assert.equal(games.busy("a"), false)
})
