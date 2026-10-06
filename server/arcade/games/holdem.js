// Texas Hold'em (No-Limit, a freeze-out: last one with chips wins) on the online room system
// (server/arcade/rooms.js): 2 to 8 players, computer players for Quick Match, Play the
// Computer and anyone who drops out. The rules live with the web client (plain ES modules in
// client/src/components/applets/casino, so tables against the computer run the very same
// rules); this file loads them at startup. The server shuffles and deals, keeps the deck and
// everyone's hole cards, and runs the turn clock; each player's view shows only their own
// cards until a showdown. Online tables play with their own chips, not the casino chip bank,
// and nothing is stored.

const path = require("path")
const { pathToFileURL } = require("url")

const DIR = path.join(__dirname, "../../../client/src/components/applets/casino")

let rules = null
const ready = import(pathToFileURL(path.join(DIR, "holdem.js")).href).then((r) => (rules = r))
ready.catch((error) => console.error("[rooms] Hold'em's rules didn't load", error))

const loaded = () => {
  if (!rules) throw new Error("Hold'em is still loading")
  return rules
}

module.exports = {
  id: "holdem",
  name: "Texas Hold'em",
  minPlayers: 2,
  maxPlayers: 8,
  ready,
  get defaultSettings() {
    return rules ? { ...rules.DEFAULTS, timer: 30 } : {}
  },
  validateSettings: (s) => {
    if (!rules) return { error: "Hold'em is still starting up. Try again in a moment." }
    const clean = rules.validateSettings(s)
    // online tables always have a turn clock, so nobody can stall the table
    if (!clean.error && !clean.timer) clean.timer = 30
    return clean
  },
  seats: (s) => (rules ? rules.seats(s) : 6),
  // Quick Match: the same table size and stakes play together
  bucket: (s) => `players:${s.players}:blind:${s.blind}:stack:${s.stack}`,
  create: (args) => loaded().create(args),
  action: (state, seat, action, ctx) => loaded().action(state, seat, action, ctx),
  view: (state, seat) => loaded().view(state, seat),
  isOver: (state) => loaded().isOver(state),
  bot: (state, seat, ctx) => loaded().bot(state, seat, ctx),
  // (someone who leaves mid-game: a computer player takes their seat and chips)
  botDelay: (state, seat, action, ctx) => loaded().botDelay(state, seat, action, ctx),
}
