// 98ish service worker: keeps a copy of the whole app so it opens with no connection
// (from the home screen too). Chat, multiplayer, the Wayback Machine and YouTube still
// need the internet; everything else works offline.
//
// sw-manifest.json is written at build time (vite.config.js) and lists every built file
// plus the public assets. Each deploy has its own cache; the previous one is kept until
// the next start so a page that's still open can finish loading its lazy chunks.

const PREFIX = "98ish-"

const manifest = () => fetch("/sw-manifest.json", { cache: "no-store" }).then((r) => r.json())

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const { version, files } = await manifest()
      const cache = await caches.open(PREFIX + version)
      // one at a time-ish so a slow phone connection isn't swamped; a failure skips the file
      const queue = ["/", ...files]
      const worker = async () => {
        while (queue.length) {
          const url = queue.shift()
          try {
            const res = await fetch(url, { cache: "reload" })
            if (res.ok) await cache.put(url, res)
          } catch {
            // offline mid-install: it'll be fetched (and cached) on first use instead
          }
        }
      }
      await Promise.all([worker(), worker(), worker(), worker()])
      await self.skipWaiting()
    })()
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const { version } = await manifest().catch(() => ({ version: null }))
      const keep = PREFIX + version
      const names = (await caches.keys()).filter((n) => n.startsWith(PREFIX) && n !== keep)
      // keep the newest older cache for pages still running the previous version
      names.sort()
      for (const name of names.slice(0, -1)) await caches.delete(name)
      await self.clients.claim()
    })()
  )
})

const sameOrigin = (url) => url.origin === self.location.origin

// ---- Share to 98ish (Web Share Target, manifest.webmanifest's share_target) ----
// An installed 98ish on Android (Chrome) shows up in the phone's share sheet. What's
// shared is POSTed here; it's kept in the "share-inbox" cache (not a "98ish-" one, so
// new versions don't clear it) and the app opens at /?share-target=<id>, where the
// Received Items dialog (OS-specific/ShareCenter.jsx) saves it into the 98ish drive.
// iPhone Safari has no share targets: there, Upload from Phone and Paste do this job.
const SHARE_PATH = "/share-target"
const SHARE_INBOX = "share-inbox"

const receiveShare = async (request) => {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  try {
    const form = await request.formData()
    const cache = await caches.open(SHARE_INBOX)
    const files = []
    let n = 0
    for (const file of form.getAll("files")) {
      if (typeof file === "string" || !file.size) continue
      const key = `/share-inbox/${id}/${n++}`
      await cache.put(key, new Response(file, { headers: { "content-type": file.type || "application/octet-stream" } }))
      files.push({ key, name: file.name || `Shared file ${n}`, type: file.type || "", size: file.size })
    }
    const meta = { id, at: Date.now(), title: String(form.get("title") || ""), text: String(form.get("text") || ""), url: String(form.get("url") || ""), files }
    await cache.put(`/share-inbox/${id}/meta`, new Response(JSON.stringify(meta), { headers: { "content-type": "application/json" } }))
  } catch {
    return Response.redirect(`/?share-target=failed`, 303)
  }
  return Response.redirect(`/?share-target=${id}`, 303)
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)
  if (!sameOrigin(url) || url.pathname !== SHARE_PATH) return
  if (event.request.method === "POST") event.respondWith(receiveShare(event.request))
  // a GET share (title/text/url in the address): hand it to the app as it is
  else event.respondWith(Response.redirect(`/?share-target=get${url.search ? `&${url.search.slice(1)}` : ""}`, 303))
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return
  const url = new URL(request.url)
  if (url.pathname === SHARE_PATH) return // answered above
  // the app's own files only: never the chat server, Wayback, YouTube or /api
  if (!sameOrigin(url) || url.pathname.startsWith("/api/") || url.pathname === "/sw-manifest.json") return

  // pages: try the network (to get updates), fall back to the saved app
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request)
          const cache = (await caches.keys()).filter((n) => n.startsWith(PREFIX)).sort().pop()
          if (res.ok && cache) (await caches.open(cache)).put("/", res.clone())
          return res
        } catch {
          return (await caches.match("/", { ignoreVary: true })) || Response.error()
        }
      })()
    )
    return
  }

  // files: saved copy first (built files never change: their names include a hash),
  // otherwise fetch it and save it for next time
  event.respondWith(
    (async () => {
      const hit = await caches.match(request, { ignoreVary: true })
      if (hit) return hit
      const res = await fetch(request)
      if (res.ok && res.type === "basic") {
        const cache = (await caches.keys()).filter((n) => n.startsWith(PREFIX)).sort().pop()
        if (cache) (await caches.open(cache)).put(request, res.clone())
      }
      return res
    })()
  )
})

// ---- push notifications (server/push) ----
// A push always shows a notification (iPhones insist). It's also kept in a little inbox
// (Cache Storage) and passed to any open 98ish, so the Notification Center lists it.
// Tapping one brings 98ish forward (or opens it) at the right place: the push's url is a
// deep link like /?open=im&with=NAME that the app handles.

const INBOX = "push-inbox-98ish" // not "98ish-...": a new deploy clears those
const INBOX_URL = "/__push-inbox"

const keepInInbox = async (data) => {
  const cache = await caches.open(INBOX)
  const res = await cache.match(INBOX_URL)
  const list = res ? await res.json().catch(() => []) : []
  list.push({ ...data, receivedAt: Date.now() })
  await cache.put(INBOX_URL, new Response(JSON.stringify(list.slice(-50)), { headers: { "content-type": "application/json" } }))
}

const windowsOf98ish = async () => (await self.clients.matchAll({ type: "window", includeUncontrolled: true })).filter((c) => c.url.startsWith(self.location.origin))

const readPush = (event) => {
  try {
    return event.data ? event.data.json() : {}
  } catch {
    return { title: "98ish", body: event.data ? event.data.text() : "" }
  }
}

self.addEventListener("push", (event) => {
  const data = readPush(event)
  const options = {
    body: data.body || "",
    tag: data.tag || undefined,
    renotify: !!(data.tag && data.renotify),
    requireInteraction: !!data.requireInteraction,
    icon: "/icons/icon-192.png",
    badge: "/icons/favicon-32.png",
    timestamp: data.time || Date.now(),
    data: { url: data.url || "/", key: data.key || null, category: data.category || null },
  }
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(data.title || "98ish", options)
      await keepInInbox(data).catch(() => {})
      try {
        await self.navigator.setAppBadge?.()
      } catch {
        // no badges here
      }
      for (const client of await windowsOf98ish()) client.postMessage({ type: "98ish-push", data })
    })()
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  let url
  try {
    url = new URL(event.notification.data?.url || "/", self.location.origin)
    if (url.origin !== self.location.origin) url = new URL("/", self.location.origin)
  } catch {
    url = new URL("/", self.location.origin)
  }
  event.waitUntil(
    (async () => {
      const open = await windowsOf98ish()
      const client = open.find((c) => c.focused) || open.find((c) => c.visibilityState === "visible") || open[0]
      if (client) {
        client.postMessage({ type: "98ish-open", url: url.href })
        try {
          return await client.focus()
        } catch {
          return client
        }
      }
      return self.clients.openWindow(url.href)
    })()
  )
})
