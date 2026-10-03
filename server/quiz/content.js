// The Quiz Show's rules and question packs live with the browser code (they're plain ES
// modules); the server loads the very same files, so scoring and validation match.

const path = require("path")
const { pathToFileURL } = require("url")

const DIR = path.join(__dirname, "../../client/src/components/applets/quiz/shared")
const load = (name) => import(pathToFileURL(path.join(DIR, name)).href)

let loading = null
// -> { logic, show, content: { aboutMe, pairs, deep, compat, triviaPacks, trivia, likely } }
const quizContent = () =>
  (loading ??= Promise.all([load("logic.js"), load("show.js"), load("packs.js")])
    .then(async ([logic, show, packs]) => ({ logic, show, content: await packs.loadAllPacks() }))
    .catch((error) => {
      loading = null
      throw error
    }))

module.exports = { quizContent }
