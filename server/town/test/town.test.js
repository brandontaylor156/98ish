// Sunny Acres together: cloud saves, who may visit, notes and hearts, help requests (checked
// against the helper's saved Barn, filled once), gifts and their daily limit, the couple's goal.
const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const path = require("node:path")
const { pathToFileURL } = require("node:url")
const express = require("express")
const town = require("..")

const TOWN = path.join(__dirname, "../../../client/src/components/applets/town")
const rules = Promise.all([import(pathToFileURL(path.join(TOWN, "game.js")).href), import(pathToFileURL(path.join(TOWN, "data.js")).href)])

const T0 = Date.UTC(2026, 9, 5, 12) // a Monday
const tokens = { alice: "a", bobby: "b", carol: "c", dave: "d" }
const TOKEN = Object.fromEntries(Object.entries(tokens).map(([k, c]) => [k, c.repeat(48)]))

const fakeAim = () => {
  const users = {
    alice: { key: "alice", screenName: "Alice", blocked: [], groups: [{ name: "Buddies", buddies: ["Bobby", "Dave"] }] },
    bobby: { key: "bobby", screenName: "Bobby", blocked: [], groups: [{ name: "Buddies", buddies: ["Alice"] }] },
    carol: { key: "carol", screenName: "Carol", blocked: [], groups: [{ name: "Buddies", buddies: ["Alice"] }] },
    dave: { key: "dave", screenName: "Dave", blocked: [], groups: [{ name: "Buddies", buddies: ["Alice"] }] },
  }
  const socket = () => ({ events: [], connected: true, emit(event, payload) { this.events.push({ event, payload }) } })
  const sessions = new Map(Object.keys(users).map((key) => [key, { key, user: users[key], socket: socket() }]))
  const byToken = Object.fromEntries(Object.entries(TOKEN).map(([k, t]) => [t, k]))
  return { users, sessions, authenticate: (t) => sessions.get(byToken[t]) || null, store: { find: async (key) => users[key] || null } }
}

// Alice and Bobby are a couple; Dave is on Alice's buddy list; Carol is a stranger to Alice
const couples = {
  partnerOf: (key) => ({ alice: "Bobby", bobby: "Alice" })[String(key).toLowerCase()] || null,
  coupleIdOf: (key) => (["alice", "bobby"].includes(String(key).toLowerCase()) ? "c0ffee" : null),
}

const serve = () => {
  const aim = fakeAim()
  let t = T0
  const service = town.createTown({ store: town.memoryStore(), aim, couples, now: () => t })
  const app = express()
  app.use("/api/town", town.townRouter({ service, limits: { savesPerMinute: 1000, writesPerMinute: 1000, notesPerHour: 1000 } }))
  const server = http.createServer(app).listen(0)
  const base = `http://127.0.0.1:${server.address().port}/api/town`
  const call = (who, method, p, body) =>
    fetch(base + p, {
      method,
      headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${TOKEN[who] || who}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, ...(await r.json()) }))
  return { aim, server, call, service, advance: (ms) => (t += ms), at: () => t }
}

// a town with the tutorial done and some goods in the Barn
const makeTown = async (seed, goods = {}) => {
  const [G] = await rules
  const s = G.newGame(T0, seed)
  Object.assign(s.goods, goods)
  return JSON.parse(G.serialize(s))
}

// save a town; returns the response
const save = async (call, who, snap, base = 0, force = false) => call(who, "PUT", "/me", { snap, base, force })

test("every route needs a signed-on session", async () => {
  const { server, call } = serve()
  try {
    const routes = [
      ["GET", "/me"], ["PUT", "/me"], ["PUT", "/settings"], ["GET", "/friends"], ["GET", "/visit/Bobby"], ["POST", "/visit/Bobby/heart"],
      ["POST", "/visit/Bobby/notes"], ["DELETE", "/visit/Bobby/notes/x"], ["DELETE", "/notes/x"], ["POST", "/requests"], ["DELETE", "/requests/x"],
      ["POST", "/visit/Bobby/help/x"], ["POST", "/gifts"], ["POST", "/mailbox/x/open"],
    ]
    for (const [method, p] of routes) {
      const body = method === "GET" || method === "DELETE" ? undefined : {}
      assert.equal((await call(null, method, p, body)).status, 401, `${method} ${p} signed off`)
      assert.equal((await call("f".repeat(48), method, p, body)).status, 401, `${method} ${p} bad token`)
    }
  } finally {
    server.close()
  }
})

test("cloud saves: round trip, conflicts, size and shape checks", async () => {
  const { server, call, advance } = serve()
  try {
    const empty = await call("alice", "GET", "/me")
    assert.equal(empty.status, 200)
    assert.equal(empty.town, null)
    const snap = await makeTown(1, { wheat: 7 })
    const first = await save(call, "alice", snap)
    assert.equal(first.status, 200, first.error)
    assert.ok(first.savedAt > 0)
    const back = await call("alice", "GET", "/me")
    assert.deepEqual(back.town.snap, snap)
    assert.equal(back.town.savedAt, first.savedAt)

    // another device saves on top of an old copy: 409 with the cloud's copy, unless forced
    advance(1000)
    const second = await save(call, "alice", { ...snap, coins: 999 }, first.savedAt)
    assert.equal(second.status, 200)
    const stale = await save(call, "alice", { ...snap, coins: 5 }, first.savedAt)
    assert.equal(stale.status, 409)
    assert.equal(stale.conflict, true)
    assert.equal(stale.snap.coins, 999)
    assert.equal(stale.savedAt, second.savedAt)
    const forced = await save(call, "alice", { ...snap, coins: 5 }, first.savedAt, true)
    assert.equal(forced.status, 200)
    assert.ok(forced.savedAt > second.savedAt)

    // what isn't a town is refused
    const base = forced.savedAt
    const bad = async (patch) => (await save(call, "alice", { ...snap, ...patch }, base)).status
    assert.equal(await bad({ objs: "nope" }), 400)
    assert.equal(await bad({ level: -3 }), 400)
    assert.equal(await bad({ goods: { gold: 5 } }), 400)
    assert.equal(await bad({ goods: { wheat: 1.5 } }), 400)
    assert.equal(await bad({ objs: [{ i: 1, t: "<b>", x: 1, y: 1 }] }), 400)
    assert.equal(await bad({ objs: [{ i: 1, t: "barn", x: 900, y: 1 }] }), 400)
    assert.equal(await bad({ paired: { name: "x" } }), 400)
    assert.equal((await call("alice", "PUT", "/me", { snap: "a string", base })).status, 400)
    // 200 KB at most
    const huge = await bad({ junk: "x".repeat(210 * 1024) })
    assert.ok(huge === 400 || huge === 413, `huge town: ${huge}`)
    assert.equal((await call("alice", "GET", "/me")).town.snap.coins, 5, "nothing bad was stored")
  } finally {
    server.close()
  }
})

test("privacy: partner always, buddies only when allowed, strangers never", async () => {
  const { server, call, aim } = serve()
  try {
    await save(call, "alice", await makeTown(2))
    // Bobby (partner) can visit; Alice's buddy Dave can't until she allows it; Carol never
    const bob = await call("bobby", "GET", "/visit/Alice")
    assert.equal(bob.status, 200, bob.error)
    assert.equal(bob.owner, "Alice")
    assert.equal(bob.relation, "partner")
    assert.ok(Array.isArray(bob.snap.objs))
    assert.ok(aim.sessions.get("alice").socket.events.some((e) => e.event === "town:visitor" && e.payload.name === "Bobby" && e.payload.arrived))
    assert.equal((await call("dave", "GET", "/visit/Alice")).status, 403)
    assert.equal((await call("carol", "GET", "/visit/Alice")).status, 403)
    assert.equal((await call("alice", "PUT", "/settings", { allowBuddies: true })).allowBuddies, true)
    assert.equal((await call("dave", "GET", "/visit/Alice")).status, 200)
    assert.equal((await call("dave", "GET", "/visit/Alice")).relation, "buddy")
    // Carol has Alice as a buddy, but Alice doesn't have Carol: still private
    assert.equal((await call("carol", "GET", "/visit/Alice")).status, 403)
    // blocking wins over the buddy list
    aim.users.alice.blocked = ["dave"]
    assert.equal((await call("dave", "GET", "/visit/Alice")).status, 403)
    aim.users.alice.blocked = []
    // strangers can't heart, leave notes or help either
    assert.equal((await call("carol", "POST", "/visit/Alice/heart", { obj: 1 })).status, 403)
    assert.equal((await call("carol", "POST", "/visit/Alice/notes", { text: "hi", x: 5, y: 5 })).status, 403)
    assert.equal((await call("carol", "POST", "/visit/Alice/help/abc", {})).status, 403)
    // a partner with no town yet, someone who doesn't exist, and yourself
    assert.equal((await call("alice", "GET", "/visit/Bobby")).status, 404)
    assert.equal((await call("alice", "GET", "/visit/Nobody99")).status, 404)
    assert.equal((await call("alice", "GET", "/visit/Alice")).status, 400)
    // the friends list says who's visitable
    await save(call, "bobby", await makeTown(3))
    const friends = await call("alice", "GET", "/friends")
    assert.deepEqual(friends.friends.map((f) => [f.name, f.relation, f.canVisit]), [["Bobby", "partner", true], ["Dave", "buddy", false]])
  } finally {
    server.close()
  }
})

test("hearts and notes: toggled, checked, shown to the owner, removable", async () => {
  const { server, call } = serve()
  try {
    const snap = await makeTown(4)
    await save(call, "alice", snap)
    const barn = snap.objs.find((o) => o.t === "barn")
    const liked = await call("bobby", "POST", "/visit/Alice/heart", { obj: barn.i })
    assert.deepEqual([liked.count, liked.mine], [1, true])
    assert.equal((await call("bobby", "POST", "/visit/Alice/heart", { obj: 9999 })).status, 404)
    assert.equal((await call("alice", "GET", "/me")).hearts[barn.i], 1)
    assert.equal((await call("bobby", "POST", "/visit/Alice/heart", { obj: barn.i })).count, 0, "a second tap takes it back")

    const note = await call("bobby", "POST", "/visit/Alice/notes", { text: "Love your bakery!  <3", x: 8.5, y: 9.25 })
    assert.equal(note.status, 200, note.error)
    assert.equal(note.note.text, "Love your bakery! <3")
    assert.equal((await call("bobby", "POST", "/visit/Alice/notes", { text: "x".repeat(81), x: 1, y: 1 })).status, 400)
    assert.equal((await call("bobby", "POST", "/visit/Alice/notes", { text: "see http://evil.example", x: 1, y: 1 })).status, 400)
    assert.equal((await call("bobby", "POST", "/visit/Alice/notes", { text: "   ", x: 1, y: 1 })).status, 400)
    assert.equal((await call("bobby", "POST", "/visit/Alice/notes", { text: "hi", x: 99, y: 1 })).status, 400)
    const mine = await call("alice", "GET", "/me")
    assert.equal(mine.notes.length, 1)
    assert.equal(mine.notes[0].by, "Bobby")
    // three signs per visitor: a fourth replaces the oldest
    for (const text of ["two", "three", "four"]) await call("bobby", "POST", "/visit/Alice/notes", { text, x: 5, y: 5 })
    const notes = (await call("alice", "GET", "/me")).notes
    assert.deepEqual(notes.map((n) => n.text), ["two", "three", "four"])
    assert.equal((await call("alice", "DELETE", `/notes/${notes[0].id}`)).status, 200)
    assert.equal((await call("bobby", "DELETE", `/visit/Alice/notes/${notes[1].id}`)).status, 200)
    assert.equal((await call("alice", "GET", "/me")).notes.length, 1)
  } finally {
    server.close()
  }
})

test("help requests: validated against both towns, filled once, rewards on both sides", async () => {
  const { server, call, service, aim } = serve()
  try {
    const [G] = await rules
    // Alice's first order needs cow feed and wheat; Bobby has some, Dave (a buddy) has some
    const alice = await makeTown(5)
    const need = alice.orders[0].need
    await save(call, "alice", alice)
    await call("alice", "PUT", "/settings", { allowBuddies: true })
    assert.equal((await call("alice", "POST", "/requests", { kind: "order", slot: 7 })).status, 409, "no order there")
    assert.equal((await call("alice", "POST", "/requests", { kind: "car", slot: 0 })).status, 409, "no train yet")
    assert.equal((await call("alice", "POST", "/requests", { kind: "pony", slot: 0 })).status, 400)
    const asked = await call("alice", "POST", "/requests", { kind: "order", slot: 0 })
    assert.equal(asked.status, 200, asked.error)
    assert.deepEqual(asked.request.need, need)
    assert.equal((await call("alice", "POST", "/requests", { kind: "order", slot: 0 })).request.id, asked.request.id, "asking twice is one request")
    const id = asked.request.id

    // Bobby's saved Barn is empty: refused
    const bobby = await makeTown(6, { cowfeed: 0 })
    bobby.goods = {}
    const saved = await save(call, "bobby", bobby)
    const visit = await call("bobby", "GET", "/visit/Alice")
    assert.deepEqual(visit.requests.map((r) => r.id), [id])
    const short = await call("bobby", "POST", `/visit/Alice/help/${id}`)
    assert.equal(short.status, 409)
    assert.match(short.error, /more/)
    // with the goods saved, it works, once
    bobby.goods = { ...need, corn: 1 }
    const saved2 = await save(call, "bobby", bobby, saved.savedAt)
    const helped = await call("bobby", "POST", `/visit/Alice/help/${id}`)
    assert.equal(helped.status, 200, helped.error)
    assert.deepEqual(helped.effect.goods, need)
    assert.deepEqual({ coins: helped.effect.coins, xp: helped.effect.xp }, G.helpReward(need))
    assert.equal(helped.request.status, "filled")
    assert.equal(helped.request.by, "Bobby")
    assert.ok(aim.sessions.get("alice").socket.events.some((e) => e.event === "town:news" && e.payload.type === "helped"))
    const again = await call("bobby", "POST", `/visit/Alice/help/${id}`)
    assert.equal(again.status, 409)
    assert.match(again.error, /already helped/)

    // Bobby's goods are promised away until his town says it has the change
    const ask2 = alice.orders[1]
    const req2 = await call("alice", "POST", "/requests", { kind: "order", slot: 1 })
    bobby.goods = { ...need }
    for (const [g, n] of Object.entries(ask2.need)) bobby.goods[g] = Math.max(bobby.goods[g] || 0, n)
    // (his saved Barn still has the old goods; what he gave is subtracted)
    const pendingBefore = service.available(await service.load("bobby"))
    for (const [g, n] of Object.entries(need)) assert.equal(pendingBefore.goods[g], (({ ...need, corn: 1 })[g] || 0) - n)

    // each side applies its effect once, and saving with it claimed clears it
    const bobState = G.migrate(bobby)
    bobState.goods = { ...need, corn: 1 }
    const coins = bobState.coins
    assert.ok(G.applyEffect(bobState, helped.effect, T0).ok)
    assert.equal(G.applyEffect(bobState, helped.effect, T0).ok, false, "only once")
    assert.equal(bobState.coins, coins + helped.effect.coins)
    assert.deepEqual(bobState.goods, { corn: 1 })
    const aliceMe = await call("alice", "GET", "/me")
    assert.equal(aliceMe.effects.length, 1)
    const aliceState = G.migrate(alice)
    const aliceCoins = aliceState.coins
    const orderCoins = alice.orders[0].coins
    const applied = G.applyEffect(aliceState, aliceMe.effects[0], T0)
    assert.equal(applied.filled, true)
    assert.ok(aliceState.coins >= aliceCoins + orderCoins, "paid for the order (and maybe a level up)")
    assert.equal(aliceState.orders[0].need, undefined, "the order flew off")
    const resaved = await save(call, "alice", JSON.parse(G.serialize(aliceState)), aliceMe.town.savedAt)
    assert.equal(resaved.status, 200, resaved.error)
    assert.equal(resaved.effects.length, 0)
    const bobSaved = await save(call, "bobby", JSON.parse(G.serialize(bobState)), saved2.savedAt)
    assert.equal(bobSaved.effects.length, 0)
    assert.deepEqual(service.available(await service.load("bobby")).goods, { corn: 1 })

    // requests whose order changed are refused (and closed)
    const filled = (await call("alice", "GET", "/me")).requests.find((r) => r.id === req2.request.id)
    assert.equal(filled.status, "open")
    const changed = JSON.parse(G.serialize(aliceState))
    changed.orders[1] = { wait: T0 + 1000 }
    await save(call, "alice", changed, resaved.savedAt)
    const gone = await call("bobby", "POST", `/visit/Alice/help/${req2.request.id}`)
    assert.equal(gone.status, 409)
    assert.match(gone.error, /isn't there/)

    // at most three open requests; strangers can't fill them
    const many = JSON.parse(G.serialize(aliceState))
    many.orders = [0, 1, 2, 3].map(() => ({ need: { wheat: 1 }, coins: 5, xp: 1 }))
    const ms = await save(call, "alice", many, (await call("alice", "GET", "/me")).town.savedAt)
    for (const slot of [0, 1, 2]) assert.equal((await call("alice", "POST", "/requests", { kind: "order", slot })).status, 200)
    assert.equal((await call("alice", "POST", "/requests", { kind: "order", slot: 3 })).status, 409)
    const open = (await call("alice", "GET", "/me")).requests.filter((r) => r.status === "open")
    assert.equal(open.length, 3)
    assert.equal((await call("carol", "POST", `/visit/Alice/help/${open[0].id}`)).status, 403)
    // a cancelled request can't be filled
    assert.equal((await call("alice", "DELETE", `/requests/${open[0].id}`)).status, 200)
    assert.equal((await call("bobby", "POST", `/visit/Alice/help/${open[0].id}`)).status, 409)
    assert.ok(ms.savedAt)
  } finally {
    server.close()
  }
})

test("help is atomic: two helpers at once, only one fills it", async () => {
  const { server, call } = serve()
  try {
    const alice = await makeTown(7)
    await save(call, "alice", alice)
    await call("alice", "PUT", "/settings", { allowBuddies: true })
    const id = (await call("alice", "POST", "/requests", { kind: "order", slot: 0 })).request.id
    const rich = await makeTown(8, { wheat: 20, cowfeed: 20 })
    await save(call, "bobby", rich)
    await save(call, "dave", rich)
    const results = await Promise.all([call("bobby", "POST", `/visit/Alice/help/${id}`), call("dave", "POST", `/visit/Alice/help/${id}`)])
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409])
    assert.equal((await call("alice", "GET", "/me")).effects.length, 1)
  } finally {
    server.close()
  }
})

test("gifts: partner only, from what you have, three a day, opened once", async () => {
  const { server, call, advance, aim } = serve()
  try {
    const [G] = await rules
    await save(call, "alice", await makeTown(9, { wheat: 12, milk: 3 }))
    assert.equal((await call("carol", "POST", "/gifts", { goods: { wheat: 1 } })).status, 403, "not paired")
    assert.equal((await call("alice", "POST", "/gifts", { goods: { wheat: 11 } })).status, 400, "ten at most")
    assert.equal((await call("alice", "POST", "/gifts", { goods: { gold: 1 } })).status, 400)
    assert.equal((await call("alice", "POST", "/gifts", { goods: { wheat: 0 } })).status, 400)
    assert.equal((await call("alice", "POST", "/gifts", { decor: "lovecottage" })).status, 400)
    assert.equal((await call("alice", "POST", "/gifts", { decor: "statue" })).status, 409, "level 9")
    assert.equal((await call("alice", "POST", "/gifts", { goods: { milk: 4 } })).status, 409, "only 3 milk")
    const first = await call("alice", "POST", "/gifts", { goods: { wheat: 5, milk: 2 }, note: "For your bakery ♥" })
    assert.equal(first.status, 200, first.error)
    assert.equal(first.giftsLeft, 2)
    assert.ok(aim.sessions.get("bobby").socket.events.some((e) => e.event === "town:news" && e.payload.type === "gift"))
    // promised goods are gone from what she can give
    assert.equal((await call("alice", "POST", "/gifts", { goods: { milk: 2 } })).status, 409)
    assert.equal((await call("alice", "POST", "/gifts", { decor: "hearttree", note: "<3" })).status, 200)
    assert.equal((await call("alice", "POST", "/gifts", { goods: { wheat: 1 } })).status, 200)
    const limit = await call("alice", "POST", "/gifts", { goods: { wheat: 1 } })
    assert.equal(limit.status, 429)
    assert.equal((await call("alice", "GET", "/me")).giftsLeft, 0)
    advance(24 * 3600_000)
    assert.equal((await call("alice", "GET", "/me")).giftsLeft, 3, "a new day")

    // Bobby's mailbox: three gifts; opening gives an effect once
    const box = (await call("bobby", "GET", "/me")).mailbox
    assert.equal(box.length, 3)
    assert.equal(box[0].from, "Alice")
    assert.equal(box[0].note, "For your bakery ♥")
    assert.equal((await call("alice", "POST", `/mailbox/${box[0].id}/open`)).status, 404, "not hers to open")
    const opened = await call("bobby", "POST", `/mailbox/${box[0].id}/open`)
    assert.equal(opened.status, 200)
    assert.deepEqual(opened.effect.goods, { wheat: 5, milk: 2 })
    const reopened = await call("bobby", "POST", `/mailbox/${box[0].id}/open`)
    assert.equal(reopened.effect.id, opened.effect.id, "the same gift, not a second one")
    const s = G.newGame(T0, 3)
    assert.ok(G.applyEffect(s, opened.effect, T0).ok)
    assert.equal(s.goods.milk, 2)
    const deco = await call("bobby", "POST", `/mailbox/${box[1].id}/open`)
    G.applyEffect(s, deco.effect, T0)
    assert.equal(s.inv.hearttree, 1)
    assert.equal(G.offer(s, "hearttree").why, null, "a gifted topiary is free to place")
    assert.equal(G.offer(G.newGame(T0, 3), "hearttree").why !== null, true, "not for sale otherwise")
    // her own side: what she gave leaves her Barn and coins
    const a = G.migrate(await makeTown(9, { wheat: 12, milk: 3 }))
    const coins = a.coins
    G.applyEffect(a, first.effect, T0)
    assert.equal(a.goods.wheat, 7)
    assert.equal(a.goods.milk, 1)
    assert.equal(a.coins, coins)
  } finally {
    server.close()
  }
})

test("the couple's goal: harvests from both towns add up, the reward comes once to both", async () => {
  const { server, call, advance } = serve()
  try {
    const [G] = await rules
    const a = await makeTown(10)
    const b = await makeTown(11)
    let sa = (await save(call, "alice", a)).savedAt
    let sb = (await save(call, "bobby", b)).savedAt
    const goal0 = (await call("alice", "GET", "/me")).goal
    assert.deepEqual([goal0.total, goal0.target, goal0.done], [0, G.GOAL_TARGET, false])
    a.stats.harvests += 300
    sa = (await save(call, "alice", a, sa)).savedAt
    b.stats.harvests += 150
    const mid = await save(call, "bobby", b, sb)
    sb = mid.savedAt
    assert.deepEqual([mid.goal.mine, mid.goal.theirs, mid.goal.total], [150, 300, 450])
    b.stats.harvests += 60
    const done = await save(call, "bobby", b, sb)
    sb = done.savedAt
    assert.equal(done.goal.done, true)
    assert.equal(done.effects.filter((e) => e.kind === "goal").length, 1)
    const aliceEffects = (await call("alice", "GET", "/me")).effects
    assert.equal(aliceEffects.filter((e) => e.kind === "goal").length, 1)
    b.stats.harvests += 100
    const more = await save(call, "bobby", b, sb)
    assert.equal(more.effects.filter((e) => e.kind === "goal").length, 1, "rewarded once a week")
    const s = G.newGame(T0, 1)
    const coins = s.coins
    G.applyEffect(s, aliceEffects[0], T0)
    assert.ok(s.coins >= coins + G.GOAL_REWARD.coins)
    assert.ok(s.xp >= G.GOAL_REWARD.xp)
    assert.ok(s.clovers >= 8 + G.GOAL_REWARD.clovers)
    // a new week starts over; someone not paired has no goal
    advance(7 * 24 * 3600_000)
    assert.equal((await call("alice", "GET", "/me")).goal.total, 0)
    await save(call, "dave", await makeTown(12))
    assert.equal((await call("dave", "GET", "/me")).goal, null)
  } finally {
    server.close()
  }
})

test("a town over the size limit is refused before it's stored", async () => {
  const { server, call } = serve()
  try {
    const snap = await makeTown(13)
    snap.objs = Array.from({ length: 1501 }, (_, i) => ({ i, t: "tree", x: 5, y: 5 }))
    assert.equal((await save(call, "alice", snap)).status, 400)
    assert.equal((await call("alice", "GET", "/me")).town, null)
  } finally {
    server.close()
  }
})
