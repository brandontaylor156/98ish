// 98ish realtime server: the 98 Messenger (AIM-style) service on Socket.io, plus Network
// Neighborhood (file sharing, WinPopup, network games), the guestbook's HTTP API, and
// couples (server/couples: pairing, love letters, Our Story, flowers), and shared
// calendars (server/calendar), and Web Push notifications (server/push).
// Env: PORT, MONGODB_URI (accounts, guestbook and online drives; kept in memory without it),
// VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY + VAPID_SUBJECT (push notifications; off without them).

const express = require("express")
const cors = require("cors")
const { attachAim } = require("./server/aim")
const { attachNet } = require("./server/net")
const { guestbookRouter } = require("./server/net/guestbook")
const { driveRouter } = require("./server/drive")
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

const app = express()
app.use(cors())
app.get("/", (request, response) => response.send("98ish chat server is running"))
let aim // 98 Messenger, once started: the online drive signs in with its sessions
app.use("/api/drive", driveRouter({ aim: () => aim }))
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

// room for a picture or a sound sent over Network Neighborhood (1.5 MB as a data URL)
const io = require("socket.io")(server, { cors: true, maxHttpBufferSize: 2 * 1024 * 1024 })

const net = attachNet(io)
attachGameChat(io, net)
aim = attachAim(io, { push })
aim
  .then((aim) => {
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
