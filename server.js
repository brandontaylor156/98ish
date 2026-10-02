// 98ish realtime server: the 98 Messenger (AIM-style) service on Socket.io, plus Network
// Neighborhood (file sharing, WinPopup, network games) and the guestbook's HTTP API.
// Env: PORT, MONGODB_URI (accounts and guestbook; kept in memory without it).

const express = require("express")
const cors = require("cors")
const { attachAim } = require("./server/aim")
const { attachNet } = require("./server/net")
const { guestbookRouter } = require("./server/net/guestbook")

const app = express()
app.use(cors())
app.get("/", (request, response) => response.send("98ish chat server is running"))
app.use("/api", guestbookRouter())

const port = process.env.PORT || 8000
const server = app.listen(port, () => console.log(`The server is all fired up on port ${port}`))

const io = require("socket.io")(server, { cors: true })

const net = attachNet(io)
attachAim(io)
  .then((aim) => net.useAim(aim))
  .catch((error) => {
    console.error("[aim] failed to start", error)
    process.exit(1)
  })
