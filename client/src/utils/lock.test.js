// Lock screen and user profiles: hashing (WebCrypto in Node), lock timers, wrong-try waits,
// and per-user storage keys. Run: node --test client/src/utils/lock.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { ITERATIONS, checkSecret, delayAfter, hashSecret, verifySecret } from "./lockCrypto.js"
import { afterWrongTry, createIdleLock, idleDue, shouldLockOnLoad, waitLeft } from "./lockTimers.js"

// ---- hashing ----

test("hashSecret: salted PBKDF2, never the secret, verifies right and wrong", async () => {
  const a = await hashSecret("pin", "4821", { iterations: 1000 })
  const b = await hashSecret("pin", "4821", { iterations: 1000 })
  assert.equal(a.algo, "PBKDF2-SHA256")
  assert.equal(a.kind, "pin")
  assert.notEqual(a.salt, b.salt, "a random salt each time")
  assert.notEqual(a.hash, b.hash, "so the same PIN hashes differently")
  assert.ok(!JSON.stringify(a).includes("4821"), "the PIN itself isn't in the record")
  assert.equal(Buffer.from(a.salt, "base64").length, 16)
  assert.equal(Buffer.from(a.hash, "base64").length, 32)
  assert.equal(await verifySecret("4821", a), true)
  assert.equal(await verifySecret("4822", a), false)
  assert.equal(await verifySecret("", a), false)
  assert.equal(await verifySecret("4821", { ...a, hash: b.hash }), false)
  assert.equal(await verifySecret("4821", null), false)
  assert.equal(await verifySecret("4821", { ...a, iterations: 0 }), false)
})

test("hashSecret: known vector (RFC 6070-style check of the PBKDF2 wiring)", async () => {
  // PBKDF2-HMAC-SHA256("password", "salt", 1 iteration, 32 bytes)
  const r = await hashSecret("password", "password", { iterations: 1, salt: new TextEncoder().encode("salt") })
  assert.equal(Buffer.from(r.hash, "base64").toString("hex"), "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b")
})

test("hashSecret: default strength, passwords with any characters", async () => {
  assert.ok(ITERATIONS >= 310_000)
  const r = await hashSecret("password", "café ünïcode 98!")
  assert.equal(r.iterations, ITERATIONS)
  assert.equal(await verifySecret("café ünïcode 98!", r), true)
  // the same text in another Unicode form still matches (NFC)
  assert.equal(await verifySecret("café ünïcode 98!", r), true)
})

test("checkSecret: PIN digits 4-12, passwords 4+", () => {
  assert.equal(checkSecret("pin", "1234"), null)
  assert.match(checkSecret("pin", "123"), /4 to 12/)
  assert.match(checkSecret("pin", "12a4"), /digits/)
  assert.match(checkSecret("pin", "1".repeat(13)), /4 to 12/)
  assert.equal(checkSecret("password", "abcd"), null)
  assert.match(checkSecret("password", "abc"), /at least 4/)
})

// ---- wrong tries ----

test("delayAfter: three free tries, then growing waits up to 15 minutes", () => {
  assert.deepEqual([0, 1, 2].map(delayAfter), [0, 0, 0])
  assert.deepEqual([3, 4, 5, 6].map(delayAfter), [5, 15, 45, 135])
  assert.equal(delayAfter(9), 900)
  assert.equal(delayAfter(50), 900)
  let fails = null
  const now = 1_000_000
  for (let i = 0; i < 3; i++) fails = afterWrongTry(fails, now, delayAfter)
  assert.equal(fails.count, 3)
  assert.equal(waitLeft(fails, now), 5)
  assert.equal(waitLeft(fails, now + 4001), 1)
  assert.equal(waitLeft(fails, now + 5000), 0)
  fails = afterWrongTry(fails, now + 5000, delayAfter)
  assert.equal(waitLeft(fails, now + 5000), 15)
  assert.equal(waitLeft(null, now), 0)
})

// ---- timers ----

test("shouldLockOnLoad: locked stays locked; away longer than the wait locks", () => {
  const now = 10 * 60_000
  const base = { hasSecret: true, locked: false, lastActive: now - 4 * 60_000, now, lockAfter: 5 }
  assert.equal(shouldLockOnLoad(base), false)
  assert.equal(shouldLockOnLoad({ ...base, lastActive: now - 5 * 60_000 }), true)
  assert.equal(shouldLockOnLoad({ ...base, locked: true }), true)
  assert.equal(shouldLockOnLoad({ ...base, locked: true, hasSecret: false }), false, "nothing to unlock with: never")
  assert.equal(shouldLockOnLoad({ ...base, lastActive: 1, lockAfter: 0 }), false, "Never")
  assert.equal(shouldLockOnLoad({ ...base, lastActive: 0 }), false, "first visit")
})

test("createIdleLock: fires once per idle spell with a fake clock; input starts over", () => {
  let t = 0
  let fired = 0
  const idle = createIdleLock({ minutes: 2, now: () => t, onIdle: () => fired++ })
  t = 119_000
  assert.equal(idle.tick(), false)
  idle.poke()
  t = 119_000 + 119_000
  idle.tick()
  assert.equal(fired, 0, "input reset the count")
  t = 119_000 + 120_000
  assert.equal(idle.tick(), true)
  t += 600_000
  idle.tick()
  assert.equal(fired, 1, "once per spell")
  idle.poke()
  t += 120_000
  idle.tick()
  assert.equal(fired, 2)
  assert.equal(idleDue({ last: 0, now: 1e9, minutes: 0 }), false, "0 = never")
})

// ---- per-user storage keys ----

class FakeStorage {
  #m = new Map()
  get length() {
    return this.#m.size
  }
  key(i) {
    return [...this.#m.keys()][i] ?? null
  }
  getItem(k) {
    return this.#m.has(String(k)) ? this.#m.get(String(k)) : null
  }
  setItem(k, v) {
    this.#m.set(String(k), String(v))
  }
  removeItem(k) {
    this.#m.delete(String(k))
  }
}

test("users: userKey namespacing, the default user keeps today's keys", async () => {
  const { userKey, keyPrefix, keysOf, DEFAULT_ID } = await import("./users.js")
  assert.equal(userKey("98ish.fs.v1", DEFAULT_ID), "98ish.fs.v1")
  assert.equal(userKey("98ish.fs.v1", "ab12cd"), "98ish.u.ab12cd.fs.v1")
  assert.equal(userKey("98ish.settings", "ab12cd"), "98ish.u.ab12cd.settings")
  assert.equal(userKey("98ish.u.ab12cd.fs.v1", "zz99zz"), "98ish.u.ab12cd.fs.v1", "already per-user: unchanged")
  assert.equal(userKey("98ish.users", "ab12cd"), "98ish.users", "device keys stay shared")
  assert.equal(userKey("98ish.currentUser", "ab12cd"), "98ish.currentUser")
  assert.equal(userKey("98ish.lock", "ab12cd"), "98ish.lock")
  assert.equal(userKey("other.app", "ab12cd"), "other.app", "not ours")
  assert.equal(keyPrefix(DEFAULT_ID), "98ish.")
  assert.equal(keyPrefix("ab12cd"), "98ish.u.ab12cd.")
  const all = ["98ish.fs.v1", "98ish.settings", "98ish.users", "98ish.lock", "98ish.u.ab12cd.fs.v1", "98ish.u.ab12cd.settings", "98ish.u.zz99zz.fs.v1", "x"]
  assert.deepEqual(keysOf(DEFAULT_ID, all), ["98ish.fs.v1", "98ish.settings"])
  assert.deepEqual(keysOf("ab12cd", all), ["98ish.u.ab12cd.fs.v1", "98ish.u.ab12cd.settings"])
})

test("users: installed storage keeps each person's data apart; existing data stays the first user's", async () => {
  // a device with data from before profiles existed
  const ls = new FakeStorage()
  ls.setItem("98ish.fs.v1", '{"root":"old drive"}')
  ls.setItem("98ish.settings", '{"scheme":"rainy"}')
  ls.setItem("98ish.user", "Brandon")
  globalThis.Storage = FakeStorage
  Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true, writable: true })
  try {
    const users = await import(`./users.js?device=${Date.now()}`)
    assert.equal(users.currentUserId(), "default")
    assert.equal(users.currentUserName(), "Brandon", "the old Log On name becomes the first user's")
    assert.equal(users.hasProfiles(), false)
    const ana = users.createUser({ name: "Ana", screenName: "AnaBanana" })
    assert.match(ana.id, /^[a-z0-9]{6}$/)
    assert.throws(() => users.createUser({ name: "ana" }), /already/)
    assert.equal(users.hasProfiles(), true)
    assert.ok(JSON.parse(ls.getItem("98ish.users")).users.some((u) => u.name === "Ana"))

    // logging on as Ana (what switchUser does before its reload)
    let reloaded = 0
    assert.equal(users.switchUser(ana.id, { reload: () => reloaded++ }), true)
    assert.equal(reloaded, 1)
    assert.equal(ls.getItem("98ish.currentUser"), ana.id)

    // a "new page load" as Ana: fresh modules, then the storage seam installed
    const fresh = await import(`./users.js?ana=${Date.now()}`)
    assert.equal(fresh.currentUserId(), ana.id)
    const key = fresh.userKey("98ish.fs.v1")
    assert.equal(key, `98ish.u.${ana.id}.fs.v1`)
    // patch the fake Storage the way userStorage.js patches the browser's
    const proto = FakeStorage.prototype
    const get = proto.getItem
    const set = proto.setItem
    proto.getItem = function (k) {
      return get.call(this, fresh.userKey(String(k)))
    }
    proto.setItem = function (k, v) {
      return set.call(this, fresh.userKey(String(k)), v)
    }
    try {
      assert.equal(ls.getItem("98ish.fs.v1"), null, "Ana starts with an empty drive (the app fills in the starting files)")
      ls.setItem("98ish.fs.v1", '{"root":"ana drive"}')
      ls.setItem("98ish.settings", '{"scheme":"lilac"}')
      assert.equal(ls.getItem("98ish.settings"), '{"scheme":"lilac"}')
      assert.equal(ls.getItem("98ish.users") !== null, true, "the user list is shared")
    } finally {
      proto.getItem = get
      proto.setItem = set
    }
    // the first user's data is exactly as it was
    assert.equal(ls.getItem("98ish.fs.v1"), '{"root":"old drive"}')
    assert.equal(ls.getItem("98ish.settings"), '{"scheme":"rainy"}')
    assert.equal(ls.getItem(`98ish.u.${ana.id}.fs.v1`), '{"root":"ana drive"}')

    // removing Ana (as the first user) removes only her keys, and tells other stores
    ls.setItem("98ish.currentUser", "default")
    const back = await import(`./users.js?back=${Date.now()}`)
    assert.equal(back.currentUserId(), "default")
    const cleaned = []
    back.onUserRemoved((id, prefix) => cleaned.push([id, prefix]))
    assert.throws(() => back.removeUser("default"), /can't be removed/)
    back.removeUser(ana.id)
    assert.deepEqual(cleaned, [[ana.id, `98ish.u.${ana.id}.`]])
    assert.equal(ls.getItem(`98ish.u.${ana.id}.fs.v1`), null)
    assert.equal(ls.getItem("98ish.fs.v1"), '{"root":"old drive"}')
    assert.equal(back.listUsers().length, 1)
  } finally {
    delete globalThis.localStorage
    delete globalThis.Storage
  }
})
