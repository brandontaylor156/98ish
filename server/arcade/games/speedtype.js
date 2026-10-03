// Speed Typist 98 on the online room system (server/arcade/rooms.js): typing races for up
// to five. The rules live with the web client (client/src/components/applets/speedtype/
// rules.js, a plain ES module, so races against the computer run the very same rules);
// this file loads them once at startup. The server picks the prompts, runs the countdown
// and the clock, checks every progress report (it must match the prompt, at a human
// speed), types for the computer racers and works out the places.

const path = require("path")
const { pathToFileURL } = require("url")
const { mask } = require("../../gamechat")

const FILE = path.join(__dirname, "../../../client/src/components/applets/speedtype/rules.js")

let rules = null
const ready = import(pathToFileURL(FILE).href).then((m) => (rules = m.rules))
ready.catch((error) => console.error("[rooms] Speed Typist's rules didn't load", error))

const loaded = () => {
  if (!rules) throw new Error("Speed Typist is still loading")
  return rules
}

module.exports = {
  id: "speedtype",
  name: "Speed Typist 98",
  minPlayers: 1,
  maxPlayers: 5,
  fillTo: 4, // Quick Match: computer racers fill up to four
  tickMs: 200,
  ready,
  get defaultSettings() {
    return rules ? rules.defaultSettings : {}
  },
  // (online rooms never get a ghost or a practice-drill label: those are local only).
  // A host's own text is only shown to the people in that room, with swear words starred
  // out the way game chat does it.
  validateSettings: (s) => {
    if (!rules) return { error: "Speed Typist is still starting up. Try again in a moment." }
    const clean = rules.validateSettings(s)
    if (clean.error || !clean.custom) return clean
    return { ...clean, custom: mask(clean.custom) }
  },
  bucket: (s) => (rules ? rules.bucket(s) : "loading"),
  seats: (s) => (rules ? rules.seats(s) : 5),
  create: (args) => loaded().create(args),
  action: (state, seat, action, ctx) => loaded().action(state, seat, action, ctx),
  view: (state, seat) => loaded().view(state, seat),
  isOver: (state) => loaded().isOver(state),
  // the computer racers type on the server's tick (rules.js), not through moves
  bot: () => null,
}
