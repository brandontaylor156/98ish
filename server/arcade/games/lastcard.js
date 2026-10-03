// Last Card (an original take on the classic shedding card game) on the online room system
// (server/arcade/rooms.js): 2 to 10 players, house rules from the room's settings, computer
// players with characters for Quick Match, Play the Computer and anyone who drops out. The
// rules live with the web client (plain ES modules in client/src/components/applets/lastcard,
// so games against the computer run the very same rules); this file loads them at startup.
// The server deals, holds every hand and the draw pile, and runs the turn clock and the
// "Last Card!" catch window; each player's view shows only their own cards.

const path = require("path")
const { pathToFileURL } = require("url")

const DIR = path.join(__dirname, "../../../client/src/components/applets/lastcard")

let rules = null
const ready = import(pathToFileURL(path.join(DIR, "rules.js")).href).then((r) => (rules = r))
ready.catch((error) => console.error("[rooms] Last Card's rules didn't load", error))

const loaded = () => {
  if (!rules) throw new Error("Last Card is still loading")
  return rules
}

module.exports = {
  id: "lastcard",
  name: "Last Card",
  minPlayers: 2,
  maxPlayers: 10,
  ready,
  get defaultSettings() {
    return rules ? rules.DEFAULTS : {}
  },
  validateSettings: (s) => (rules ? rules.validateSettings(s) : { error: "Last Card is still starting up. Try again in a moment." }),
  seats: (s) => (rules ? rules.seats(s) : 4),
  // Quick Match: people who want the same table size play together (the room's first
  // player picked the house rules)
  bucket: (s) => `players:${s.players}`,
  create: (args) => loaded().create(args),
  action: (state, seat, action, ctx) => loaded().action(state, seat, action, ctx),
  view: (state, seat) => loaded().view(state, seat),
  isOver: (state) => loaded().isOver(state),
  bot: (state, seat, ctx) => loaded().bot(state, seat, ctx),
  botDelay: (state, seat, action, ctx) => loaded().botDelay(state, seat, action, ctx),
}
