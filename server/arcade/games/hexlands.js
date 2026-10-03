// Hexlands (an original settle-and-trade island game) on the online room system
// (server/arcade/rooms.js): 2 to 6 players, the room's settings pick the map, points to win,
// turn clock and house rules; computer players with personalities fill Quick Match, Play
// the Computer and anyone who drops out. The rules live with the web client (plain ES
// modules in client/src/components/applets/hexlands, so games against the computer run the
// very same rules); this file loads them at startup. The server rolls the dice, holds every
// hand and the shuffled development deck, and runs the turn clock and trade offers; each
// player's view shows other hands only as counts and a stolen card only to the two players.

const path = require("path")
const { pathToFileURL } = require("url")

const DIR = path.join(__dirname, "../../../client/src/components/applets/hexlands")

let rules = null
const ready = import(pathToFileURL(path.join(DIR, "rules.js")).href).then((r) => (rules = r))
ready.catch((error) => console.error("[rooms] Hexlands' rules didn't load", error))

const loaded = () => {
  if (!rules) throw new Error("Hexlands is still loading")
  return rules
}

module.exports = {
  id: "hexlands",
  name: "Hexlands",
  minPlayers: 2,
  maxPlayers: 6,
  ready,
  get defaultSettings() {
    return rules ? { ...rules.DEFAULTS, timer: 90 } : {}
  },
  validateSettings: (s) => (rules ? rules.validateSettings(s) : { error: "Hexlands is still starting up. Try again in a moment." }),
  seats: (s) => (rules ? rules.seats(s) : 4),
  // Quick Match: people who want the same table size play together (the room's first
  // player picked the rest)
  bucket: (s) => `players:${s.players}`,
  create: (args) => loaded().create(args),
  action: (state, seat, action, ctx) => loaded().action(state, seat, action, ctx),
  view: (state, seat) => loaded().view(state, seat),
  isOver: (state) => loaded().isOver(state),
  bot: (state, seat, ctx) => loaded().bot(state, seat, ctx),
  botDelay: (state, seat, action) => loaded().botDelay(state, seat, action),
}
