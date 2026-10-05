// Search everything: tokenizing, ranking, snippets, the settings registry and the drive's
// in-memory index (updates on changes, remembers dates). Run:
// node --test client/src/utils/search.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { FileIndex, fold, hashText, htmlText, prepare, rank, scoreEntry, snippet, tokenize } from "./searchCore.js"
import { PROGRAM_KEYWORDS, SEARCH_TYPES, registerSearchable, registerSearchProvider, searchProviders, searchableEntries, searchableVersion } from "./searchIndex.js"

const entry = (title, keywords = [], detail = "", body = "") => ({ title, search: prepare({ title, keywords, detail, body }) })
const titles = (list) => list.map((e) => e.title)

test("tokenize: lowercase, accents off, punctuation splits, at most 8 words", () => {
  assert.deepEqual(tokenize("  Find my  C:\\Notes "), ["find", "my", "c", "notes"])
  assert.deepEqual(tokenize("Café Déjà-vu!"), ["cafe", "deja", "vu"])
  assert.deepEqual(tokenize(""), [])
  assert.deepEqual(tokenize("..."), [])
  assert.equal(tokenize("a b c d e f g h i j").length, 8)
  assert.equal(fold("ÉCOLE"), "ecole")
})

test("ranking: exact and prefix beat word starts, which beat letters inside", () => {
  const programs = [entry("Calculator", PROGRAM_KEYWORDS.Calculator), entry("Calendar", PROGRAM_KEYWORDS.Calendar), entry("Pictures Calendar"), entry("Recalc Tool")]
  assert.deepEqual(titles(rank(programs, "calc")), ["Calculator", "Recalc Tool"])
  assert.equal(titles(rank(programs, "cal"))[0], "Calendar", "the shorter of two prefix matches first")
  // keywords: "pictures" is Photos' word, while "Pictures Calendar" has it in its title
  const withPhotos = [...programs, entry("Photos", PROGRAM_KEYWORDS.Photos), entry("Paint", PROGRAM_KEYWORDS.Paint)]
  const pictures = titles(rank(withPhotos, "pictures"))
  assert.ok(pictures.includes("Photos") && pictures.includes("Paint"))
  // every word has to match somewhere
  assert.deepEqual(titles(rank(programs, "calc zebra")), [])
  // a word in the details or the contents counts, but less than the title
  const docs = [entry("Grocery list", [], "C:\\Documents", "milk, eggs and bread"), entry("Bread recipes", [], "C:\\Documents", "flour")]
  assert.deepEqual(titles(rank(docs, "bread")), ["Bread recipes", "Grocery list"])
  assert.deepEqual(titles(rank(docs, "eggs")), ["Grocery list"])
  assert.deepEqual(titles(rank(docs, "documents")).sort(), ["Bread recipes", "Grocery list"])
  assert.deepEqual(rank(docs, "   "), [])
})

test("scores: one-letter words only match word starts; the whole query at the start wins", () => {
  const e = prepare({ title: "Display Properties", keywords: ["wallpaper"] })
  assert.ok(scoreEntry(e, ["d"]) > 0)
  assert.equal(scoreEntry(e, ["y"]), 0, "a single letter inside a word isn't a match")
  assert.ok(scoreEntry(e, ["prop"]) > scoreEntry(e, ["erties"]))
  assert.ok(scoreEntry(e, ["wall"]) > 0)
  assert.ok(scoreEntry(e, ["display", "prop"], "display prop") > scoreEntry(e, ["prop", "display"], "prop display"))
})

test("snippets show the words around the match", () => {
  const text = "Dear diary,\n\nToday we went to the lake and saw a heron. Then we had ice cream by the boathouse."
  assert.match(snippet(text, "heron"), /heron/)
  assert.match(snippet(text, "heron"), /^\.\.\./)
  assert.equal(snippet("short", "nothing"), "short")
  assert.equal(htmlText("<p>Hello <b>there</b>&nbsp;&amp; you</p><style>p{}</style>").replace(/\s+/g, " ").trim(), "Hello there & you")
  assert.notEqual(hashText("abc"), hashText("abd"))
  assert.equal(hashText("abc"), hashText("abc"))
})

test("the settings registry: anyone can add, results know their order", () => {
  const before = searchableVersion()
  const seeded = searchableEntries().map((e) => e.title)
  for (const t of ["Change the wallpaper", "Screen saver", "Date and time", "Keyboard", "Passwords and PIN", "Notifications", "Sounds", "Desktop Themes"]) assert.ok(seeded.includes(t), t)
  const remove = registerSearchable([{ id: "cp:mouse", title: "Mouse", keywords: ["pointer speed", "double-click"], open: { program: "Control Panel", extra: { applet: "mouse" } } }, { title: "no id: skipped" }])
  assert.ok(searchableVersion() > before)
  const found = rank(searchableEntries().map((e) => ({ ...e, search: prepare({ title: e.title, keywords: e.keywords }) })), "double click")
  assert.equal(found[0].title, "Mouse")
  assert.equal(found[0].type, "settings")
  remove()
  assert.ok(!searchableEntries().some((e) => e.id === "cp:mouse"))
  const off = registerSearchProvider("messages", { entries: () => [] })
  assert.ok(searchProviders().some(([id]) => id === "messages"))
  off()
  assert.ok(!searchProviders().some(([id]) => id === "messages"))
  assert.deepEqual(SEARCH_TYPES.map((t) => t.id), ["programs", "settings", "files", "contacts", "events", "tasks", "notes", "messages", "mail", "photos", "help"])
})

// a little drive: { name, path, type, text } items, changed by the tests
const makeDrive = () => {
  const items = [
    { name: "Documents", path: "C:\\Documents", type: "documents", dir: true },
    { name: "Shopping", path: "C:\\Documents\\Shopping", type: "text", text: "milk eggs bread" },
    { name: "Letter", path: "C:\\Documents\\Letter", type: "richtext", text: "<p>Dear <b>grandma</b>, thanks for the sweater</p>" },
    { name: "PHOTO001.JPG", path: "C:\\My Pictures\\PHOTO001.JPG", type: "image", text: "data:image/jpeg;base64,AAAA" },
  ]
  const walk = function* () {
    for (const i of items) yield { key: i, name: i.name, path: i.path, type: i.type, isDirectory: !!i.dir, text: () => i.text || "" }
  }
  return { items, walk }
}

test("the drive index: names and words, rebuilt only for what changed", () => {
  const drive = makeDrive()
  let now = 1000
  const dates = {}
  const index = new FileIndex({ walk: drive.walk, now: () => now, dates })
  let list = index.refresh()
  assert.equal(list.length, 4)
  assert.equal(index.stats.built, 4)
  assert.deepEqual(titles(rank(list.map((e) => ({ ...e, title: e.name })), "grandma")), ["Letter"], "words inside a WordPad document, without its tags")
  assert.deepEqual(titles(rank(list.map((e) => ({ ...e, title: e.name })), "b")).includes("Letter"), false, "tag letters aren't words")
  // the first look only records what's there: no made-up dates
  assert.ok(Object.values(dates).every((d) => d.t === null))

  // nothing changed: nothing rebuilt (and refresh without invalidate costs nothing)
  assert.equal(index.refresh(), list)
  index.invalidate()
  index.refresh()
  assert.equal(index.stats.built, 0)
  assert.equal(index.stats.reused, 4)

  // one file edited, one added, one renamed, one deleted
  now = 5000
  drive.items[1].text = "milk eggs bread butter"
  drive.items.push({ name: "Ideas", path: "C:\\Documents\\Ideas", type: "text", text: "a treehouse" })
  drive.items[2].name = "Letter to Grandma"
  drive.items[2].path = "C:\\Documents\\Letter to Grandma"
  drive.items.splice(3, 1)
  index.invalidate()
  list = index.refresh()
  assert.equal(index.stats.built, 3)
  assert.equal(index.stats.reused, 1)
  const byName = Object.fromEntries(list.map((e) => [e.name, e]))
  assert.ok(byName.Shopping.body.includes("butter"))
  assert.equal(byName.Shopping.modified, 5000, "an edit is dated")
  assert.equal(byName.Ideas.modified, 5000, "a new file is dated")
  assert.equal(byName.Documents.modified, undefined, "folders have no date")
  assert.equal(dates["C:\\My Pictures\\PHOTO001.JPG"], undefined, "deleted files are forgotten")
  assert.ok(!list.some((e) => e.name === "PHOTO001.JPG"))
  assert.equal(rank(list.map((e) => ({ ...e, title: e.name })), "treehouse")[0].name, "Ideas")
})

test("the drive index is fast for a typical drive", () => {
  const items = []
  for (let i = 0; i < 400; i++) items.push({ name: `Note ${i}`, path: `C:\\Documents\\Note ${i}`, type: "text", text: `entry ${i} `.repeat(200) + (i === 77 ? " zeppelin" : "") })
  for (let i = 0; i < 40; i++) items.push({ name: `PHOTO${i}.JPG`, path: `C:\\My Pictures\\PHOTO${i}.JPG`, type: "image", text: "data:image/jpeg;base64," + "A".repeat(150_000) })
  const index = new FileIndex({ walk: function* () { for (const i of items) yield { key: i, name: i.name, path: i.path, type: i.type, isDirectory: false, text: () => i.text } }, dates: {} })
  let t = performance.now()
  const list = index.refresh()
  const build = performance.now() - t
  t = performance.now()
  const entries = list.map((e) => ({ ...e, title: e.name }))
  const hits = rank(entries, "zeppelin")
  const query = performance.now() - t
  assert.equal(hits[0].name, "Note 77")
  index.invalidate()
  t = performance.now()
  index.refresh()
  const again = performance.now() - t
  assert.ok(query < 50, `a query took ${query.toFixed(1)} ms`)
  assert.ok(again < 50, `re-indexing an unchanged drive took ${again.toFixed(1)} ms`)
  assert.ok(build < 500, `the first build took ${build.toFixed(1)} ms`)
})
