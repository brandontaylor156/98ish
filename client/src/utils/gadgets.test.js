// Desktop gadgets: the saved state, placement, persistence per 98ish user, and what the
// gadgets show. Run: node --test client/src/utils/gadgets.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { GADGETS, addGadget, cleanGadgets, handAngles, layout, meterPoints, moveGadget, nextAlarm, removeGadget, setConfig } from "./gadgetsCore.js"
import { GADGETS_KEY, createGadgetStore } from "./gadgets.js"
import { createFakeStorage } from "./fakeIndexedDb.js"
import { userKey, keysOf } from "./users.js"

test("five gadgets; none are out to start with (phones stay clear)", () => {
  assert.deepEqual(
    GADGETS.map((g) => g.kind),
    ["clock", "weather", "calendar", "notes", "meter"]
  )
  assert.deepEqual(cleanGadgets(null), { list: [] })
})

test("add, remove, configure; each kind once; junk dropped", () => {
  let s = cleanGadgets(null)
  s = addGadget(s, "clock")
  s = addGadget(s, "clock")
  s = addGadget(s, "nope")
  s = addGadget(s, "notes")
  assert.deepEqual(
    s.list.map((g) => g.kind),
    ["clock", "notes"]
  )
  s = setConfig(s, "notes", { noteId: "abc" })
  assert.equal(s.list[1].config.noteId, "abc")
  s = removeGadget(s, "clock")
  assert.deepEqual(
    s.list.map((g) => g.kind),
    ["notes"]
  )
  const cleaned = cleanGadgets({ list: [{ kind: "meter", x: "1", y: 5 }, { kind: "meter" }, null, { kind: "evil", x: 1 }], extra: 1 })
  assert.deepEqual(cleaned, { list: [{ kind: "meter", x: null, y: 5, config: {} }] })
})

test("auto spots stack down the right edge, then a new column; placed ones stay inside", () => {
  let s = cleanGadgets(null)
  for (const g of GADGETS) s = addGadget(s, g.kind)
  const desk = { w: 1280, h: 560 }
  const spots = layout(s, desk)
  assert.equal(spots[0].x, 1280 - 12 - 156)
  assert.equal(spots[0].y, 12)
  assert.equal(spots[1].y, 12 + 196 + 10)
  // nothing overlaps, everything inside
  for (const a of spots) {
    assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= desk.w && a.y + a.h <= desk.h, a.kind)
    for (const b of spots) if (a !== b) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.kind}/${b.kind}`)
  }
  assert.ok(spots.some((p) => p.x < spots[0].x), "a second column")
  // dragged far out: pulled back inside
  s = moveGadget(s, "clock", { x: 5000, y: -40 }, desk)
  assert.deepEqual([s.list[0].x, s.list[0].y], [1280 - 156, 0])
  const small = layout(s, { w: 800, h: 600 })
  assert.equal(small[0].x, 800 - 156)
})

test("saved per 98ish user through the storage seam", () => {
  // the app's localStorage maps every 98ish key through userKey (utils/userStorage.js);
  // this storage does the same for whoever is "logged on"
  const raw = createFakeStorage()
  let who = "default"
  const seam = () => ({
    getItem: (k) => raw.getItem(userKey(k, who)),
    setItem: (k, v) => raw.setItem(userKey(k, who), v),
  })
  const first = createGadgetStore(seam)
  first.add("clock")
  first.move("clock", { x: 40, y: 50 })
  who = "bob"
  const bob = createGadgetStore(seam)
  assert.deepEqual(bob.get().list, [], "bob's desktop has no gadgets")
  bob.add("meter")
  who = "default"
  const again = createGadgetStore(seam)
  assert.deepEqual(again.get().list, [{ kind: "clock", x: 40, y: 50, config: {} }], "a reload brings the first user's back")
  assert.ok(raw.getItem(GADGETS_KEY))
  assert.ok(raw.getItem("98ish.u.bob.gadgets"))
  // removing bob removes his keys (users.js keysOf)
  assert.deepEqual(keysOf("bob", [GADGETS_KEY, "98ish.u.bob.gadgets"]), ["98ish.u.bob.gadgets"])
})

test("a store with broken or no storage still works for the visit", () => {
  const broken = createGadgetStore(() => ({
    getItem: () => "{nope",
    setItem: () => {
      throw new Error("full")
    },
  }))
  broken.add("weather")
  assert.equal(broken.get().list.length, 1)
  const none = createGadgetStore(() => null)
  none.add("notes")
  assert.equal(none.get().list[0].kind, "notes")
})

test("clock hands, next alarm, meter line", () => {
  assert.deepEqual(handAngles(3, 0, 0), { hour: 90, minute: 0, second: 0 })
  assert.deepEqual(handAngles(15, 30, 30), { hour: 105, minute: 183, second: 180 })
  const now = new Date(2026, 9, 8, 22, 0) // a Thursday, 10 PM
  const alarms = [
    { time: "07:00", days: [], on: true },
    { time: "06:00", days: [1], on: true }, // Mondays
    { time: "06:30", days: [], on: false },
    { time: "23:15", days: [5], on: true }, // Fridays
  ]
  const next = nextAlarm(alarms, now)
  assert.equal(next.alarm.time, "07:00")
  assert.equal(new Date(next.at).getDate(), 9)
  assert.equal(nextAlarm([{ time: "06:00", days: [1], on: true }], now).at, new Date(2026, 9, 12, 6, 0).getTime())
  assert.equal(nextAlarm([], now), null)
  assert.equal(meterPoints([], 100, 50), "")
  assert.equal(meterPoints([0, 100], 30, 50, 4), "20,50 30,0")
})
