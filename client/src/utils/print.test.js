// node --test client/src/utils/print.test.js
import { test } from "node:test"
import assert from "node:assert/strict"
import { escapeHtml, pictureHtml, printDocument, textHtml } from "./print.js"

// just enough of a DOM for printDocument
const fakeWindow = ({ throws = false } = {}) => {
  const make = (tag) => {
    const el = {
      tag,
      children: [],
      className: "",
      textContent: "",
      innerHTML: "",
      attrs: {},
      parent: null,
      setAttribute(k, v) {
        el.attrs[k] = v
      },
      append(...kids) {
        kids.forEach((k) => el.appendChild(k))
      },
      appendChild(k) {
        k.parent = el
        el.children.push(k)
        return k
      },
      remove() {
        if (el.parent) el.parent.children = el.parent.children.filter((c) => c !== el)
        el.parent = null
      },
    }
    return el
  }
  const classes = new Set()
  const body = make("body")
  body.classList = { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) }
  const listeners = {}
  const win = {
    printed: 0,
    document: { title: "98ish", body, createElement: make },
    addEventListener: (t, fn) => (listeners[t] = fn),
    removeEventListener: (t, fn) => listeners[t] === fn && delete listeners[t],
    print() {
      if (throws) throw new Error("no printing here")
      win.printed++
      // what's on paper right now
      win.paper = { classes: [...classes], title: win.document.title, areas: body.children.map((c) => c.className), html: body.children.at(-1)?.children[1]?.innerHTML, css: body.children.at(-1)?.children[0]?.textContent }
    },
    fire: (t) => listeners[t]?.(),
  }
  return win
}

test("text from users is escaped before it goes on paper", () => {
  assert.equal(escapeHtml(`<b>"Tom" & 'Jerry'</b>`), "&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;")
  assert.match(textHtml("NOTES.TXT", "a < b\nline 2"), /<pre class="os-printText">a &lt; b\nline 2<\/pre>/)
  assert.match(pictureHtml("data:image/png;base64,AAA=", 'my "pic"'), /alt="my &quot;pic&quot;"/)
})

test("printDocument prints the document's own copy, with its title and print-only styles, then cleans up", () => {
  const win = fakeWindow()
  assert.equal(printDocument({ title: "Letter.rtf", html: "<p>Hi</p>", css: ".x{color:red}", page: "size: letter" }, win), true)
  assert.equal(win.printed, 1)
  assert.deepEqual(win.paper.classes, ["os-printing"], "everything but the copy is hidden while printing")
  assert.equal(win.paper.title, "Letter.rtf", "the title names the PDF")
  assert.deepEqual(win.paper.areas, ["os-print"])
  assert.equal(win.paper.html, "<p>Hi</p>")
  assert.match(win.paper.css, /^@media print \{ @page \{ size: letter \} \.x\{color:red\} \}$/)
  win.fire("afterprint")
  assert.equal(win.document.body.children.length, 0, "the copy goes after printing")
  assert.equal(win.document.title, "98ish", "and the page's title comes back")
  assert.equal(win.document.body.classList.contains("os-printing"), false)
})

test("a second print replaces a copy whose afterprint never came", () => {
  const win = fakeWindow()
  printDocument({ title: "One", html: "1" }, win)
  printDocument({ title: "Two", html: "2" }, win)
  assert.equal(win.document.body.children.length, 1)
  assert.equal(win.paper.html, "2")
})

test("a browser that can't print says so and leaves nothing behind", () => {
  const win = fakeWindow({ throws: true })
  assert.equal(printDocument({ title: "X", html: "x" }, win), false)
  assert.equal(win.document.body.children.length, 0)
  assert.equal(win.document.title, "98ish")
  assert.equal(printDocument({ title: "X" }, { document: {} }), false, "no body, no print()")
})
