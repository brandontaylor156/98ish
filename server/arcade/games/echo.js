// Echo Pads (a Simon-style memory game) on the online room system: "Pass the Pads", players
// take turns repeating the shared sequence and adding a step; a mistake or the turn clock
// knocks you out; the last one left wins. The rules live with the web client
// (client/src/components/applets/echo/rules.js); this file loads them once at startup.

const path = require("path")
const { pathToFileURL } = require("url")

const FILE = path.join(__dirname, "../../../client/src/components/applets/echo/rules.js")

let rules = null
const ready = import(pathToFileURL(FILE).href).then((m) => (rules = m.rules))
ready.catch((error) => console.error("[rooms] Echo Pads' rules didn't load", error))

const loaded = () => {
  if (!rules) throw new Error("Echo Pads is still loading")
  return rules
}

module.exports = {
  id: "echo",
  name: "Echo Pads",
  minPlayers: 2,
  maxPlayers: 6,
  fillTo: 2,
  ready,
  get defaultSettings() {
    return rules ? rules.defaultSettings : {}
  },
  get botDelay() {
    return rules ? rules.botDelay : 600
  },
  validateSettings: (s) => (rules ? rules.validateSettings(s) : { error: "Echo Pads is still starting up. Try again in a moment." }),
  bucket: (s) => (rules ? rules.bucket(s) : "loading"),
  seats: (s) => (rules ? rules.seats(s) : 4),
  quickSeats: () => 2,
  create: (args) => loaded().create(args),
  action: (state, seat, action, ctx) => loaded().action(state, seat, action, ctx),
  view: (state, seat) => loaded().view(state, seat),
  isOver: (state) => loaded().isOver(state),
  bot: (state, seat, ctx) => loaded().bot(state, seat, ctx),
  onLeave: (state, seat, ctx) => loaded().onLeave(state, seat, ctx),
}
