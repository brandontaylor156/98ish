import { test } from "node:test"
import assert from "node:assert/strict"
import * as R from "./shareRules.js"

const pic = { name: "IMG_1.JPG", data: "x", mime: "image/jpeg" }
const txt = { name: "note.txt", data: "hi", mime: "text/plain" }

test("planShare: share sheet when it can, else download or copy", () => {
  const full = { share: true, files: true }
  const noFiles = { share: true, files: false }
  const none = { share: false, files: false }
  assert.equal(R.planShare(full, { files: [pic] }, "phone"), "share")
  assert.equal(R.planShare(noFiles, { files: [pic] }, "phone"), "download")
  assert.equal(R.planShare(none, { files: [pic] }, "apps"), "download")
  // text first for Other Apps when the payload prefers it
  assert.equal(R.planShare(none, { files: [txt], text: "hi", preferText: true }, "apps"), "copy")
  assert.equal(R.planShare(noFiles, { files: [txt], text: "hi", preferText: true }, "apps"), "share")
  // My Phone always sends the file
  assert.equal(R.planShare(noFiles, { files: [txt], text: "hi", preferText: true }, "phone"), "download")
  assert.equal(R.planShare(full, { url: "https://a.b" }, "phone"), "share")
  assert.equal(R.planShare(none, { url: "https://a.b" }, "phone"), "copy")
  assert.equal(R.planShare(full, {}, "apps"), "none")
})

test("shareData: bare files for My Phone, words for Other Apps", () => {
  const make = (f) => ({ file: f.name })
  assert.deepEqual(R.shareData({ title: "IMG_1", files: [pic] }, "phone", make), { files: [{ file: "IMG_1.JPG" }] })
  assert.deepEqual(R.shareData({ title: "IMG_1", files: [pic] }, "apps", make), { files: [{ file: "IMG_1.JPG" }], title: "IMG_1" })
  assert.deepEqual(R.shareData({ title: "Note", text: "hi", files: [txt], preferText: true }, "apps", make), { title: "Note", text: "hi" })
  assert.deepEqual(R.shareData({ title: "Note", text: "hi", files: [txt], preferText: true }, "phone", make), { files: [{ file: "note.txt" }] })
  assert.deepEqual(R.shareData({ title: "AOL", url: "https://aol.com", files: [] }, "phone", make), { title: "AOL", url: "https://aol.com" })
})

test("copyTextFor and fallback messages", () => {
  assert.equal(R.copyTextFor({ text: "a", url: "https://b" }), "a\nhttps://b")
  assert.equal(R.copyTextFor({ url: "https://b" }), "https://b")
  assert.equal(R.copyTextFor({ title: "T" }), "T")
  assert.match(R.fallbackMessage("download", { files: [pic] }, "phone"), /IMG_1\.JPG was downloaded/)
  assert.match(R.fallbackMessage("download", { files: [pic, txt] }, "apps"), /2 files were downloaded/)
  assert.match(R.fallbackMessage("copied", {}, "apps"), /copied to the clipboard/)
  assert.equal(R.fallbackMessage("shared", {}, "apps"), null)
})

test("file names", () => {
  assert.equal(R.safeFileName("a:b/c?", ".txt"), "a_b_c_.txt")
  assert.equal(R.safeFileName("notes.TXT", ".txt"), "notes.TXT")
  assert.equal(R.safeFileName("", ".png"), "98ish.png")
  assert.deepEqual(R.textFile("Hello", "a\nb"), { name: "Hello.txt", data: "a\r\nb", mime: "text/plain" })
})

test("incomingKind and destinations", () => {
  assert.equal(R.incomingKind({ name: "IMG_0001.HEIC", type: "" }), "image")
  assert.equal(R.incomingKind({ name: "photo", type: "image/jpeg" }), "image")
  assert.equal(R.incomingKind({ name: "notes.md", type: "" }), "text")
  assert.equal(R.incomingKind({ name: "page.html", type: "text/html" }), "richtext")
  assert.equal(R.incomingKind({ name: "memo.m4a", type: "audio/mp4" }), "sound")
  assert.equal(R.incomingKind({ name: "report.pdf", type: "application/pdf" }), null)
  assert.deepEqual(R.destinationFor("image"), ["C:", "My Pictures"])
  assert.deepEqual(R.destinationFor("text"), ["C:", "Documents"])
  assert.equal(R.pathLabel(["C:", "My Pictures"]), "C:\\My Pictures")
  assert.equal(R.pathLabel(["C:"]), "C:\\")
})

test("findUrl, shortcutName, noteName", () => {
  assert.equal(R.findUrl("look at https://example.com/a?b=1."), "https://example.com/a?b=1")
  assert.equal(R.findUrl("(see http://x.org/page)"), "http://x.org/page")
  assert.equal(R.findUrl("no link"), null)
  assert.equal(R.shortcutName("Cats: a <history>", "https://cats.com"), "Cats  a  history".replace(/\s+/g, " "))
  assert.equal(R.shortcutName("", "https://www.example.com/x"), "example.com")
  assert.equal(R.shortcutName("https://x.com", "https://x.com"), "x.com")
  assert.equal(R.noteName("", "Buy milk and eggs and bread today please"), "Buy milk and eggs and")
  assert.equal(R.noteName("Groceries", "milk"), "Groceries")
  assert.equal(R.noteName("", ""), "Shared Text")
})

test("planReceived routes files, links and text", () => {
  const files = [
    { name: "IMG_1.jpg", type: "image/jpeg", size: 10 },
    { name: "list.txt", type: "text/plain", size: 5 },
    { name: "doc.pdf", type: "application/pdf", size: 5 },
    { name: "", type: "", size: 0 }, // Android sends an empty file part when nothing was picked
  ]
  const plan = R.planReceived({ title: "", text: "", url: "", files })
  assert.deepEqual(
    plan.map((p) => [p.kind, p.name, p.dest]),
    [
      ["image", "IMG_1.jpg", ["C:", "My Pictures"]],
      ["text", "list.txt", ["C:", "Documents"]],
      ["unsupported", "doc.pdf", undefined],
    ]
  )
  // Android: the link in text, the page title in title
  const link = R.planReceived({ title: "Big News", text: "https://news.site/story", url: "" })
  assert.deepEqual(link, [{ kind: "link", url: "https://news.site/story", name: "Big News" }])
  // words around a link: a shortcut plus a note
  const both = R.planReceived({ title: "", text: "You have to see this https://a.com/x", url: "" })
  assert.deepEqual(both.map((p) => p.kind), ["link", "note"])
  assert.equal(both[1].text, "You have to see this")
  // just words
  const words = R.planReceived({ title: "", text: "Pick up the cake", url: "" })
  assert.deepEqual(words, [{ kind: "note", text: "Pick up the cake", name: "Pick up the cake" }])
  // url field wins and the text that repeats the title isn't a note
  const dup = R.planReceived({ title: "Hello", text: "Hello", url: "https://h.com" })
  assert.deepEqual(dup.map((p) => p.kind), ["link"])
  assert.deepEqual(R.planReceived({}), [])
})

test("planPastedText", () => {
  assert.deepEqual(R.planPastedText("https://example.com/a"), { kind: "link", url: "https://example.com/a", name: "example.com" })
  assert.deepEqual(R.planPastedText("hello https://x.com"), { kind: "note", text: "hello https://x.com", name: "Pasted Text" })
  assert.equal(R.planPastedText("   "), null)
})
