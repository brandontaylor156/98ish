// The rules for Reversi, Chess and Battleship live with the web client (plain ES modules,
// so games against the computer use the very same code). The server loads them once at
// startup; `ready` resolves when they're in. Games of those kinds wait for it.

const path = require("path")
const { pathToFileURL } = require("url")

const RULES_DIR = path.join(__dirname, "../../client/src/components/applets/network/rules")
const load = (name) => import(pathToFileURL(path.join(RULES_DIR, `${name}.js`)).href)

const rules = { reversi: null, chess: null, battleship: null }

const ready = Promise.all(
  Object.keys(rules).map((name) =>
    load(name).then((mod) => {
      rules[name] = mod
    })
  )
).then(() => rules)

ready.catch((error) => console.error("[net] couldn't load the game rules", error))

module.exports = { rules, ready }
