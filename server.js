// 98ish realtime server: the 98 Messenger (AIM-style) service on Socket.io.
// Env: PORT, MONGODB_URI (accounts; kept in memory without it).

const express = require("express")
const cors = require("cors")
const { attachAim } = require("./server/aim")

const app = express()
app.use(cors())
app.get("/", (request, response) => response.send("98ish chat server is running"))

const port = process.env.PORT || 8000
const server = app.listen(port, () => console.log(`The server is all fired up on port ${port}`))

const io = require("socket.io")(server, { cors: true })

attachAim(io).catch((error) => {
  console.error("[aim] failed to start", error)
  process.exit(1)
})
