// 98ish realtime server: the 98 Messenger (AIM-style) service on Socket.io, plus Network
// Neighborhood (file sharing, WinPopup, network games) and the guestbook's HTTP API.
// Env: PORT, MONGODB_URI (accounts, guestbook and online drives; kept in memory without it).

const express = require("express")
const cors = require("cors")
const { attachAim } = require("./server/aim")
const { attachNet } = require("./server/net")
const { guestbookRouter } = require("./server/net/guestbook")
const { driveRouter } = require("./server/drive")
const { homepageRouter } = require("./server/net/homepages")
const { mailRouter } = require("./server/mail")
const { attachGameChat } = require("./server/gamechat")

const app = express()
app.use(cors())
app.get("/", (request, response) => response.send("98ish chat server is running"))
let aim // 98 Messenger, once started: the online drive signs in with its sessions
app.use("/api/drive", driveRouter({ aim: () => aim }))
// Mail and homepages first: they read bigger bodies than the guestbook's parser allows
const mail = mailRouter()
const homepages = homepageRouter()
app.use("/api/mail", mail)
app.use("/api", homepages)
app.use("/api", guestbookRouter())

const port = process.env.PORT || 8000
const server = app.listen(port, () => console.log(`The server is all fired up on port ${port}`))

// room for a picture or a sound sent over Network Neighborhood (1.5 MB as a data URL)
const io = require("socket.io")(server, { cors: true, maxHttpBufferSize: 2 * 1024 * 1024 })

const net = attachNet(io)
attachGameChat(io, net)
aim = attachAim(io)
aim
  .then((aim) => {
    net.useAim(aim)
    mail.useAim(aim)
    homepages.useAim(aim)
  })
  .catch((error) => {
    console.error("[aim] failed to start", error)
    process.exit(1)
  })
