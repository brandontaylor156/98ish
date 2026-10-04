// Color Match on the online room system (server/arcade/rooms.js): everyone gets the same
// questions (one seed) and the best score when the clock runs out wins. The rules live with
// the web client (client/src/components/applets/colormatch/rules.js, a plain ES module) so
// solo games, computer players and the server agree; this file loads them once at startup.

const path = require("path")
const { pathToFileURL } = require("url")

const FILE = path.join(__dirname, "../../../client/src/components/applets/colormatch/rules.js")

let rules = null
const ready = import(pathToFileURL(FILE).href).then((m) => (rules = m.rules))
ready.catch((error) => console.error("[rooms] Color Match's rules didn't load", error))

const loaded = () => {
  if (!rules) throw new Error("Color Match is still loading")
  return rules
}

module.exports = {
  id: "colormatch",
  name: "Color Match",
  minPlayers: 2,
  maxPlayers: 6,
  fillTo: 2, // Quick Match: one computer player when nobody else turns up
  tickMs: 250,
  ready,
  get defaultSettings() {
    return rules ? rules.defaultSettings : {}
  },
  validateSettings: (s) => (rules ? rules.validateSettings(s) : { error: "Color Match is still starting up. Try again in a moment." }),
  bucket: (s) => (rules ? rules.bucket(s) : "loading"),
  seats: (s) => (rules ? rules.seats(s) : 4),
  quickSeats: () => 2,
  create: (args) => loaded().create(args),
  action: (state, seat, action, ctx) => loaded().action(state, seat, action, ctx),
  view: (state, seat) => loaded().view(state, seat),
  isOver: (state) => loaded().isOver(state),
  onLeave: (state, seat, ctx) => loaded().onLeave(state, seat, ctx),
  // the computer players answer on the server's tick (rules.js), not through moves
  bot: () => null,
}
