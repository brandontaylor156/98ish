// Every help topic, gathered from the topic files (each exports `books` and `topics`; the
// format is described at the top of ../helpCore.js). To add topics, add to a file here or
// add a file and list it below. The ".js" endings let Node's tests import these directly.

import * as basics from "./basics.js"
import * as accessories from "./accessories.js"
import * as internet from "./internet.js"
import * as us from "./us.js"
import * as games from "./games.js"
import * as quickgames from "./quickgames.js"
import * as casino from "./casino.js"
import * as settings from "./settings.js"
import * as support from "./support.js"

const FILES = [basics, accessories, internet, us, games, quickgames, casino, settings, support]

export const BOOKS = FILES.flatMap((f) => f.books || [])
export const TOPICS = FILES.flatMap((f) => f.topics || [])
// the page Home goes to
export const HOME = "help-home"
