// Sunny Acres co-op: the server's town follows the very same rules as the browser's game,
// patches rebuild the town exactly, conflicting moves resolve one way, bad intents are
// refused, only members get in, towns persist and catch up from timestamps, and rate limits.
const test = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const { pathToFileURL } = require("node:url")
const town = require("..")
const { createCoop, coupleTownId } = require("../coop")
const { createGames } = require("../../net/games")

const TOWN = path.join(__dirname, "../../../client/src/components/applets/town")
const mods = Promise.all(["game.js", "data.js", "coopRules.js"].map((f) => import(pathToFileURL(path.join(TOWN, f)).href)))

const T0 = Date.UTC(2026, 9, 5, 12)
const USERS = {
  alice: { key: "alice", screenName: "Alice", blocked: [], groups: [{ name: "Buddies", buddies: ["Bobby", "Dave"] }] },
  bobby: { key: "bobby", screenName: "Bobby", blocked: [], groups: [{ name: "Buddies", buddies: ["Alice"] }] },
  carol: { key: "carol", screenName: "Carol", blocked: [], groups: [] },
  dave: { key: "dave", screenName: "Dave", blocked: [], groups: [{ name: "Buddies", buddies: ["Alice"] }] },
  erin: { key: "erin", screenName: "Erin", blocked: [], groups: [] },
  frank: { key: "frank", screenName: "Frank", blocked: [], groups: [] },
}
// computers on the network: pid -> who's signed on there
const PIDS = { pa: "alice", pb: "bobby", pc: "carol", pd: "dave", pe: "erin", pf: "frank", pg: null }
const me = (pid) => ({ pid, name: PIDS[pid] ? USERS[PIDS[pid]].screenName : "GUEST-1234", key: PIDS[pid] })

const setup = ({ rate } = {}) => {
  let t = T0
  let paired = true
  const couples = {
    partnerOf: (key) => (paired ? { alice: "Bobby", bobby: "Alice" }[key] || null : null),
    coupleIdOf: (key) => (paired && ["alice", "bobby"].includes(key) ? "c0ffee" : null),
    isActiveCouple: (id) => paired && id === "c0ffee",
  }
  const aim = { sessions: new Map(), store: { find: async (key) => USERS[key] || null } }
  const store = town.memoryStore()
  const service = town.createTown({ store, aim, couples, now: () => t })
  const inbox = Object.fromEntries(Object.keys(PIDS).map((p) => [p, []]))
  const coop = createCoop({ service, emit: (pid, event, payload) => inbox[pid]?.push({ event, payload }), who: (pid) => (pid in PIDS ? me(pid) : null), tickMs: 0, saveMs: 5, rate })
  const of = (pid, event) => inbox[pid].filter((m) => m.event === event).map((m) => m.payload)
  return { coop, service, store, inbox, of, advance: (ms) => (t += ms), at: () => t, unpair: () => (paired = false), clear: () => Object.values(inbox).forEach((l) => (l.length = 0)) }
}

const ripe = (G, s, now) => s.objs.filter((o) => o.t === "field" && G.fieldStage(o, now) === 4).map((o) => o.i)
const fields = (s) => s.objs.filter((o) => o.t === "field").map((o) => o.i)
const comparable = (G, s) => {
  const out = JSON.parse(G.serialize(s))
  delete out.t
  return out
}

test("a couple's co-op town: create, join, and only members get in", async () => {
  const [G] = await mods
  const { coop, of } = setup()
  try {
    assert.equal((await coop.list(me("pg"))).ok, false, "guests need 98 Messenger")
    const made = await coop.create(me("pa"), { kind: "couple", from: "new" })
    assert.equal(made.ok, true, made.error)
    assert.equal(made.id, coupleTownId("c0ffee"))
    assert.equal((await coop.create(me("pb"), { kind: "couple", from: "new" })).exists, true, "one couple town per couple")
    assert.equal((await coop.create(me("pc"), { kind: "couple", from: "new" })).ok, false, "not paired")

    const a = await coop.join(me("pa"), { id: made.id })
    assert.equal(a.ok, true, a.error)
    const s = G.migrate(JSON.parse(a.state))
    assert.equal(s.tut, 6, "no tutorial in a co-op town")
    assert.equal(s.paired, "Bobby")
    assert.ok(s.objs.some((o) => o.t === "welcome"), "the couple's welcome sign")
    const b = await coop.join(me("pb"), { id: made.id })
    assert.equal(b.ok, true, "the partner can always come in")
    assert.notEqual(a.you.color, b.you.color, "each farmer has their own color")
    assert.equal(of("pa", "coop:players").at(-1).players.length, 2)
    assert.ok(b.ach.some((x) => x.id === "together"), "two farmers at once")

    // strangers can't come in, or use the town's chat
    const c = await coop.join(me("pc"), { id: made.id })
    assert.equal(c.ok, false)
    assert.equal(c.private, true)
    assert.deepEqual(coop.playersOf(made.id).sort(), ["pa", "pb"])
    assert.equal(coop.act(me("pc"), { id: made.id, seq: 1, it: { a: "harvest", ids: [1] } }).ok, false)
    assert.equal((await coop.join(me("pg"), { id: made.id })).ok, false, "guests can't")
    assert.equal((await coop.join(me("pa"), { id: "zz" })).ok, false)

    const listed = await coop.list(me("pb"))
    assert.equal(listed.towns.length, 1)
    assert.equal(listed.towns[0].name, "Our Co-op Town")
    assert.equal((await coop.list(me("pc"))).towns.length, 0)
  } finally {
    coop.close()
  }
})

test("the server applies intents exactly like the game, and patches rebuild the town", async () => {
  const [G, , C] = await mods
  const { coop, of, advance, at, clear } = setup()
  try {
    const { id } = await coop.create(me("pa"), { kind: "couple", from: "new" })
    await coop.join(me("pa"), { id })
    const b = await coop.join(me("pb"), { id })
    clear()
    // the browser's engine, on its own copy
    const local = G.migrate(JSON.parse(b.state))
    // ...and Bobby's copy, kept only from patches
    const mirror = G.migrate(JSON.parse(b.state))
    const f = fields(local)
    let seq = 0
    const step = (who, it, localFn) => {
      const r = coop.act(me(who), { id, seq: ++seq, it })
      assert.equal(r.ok, true, `${it.a}: ${r.reason}`)
      G.tick(local, at())
      const lr = localFn(local, at())
      assert.equal(lr.ok, true, `local ${it.a}: ${lr.reason}`)
      G.drainEvents(local)
    }
    step("pa", { a: "plant", ids: f.slice(0, 2), crop: "wheat" }, (s, now) => (G.plant(s, f[0], "wheat", now), G.plant(s, f[1], "wheat", now)))
    step("pb", { a: "plant", ids: f.slice(2), crop: "wheat" }, (s, now) => f.slice(2).map((x) => G.plant(s, x, "wheat", now)).at(-1))
    advance(25_000)
    step("pa", { a: "harvest", ids: f }, (s, now) => f.map((x) => G.harvest(s, x, now)).at(-1))
    const mill = local.objs.find((o) => o.t === "feedmill").i
    step("pb", { a: "make", id: mill, g: "cowfeed" }, (s, now) => G.queueProduct(s, mill, "cowfeed", now))
    advance(20_000)
    step("pa", { a: "collectGoods", id: mill }, (s, now) => G.collectFactory(s, mill, now))
    const order = local.orders.findIndex((o) => o.need && G.canDeliver(local, local.orders.indexOf(o)))
    if (order >= 0) step("pb", { a: "deliver", i: order, need: { ...local.orders[order].need } }, (s, now) => G.deliverOrder(s, order, now))
    step("pa", { a: "build", type: "cottage", x: 7, y: 15, f: 1 }, (s, now) => {
      const r = G.build(s, "cottage", 7, 15, now)
      r.obj.f = 1
      return r
    })
    step("pb", { a: "sellGood", g: "wheat", n: 1 }, (s) => G.sellGood(s, "wheat", 1))
    advance(60_000)
    const server = G.migrate(JSON.parse(coop.sync(me("pa"), { id }).state))
    G.tick(local, at())
    G.tick(server, at())
    G.drainEvents(local)
    G.drainEvents(server)
    assert.deepEqual(comparable(G, server), comparable(G, local), "server town == browser engine")

    // every patch, applied in order, gives Bobby the same town
    const patches = of("pb", "coop:patch")
    assert.ok(patches.length >= 7)
    let rev = b.rev
    for (const p of patches) {
      assert.equal(p.rev, rev + 1, "revisions count up by one")
      rev = p.rev
      C.applyPatch(mirror, p.patch)
    }
    const live = G.migrate(JSON.parse(coop.sync(me("pa"), { id }).state))
    assert.deepEqual(comparable(G, mirror), comparable(G, live), "patches rebuild the town")
    // the activity feed says who did what
    const lines = patches.filter((p) => p.line).map((p) => p.line.text)
    assert.ok(lines.includes("Alice planted 2 fields of wheat"), lines.join(" | "))
    assert.ok(lines.includes("Bobby planted 2 fields of wheat"))
    assert.equal(patches.find((p) => p.a === "plant" && p.by === "Bobby").doing, "planting wheat")
    assert.equal(JSON.stringify(patches.at(-1)).length < 3000, true, "patches are small")
  } finally {
    coop.close()
  }
})

test("two players doing the same thing at once: the first one wins, the other is told kindly", async () => {
  const [G] = await mods
  const { coop, advance, at } = setup()
  try {
    const { id } = await coop.create(me("pa"), { kind: "couple", from: "new" })
    const a = await coop.join(me("pa"), { id })
    await coop.join(me("pb"), { id })
    const f = fields(G.migrate(JSON.parse(a.state)))
    assert.equal(coop.act(me("pa"), { id, seq: 1, it: { a: "plant", ids: f, crop: "wheat" } }).ok, true)
    // Bobby planted the same fields a moment later
    const late = coop.act(me("pb"), { id, seq: 1, it: { a: "plant", ids: f, crop: "wheat" } })
    assert.equal(late.ok, false)
    assert.equal(late.reason, "Already planted by Alice")
    advance(30_000)
    // both swipe across the fields; Bobby's swipe gets there first for the first two
    const bob = coop.act(me("pb"), { id, seq: 2, it: { a: "harvest", ids: f.slice(0, 2) } })
    assert.equal(bob.ok, true)
    const alice = coop.act(me("pa"), { id, seq: 2, it: { a: "harvest", ids: f } })
    assert.equal(alice.ok, true, "the rest of Alice's swipe still counts")
    assert.deepEqual(alice.failed, f.slice(0, 2))
    assert.equal(alice.reason, "Already harvested by Bobby")
    const s = G.migrate(JSON.parse(coop.sync(me("pa"), { id }).state))
    assert.equal(s.goods.wheat, 2 + f.length * 2, "every field harvested exactly once")
    assert.equal(ripe(G, s, at()).length, 0)

    // building on the same tile: first come, first served
    assert.equal(coop.act(me("pa"), { id, seq: 3, it: { a: "build", type: "tree", x: 8, y: 16 } }).ok, true)
    const second = coop.act(me("pb"), { id, seq: 3, it: { a: "build", type: "tree", x: 8, y: 16 } })
    assert.equal(second.ok, false)
    assert.equal(second.reason, "Alice just built there!")
    // the same order can't be delivered twice
    const s2 = G.migrate(JSON.parse(coop.sync(me("pa"), { id }).state))
    const i = s2.orders.findIndex((o) => o.need && Object.entries(o.need).every(([g, n]) => (s2.goods[g] || 0) >= n))
    if (i >= 0) {
      const need = { ...s2.orders[i].need }
      assert.equal(coop.act(me("pb"), { id, seq: 4, it: { a: "deliver", i, need } }).ok, true)
      const again = coop.act(me("pa"), { id, seq: 4, it: { a: "deliver", i, need } })
      assert.equal(again.ok, false)
      assert.match(again.reason, /Bobby already delivered that order|no order here/)
    }
  } finally {
    coop.close()
  }
})

test("bad intents are refused and change nothing", async () => {
  const [G] = await mods
  const { coop } = setup()
  try {
    const { id } = await coop.create(me("pa"), { kind: "group", from: "new" })
    const a = await coop.join(me("pa"), { id })
    const before = coop.sync(me("pa"), { id })
    const bad = [
      null,
      "harvest",
      { a: "explode" },
      { a: "harvest", ids: [] },
      { a: "harvest", ids: ["1"] },
      { a: "harvest", ids: Array.from({ length: 41 }, (_, k) => k + 1) },
      { a: "plant", ids: [1], crop: "<b>" },
      { a: "build", type: "cottage", x: 99, y: 1 },
      { a: "deliver", i: 0, need: { gold: 1 } },
      { a: "hurry", target: { obj: -1 } },
      { a: "harvest", ids: [1], pad: "x".repeat(3000) },
    ]
    let seq = 0
    for (const it of bad) {
      const r = coop.act(me("pa"), { id, seq: ++seq, it })
      assert.equal(r.ok, false, JSON.stringify(it)?.slice(0, 60))
      assert.equal(r.seq, seq)
    }
    // well formed, but the rules say no
    const s = G.migrate(JSON.parse(a.state))
    const f = fields(s)[0]
    assert.equal(coop.act(me("pa"), { id, seq: 50, it: { a: "plant", ids: [f], crop: "strawberry" } }).reason, "You can't plant that yet.")
    assert.equal(coop.act(me("pa"), { id, seq: 51, it: { a: "harvest", ids: [f] } }).reason, "Nothing to harvest.")
    assert.equal(coop.act(me("pa"), { id, seq: 52, it: { a: "build", type: "villa", x: 7, y: 15 } }).ok, false)
    assert.equal(coop.sync(me("pa"), { id }).state, before.state, "nothing changed")
    assert.equal(coop.sync(me("pa"), { id }).rev, before.rev)
  } finally {
    coop.close()
  }
})

test("rate limits: a burst of 20 intents, then about 10 a second", async () => {
  const { coop, advance } = setup()
  try {
    const { id } = await coop.create(me("pa"), { kind: "group", from: "new" })
    await coop.join(me("pa"), { id })
    let slow = 0
    for (let k = 0; k < 30; k++) if (coop.act(me("pa"), { id, seq: k, it: { a: "sellGood", g: "wheat", n: 1 } }).slow) slow++
    assert.equal(slow, 10, "20 got through")
    advance(500)
    let ok = 0
    for (let k = 0; k < 10; k++) if (!coop.act(me("pa"), { id, seq: 100 + k, it: { a: "barn" } }).slow) ok++
    assert.equal(ok, 5, "half a second later, five more")
    // cursors have their own (smaller) allowance, and are clamped to the map
    let moved = 0
    for (let k = 0; k < 30; k++) if (coop.cursor(me("pa"), { id, u: 99, v: -4 }).ok) moved++
    assert.equal(moved, 15)
  } finally {
    coop.close()
  }
})

test("towns persist, idle towns don't tick, and catch up from timestamps", async () => {
  const [G] = await mods
  const { coop, store, advance, at } = setup()
  try {
    const { id } = await coop.create(me("pa"), { kind: "couple", from: "new" })
    const a = await coop.join(me("pa"), { id })
    const f = fields(G.migrate(JSON.parse(a.state)))
    assert.equal(coop.act(me("pa"), { id, seq: 1, it: { a: "plant", ids: f, crop: "wheat" } }).ok, true)
    assert.equal(coop.act(me("pa"), { id, seq: 2, it: { a: "build", type: "cottage", x: 7, y: 15 } }).ok, true)
    coop.leave("pa", id)
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(coop.rooms.size, 0, "nobody there: the town is put away")
    const saved = await store.get(`coop:${id}`)
    const sv = JSON.parse(saved.state)
    assert.equal(sv.objs.find((o) => o.i === f[0]).c, "wheat", "saved")
    assert.ok(sv.objs.some((o) => o.t === "cottage" && o.b), "the cottage was still being built")
    assert.ok(saved.feed.some((x) => /Alice built a Cottage/.test(x.text)))

    // an hour later Bobby opens it: crops are ripe, the cottage is done
    advance(60 * 60_000)
    const b = await coop.join(me("pb"), { id })
    const s = G.migrate(JSON.parse(b.state))
    assert.equal(ripe(G, s, at()).length, f.length)
    assert.ok(s.objs.some((o) => o.t === "cottage" && !o.b), "finished while nobody was there")
    assert.equal(s.xp > 0, true, "and paid its XP")
    assert.equal(b.rev, saved.rev)
    assert.ok(b.feed.length >= 3, "the feed is kept")
    assert.ok(b.stats.some((x) => x.name === "Alice" && x.total.planted === f.length), "contribution stats are kept")
    // the next day, "today" starts over but totals stay
    advance(24 * 60 * 60_000)
    assert.equal(coop.act(me("pb"), { id, seq: 1, it: { a: "harvest", ids: f } }).ok, true)
    const again = await coop.join(me("pb"), { id })
    const bobby = again.stats.find((x) => x.name === "Bobby")
    assert.equal(bobby.today.crops, f.length * 2)
    assert.equal(again.stats.find((x) => x.name === "Alice").today.planted, undefined)
  } finally {
    coop.close()
  }
})

test("invitations: through Network Neighborhood, up to four farmers; leaving; unpairing", async () => {
  const { coop, store, unpair, advance } = setup()
  const inbox = { pa: [], pb: [], pc: [], pd: [], pe: [], pf: [] }
  const games = createGames({ emit: (pid, event, payload) => inbox[pid]?.push({ event, payload }), coop })
  try {
    const { id } = await coop.create(me("pa"), { kind: "couple", from: "new" })
    // not in the town yet: nothing to invite into
    assert.equal(games.invite({ from: "pa", fromName: "Alice", to: "pd", toName: "Dave", game: "town" }).ok, false)
    await coop.join(me("pa"), { id })
    const inv = games.invite({ from: "pa", fromName: "Alice", to: "pd", toName: "Dave", game: "town" })
    assert.equal(inv.ok, true, inv.error)
    const invited = inbox.pd.find((m) => m.event === "net:invited").payload
    assert.equal(invited.gameName, "Sunny Acres Co-op")
    assert.equal(invited.options.town, "Our Co-op Town")
    assert.equal((await coop.join(me("pd"), { id })).ok, false, "not before accepting")
    const yes = games.replyInvite("pd", invited.id, true)
    assert.equal(yes.ok, true)
    assert.equal(yes.townCoop, id)
    assert.equal((await coop.join(me("pd"), { id })).ok, true, "Dave is a member now")
    assert.equal((await coop.join(me("pc"), { id })).ok, false, "Carol still isn't")

    // four farmers at most: Alice, Bobby, Dave, and one more
    const e = games.invite({ from: "pa", fromName: "Alice", to: "pe", toName: "Erin", game: "town" })
    assert.equal(e.ok, true)
    assert.equal(games.invite({ from: "pa", fromName: "Alice", to: "pf", toName: "Frank", game: "town" }).ok, false, "full, counting the pending invitation")
    // a guest can't accept
    const g = games.invite({ from: "pa", fromName: "Alice", to: "pg", toName: "GUEST-1234", game: "town" })
    assert.equal(g.ok, false)

    // Dave leaves for good
    assert.equal((await coop.quit(me("pd"), { id })).ok, true)
    assert.equal((await coop.join(me("pd"), { id })).ok, false)
    assert.equal((await coop.quit(me("pa"), { id })).ok, false, "a couple's town stays theirs")

    // unpaired: nobody gets into the couple's town any more, and it goes 30 days later
    coop.leave("pa", id)
    coop.leave("pd", id)
    await new Promise((r) => setTimeout(r, 20))
    unpair()
    assert.equal((await coop.join(me("pa"), { id })).ok, false)
    assert.equal((await coop.join(me("pb"), { id })).ok, false)
    await coop.sweep()
    assert.ok(await store.get(`coop:${id}`), "kept for now")
    advance(31 * 24 * 60 * 60_000)
    await coop.sweep()
    assert.equal(await store.get(`coop:${id}`), null, "gone 30 days after unpairing")
  } finally {
    coop.close()
  }
})

test("start fresh, or copy my own town into our co-op town (my town stays as it is)", async () => {
  const [G] = await mods
  const { coop, service, at } = setup()
  try {
    const mine = G.newGame(at(), 7)
    mine.coins = 4321
    mine.goods.corn = 9
    mine.claimed = ["abc"]
    const doc = await service.load("alice", "Alice")
    doc.snap = G.serialize(mine)
    await service.put(doc)
    assert.equal((await coop.list(me("pa"))).canConvert, true)
    assert.equal((await coop.list(me("pb"))).canConvert, false)
    const made = await coop.create(me("pa"), { kind: "couple", from: "convert" })
    assert.equal(made.ok, true, made.error)
    const s = G.migrate(JSON.parse((await coop.join(me("pb"), { id: made.id })).state))
    assert.equal(s.coins, 4321)
    assert.equal(s.goods.corn, 9)
    assert.equal(s.claimed, undefined)
    assert.equal(JSON.parse((await service.load("alice")).snap).coins, 4321, "Alice's own town is untouched")
    // starting over needs everyone else out first, and says so
    const busy = await coop.create(me("pa"), { kind: "couple", from: "new", replace: true })
    assert.equal(busy.ok, false)
    coop.leave("pb", made.id)
    await new Promise((r) => setTimeout(r, 20))
    const fresh = await coop.create(me("pa"), { kind: "couple", from: "new", replace: true })
    assert.equal(fresh.ok, true)
    const s2 = G.migrate(JSON.parse((await coop.join(me("pa"), { id: made.id })).state))
    assert.notEqual(s2.coins, 4321)
    // group towns: a few each
    for (let k = 0; k < 3; k++) assert.equal((await coop.create(me("pc"), { kind: "group", from: "new" })).ok, true)
    assert.equal((await coop.create(me("pc"), { kind: "group", from: "new" })).ok, false)
  } finally {
    coop.close()
  }
})
