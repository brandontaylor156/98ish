// Search everything: the matching and ranking, and the in-memory index of the drive's files,
// with no browser or React in them (tested in Node: node --test client/src/utils/search.test.js).
// utils/search.js gathers what there is to find (programs, settings, files, contacts, events,
// messages, mail, photos) and uses these.

// "Café Déjà-vu!" -> "cafe deja-vu!" (lowercase, accents off)
export const fold = (text) =>
  String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()

// "  Find my  C:\\notes " -> ["find", "my", "c", "notes"]
export const tokenize = (query) => fold(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 8)

const isWordStart = (text, at) => at === 0 || !/[\p{L}\p{N}]/u.test(text[at - 1])

// Where a word starts with the token: the best kind of hit in a title
const wordStartIndex = (text, token) => {
  let at = text.indexOf(token)
  while (at >= 0) {
    if (isWordStart(text, at)) return at
    at = text.indexOf(token, at + 1)
  }
  return -1
}

// How well one token matches one field (0 = not at all)
const tokenScore = (text, token, weights) => {
  if (!text) return 0
  if (text === token) return weights.exact
  if (text.startsWith(token)) return weights.prefix
  if (wordStartIndex(text, token) >= 0) return weights.word
  if (weights.inside && token.length >= 2 && text.includes(token)) return weights.inside
  return 0
}

const TITLE = { exact: 100, prefix: 70, word: 50, inside: 22 }
const KEYWORD = { exact: 64, prefix: 44, word: 30, inside: 0 }
const DETAIL = { exact: 18, prefix: 16, word: 14, inside: 6 }
const BODY = { exact: 10, prefix: 10, word: 9, inside: 5 }

// An entry: { title, keywords: [..], detail (path, place, sender...), body (contents) } with
// each already folded (see prepare()). Every token must match somewhere. -> a score (0 = no)
export const scoreEntry = (entry, tokens, query = tokens.join(" ")) => {
  if (!tokens.length) return 0
  let total = 0
  for (const token of tokens) {
    let best = tokenScore(entry.title, token, TITLE)
    for (const k of entry.keywords || []) best = Math.max(best, tokenScore(k, token, KEYWORD))
    if (best < DETAIL.exact) best = Math.max(best, tokenScore(entry.detail, token, DETAIL))
    if (!best) best = tokenScore(entry.body, token, BODY)
    if (!best) return 0
    total += best
  }
  // the whole query at the start of the title ("calc" -> Calculator), and shorter titles
  // (a closer match) first
  if (query && entry.title.startsWith(query)) total += 40
  if (query && (entry.keywords || []).includes(query)) total += 30
  return total - Math.min(entry.title.length, 60) * 0.15
}

// Fold an entry's searchable fields once (titles, keywords, detail, body)
export const prepare = ({ title = "", keywords = [], detail = "", body = "" }) => ({
  title: fold(title),
  keywords: keywords.map(fold),
  detail: fold(detail),
  body: fold(body),
})

// The best matches among entries ({ ..., search: prepare(...) }), highest score first
export const rank = (entries, query, { limit = 50, boost = () => 0 } = {}) => {
  const tokens = tokenize(query)
  if (!tokens.length) return []
  const q = tokens.join(" ")
  const hits = []
  for (const entry of entries) {
    const score = scoreEntry(entry.search, tokens, q)
    if (score > 0) hits.push({ entry, score: score + boost(entry) })
  }
  hits.sort((a, b) => b.score - a.score || a.entry.search.title.localeCompare(b.entry.search.title))
  return hits.slice(0, limit).map((h) => ({ ...h.entry, score: h.score }))
}

// A bit of `text` around the first word that matches, for showing under a result
export const snippet = (text, query, length = 70) => {
  const raw = String(text ?? "").replace(/\s+/g, " ").trim()
  const tokens = tokenize(query)
  const folded = fold(raw)
  let at = -1
  for (const t of tokens) {
    const i = folded.indexOf(t)
    if (i >= 0 && (at < 0 || i < at)) at = i
  }
  if (at < 0) return raw.slice(0, length) + (raw.length > length ? "..." : "")
  const start = Math.max(0, at - Math.floor(length / 3))
  return (start > 0 ? "..." : "") + raw.slice(start, start + length) + (start + length < raw.length ? "..." : "")
}

// A quick fingerprint of some text (to notice a changed file)
export const hashText = (text) => {
  let h = 5381
  const s = String(text ?? "")
  const step = s.length > 20_000 ? Math.ceil(s.length / 20_000) : 1
  for (let i = 0; i < s.length; i += step) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return `${s.length.toString(36)}.${(h >>> 0).toString(36)}`
}

// WordPad's documents are HTML: their words, without the tags
export const htmlText = (html) =>
  String(html ?? "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")

const MAX_BODY = 60_000 // characters of a document's contents kept for finding words in it

// The drive's files, indexed in memory and kept up to date cheaply: walk() lists every item
// as { key (the item itself), name, path, type, isDirectory, text() }; refresh() reuses the
// entries of items whose name, place and contents didn't change and only re-reads the rest.
// dates ({ path: { sig, t } }) remembers when each file was first seen or last changed
// (the drive itself keeps no dates); the first build only records what's there (t: null).
export class FileIndex {
  constructor({ walk, textTypes = ["text", "note", "richtext"], now = () => Date.now(), dates = null } = {}) {
    this.walk = walk
    this.textTypes = new Set(textTypes)
    this.now = now
    this.dates = dates
    this.cache = new Map() // key -> entry
    this.entries = []
    this.dirty = true
    this.stats = { built: 0, reused: 0 }
  }

  invalidate() {
    this.dirty = true
  }

  // -> the entries ({ key, name, path, type, isDirectory, modified, search })
  refresh() {
    if (!this.dirty) return this.entries
    const firstTime = this.dates && !Object.keys(this.dates).length
    const seen = new Map()
    const stats = { built: 0, reused: 0 }
    const datesSeen = new Set()
    for (const item of this.walk()) {
      const raw = item.isDirectory ? "" : item.text()
      const old = this.cache.get(item.key)
      let entry
      if (old && old.raw === raw && old.name === item.name && old.path === item.path && old.type === item.type) {
        entry = old
        stats.reused++
      } else {
        const isText = !item.isDirectory && this.textTypes.has(item.type)
        const body = isText ? (item.type === "richtext" ? htmlText(raw) : raw).slice(0, MAX_BODY) : ""
        entry = {
          key: item.key,
          raw,
          name: item.name,
          path: item.path,
          type: item.type,
          isDirectory: item.isDirectory,
          size: raw.length,
          body,
          search: prepare({ title: item.name, detail: item.path, body }),
        }
        stats.built++
      }
      if (this.dates && !item.isDirectory) {
        const sig = item.type + ":" + (this.textTypes.has(item.type) ? hashText(raw) : raw.length)
        const known = this.dates[item.path]
        if (!known || known.sig !== sig) this.dates[item.path] = { sig, t: firstTime ? null : this.now() }
        datesSeen.add(item.path)
        entry.modified = this.dates[item.path].t
      }
      seen.set(item.key, entry)
    }
    // forget files that are gone
    if (this.dates) for (const path of Object.keys(this.dates)) if (!datesSeen.has(path)) delete this.dates[path]
    this.cache = seen
    this.entries = [...seen.values()]
    this.dirty = false
    this.stats = stats
    return this.entries
  }
}
