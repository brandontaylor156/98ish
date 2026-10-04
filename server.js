// 98ish realtime server: the 98 Messenger (AIM-style) service on Socket.io, plus Network
// Neighborhood (file sharing, WinPopup, network games), the guestbook's HTTP API, and
// couples (server/couples: pairing, love letters, Our Story, flowers), and shared
// calendars (server/calendar), Web Push notifications (server/push), and the Address Book's
// online copy (server/contacts), and Compass's web relay (server/web: WEB_* env vars, see there).
// Env: PORT, MONGODB_URI (accounts, guestbook and online drives; kept in memory without it),
// VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY + VAPID_SUBJECT (push notifications; off without them),
// DRIVE_SYNC_QUOTA_MB and DRIVE_SYNC_MAX_FILE_MB (file sync, see server/drive/sync.js).

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
const { townRouter, attachTown } = require("./server/town")
const { petRouter } = require("./server/pet")
const { calendarRouter, attachCalendar } = require("./server/calendar")
const { defaultPush } = require("./server/push")
const { contactsRouter } = require("./server/contacts")
const { createWeb } = require("./server/web")

const app = express()
// Compass's web relay answers CORS itself (relayed pages are opaque origins), so it goes first
let aimService = null // 98 Messenger once it's running (the relay signs people in with it)
const web = createWeb({ aim: () => aimService })
app.use("/api/web", web.router)
app.use(cors())
app.get("/", (request, response) => response.send("98ish chat server is running"))
let aim // 98 Messenger, once started: the online drive signs in with its sessions
// File sync per account (before /api/drive, which would claim its paths); old whole-drive
// online copies become synced files the first time an account syncs
const legacyDrives = createDriveStore()
legacyDrives.catch(() => {})
app.use("/api/drive/sync", syncRouter({ aim: () => aim, legacy: legacyDrives }))
app.use("/api/drive", driveRouter({ aim: () => aim, store: legacyDrives }))
app.use("/api/contacts", contactsRouter({ aim: () => aim })) // the Address Book's online copy
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
app.use("/api", guestbookRouter())

const port = process.env.PORT || 8000
const server = app.listen(port, () => console.log(`The server is all fired up on port ${port}`))

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
const io = require("socket.io")(server, { cors: true, maxHttpBufferSize: 2 * 1024 * 1024 })

const net = attachNet(io)
attachGameChat(io, net)
aim = attachAim(io, { push })
aim
  .then((aim) => {
    aimService = aim
    net.useAim(aim)
    mail.useAim(aim)
    puzzles.useAim(aim)
    dollhouse.useAim(aim)
    homepages.useAim(aim)
    quiz.useAim(aim)
    attachCouples(io, { aim })
    const calendars = attachCalendar(io, { aim, couples: coupleService })
    push.start({ calendars, couples: coupleService() })
    town.useAim(aim)
    attachTown(io)
  })
  .catch((error) => {
    console.error("[aim] failed to start", error)
    process.exit(1)
  })
