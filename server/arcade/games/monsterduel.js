// Monster Duel on the online room system (server/arcade/rooms.js): a trading card duel for
// two, one duel or best of three. The rules, the card pool and the computer players live
// with the web client (plain ES modules in client/src/components/applets/monsterduel/engine,
// so games against the computer in the browser run the very same rules); this file loads
// them once at startup. The server holds both decks, both hands and every face-down card;
// view() only shows a player what they may see. Each player brings a deck (a starter or
// their own), which is checked against the card pool before the duel starts.

const path = require("path")
const { pathToFileURL } = require("url")

const FILE = path.join(__dirname, "../../../client/src/components/applets/monsterduel/engine/rules.js")

let rules = null
const ready = import(pathToFileURL(FILE).href).then((mod) => {
  rules = mod
  return mod
})
ready.catch((error) => console.error("[rooms] Monster Duel's rules didn't load", error))

const loaded = () => {
  if (!rules) throw new Error("Monster Duel is still loading")
  return rules
}

module.exports = {
  id: "monsterduel",
  name: "Monster Duel",
  minPlayers: 2,
  maxPlayers: 2,
  botDelay: 900,
  ready,
  defaultSettings: { bestOf: 1, turnTime: 180, lp: 8000 },
  validateSettings: (s) => (rules ? rules.validateSettings(s) : { error: "Monster Duel is still starting up. Try again in a moment." }),
  // the settings that matter for who to pair in Quick Match
  bucket: (s) => `${s.bestOf}:${s.lp}`,
  create: ({ players, settings, random, now, after }) => loaded().create({ players, settings: { bestOf: settings.bestOf, turnTime: settings.turnTime, lp: settings.lp }, random, now, after }),
  action: (state, seat, action, ctx) => loaded().action(state, seat, action, ctx),
  view: (state, seat) => loaded().view(state, seat),
  isOver: (state) => loaded().isOver(state),
  bot: (state, seat, ctx) => loaded().bot(state, seat, ctx),
}
