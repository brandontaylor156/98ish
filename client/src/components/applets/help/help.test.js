// 98ish Help: the topics are well formed, every program has a topic, the Index and Search work.
// node --test client/src/components/applets/help/help.test.js
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { BOOKS, TOPICS, HOME } from "./topics/index.js"
import { buildIndex, buildToc, bookPath, indexLookup, linksIn, parseInline, plain, prepareTopics, searchTopics, topicForProgram, topicText, validate } from "./helpCore.js"

// the program names in programs.js (it can't be imported in Node: extensionless imports)
const programsSource = readFileSync(new URL("../../../utils/programs.js", import.meta.url), "utf8")
const projectsSource = readFileSync(new URL("../../../utils/projects.js", import.meta.url), "utf8")
const PROGRAM_NAMES = [
  ...[...programsSource.matchAll(/\{ name: "([^"]+)"/g)].map((m) => m[1]),
  ...[...programsSource.matchAll(/\{ name: '([^']+)'/g)].map((m) => m[1]),
  ...[...projectsSource.matchAll(/name: "([^"]+)"/g)].map((m) => m[1]),
]

test("programs.js parsed", () => {
  assert.ok(PROGRAM_NAMES.includes("Notepad"))
  assert.ok(PROGRAM_NAMES.includes("YouTube '98"))
  assert.ok(PROGRAM_NAMES.includes("98ish Help"))
  assert.ok(PROGRAM_NAMES.includes("One Closet"))
})

test("every topic is well formed: a title, a body, real links and programs", () => {
  const errors = validate({ books: BOOKS, topics: TOPICS, programNames: PROGRAM_NAMES })
  assert.deepEqual(errors, [])
  assert.ok(TOPICS.length >= 100, `only ${TOPICS.length} topics`)
  assert.ok(TOPICS.some((t) => t.id === HOME))
})

test("every program opens a help topic", () => {
  const missing = PROGRAM_NAMES.filter((p) => !topicForProgram(TOPICS, p))
  assert.deepEqual(missing, [])
  assert.equal(topicForProgram(TOPICS, "Notepad"), "notepad")
  assert.equal(topicForProgram(TOPICS, "Nope"), null)
})

test("every topic is in Contents, under a book", () => {
  const toc = buildToc(BOOKS, TOPICS)
  const seen = new Set()
  const walk = (nodes) => nodes.forEach((n) => (n.kind === "topic" ? seen.add(n.id) : walk(n.children)))
  walk(toc)
  assert.equal(seen.size, TOPICS.length)
  assert.equal(toc[0].id, "start")
  // books in order
  const orders = toc.map((n) => BOOKS.find((b) => b.id === n.id).order ?? 1000)
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b))
  // no empty books
  const empty = []
  const walkBooks = (nodes) => nodes.forEach((n) => n.kind === "book" && (n.children.length ? walkBooks(n.children) : empty.push(n.id)))
  walkBooks(toc)
  assert.deepEqual(empty, [])
})

test("bookPath opens the books around a topic", () => {
  const books = [{ id: "a", title: "A" }, { id: "b", title: "B", parent: "a" }]
  assert.deepEqual(bookPath(books, { book: "b" }), ["a", "b"])
  assert.deepEqual(bookPath(books, { book: "a" }), ["a"])
  assert.deepEqual(bookPath(books, null), [])
})

test("validate finds problems", () => {
  const books = [{ id: "b", title: "B" }]
  const ok = { id: "x", book: "b", title: "X", body: ["Hi [[y]]"], related: ["y"] }
  const y = { id: "y", book: "b", title: "Y", body: ["Y"] }
  assert.deepEqual(validate({ books, topics: [ok, y] }), [])
  const errs = validate({
    books,
    topics: [
      { ...ok, related: ["nope"] },
      { id: "Bad Id", book: "b", title: "", body: [] },
      { id: "z", book: "missing", title: "Z", body: [{ weird: 1 }, "see [[gone]]", { open: "Nah" }], programs: ["Nah"] },
      { ...y, programs: ["P"] },
      { id: "w", book: "b", title: "W", body: ["w"], programs: ["P"] },
    ],
    programNames: ["P"],
  })
  const has = (re) => assert.ok(errs.some((e) => re.test(e)), `expected ${re} in ${errs.join("\n")}`)
  has(/related topic nope/)
  has(/bad id/)
  has(/has no title/)
  has(/has no body/)
  has(/book missing/)
  has(/no known kind/)
  has(/links to gone/)
  has(/opens Nah/)
  has(/program Nah/)
  has(/claimed by y and w/)
})

test("inline markup", () => {
  assert.deepEqual(parseInline("Press {{F1}} or see [[tetris|Tetris]], **now**."), [
    { text: "Press " },
    { key: "F1" },
    { text: " or see " },
    { link: "tetris", text: "Tetris" },
    { text: ", " },
    { bold: "now" },
    { text: "." },
  ])
  assert.deepEqual(linksIn("[[a]] and [[b-c|B]]"), ["a", "b-c"])
  assert.equal(plain("See [[a]] or [[b|the B]]", (id) => id.toUpperCase()), "See A or the B")
  assert.match(topicText({ body: ["One", { steps: ["Two"] }, { tip: "Three" }, { keys: [["F1", "Help"]] }] }), /One Two Three F1 Help/)
})

test("the Index: every term leads to real topics, alphabetical, type-to-find", () => {
  const index = buildIndex(TOPICS)
  const ids = new Set(TOPICS.map((t) => t.id))
  assert.ok(index.length > TOPICS.length)
  for (const e of index) {
    assert.ok(e.term.trim())
    assert.ok(e.topics.length > 0)
    for (const id of e.topics) assert.ok(ids.has(id), `${e.term} -> ${id}`)
  }
  const keys = index.map((e) => e.term.toLowerCase().replace(/^(the|a|an) /, ""))
  assert.deepEqual(keys, [...keys].sort((a, b) => a.localeCompare(b)))
  // typing finds the first term starting with it
  const small = buildIndex([
    { id: "a", title: "Apple", keywords: ["The Banana"] },
    { id: "b", title: "Cherry", keywords: ["apple pie"] },
  ])
  assert.deepEqual(small.map((e) => e.term), ["Apple", "apple pie", "The Banana", "Cherry"])
  assert.deepEqual(small[0].topics, ["a"])
  assert.equal(indexLookup(small, "ban"), 2)
  assert.equal(indexLookup(small, "app"), 0)
  assert.equal(indexLookup(small, "apple p"), 1)
  assert.equal(indexLookup(small, "bz"), 3) // the next one alphabetically
  assert.equal(indexLookup(small, "zzz"), 3)
  assert.equal(indexLookup(small, ""), 0)
})

test("Search ranks titles over keywords over words in the page", () => {
  const books = [{ id: "b", title: "Book" }]
  const topics = [
    { id: "body", book: "b", title: "Something else", body: ["You can play tetris here too."] },
    { id: "kw", book: "b", title: "Falling blocks", keywords: ["tetris"], body: ["Blocks."] },
    { id: "title", book: "b", title: "Tetris", body: ["Clear lines."] },
    { id: "none", book: "b", title: "Mail", body: ["Letters."] },
  ]
  const prepared = prepareTopics(books, topics)
  const hits = searchTopics(prepared, "tetris")
  assert.deepEqual(hits.map((h) => h.id), ["title", "kw", "body"])
  assert.equal(hits[0].book, "Book")
  assert.match(hits[2].snippet, /play tetris/)
  assert.deepEqual(searchTopics(prepared, "zebra"), [])
  assert.deepEqual(searchTopics(prepared, ""), [])
  // every word must match somewhere
  assert.deepEqual(searchTopics(prepared, "tetris mail").map((h) => h.id), [])
})

test("Search over the real topics finds the obvious page first", () => {
  const prepared = prepareTopics(BOOKS, TOPICS)
  const first = (q) => searchTopics(prepared, q)[0]?.id
  assert.equal(first("notepad"), "notepad")
  assert.equal(first("tetris"), "tetris")
  assert.equal(first("room code"), "online-play")
  assert.equal(first("add to home screen"), "home-screen")
  assert.ok(searchTopics(prepared, "pair").some((h) => h.id === "us-pairing"))
  assert.ok(searchTopics(prepared, "webcal").length > 0)
})
