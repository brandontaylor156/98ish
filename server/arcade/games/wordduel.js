// Word Duel on the online room system (server/arcade/rooms.js): races, turns, co-op,
// battle royale, speed rush, sabotage and more (the settings pick the format). The rules
// and the word lists live with the web client (plain ES modules in
// client/src/components/applets/wordduel, so solo games run the very same rules); this
// file loads them once at startup. The server holds every secret word and judges every
// guess; the rules' view() never shows a word before its round is over.

const path = require("path")
const { pathToFileURL } = require("url")

const DIR = path.join(__dirname, "../../../client/src/components/applets/wordduel")
const load = (file) => import(pathToFileURL(path.join(DIR, file)).href)

let rules = null
const ready = Promise.all([load("rules.js"), load("words/index.js")])
  .then(async ([r, words]) => {
    const lists = await Promise.all(words.LENGTHS.map((n) => words.loadWords(n)))
    rules = r.makeRules(words.makeDict(lists), { utc: true })
    return rules
  })
ready.catch((error) => console.error("[rooms] Word Duel's rules didn't load", error))

const loaded = () => {
  if (!rules) throw new Error("Word Duel is still loading")
  return rules
}

module.exports = {
  id: "wordduel",
  name: "Word Duel",
  minPlayers: 1,
  maxPlayers: 8,
  tickMs: 500,
  ready,
  get defaultSettings() {
    return rules ? rules.defaultSettings : {}
  },
  validateSettings: (s) => (rules ? rules.validateSettings(s) : { error: "Word Duel is still starting up. Try again in a moment." }),
  seats: (s) => (rules ? rules.seats(s) : 2),
  spectate: (s) => (rules ? rules.spectate(s) : true),
  create: (args) => loaded().create(args),
  action: (state, seat, action, ctx) => loaded().action(state, seat, action, ctx),
  view: (state, seat) => loaded().view(state, seat),
  isOver: (state) => loaded().isOver(state),
  bot: () => null,
}
