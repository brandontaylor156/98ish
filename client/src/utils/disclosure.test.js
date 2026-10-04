import test from "node:test"
import assert from "node:assert/strict"

// a tiny localStorage for Node
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { DISCLOSURE_KEY, isOpen, rememberOpen, summarize } = await import("./disclosure.js")

test("closed until someone opens it, then remembered per id", () => {
  store.clear()
  assert.equal(isOpen("calendar.event"), false)
  assert.equal(isOpen("calendar.event", true), true)
  rememberOpen("calendar.event", true)
  assert.equal(isOpen("calendar.event"), true)
  assert.equal(isOpen("mail.compose"), false)
  rememberOpen("calendar.event", false)
  assert.equal(isOpen("calendar.event", true), false)
  assert.deepEqual(JSON.parse(store.get(DISCLOSURE_KEY)), { "calendar.event": false })
})

test('"*" opens every one nobody chose for', () => {
  store.clear()
  store.set(DISCLOSURE_KEY, JSON.stringify({ "*": true, "tetris.modes": false }))
  assert.equal(isOpen("camera.more"), true)
  assert.equal(isOpen("tetris.modes"), false)
})

test("bad stored data reads as nothing chosen", () => {
  store.clear()
  store.set(DISCLOSURE_KEY, "{oops")
  assert.equal(isOpen("x"), false)
  rememberOpen("x", true)
  assert.equal(isOpen("x"), true)
})

test("summaries join what's set with middle dots", () => {
  assert.equal(summarize("On this device", null, "", false, "Doesn't repeat", ["15 min reminder", undefined], "Auto color"), "On this device · Doesn't repeat · 15 min reminder · Auto color")
  assert.equal(summarize(), "")
})
