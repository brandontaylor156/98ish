// 98ish realtime server: the 98 Messenger (AIM-style) service on Socket.io, plus Network
// Neighborhood (file sharing, WinPopup, network games), the guestbook's HTTP API, and
// couples (server/couples: pairing, love letters, Our Story, flowers), and shared
// calendars (server/calendar), Web Push notifications (server/push), and the Address Book's
// online copy (server/contacts), and Compass's web relay (server/web: WEB_* env vars, see there).
// Env: PORT, MONGODB_URI (accounts, guestbook and online drives; kept in memory without it),
// VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY + VAPID_SUBJECT (push notifications; off without them),
// DRIVE_SYNC_QUOTA_MB and DRIVE_SYNC_MAX_FILE_MB (file sync, see server/drive/sync.js),
// WEB_MONTHLY_WARN_MB (server/meter: the monthly outgoing-traffic meter).
// BLOB_READ_WRITE_TOKEN (synced file contents in Vercel Blob; see server/drive/bucket.js).

const express = require("express")
const cors = require("cors")
const { attachAim } = require("./server/aim")
const { attachNet } = require("./server/net")
const { guestbookRouter } = require("./server/net/guestbook")
const { driveRouter, syncRouter, createDriveStore } = require("./server/drive")
const { homepageRouter } = require("./server/net/homepages")
const { mailRouter } = require("./server/mail")
const { attachGameChat } = require("./server/gamechat")
const { puzzleRouter } = require("./server/puzzles")
const { quizRouter } = require("./server/quiz")
const { couplesRouter, attachCouples, coupleService } = require("./server/couples")
const { dollhouseRouter } = require("./server/dollhouse")
const { townRouter, attachTown, townService } = require("./server/town")
const { createAccountEraser } = require("./server/account")
const { petRouter } = require("./server/pet")
const { calendarRouter, attachCalendar } = require("./server/calendar")
const { defaultPush } = require("./server/push")
const { contactsRouter } = require("./server/contacts")
const { createWeb } = require("./server/web")
const { refuseOpaqueOrigins, allowSocketRequest } = require("./server/web/origins")
const { defaultUsage } = require("./server/meter")

const app = express()
// Usage counters kept in MongoDB (Compass's allowances) and the meter of everything this server
// sends in a month (Render's free 5 GB covers all of it; Compass closes well before): server/meter
const usage = defaultUsage()
// Compass's web relay answers CORS itself (relayed pages are opaque origins), so it goes first
let aimService = null // 98 Messenger once it's running (the relay signs people in with it)
const web = createWeb({ aim: () => aimService, counters: usage.counters })
app.use("/api/web", web.router)
// everything else refuses sandboxed (opaque-origin) callers, such as relayed pages
app.use(refuseOpaqueOrigins)
app.use(cors())
app.get("/", (request, response) => response.send("98ish chat server is running"))
let aim // 98 Messenger, once started: the online drive signs in with its sessions
// File sync per account (before /api/drive, which would claim its paths); old whole-drive
// online copies become synced files the first time an account syncs
const legacyDrives = createDriveStore()
legacyDrives.catch(() => {})
const sync = syncRouter({ aim: () => aim, legacy: legacyDrives })
app.use("/api/drive/sync", sync)
app.use("/api/drive", driveRouter({ aim: () => aim, store: legacyDrives }))
const contacts = contactsRouter({ aim: () => aim })
app.use("/api/contacts", contacts) // the Address Book's online copy
// Mail and homepages first: they read bigger bodies than the guestbook's parser allows
const mail = mailRouter()
const homepages = homepageRouter()
const quiz = quizRouter()
app.use("/api/mail", mail)
const puzzles = puzzleRouter()
app.use("/api/puzzles", puzzles)
app.use("/api/quiz", quiz)
app.use("/api/couples/pet", petRouter()) // Our Pet (before the couples router)
app.use("/api/couples", couplesRouter())
app.use("/api/calendar", calendarRouter())
const push = defaultPush()
app.use("/api/push", push.router())
const dollhouse = dollhouseRouter()
app.use("/api/dollhouse", dollhouse)
const town = townRouter()
app.use("/api/town", town)
app.use("/api", homepages)
const guestbook = guestbookRouter()
app.use("/api", guestbook)

const port = process.env.PORT || 8000
const server = app.listen(port, () => console.log(`The server is all fired up on port ${port}`))
usage.meter.attach(server) // every byte sent: HTTP, socket.io, the relay

// Render stops the server with SIGTERM: save the usage counters first (3 s at most)
let stopping = false
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, async () => {
    if (stopping) return
    stopping = true
    await usage.shutdown().catch(() => {})
    process.exit(0)
  })
}

// Render's free plan puts the server to sleep after 15 minutes without a visitor (waking
// takes 20-50 s, and scheduled reminders and pushes wait for it). On Render (which sets
// RENDER_EXTERNAL_URL) it visits itself every 10 minutes through the public address, which
// counts as a visit. One always-on service fits in the free plan's monthly hours.
// KEEP_AWAKE=0 turns it off.
if (process.env.RENDER_EXTERNAL_URL && process.env.KEEP_AWAKE !== "0") {
  const selfUrl = process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "") + "/"
  setInterval(() => {
    fetch(selfUrl, { headers: { "user-agent": "98ish-keep-awake" } }).catch(() => {})
  }, 10 * 60 * 1000).unref()
}

// room for a picture or a sound sent over Network Neighborhood (1.5 MB as a data URL)
const io = require("socket.io")(server, { cors: true, maxHttpBufferSize: 2 * 1024 * 1024, allowRequest: allowSocketRequest })

const net = attachNet(io)
const gameChat = attachGameChat(io, net)

// Delete My Account: every place that keeps something for an account, in order (the full
// list, and what happens to shared things, is at the top of server/account/index.js)
let calendars = null
const eraser = createAccountEraser()
  .addContext((key) => coupleService().accountContext(key))
  .add("push", (ctx) => push.eraseAccount(ctx))
  .add("drive", (ctx) => sync.eraseAccount(ctx))
  .add("contacts", (ctx) => contacts.eraseAccount(ctx))
  .add("mail", (ctx) => mail.eraseAccount(ctx))
  .add("puzzles", (ctx) => puzzles.eraseAccount(ctx))
  .add("quiz", (ctx) => quiz.eraseAccount(ctx))
  .add("homepages", (ctx) => homepages.eraseAccount(ctx))
  .add("guestbook", (ctx) => guestbook.eraseAccount(ctx))
  .add("games", (ctx) => net.eraseAccount(ctx))
  .add("calendar", (ctx) => {
    if (!calendars) throw new Error("calendars aren't ready")
    return calendars.eraseAccount(ctx)
  })
  .add("dollhouse", (ctx) => dollhouse.eraseAccount(ctx))
  .add("town", (ctx) => townService().eraseAccount(ctx))
  .add("couples", (ctx) => coupleService().eraseAccount(ctx))
  .add("gamechat", (ctx) => gameChat.eraseAccount(ctx))

aim = attachAim(io, { push, eraser })
aim
  .then((aim) => {
    aimService = aim
    net.useAim(aim)
    mail.useAim(aim)
    puzzles.useAim(aim)
    dollhouse.useAim(aim)
    homepages.useAim(aim)
    guestbook.useAim(aim)
    quiz.useAim(aim)
    attachCouples(io, { aim })
    calendars = attachCalendar(io, { aim, couples: coupleService })
    push.start({ calendars, couples: coupleService() })
    town.useAim(aim)
    attachTown(io)
  })
  .catch((error) => {
    console.error("[aim] failed to start", error)
    process.exit(1)
  })
