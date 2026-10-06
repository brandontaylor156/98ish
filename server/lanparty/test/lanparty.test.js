const test = require("node:test")
const assert = require("node:assert/strict")
const { createLanParty } = require("..")

// a fake 98 Messenger: alice and bob are buddies, carol blocks alice, dave knows nobody
const fakeAim = () => {
  const users = {
    alice: { groups: [{ buddies: ["Bob", "Carol"] }], blocked: [] },
    bob: { groups: [{ buddies: ["Alice"] }], blocked: [] },
    carol: { groups: [{ buddies: ["Alice"] }], blocked: ["alice"] },
    dave: { groups: [], blocked: [] },
  }
  return { sessions: new Map(Object.entries(users).map(([k, user]) => [k, { user }])) }
}

const setup = (opts = {}) => {
  const sent = []
  let t = 1_000_000
  const lan = createLanParty({ emit: (pid, event, payload) => sent.push({ pid, event, payload }), aim: fakeAim, now: () => t, ...opts })
  const who = (name, pid) => ({ pid, name, key: name.toLowerCase() })
  return { lan, sent, who, tick: (ms) => (t += ms) }
}

test("host publishes a game under a code; a buddy sees it, joins, and the host hears", () => {
  const { lan, sent, who } = setup()
  const A = who("Alice", 1)
  const B = who("Bob", 2)
  const r = lan.host(A, { game: "doom", nodes: 3, deathmatch: true, peerId: 4242 })
  assert.equal(r.ok, true)
  assert.match(r.code, /^[A-Z2-9]{5}$/)
  const seen = lan.list(B).games
  assert.equal(seen.length, 1)
  assert.deepEqual({ game: seen[0].game, nodes: seen[0].nodes, deathmatch: seen[0].deathmatch, peerId: seen[0].peerId, host: seen[0].host }, { game: "doom", nodes: 3, deathmatch: true, peerId: 4242, host: "Alice" })
  const j = lan.join(B, { code: r.code.toLowerCase() })
  assert.equal(j.ok, true)
  assert.equal(j.game.peerId, 4242)
  assert.deepEqual(sent.at(-1), { pid: 1, event: "lan:joined", payload: { code: r.code, name: "Bob", count: 2 } })
})

test("who can see a game: buddies yes, strangers and blocked no; the code still works for anyone", () => {
  const { lan, who } = setup()
  const r = lan.host(who("Alice", 1), { game: "heretic", peerId: 7 })
  assert.equal(lan.list(who("Dave", 4)).games.length, 0)
  assert.equal(lan.list(who("Carol", 3)).games.length, 0)
  assert.equal(lan.list(who("Alice", 1)).games.length, 1)
  assert.equal(lan.join(who("Dave", 4), { code: r.code }).ok, true)
})

test("checks: known games, a ready peer id, full games, own game, bad codes", () => {
  const { lan, who } = setup()
  assert.equal(lan.host(who("Alice", 1), { game: "quake", peerId: 1 }).ok, false)
  assert.equal(lan.host(who("Alice", 1), { game: "doom", peerId: 0 }).ok, false)
  const r = lan.host(who("Alice", 1), { game: "doom", nodes: 2, peerId: 9 })
  assert.equal(lan.join(who("Alice", 1), { code: r.code }).ok, false)
  assert.equal(lan.join(who("Bob", 2), { code: r.code }).ok, true)
  assert.equal(lan.join(who("Dave", 4), { code: r.code }).error, "That game is full.")
  assert.equal(lan.join(who("Dave", 4), { code: "ZZZZZ" }).ok, false)
  // nodes are clamped to 2..4
  const r2 = lan.host(who("Dave", 4), { game: "heretic", nodes: 99, peerId: 3 })
  assert.equal(lan.join(who("Bob", 2), { code: r2.code }).game.nodes, 4)
})

test("the game ends when the host stops or drops; players are told; old games expire", () => {
  const { lan, sent, who, tick } = setup({ limits: { maxMs: 1000 } })
  const r = lan.host(who("Alice", 1), { game: "doom", peerId: 5 })
  lan.join(who("Bob", 2), { code: r.code })
  lan.drop(1)
  assert.deepEqual(sent.at(-1), { pid: 2, event: "lan:end", payload: { code: r.code, reason: "host-left" } })
  assert.equal(lan.games.size, 0)
  const r2 = lan.host(who("Alice", 1), { game: "doom", peerId: 6 })
  tick(5000)
  assert.equal(lan.list(who("Bob", 2)).games.length, 0)
  assert.equal(lan.join(who("Bob", 2), { code: r2.code }).ok, false)
  // a new game replaces your old one
  const a = lan.host(who("Alice", 1), { game: "doom", peerId: 6 })
  const b = lan.host(who("Alice", 1), { game: "heretic", peerId: 6 })
  assert.equal(lan.games.has(a.code), false)
  assert.equal(lan.games.has(b.code), true)
})

test("rate limits and the cap on games", () => {
  const { lan, who } = setup({ limits: { maxGames: 2 } })
  assert.equal(lan.host(who("Alice", 1), { game: "doom", peerId: 1 }).ok, true)
  assert.equal(lan.host(who("Bob", 2), { game: "doom", peerId: 2 }).ok, true)
  assert.equal(lan.host(who("Dave", 4), { game: "doom", peerId: 3 }).ok, false)
  let refused = 0
  for (let i = 0; i < 30; i++) if (lan.join(who("Carol", 3), { code: "NOPE1" }).error === "Slow down a little.") refused++
  assert.ok(refused > 0)
})
