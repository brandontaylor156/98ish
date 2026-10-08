// 98ish Help: the rules for help topics and everything done with them that needs no browser
// (the Contents tree, the Index, full-text Search, checking topics), so it's tested in Node:
// node --test client/src/components/applets/help/help.test.js
//
// ---- Writing a topic (topics/*.js) ----
// A topics file exports `books` (chapters of the Contents tree) and `topics`:
//
//   export const books = [{ id: "games", title: "Games", order: 50 },
//                         { id: "games-cards", title: "Card games", parent: "games" }]
//   export const topics = [{
//     id: "solitaire",                 // unique; lowercase letters, digits and dashes
//     book: "games-cards",             // the book it sits in (Contents)
//     title: "Solitaire",              // shown in Contents, Search and the title of the page
//     summary: "Play Klondike...",     // one line, shown in Search results
//     keywords: ["cards", "klondike"], // Index entries (and extra words for Search)
//     programs: ["Solitaire"],         // F1 / Help > Help Topics in these programs opens it
//     body: [ ...blocks ],
//     related: ["freecell"],           // Related Topics (topic ids)
//   }]
//
// Blocks, in order on the page:
//   "A paragraph."                          (also { p: "..." })
//   { h: "A heading" }
//   { steps: ["Do this.", "Then this."], title: "To pair up:" }   (title defaults to "To do this:")
//   { list: ["a point", "another"] }
//   { tip: "..." } { note: "..." } { warning: "..." }
//   { phone: "On a phone you...", computer: "With a mouse you..." }   (either or both)
//   { keys: [["Ctrl+S", "Save"], ["F1", "Help"]], title: "Shortcuts" }
//   { table: { head: ["Mode", "Goal"], rows: [["Sprint", "40 lines"]] } }
//   { open: "Notepad", label: "Open Notepad", extra: { tab: "lock" } }   (a button that opens a program)
//   { shell: "taskbar-properties", label: "Open Taskbar Properties" }    (utils/shell.js actions)
//   { img: "/assets/program_icons/tetris.svg", alt: "Tetris icon", caption: "..." }
// Text inside any block can use **bold**, {{Ctrl+S}} for a key, and [[topic-id]] or
// [[topic-id|words]] for a link to another topic.

import { prepare, rank, snippet, tokenize } from "../../../utils/searchCore.js"

export const BLOCK_KINDS = ["p", "h", "steps", "list", "tip", "note", "warning", "phone", "keys", "table", "open", "shell", "img"]
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/

// ---- inline text ----

// "Press {{F1}} or see [[tetris|Tetris]], **now**" -> [{ text }, { key }, { link, text }, { bold }]
export const parseInline = (text) => {
  const out = []
  const re = /\*\*(.+?)\*\*|\{\{(.+?)\}\}|\[\[([a-z0-9-]+)(?:\|(.+?))?\]\]/g
  let at = 0
  let m
  const s = String(text ?? "")
  while ((m = re.exec(s))) {
    if (m.index > at) out.push({ text: s.slice(at, m.index) })
    if (m[1] !== undefined) out.push({ bold: m[1] })
    else if (m[2] !== undefined) out.push({ key: m[2] })
    else out.push({ link: m[3], text: m[4] })
    at = re.lastIndex
  }
  if (at < s.length) out.push({ text: s.slice(at) })
  return out
}

// the topic ids a piece of text links to
export const linksIn = (text) => parseInline(text).filter((s) => s.link).map((s) => s.link)

// plain words of inline text (no markup), with link text filled in by `titleOf(id)`
export const plain = (text, titleOf = (id) => id) =>
  parseInline(text)
    .map((s) => s.text ?? s.bold ?? s.key ?? (s.link ? s.text || titleOf(s.link) : ""))
    .join("")

export const blockKind = (block) => {
  if (typeof block === "string") return "p"
  if (!block || typeof block !== "object") return null
  if ("phone" in block || "computer" in block) return "phone"
  return BLOCK_KINDS.find((k) => k in block) || null
}

// every piece of text in a block (for Search, links and checks)
export const blockTexts = (block) => {
  const kind = blockKind(block)
  if (kind === "p") return [typeof block === "string" ? block : block.p]
  switch (kind) {
    case "h":
      return [block.h]
    case "steps":
      return [block.title || "", ...block.steps]
    case "list":
      return block.list
    case "tip":
    case "note":
    case "warning":
      return [block[kind]]
    case "phone":
      return [block.phone || "", block.computer || ""]
    case "keys":
      return [block.title || "", ...block.keys.flat()]
    case "table":
      return [...block.table.head, ...block.table.rows.flat()]
    case "open":
    case "shell":
      return [block.label || ""]
    case "img":
      return [block.caption || ""]
    default:
      return []
  }
}

// a topic's words, as plain text
export const topicText = (topic, titleOf) => (topic.body || []).flatMap(blockTexts).map((t) => plain(t, titleOf)).filter(Boolean).join(" ")

// ---- checking topics ----

// -> a list of problems ("" none). programNames: the programs that exist (programs.js)
export const validate = ({ books = [], topics = [], programNames = null } = {}) => {
  const errors = []
  const bookIds = new Set()
  for (const b of books) {
    if (!b?.id || !ID.test(b.id)) errors.push(`book with a bad id: ${JSON.stringify(b?.id)}`)
    if (bookIds.has(b.id)) errors.push(`book ${b.id} is defined twice`)
    bookIds.add(b.id)
    if (!b.title) errors.push(`book ${b.id} has no title`)
  }
  for (const b of books) if (b.parent && !bookIds.has(b.parent)) errors.push(`book ${b.id}: parent ${b.parent} doesn't exist`)
  const ids = new Set()
  for (const t of topics) {
    const where = `topic ${t?.id}`
    if (!t?.id || !ID.test(t.id)) errors.push(`topic with a bad id: ${JSON.stringify(t?.id)}`)
    if (ids.has(t.id)) errors.push(`${where} is defined twice`)
    ids.add(t.id)
    if (!t.title || typeof t.title !== "string") errors.push(`${where} has no title`)
    if (!bookIds.has(t.book)) errors.push(`${where}: book ${t.book} doesn't exist`)
    if (!Array.isArray(t.body) || !t.body.length) errors.push(`${where} has no body`)
    if (t.keywords && (!Array.isArray(t.keywords) || t.keywords.some((k) => typeof k !== "string" || !k.trim()))) errors.push(`${where} has a bad keyword`)
    for (const [i, block] of (t.body || []).entries()) {
      const kind = blockKind(block)
      if (!kind) errors.push(`${where}: block ${i} is of no known kind: ${JSON.stringify(block).slice(0, 80)}`)
      else if (kind === "steps" && (!Array.isArray(block.steps) || !block.steps.length)) errors.push(`${where}: block ${i} has no steps`)
      else if (kind === "list" && (!Array.isArray(block.list) || !block.list.length)) errors.push(`${where}: block ${i} has an empty list`)
      else if (kind === "keys" && (!Array.isArray(block.keys) || block.keys.some((k) => !Array.isArray(k) || k.length !== 2))) errors.push(`${where}: block ${i} has bad keys`)
      else if (kind === "table" && (!Array.isArray(block.table?.head) || !Array.isArray(block.table?.rows))) errors.push(`${where}: block ${i} has a bad table`)
      else if (kind === "open" && programNames && !programNames.includes(block.open)) errors.push(`${where}: block ${i} opens ${block.open}, which isn't a program`)
      else if (kind === "img" && !block.alt && block.alt !== "") errors.push(`${where}: block ${i}: a picture needs alt text`)
    }
    for (const p of t.programs || []) if (programNames && !programNames.includes(p)) errors.push(`${where}: program ${p} doesn't exist`)
  }
  for (const t of topics) {
    for (const r of t.related || []) {
      if (!ids.has(r)) errors.push(`topic ${t.id}: related topic ${r} doesn't exist`)
      if (r === t.id) errors.push(`topic ${t.id} is related to itself`)
    }
    for (const text of (t.body || []).flatMap(blockTexts)) for (const link of linksIn(text)) if (!ids.has(link)) errors.push(`topic ${t.id}: links to ${link}, which doesn't exist`)
    if (t.summary) for (const link of linksIn(t.summary)) if (!ids.has(link)) errors.push(`topic ${t.id}: summary links to ${link}`)
  }
  // a program should open one topic
  const owner = new Map()
  for (const t of topics) for (const p of t.programs || []) {
    if (owner.has(p)) errors.push(`program ${p} is claimed by ${owner.get(p)} and ${t.id}`)
    owner.set(p, t.id)
  }
  return errors
}

// ---- Contents ----

// -> [{ kind: "book", id, title, children: [...] } | { kind: "topic", id, title }], books by
// `order` (then as listed), topics as listed (or A to Z in a book with `sort: "az"`, like
// the game books), a book's sub-books before its pages
export const buildToc = (books, topics) => {
  const order = (b) => (typeof b.order === "number" ? b.order : 1000)
  const sorted = books.map((b, i) => ({ b, i })).sort((x, y) => order(x.b) - order(y.b) || x.i - y.i).map((x) => x.b)
  const node = (b) => ({
    kind: "book",
    id: b.id,
    title: b.title,
    children: [
      ...sorted.filter((c) => c.parent === b.id).map(node),
      ...(b.sort === "az" ? (list) => [...list].sort((x, y) => x.title.localeCompare(y.title, "en", { sensitivity: "base", numeric: true })) : (list) => list)(topics.filter((t) => t.book === b.id)).map((t) => ({ kind: "topic", id: t.id, title: t.title })),
    ],
  })
  return sorted.filter((b) => !b.parent).map(node)
}

// the books a topic sits in, outermost first (to open them in Contents)
export const bookPath = (books, topic) => {
  const out = []
  let id = topic?.book
  const seen = new Set()
  while (id && !seen.has(id)) {
    seen.add(id)
    const b = books.find((x) => x.id === id)
    if (!b) break
    out.unshift(b.id)
    id = b.parent
  }
  return out
}

// ---- Index ----

const indexKey = (term) => term.toLowerCase().replace(/^(the|a|an) /, "")

// every keyword and title -> the topics it leads to, alphabetical
// -> [{ term, topics: [id] }]
export const buildIndex = (topics) => {
  const map = new Map()
  const add = (term, id) => {
    const clean = String(term).trim()
    if (!clean) return
    const key = indexKey(clean)
    const entry = map.get(key) || { term: clean, key, topics: [] }
    if (!entry.topics.includes(id)) entry.topics.push(id)
    map.set(key, entry)
  }
  for (const t of topics) {
    add(t.title, t.id)
    for (const k of t.keywords || []) add(k, t.id)
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key)).map(({ term, topics }) => ({ term, topics }))
}

// typing in the Index box: the first term that starts with what's typed (else the closest
// one after it alphabetically) -> its position
export const indexLookup = (index, typed) => {
  const q = indexKey(String(typed || "").trim())
  if (!q) return 0
  const exact = index.findIndex((e) => indexKey(e.term).startsWith(q))
  if (exact >= 0) return exact
  const after = index.findIndex((e) => indexKey(e.term).localeCompare(q) > 0)
  return after >= 0 ? after : index.length - 1
}

// ---- Search ----

// the topics made ready for searching (once)
export const prepareTopics = (books, topics) => {
  const titleOf = (id) => topics.find((t) => t.id === id)?.title || id
  const bookTitle = (id) => books.find((b) => b.id === id)?.title || ""
  return topics.map((t) => {
    const body = topicText(t, titleOf)
    return {
      id: t.id,
      title: t.title,
      book: bookTitle(t.book),
      summary: t.summary || "",
      body,
      search: prepare({ title: t.title, keywords: t.keywords || [], detail: [t.summary || "", ...(t.programs || [])].join(" "), body }),
    }
  })
}

// full-text search, best first: titles beat keywords beat summaries beat the words of a page
// -> [{ id, title, book, score, snippet }]
export const searchTopics = (prepared, query, limit = 50) => {
  const tokens = tokenize(query)
  return rank(prepared, query, { limit }).map((e) => {
    // the words around the hit, else the summary
    const inBody = tokens.some((t) => e.search.body.includes(t))
    return { id: e.id, title: e.title, book: e.book, score: e.score, snippet: inBody ? snippet(e.body, query, 110) : e.summary || snippet(e.body, "", 110) }
  })
}

// the topic for a program (F1, Help > Help Topics), or null
export const topicForProgram = (topics, program) => (program && topics.find((t) => (t.programs || []).includes(program))?.id) || null

// the words of a search, for highlighting them on the page
export const searchWords = (query) =>
  String(query || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2)
    .slice(0, 8)
