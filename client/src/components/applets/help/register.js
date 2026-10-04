// Puts every help topic in the search registry (utils/searchIndex.js), so the Start menu's
// search box and Find list them under "Help Topics". Loaded with the searching (utils/search.js)
// and with the Help window; registering twice replaces the same entries.

import { registerSearchable } from "../../../utils/searchIndex"
import { launch } from "../../../utils/programs"
import { helpHandoff } from "../../../utils/help"
import { BOOKS, TOPICS } from "./topics/index.js"
import { topicText } from "./helpCore.js"

export const HELP_ICON = "/assets/program_icons/help.svg"

const titleOf = (id) => TOPICS.find((t) => t.id === id)?.title || id
const bookTitle = (id) => BOOKS.find((b) => b.id === id)?.title || "Help"

registerSearchable(
  TOPICS.map((t) => ({
    id: `help:${t.id}`,
    type: "help",
    title: t.title,
    keywords: t.keywords || [],
    detail: `98ish Help > ${bookTitle(t.book)}`,
    summary: t.summary || "",
    body: topicText(t, titleOf),
    icon: HELP_ICON,
    open: (dispatch) => dispatch({ type: "open_window", payload: launch("98ish Help", helpHandoff(t.id)) }),
  }))
)
