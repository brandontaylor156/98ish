// Imposter (the party word game: everyone but the imposter knows the secret word) on the
// online room system (server/arcade/rooms.js): 3 to 20 players, every house rule from the
// room's settings. The rules live with the web client (client/src/components/applets/
// imposter/rules.js, the same module pass-and-play runs); this file loads them at startup.
// The server picks the word and the imposters, so nobody's browser knows more than its own
// card. No computer players: a player who leaves is dropped and the round carries on.

const path = require("path")
const { pathToFileURL } = require("url")

const DIR = path.join(__dirname, "../../../client/src/components/applets/imposter")

let rules = null
const ready = import(pathToFileURL(path.join(DIR, "rules.js")).href).then((r) => (rules = r))
ready.catch((error) => console.error("[rooms] Imposter's rules didn't load", error))

const loaded = () => {
  if (!rules) throw new Error("Imposter is still loading")
  return rules
}

module.exports = {
  id: "imposter",
  name: "Imposter",
  minPlayers: 3,
  maxPlayers: 20,
  ready,
  get defaultSettings() {
    return rules ? rules.DEFAULTS : {}
  },
  validateSettings: (s) => (rules ? rules.validateSettings(s) : { error: "Imposter is still starting up. Try again in a moment." }),
  seats: (s) => (rules ? rules.validateSettings(s).players : 8),
  // Quick Match: tables of the same size play together, and start once 4 are in
  bucket: (s) => `players:${s.players}`,
  quickSeats: (s) => Math.min(4, s.players || 8),
  create: (args) => loaded().create(args),
  action: (state, seat, action, ctx) => loaded().action(state, seat, action, ctx),
  view: (state, seat) => loaded().view(state, seat),
  isOver: (state) => loaded().isOver(state),
  onLeave: (state, seat, ctx) => loaded().onLeave(state, seat, ctx),
}
