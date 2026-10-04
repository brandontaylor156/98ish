// The service worker's push handlers (public/sw.js), run in a sandbox with fake browser
// pieces: a push shows a notification, lands in the inbox and reaches open windows; a tap
// focuses an open 98ish (or opens one) with the deep link, never another site.
// Plus the Notification Center's merging and deep links (notifications.js).
// Run: node --test client/src/utils/sw.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import vm from "node:vm"

const ORIGIN = "https://98ish.vercel.app"
const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8")

const fakeWorker = ({ windows = [] } = {}) => {
  const listeners = {}
  const shown = []
  const store = new Map() // cache name -> Map(url -> body)
  const opened = []
  const caches = {
    open: async (name) => {
      if (!store.has(name)) store.set(name, new Map())
      const c = store.get(name)
      return {
        match: async (url) => (c.has(url) ? new Response(c.get(url)) : undefined),
        put: async (url, res) => c.set(url, await res.text()),
        delete: async (url) => c.delete(url),
      }
    },
    keys: async () => [...store.keys()],
    match: async () => undefined,
    delete: async (name) => store.delete(name),
  }
  const self = {
    location: new URL(ORIGIN + "/sw.js"),
    addEventListener: (type, fn) => (listeners[type] = fn),
    registration: { showNotification: async (title, options) => shown.push({ title, options }) },
    clients: {
      matchAll: async () => windows,
      openWindow: async (url) => opened.push(url),
      claim: async () => {},
    },
    navigator: { setAppBadge: async () => {} },
    skipWaiting: async () => {},
  }
  const context = vm.createContext({ self, caches, fetch: async () => new Response("{}"), Response, URL, JSON, Date, console })
  vm.runInContext(source, context)
  // dispatch an event and wait for its waitUntil
  const fire = async (type, event) => {
    let done = Promise.resolve()
    listeners[type]({ ...event, waitUntil: (p) => (done = p) })
    await done
  }
  const inbox = async () => JSON.parse((store.get("push-inbox-98ish")?.get("/__push-inbox")) || "[]")
  return { listeners, shown, opened, fire, inbox, store }
}

// objects made inside the sandbox have its own prototypes
const plain = (x) => JSON.parse(JSON.stringify(x))
const pushEvent = (data) => ({ data: { json: () => data, text: () => JSON.stringify(data) } })
const windowClient = (url, { focused = false, visibilityState = "hidden" } = {}) => {
  const client = { url, focused, visibilityState, messages: [], focusCalls: 0 }
  client.postMessage = (m) => client.messages.push(m)
  client.focus = async () => {
    client.focusCalls++
    return client
  }
  return client
}

test("the caching handlers are still there", () => {
  const w = fakeWorker()
  for (const type of ["install", "activate", "fetch", "push", "notificationclick"]) assert.equal(typeof w.listeners[type], "function", type)
})

test("a push shows a notification, keeps it in the inbox and tells open windows", async () => {
  const win = windowClient(ORIGIN + "/")
  const other = windowClient("https://elsewhere.example/")
  const w = fakeWorker({ windows: [win, other] })
  const data = { title: "Rosie", body: "hi!", tag: "im-rosie", key: "im:rosie", url: "/?open=im&with=Rosie", category: "im", renotify: true, time: 123 }
  await w.fire("push", pushEvent(data))
  assert.equal(w.shown.length, 1)
  assert.equal(w.shown[0].title, "Rosie")
  assert.equal(w.shown[0].options.body, "hi!")
  assert.equal(w.shown[0].options.tag, "im-rosie")
  assert.equal(w.shown[0].options.renotify, true)
  assert.equal(w.shown[0].options.data.url, "/?open=im&with=Rosie")
  assert.equal(w.shown[0].options.timestamp, 123)
  const inbox = await w.inbox()
  assert.equal(inbox.length, 1)
  assert.equal(inbox[0].key, "im:rosie")
  assert.deepEqual(plain(win.messages), [{ type: "98ish-push", data }])
  assert.equal(other.messages.length, 0) // only 98ish's own windows

  // a second one adds to the inbox; a push with no data still shows something
  await w.fire("push", { data: null })
  assert.equal(w.shown[1].title, "98ish")
  assert.equal((await w.inbox()).length, 2)
})

test("a push whose data isn't JSON still shows as text", async () => {
  const w = fakeWorker()
  await w.fire("push", { data: { json: () => JSON.parse("nope"), text: () => "plain words" } })
  assert.equal(w.shown[0].title, "98ish")
  assert.equal(w.shown[0].options.body, "plain words")
})

test("tapping a notification focuses an open 98ish with the deep link, or opens one", async () => {
  const hidden = windowClient(ORIGIN + "/", { visibilityState: "hidden" })
  const shown = windowClient(ORIGIN + "/?x", { visibilityState: "visible" })
  const w = fakeWorker({ windows: [hidden, shown] })
  let closed = 0
  const tap = (url) => ({ notification: { data: { url }, close: () => closed++ } })
  await w.fire("notificationclick", tap("/?open=calendar&cal=abc&event=e1"))
  assert.equal(closed, 1)
  assert.equal(shown.focusCalls, 1)
  assert.deepEqual(plain(shown.messages), [{ type: "98ish-open", url: ORIGIN + "/?open=calendar&cal=abc&event=e1" }])
  assert.equal(w.opened.length, 0)

  const none = fakeWorker({ windows: [] })
  await none.fire("notificationclick", tap("/?open=im&with=Theo"))
  assert.deepEqual(plain(none.opened), [ORIGIN + "/?open=im&with=Theo"])

  // a link to another site never opens it
  const evil = fakeWorker({ windows: [] })
  await evil.fire("notificationclick", tap("https://evil.example/phish"))
  assert.deepEqual(plain(evil.opened), [ORIGIN + "/"])
})

test("the Notification Center merges by key, keeps accounts apart, and reads deep links", async () => {
  globalThis.window = { location: { origin: ORIGIN }, dispatchEvent: () => {} }
  const n = await import("./notifications.js")
  n.setNotifyAccount("rosie")
  n.notify({ app: "im", key: "im:theo", title: "Theo", text: "hi", target: { kind: "im", with: "Theo" } })
  n.notify({ app: "im", key: "im:theo", title: "Theo", text: "you there?" })
  let list = n.getNotifications()
  assert.equal(list.length, 1)
  assert.equal(list[0].text, "you there?")
  assert.equal(list[0].count, 2)
  assert.equal(n.unreadCount(), 1)
  // its push arriving later is the same item
  n.notify(n.fromPush({ title: "Theo", body: "you there?", key: "im:theo", url: "/?open=im&with=Theo", category: "im", time: list[0].time }))
  assert.equal(n.getNotifications().length, 1)

  n.notify({ app: "calls", key: "missed:theo:1", title: "Missed call", text: "Theo called" })
  n.notify({ app: "achievements", global: true, title: "Achievement: Juggler", read: true })
  assert.equal(n.unreadCount(), 2)
  // someone else signed on here sees only their own (and the shared ones)
  n.setNotifyAccount("theo")
  assert.deepEqual(n.getNotifications().map((x) => x.title), ["Achievement: Juggler"])
  n.setNotifyAccount("rosie")
  assert.equal(n.getNotifications().length, 3)

  let seen = null
  n.onSeen((t) => (seen = t))
  n.markAllRead()
  assert.equal(n.unreadCount(), 0)
  assert.ok(seen > 0)
  n.notify({ app: "mail", title: "New mail", key: "mail:1", time: Date.now() - 5000 })
  n.applySeen(Date.now())
  assert.equal(n.unreadCount(), 0)
  n.clearAll()
  assert.equal(n.getNotifications().length, 0)

  const target = (q) => n.targetFromParams(new URLSearchParams(q))
  assert.deepEqual(target("open=im&with=Rosie"), { kind: "im", with: "Rosie" })
  assert.deepEqual(target("open=call&with=Rosie"), { kind: "call", with: "Rosie" })
  assert.deepEqual(target("open=calendar&cal=c1&event=e1"), { kind: "calendar", calendarId: "c1", eventId: "e1" })
  assert.deepEqual(target("open=program&name=Lovebirds%20Quiz%20Show&challenge=q1"), { kind: "program", name: "Lovebirds Quiz Show", extra: { challengeId: "q1" } })
  assert.deepEqual(target("open=mail"), { kind: "mail" })
  assert.equal(target("open=im"), null)
  assert.equal(target("open=evil"), null)
  assert.equal(target("calendar=CODE"), null)
})
