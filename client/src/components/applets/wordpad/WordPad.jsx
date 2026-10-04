import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import FileDialog from "../notepad/FileDialog"
import { useFloating } from "../../../hooks/useFloating"
import { fs, readContent, writeAndSave } from "../../../utils/fs"
import { useFsVersion } from "../../../hooks/useFs"
import { trackUnsaved } from "../../../utils/unsaved"
import { now } from "../../../utils/clock"
import { sanitizeHtml, textToHtml, htmlToText } from "./sanitize"
import { ICONS } from "./WordPadIcons"
import { sendToItems } from "../../../utils/share"
import { PASTE_BLOCKED, copyText } from "../../../utils/systemClipboard"
import { safeFileName } from "../../../utils/shareRules"
import { richTextPage } from "../../../utils/fileTransfer"
import "./WordPad.css"
import { helpItem } from "../../../utils/help"
import { useDisclosure } from "../../../utils/disclosure"

// WordPad, as in Windows 98: a rich text editor with a toolbar, a format bar (font, size,
// bold/italic/underline, color, alignment, bullets), a ruler and a status bar; Font,
// Paragraph and Date/Time dialogs; Find and Replace; pictures from Paint (Insert > Object);
// Print and Print Preview. Documents are saved as Rich Text Documents (cleaned-up HTML) or
// as plain text documents. Everything that comes in is cleaned by sanitize.js first.

const PREFS_KEY = "98ish.wordpad"
const DEFAULT_PREFS = { toolbar: true, formatBar: true, ruler: true, statusBar: true }
const FONTS = ["Arial", "Times New Roman", "Courier New", "Comic Sans MS", "Georgia", "Verdana", "Tahoma", "Trebuchet MS", "Impact", "Lucida Console"]
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72]
const COLORS = [
  ["Black", "#000000"], ["Maroon", "#800000"], ["Green", "#008000"], ["Olive", "#808000"],
  ["Navy", "#000080"], ["Purple", "#800080"], ["Teal", "#008080"], ["Gray", "#808080"],
  ["Silver", "#c0c0c0"], ["Red", "#ff0000"], ["Lime", "#00ff00"], ["Yellow", "#ffff00"],
  ["Blue", "#0000ff"], ["Fuchsia", "#ff00ff"], ["Aqua", "#00ffff"], ["White", "#ffffff"],
]
const TYPES = [
  { value: "rich", label: "Rich Text Format (RTF)" },
  { value: "text", label: "Text Document" },
]
const BLOCKS = "p, div, li, h1, h2, h3, blockquote"
const SENTINEL = "wp-pending-font"
const EMPTY = "<p><br></p>"

const loadPrefs = () => {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY)) }
  } catch {
    return DEFAULT_PREFS
  }
}

// still on the drive (not deleted, not in the Recycle Bin)?
const onDrive = (file) => !!file && fs.partsOf(file)[0] === "C:" && fs.resolve(fs.partsOf(file)) === file
const isDocument = (item) => item.type === "richtext" || item.isText

// the date and time, in the formats WordPad offers
const dateFormats = () => {
  const d = now()
  const pad = (n) => String(n).padStart(2, "0")
  return [
    d.toLocaleDateString("en-US"),
    `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`,
    `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${String(d.getFullYear()).slice(2)}`,
    `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`,
    `${String(d.getFullYear()).slice(2)}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`,
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    `${pad(d.getDate())}-${d.toLocaleDateString("en-US", { month: "short" })}-${String(d.getFullYear()).slice(2)}`,
    d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
    d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }),
    d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }),
  ]
}

// ---- selections as character offsets (for undo and Find) ----

const offsetOf = (root, node, offset) => {
  const r = document.createRange()
  r.selectNodeContents(root)
  try {
    r.setEnd(node, offset)
  } catch {
    return 0
  }
  return r.toString().length
}

const textNodes = (root) => {
  const out = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) out.push(walker.currentNode)
  return out
}

// a character offset -> a spot in the document
const pointAt = (root, index) => {
  let left = index
  const nodes = textNodes(root)
  for (const node of nodes) {
    if (left <= node.nodeValue.length) return [node, left]
    left -= node.nodeValue.length
  }
  const last = nodes.at(-1)
  return last ? [last, last.nodeValue.length] : [root, root.childNodes.length]
}

const rangeFor = (root, start, end) => {
  const r = document.createRange()
  r.setStart(...pointAt(root, start))
  r.setEnd(...pointAt(root, end))
  return r
}

const pxToInches = (px) => Math.round((parseFloat(px) / 96) * 100) / 100 || 0

const WordPad = ({ file: initialFile = null, mobile = false, onTitle, onClose, registerCloseGuard }) => {
  useFsVersion()
  const [file, setFile] = useState(initialFile)
  const [format, setFormat] = useState(initialFile && initialFile.type !== "richtext" ? "text" : "rich")
  const [dirty, setDirty] = useState(false)
  const [prefs, setPrefsState] = useState(loadPrefs)
  // the Format Bar: behind Aa (and View > Format Bar), as in the IM window; closed until
  // someone opens it, then remembered per user (docs/simplicity.md)
  const [formatBar, setFormatBar] = useDisclosure("wordpad.format", false)
  const [fmt, setFmt] = useState({ font: "Arial", size: 10, bold: false, italic: false, underline: false, align: "left", bullets: false })
  const [dialog, setDialog] = useState(null)
  const [find, setFind] = useState(null)
  const [colorMenu, setColorMenu] = useState(null) // { left, top } while open
  const [preview, setPreview] = useState(null) // { html, page, zoom }
  const [printHtml, setPrintHtml] = useState(null)
  const [saveType, setSaveType] = useState("rich")
  const edRef = useRef(null)
  const findBox = useFloating() // Find / Replace drags anywhere, like a real dialog
  const savedHtml = useRef("")
  const savedRange = useRef(null)
  const history = useRef({ undo: [], redo: [] })
  const typing = useRef({ active: false, timer: 0 })
  const lastFind = useRef({ query: "", matchCase: false, wholeWord: false })
  const afterSave = useRef(null)
  const dragging = useRef(false)
  const live = useRef({})

  const name = file ? file.name : "Document"
  live.current = { dirty, name }
  const ed = () => edRef.current

  useEffect(() => onTitle?.(`${name} - WordPad`), [name])
  useEffect(() => (dirty ? trackUnsaved("WordPad") : undefined), [dirty])

  const setPrefs = (patch) =>
    setPrefsState((current) => {
      const next = { ...current, ...patch }
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next))
      } catch {
        // storage unavailable
      }
      return next
    })

  // ---- the document ----

  const loadHtml = (html) => {
    const el = ed()
    el.innerHTML = html || EMPTY
    savedHtml.current = el.innerHTML
    history.current = { undo: [], redo: [] }
    setDirty(false)
    const r = document.createRange()
    r.setStart(...pointAt(el, 0))
    r.collapse(true)
    savedRange.current = r
    readFormat()
  }

  const htmlOf = (item) => (item.type === "richtext" ? sanitizeHtml(item.textContent) : textToHtml(item.textContent))

  const [loading, setLoading] = useState(false)
  useLayoutEffect(() => {
    // a big document that isn't loaded yet opens once it is (typing stays off meanwhile)
    if (initialFile && !initialFile.loaded) {
      loadHtml(EMPTY)
      setLoading(true)
      readContent(initialFile).then(() => {
        setLoading(false)
        loadHtml(htmlOf(initialFile))
      })
    } else loadHtml(initialFile ? htmlOf(initialFile) : EMPTY)
    try {
      document.execCommand("defaultParagraphSeparator", false, "p")
    } catch {}
    if (!mobile) ed().focus({ preventScroll: true })
  }, [])

  // Keep every line in a paragraph: some browser commands (bullets off, pasting) leave bare
  // text and <br>s at the top level, or empty paragraphs behind
  const tidy = () => {
    const el = ed()
    const sel = window.getSelection()
    const caret = sel.rangeCount && el.contains(sel.anchorNode) ? sel.getRangeAt(0) : null
    const at = caret && [offsetOf(el, caret.startContainer, caret.startOffset), offsetOf(el, caret.endContainer, caret.endOffset)]
    let moved = false
    let run = null
    for (const node of [...el.childNodes]) {
      if (node.nodeType === 1 && /^(P|DIV|UL|OL|H1|H2|H3|BLOCKQUOTE)$/.test(node.tagName)) {
        run = null
        if (!node.childNodes.length) {
          if (caret && caret.startContainer === node) node.appendChild(document.createElement("br"))
          else node.remove()
          moved = true
        }
        continue
      }
      if (node.nodeType === 3 && !node.nodeValue) {
        node.remove()
        continue
      }
      moved = true
      if (!run) {
        run = document.createElement("p")
        el.insertBefore(run, node)
      }
      // a top-level <br> ends its line (or is the whole line, if it's empty)
      if (node.nodeName === "BR") {
        if (run.childNodes.length) node.remove()
        else run.appendChild(node)
        run = null
        continue
      }
      run.appendChild(node)
    }
    if (!el.childNodes.length) {
      el.innerHTML = EMPTY
      moved = true
    }
    if (moved && at) {
      const r = rangeFor(el, ...at)
      sel.removeAllRanges()
      sel.addRange(r)
      savedRange.current = r.cloneRange()
    }
  }

  const changed = () => {
    const el = ed()
    if (!el) return
    setDirty(el.innerHTML !== savedHtml.current)
    readFormat()
  }

  // what the format bar shows for the text at the cursor
  const readFormat = () => {
    const el = ed()
    const sel = window.getSelection()
    if (!el || !sel?.rangeCount || !el.contains(sel.anchorNode)) return
    let node = sel.anchorNode
    if (node.nodeType === 3) node = node.parentElement
    const cs = getComputedStyle(node)
    const block = node.closest(BLOCKS)
    const q = (cmd) => {
      try {
        return document.queryCommandState(cmd)
      } catch {
        return false
      }
    }
    setFmt({
      font: cs.fontFamily.split(",")[0].replace(/["']/g, "").trim(),
      size: Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2,
      bold: q("bold"),
      italic: q("italic"),
      underline: q("underline"),
      align: block && el.contains(block) ? getComputedStyle(block).textAlign.replace("start", "left").replace("end", "right") : "left",
      bullets: !!node.closest("ul") && el.contains(node.closest("ul")),
    })
  }

  // remember the selection, so the format bar and dialogs can act on it after taking focus
  useEffect(() => {
    const onSel = () => {
      const el = ed()
      const sel = window.getSelection()
      if (!el || !sel?.rangeCount) return
      const r = sel.getRangeAt(0)
      if (!el.contains(r.commonAncestorContainer)) return
      savedRange.current = r.cloneRange()
      readFormat()
    }
    document.addEventListener("selectionchange", onSel)
    return () => document.removeEventListener("selectionchange", onSel)
  }, [])

  const restoreSel = () => {
    const el = ed()
    el.focus({ preventScroll: true })
    const r = savedRange.current
    if (r && el.contains(r.commonAncestorContainer)) {
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(r)
    }
  }

  // ---- undo (our own, since we change the document ourselves too) ----

  const snapshot = () => {
    const el = ed()
    const r = savedRange.current
    const inside = r && el.contains(r.commonAncestorContainer)
    return { html: el.innerHTML, start: inside ? offsetOf(el, r.startContainer, r.startOffset) : 0, end: inside ? offsetOf(el, r.endContainer, r.endOffset) : 0 }
  }

  const record = () => {
    const h = history.current
    const s = snapshot()
    if (h.undo.at(-1)?.html !== s.html) h.undo.push(s)
    if (h.undo.length > 100) h.undo.shift()
    h.redo = []
    typing.current.active = false
  }

  const restore = (s) => {
    const el = ed()
    el.innerHTML = s.html
    el.focus({ preventScroll: true })
    const r = rangeFor(el, s.start, s.end)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(r)
    savedRange.current = r.cloneRange()
    changed()
  }

  const undo = () => {
    const h = history.current
    const current = snapshot()
    while (h.undo.length && h.undo.at(-1).html === current.html) h.undo.pop()
    const prev = h.undo.pop()
    if (!prev) return
    h.redo.push(current)
    typing.current.active = false
    restore(prev)
  }

  const redo = () => {
    const h = history.current
    const next = h.redo.pop()
    if (!next) return
    h.undo.push(snapshot())
    restore(next)
  }

  // typing: one undo step per burst
  useEffect(() => {
    const el = ed()
    const before = () => {
      const t = typing.current
      if (!t.active) {
        record()
        t.active = true
      }
      clearTimeout(t.timer)
      t.timer = setTimeout(() => (t.active = false), 1000)
    }
    const input = (e) => {
      if (!e.isComposing && [...el.childNodes].some((n) => n.nodeType === 3 || n.nodeName === "BR")) tidy()
      changed()
    }
    el.addEventListener("beforeinput", before)
    el.addEventListener("input", input)
    return () => {
      el.removeEventListener("beforeinput", before)
      el.removeEventListener("input", input)
      clearTimeout(typing.current.timer)
    }
  }, [])

  // ---- formatting ----

  const exec = (cmd, value = null) => {
    restoreSel()
    record()
    try {
      document.execCommand("styleWithCSS", false, false)
      document.execCommand(cmd, false, value)
      tidy()
    } catch {}
    changed()
  }

  const setFont = (family) => {
    restoreSel()
    record()
    document.execCommand("styleWithCSS", false, false)
    document.execCommand("fontName", false, SENTINEL)
    for (const f of ed().querySelectorAll(`font[face="${SENTINEL}"]`)) {
      f.setAttribute("face", family)
      for (const inner of f.querySelectorAll("[face], [style*='font-family']")) {
        inner.removeAttribute("face")
        inner.style.fontFamily = ""
      }
    }
    changed()
  }

  const setSize = (pt) => {
    restoreSel()
    record()
    document.execCommand("styleWithCSS", false, false)
    document.execCommand("fontSize", false, "7")
    for (const f of ed().querySelectorAll('font[size="7"]')) {
      f.removeAttribute("size")
      f.style.fontSize = `${pt}pt`
      for (const inner of f.querySelectorAll("[size], [style*='font-size']")) {
        inner.removeAttribute("size")
        inner.style.fontSize = ""
      }
    }
    changed()
  }

  // the paragraphs the selection touches (making one if the text has none)
  const selectedBlocks = () => {
    const el = ed()
    const r = savedRange.current
    if (!r || !el.contains(r.commonAncestorContainer)) return []
    const leaf = (b) => !b.querySelector(BLOCKS)
    let blocks = [...el.querySelectorAll(BLOCKS)].filter((b) => leaf(b) && r.intersectsNode(b))
    if (!blocks.length) {
      restoreSel()
      document.execCommand("formatBlock", false, "p")
      const sel = window.getSelection()
      if (sel.rangeCount) savedRange.current = sel.getRangeAt(0).cloneRange()
      const r2 = savedRange.current
      blocks = [...el.querySelectorAll(BLOCKS)].filter((b) => leaf(b) && r2.intersectsNode(b))
    }
    return blocks
  }

  const paragraph = ({ left, right, first, align }) => {
    restoreSel()
    record()
    for (const b of selectedBlocks()) {
      b.style.marginLeft = left ? `${left}in` : ""
      b.style.marginRight = right ? `${right}in` : ""
      b.style.textIndent = first ? `${first}in` : ""
      b.style.textAlign = align === "left" ? "" : align
      b.removeAttribute("align")
    }
    changed()
  }

  const align = (how) => exec(how === "left" ? "justifyLeft" : how === "center" ? "justifyCenter" : "justifyRight")

  const applyFontDialog = (f) => {
    setFont(f.font)
    setSize(f.size)
    const q = (cmd) => document.queryCommandState(cmd)
    for (const [cmd, want] of [
      ["bold", f.bold],
      ["italic", f.italic],
      ["underline", f.underline],
      ["strikeThrough", f.strike],
    ]) {
      if (q(cmd) !== want) document.execCommand(cmd)
    }
    if (f.color) document.execCommand("foreColor", false, f.color)
    changed()
  }

  // ---- inserting ----

  const insertHtml = (html) => {
    restoreSel()
    record()
    document.execCommand("insertHTML", false, html)
    tidy()
    changed()
  }

  const insertText = (text) => {
    restoreSel()
    record()
    if (!document.execCommand("insertText", false, text)) {
      const r = window.getSelection().getRangeAt(0)
      r.deleteContents()
      r.insertNode(document.createTextNode(text))
    }
    changed()
  }

  const insertPicture = (src) => {
    const clean = sanitizeHtml(`<img src="${src.replace(/"/g, "")}" alt="">`)
    if (!clean) return setDialog({ kind: "alert", text: "WordPad can't insert that picture." })
    insertHtml(clean)
  }

  const pasteData = (data) => {
    const imageFile = [...(data.files || [])].find((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type))
    const html = data.getData("text/html")
    const text = data.getData("text/plain")
    if (html) return insertHtml(sanitizeHtml(html, { collapse: true }))
    if (text) return insertText(text)
    if (imageFile) {
      if (imageFile.size > 1500000) return setDialog({ kind: "alert", text: "That picture is too big to paste into WordPad." })
      const reader = new FileReader()
      reader.onload = () => insertPicture(String(reader.result))
      reader.readAsDataURL(imageFile)
    }
  }

  const onPaste = (e) => {
    e.preventDefault()
    pasteData(e.clipboardData)
  }

  const onDrop = (e) => {
    if (dragging.current) return // moving text within the document
    e.preventDefault()
    const caret = document.caretRangeFromPoint?.(e.clientX, e.clientY)
    if (caret && ed().contains(caret.startContainer)) savedRange.current = caret
    pasteData(e.dataTransfer)
  }

  const pasteMenu = async () => {
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read()
        for (const item of items) {
          if (item.types.includes("text/html")) return insertHtml(sanitizeHtml(await (await item.getType("text/html")).text(), { collapse: true }))
        }
      }
      const text = await navigator.clipboard.readText()
      insertText(text)
    } catch {
      setDialog({ kind: "alert", text: PASTE_BLOCKED })
    }
  }

  const clipboard = (cmd) => {
    restoreSel()
    if (cmd === "cut") record()
    let ok = false
    try {
      ok = document.execCommand(cmd)
    } catch {}
    // the copy command refused (some browsers, outside a key press): the system
    // clipboard still gets the words, so they paste in other apps
    if (!ok) {
      const words = window.getSelection()?.toString() || ""
      if (words) {
        copyText(words)
        if (cmd === "cut") document.execCommand("delete")
      }
    }
    changed()
  }

  const selectAll = () => {
    const el = ed()
    el.focus({ preventScroll: true })
    const r = document.createRange()
    r.selectNodeContents(el)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(r)
    savedRange.current = r.cloneRange()
  }

  // ---- find / replace ----

  const plainText = () => textNodes(ed()).map((n) => n.nodeValue).join("")

  const matchAt = (hay, needle, from, { matchCase, wholeWord }) => {
    const h = matchCase ? hay : hay.toLowerCase()
    const n = matchCase ? needle : needle.toLowerCase()
    for (let at = h.indexOf(n, from); at >= 0; at = h.indexOf(n, at + 1)) {
      if (!wholeWord || (!/\w/.test(hay[at - 1] || "") && !/\w/.test(hay[at + needle.length] || ""))) return at
    }
    return -1
  }

  const findNext = (opts = lastFind.current, { quiet = false } = {}) => {
    const { query } = opts
    if (!query) return false
    lastFind.current = { ...lastFind.current, ...opts }
    const el = ed()
    const r = savedRange.current
    const from = r && el.contains(r.commonAncestorContainer) ? offsetOf(el, r.endContainer, r.endOffset) : 0
    const hay = plainText()
    const at = matchAt(hay, query, from, opts)
    if (at < 0) {
      if (!quiet) setDialog({ kind: "alert", text: "WordPad has finished searching the document." })
      return false
    }
    const range = rangeFor(el, at, at + query.length)
    const sel = window.getSelection()
    el.focus({ preventScroll: true })
    sel.removeAllRanges()
    sel.addRange(range)
    savedRange.current = range.cloneRange()
    const box = range.getBoundingClientRect()
    const scroller = el.closest(".wpScroll")
    const area = scroller.getBoundingClientRect()
    if (box.top < area.top || box.bottom > area.bottom) scroller.scrollTop += box.top - area.top - area.height / 3
    return true
  }

  const selectionMatches = ({ query, matchCase }) => {
    const sel = String(savedRange.current || "")
    return matchCase ? sel === query : sel.toLowerCase() === query.toLowerCase()
  }

  const replaceOne = () => {
    if (!find.query) return
    if (selectionMatches(find)) insertText(find.replace || "")
    findNext({ query: find.query, matchCase: find.matchCase, wholeWord: find.wholeWord })
  }

  const replaceAll = () => {
    const { query, replace = "" } = find
    if (!query) return
    const el = ed()
    const hay = plainText()
    const spots = []
    for (let at = matchAt(hay, query, 0, find); at >= 0; at = matchAt(hay, query, at + query.length, find)) spots.push(at)
    if (!spots.length) return setDialog({ kind: "alert", text: "WordPad has finished searching the document." })
    restoreSel()
    record()
    // back to front, so earlier offsets stay put
    for (const at of spots.reverse()) {
      const r = rangeFor(el, at, at + query.length)
      r.deleteContents()
      if (replace) r.insertNode(document.createTextNode(replace))
    }
    el.normalize()
    changed()
    setDialog({ kind: "alert", text: `WordPad has finished searching the document. ${spots.length} replaced.` })
  }

  const openFind = (mode) => {
    const r = savedRange.current
    const picked = r && !r.collapsed && String(r).length < 60 ? String(r) : lastFind.current.query
    setFind({ mode, query: picked, replace: "", matchCase: lastFind.current.matchCase, wholeWord: lastFind.current.wholeWord })
  }

  const closeFind = () => {
    setFind(null)
    requestAnimationFrame(() => restoreSel())
  }

  // ---- files ----

  const tooBig = () =>
    setDialog({ kind: "alert", text: "There isn't enough room on the 98ish drive to save this document. Try removing some pictures, or delete some files and try again." })

  const contentAs = (as) => (as === "text" ? htmlToText(ed().innerHTML) : sanitizeHtml(ed().innerHTML))

  const markSaved = () => {
    savedHtml.current = ed().innerHTML
    setDirty(false)
    setDialog(null)
    const next = afterSave.current
    afterSave.current = null
    next?.()
  }

  const writeTo = async (dir, fileName, as = saveType, confirmed = false) => {
    if (as === "text" && format === "rich" && !confirmed) return setDialog({ kind: "textOnly", dir, fileName })
    const content = contentAs(as)
    const type = as === "text" ? "text" : "richtext"
    try {
      let target = dir.getItem(fileName)
      let ok
      if (target && isDocument(target) && (target.type === "richtext") === (as === "rich")) ok = await writeAndSave(target, content)
      else {
        if (target) {
          // replacing a document of the other kind
          if (!isDocument(target)) throw new Error(`'${fileName}' can't be replaced.`)
          dir.removeItem(fileName)
        }
        target = fs.createFileIn(dir, fileName, type, "")
        ok = await writeAndSave(target, content, { created: true })
      }
      if (!ok) {
        afterSave.current = null
        return tooBig()
      }
      setFile(target)
      setFormat(as)
      markSaved()
    } catch (error) {
      afterSave.current = null
      setDialog({ kind: "alert", text: error.message })
    }
  }

  const saveAs = () => {
    setSaveType(format)
    setDialog({ kind: "saveAs" })
  }

  const save = async () => {
    if (onDrive(file) && isDocument(file)) {
      if (!(await writeAndSave(file, contentAs(file.type === "richtext" ? "rich" : "text")))) {
        afterSave.current = null
        return tooBig()
      }
      return markSaved()
    }
    saveAs()
  }

  // run `then` now, or after asking about unsaved changes
  const guard = (then) => {
    if (!dirty) return then()
    afterSave.current = then
    setDialog({ kind: "changed" })
  }

  const newDocument = (as) => {
    setFile(null)
    setFormat(as)
    loadHtml(EMPTY)
    setDialog(null)
    requestAnimationFrame(() => restoreSel())
  }

  const openFile = async (target) => {
    if (!target.loaded) {
      setDialog(null)
      setLoading(true)
      await readContent(target)
      setLoading(false)
    }
    setFile(target)
    setFormat(target.type === "richtext" ? "rich" : "text")
    loadHtml(htmlOf(target))
    setDialog(null)
    requestAnimationFrame(() => restoreSel())
  }

  // closing the window with unsaved changes asks first
  useEffect(() => {
    if (!registerCloseGuard) return
    return registerCloseGuard(() => {
      if (!live.current.dirty) return true
      afterSave.current = () => onClose?.()
      setDialog({ kind: "changed" })
      return false
    })
  }, [registerCloseGuard])

  // back to the document once a menu or dialog is done (keyboard shortcuts keep working)
  useEffect(() => {
    if (!dialog && !find && !preview && !mobile && (document.activeElement === document.body || !document.activeElement)) restoreSel()
  }, [dialog, find, preview, prefs])

  // ---- printing ----

  const print = () => {
    setPrintHtml(sanitizeHtml(ed().innerHTML))
    setDialog(null)
  }

  // once the print-only copy is on the page, open the browser's print dialog
  useEffect(() => {
    if (printHtml === null) return
    const done = () => setPrintHtml(null)
    window.addEventListener("afterprint", done)
    const id = requestAnimationFrame(() => {
      try {
        window.print()
      } catch {}
    })
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener("afterprint", done)
    }
  }, [printHtml])

  // Send To: the document as a web page any phone opens; Other Apps gets its words
  const sharePayload = () => {
    const title = file?.name || "Document"
    const html = sanitizeHtml(ed().innerHTML)
    return { title, text: htmlToText(ed().innerHTML).trim(), preferText: true, files: [{ name: safeFileName(title.replace(/\.(rtf|doc|html?)$/i, ""), ".html"), data: richTextPage(title, html), mime: "text/html" }] }
  }

  const openPreview = () => setPreview({ html: sanitizeHtml(ed().innerHTML), page: 0, zoom: false })

  // ---- keys ----

  const onKeyDown = (e) => {
    if (e.target.closest?.(".dialog, .wpFind")) return
    const ctrl = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    const inDoc = e.target === ed()
    const run = (fn) => (e.preventDefault(), fn())
    if (e.key === "F3") return run(() => findNext())
    if (ctrl && key === "s") return run(save)
    if (ctrl && key === "o") return run(() => guard(() => setDialog({ kind: "open" })))
    if (ctrl && key === "n") return run(() => guard(() => setDialog({ kind: "new" })))
    if (ctrl && key === "p") return run(() => setDialog({ kind: "print" }))
    if (ctrl && key === "f") return run(() => openFind("find"))
    if (ctrl && key === "h") return run(() => openFind("replace"))
    if (!inDoc) return
    if (ctrl && key === "z") return run(e.shiftKey ? redo : undo)
    if (ctrl && key === "y") return run(redo)
    if (ctrl && key === "b") return run(() => exec("bold"))
    if (ctrl && key === "i") return run(() => exec("italic"))
    if (ctrl && key === "u") return run(() => exec("underline"))
    if (ctrl && key === "e") return run(() => align("center"))
    if (ctrl && key === "l") return run(() => align("left"))
    if (ctrl && key === "r") return run(() => align("right"))
    if (e.key === "Tab" && !ctrl && !e.altKey) return run(() => insertText("\t"))
  }

  // toolbar buttons keep the document's selection (no focus steal on mouse down)
  const keep = (e) => e.preventDefault()

  const fontDialog = () => {
    setDialog({ kind: "font", font: { font: fmt.font, size: fmt.size, bold: fmt.bold, italic: fmt.italic, underline: fmt.underline, strike: !!document.queryCommandState?.("strikeThrough"), color: "" } })
  }

  const paragraphDialog = () => {
    const el = ed()
    const r = savedRange.current
    let block = r && el.contains(r.startContainer) ? (r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer).closest(BLOCKS) : null
    if (block && !el.contains(block)) block = null
    const cs = block ? getComputedStyle(block) : null
    setDialog({
      kind: "paragraph",
      p: {
        left: cs ? String(pxToInches(cs.marginLeft)) : "0",
        right: cs ? String(pxToInches(cs.marginRight)) : "0",
        first: cs ? String(pxToInches(cs.textIndent)) : "0",
        align: fmt.align,
      },
    })
  }

  const menus = [
    {
      label: "File",
      items: [
        { label: "New... Ctrl+N", onClick: () => guard(() => setDialog({ kind: "new" })) },
        { label: "Open... Ctrl+O", onClick: () => guard(() => setDialog({ kind: "open" })) },
        { label: "Save Ctrl+S", onClick: save },
        { label: "Save As...", onClick: saveAs },
        "-",
        { label: "Print... Ctrl+P", onClick: () => setDialog({ kind: "print" }) },
        { label: "Print Preview", onClick: openPreview },
        { label: "Page Setup...", onClick: () => setDialog({ kind: "alert", text: "Pages are Letter size (8.5 x 11 in.) with 1 in. margins at the top and bottom and 1.25 in. at the sides. Your browser's print dialog can change the paper and margins." }) },
        "-",
        { label: "Send To", items: sendToItems(sharePayload, { title: "WordPad" }) },
        "-",
        { label: "Exit", onClick: () => guard(() => onClose?.()) },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo Ctrl+Z", onClick: undo },
        { label: "Redo Ctrl+Y", onClick: redo },
        "-",
        { label: "Cut Ctrl+X", onClick: () => clipboard("cut") },
        { label: "Copy Ctrl+C", onClick: () => clipboard("copy") },
        { label: "Paste Ctrl+V", onClick: pasteMenu },
        { label: "Clear Del", onClick: () => exec("delete") },
        { label: "Select All", onClick: selectAll },
        "-",
        { label: "Find... Ctrl+F", onClick: () => openFind("find") },
        { label: "Find Next F3", onClick: () => findNext() },
        { label: "Replace... Ctrl+H", onClick: () => openFind("replace") },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Toolbar", checked: prefs.toolbar, onClick: () => setPrefs({ toolbar: !prefs.toolbar }) },
        { label: "Format Bar", checked: formatBar, onClick: () => setFormatBar(!formatBar) },
        { label: "Ruler", checked: prefs.ruler, onClick: () => setPrefs({ ruler: !prefs.ruler }) },
        { label: "Status Bar", checked: prefs.statusBar, onClick: () => setPrefs({ statusBar: !prefs.statusBar }) },
      ],
    },
    {
      label: "Insert",
      items: [
        { label: "Date and Time...", onClick: () => setDialog({ kind: "date", formats: dateFormats(), pick: 0 }) },
        { label: "Object...", onClick: () => setDialog({ kind: "object" }) },
      ],
    },
    {
      label: "Format",
      items: [
        { label: "Font...", onClick: fontDialog },
        { label: "Bullet Style", checked: fmt.bullets, onClick: () => exec("insertUnorderedList") },
        { label: "Paragraph...", onClick: paragraphDialog },
      ],
    },
    {
      label: "Help",
      items: [helpItem({ program: "WordPad" }), "-",
        {
          label: "About WordPad",
          onClick: () =>
            setDialog({ kind: "alert", title: "About WordPad", text: "WordPad for 98ish. Fonts, colors, bullets and pictures from Paint (Insert > Object). Save as a Rich Text Document to keep the formatting." }),
        },
      ],
    },
  ]

  // extra: a tool phones leave to the menus (docs/simplicity.md)
  const tool = (icon, label, onClick, active, extra = false) => (
    <button type="button" className={`wpTool${active ? " is-active" : ""}${extra ? " wpTool--extra" : ""}`} aria-label={label} title={label} aria-pressed={active === undefined ? undefined : !!active} onMouseDown={keep} onClick={onClick}>
      {ICONS[icon] || icon}
    </button>
  )

  const sizeOptions = SIZES.includes(fmt.size) ? SIZES : [...SIZES, fmt.size].sort((a, b) => a - b)
  const fontOptions = FONTS.includes(fmt.font) ? FONTS : [fmt.font, ...FONTS]

  return (
    <div className={mobile ? "wpRoot wpRoot--mobile" : "wpRoot"} onKeyDown={onKeyDown}>
      <MenuBar menus={menus} />

      {prefs.toolbar && (
        <div className="wpBar" role="toolbar" aria-label="Toolbar">
          {tool("new", "New", () => guard(() => setDialog({ kind: "new" })))}
          {tool("open", "Open", () => guard(() => setDialog({ kind: "open" })))}
          {tool("save", "Save", save)}
          <span className="wpSep" />
          {tool("print", "Print", print)}
          {tool("preview", "Print Preview", openPreview, undefined, true)}
          <span className="wpSep" />
          {tool("find", "Find", () => openFind("find"))}
          <span className="wpSep" />
          {tool("cut", "Cut", () => clipboard("cut"), undefined, true)}
          {tool("copy", "Copy", () => clipboard("copy"), undefined, true)}
          {tool("paste", "Paste", pasteMenu, undefined, true)}
          {tool("undo", "Undo", undo)}
          <span className="wpSep wpTool--extra" />
          {tool("datetime", "Date/Time", () => setDialog({ kind: "date", formats: dateFormats(), pick: 0 }), undefined, true)}
          <span className="wpSep" />
          {/* Aa shows the Format Bar (font, size, B/I/U, color, alignment, bullets), as in the IM window */}
          <button type="button" className={`wpTool wpAa${formatBar ? " is-active" : ""}`} aria-label="Format Bar" title="Format Bar" aria-expanded={formatBar} onMouseDown={keep} onClick={() => setFormatBar(!formatBar)}>
            Aa
          </button>
        </div>
      )}

      {formatBar && (
        <div className="wpBar wpFormatBar" role="toolbar" aria-label="Format Bar">
          <select className="wpFontSelect" aria-label="Font" value={fmt.font} onChange={(e) => setFont(e.target.value)}>
            {fontOptions.map((f) => (
              <option key={f} value={f} style={{ fontFamily: f }}>
                {f}
              </option>
            ))}
          </select>
          <select className="wpSizeSelect" aria-label="Font Size" value={fmt.size} onChange={(e) => setSize(Number(e.target.value))}>
            {sizeOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <span className="wpSep" />
          {tool(<b>B</b>, "Bold", () => exec("bold"), fmt.bold)}
          {tool(<i style={{ fontFamily: "Times New Roman, serif", fontSize: 13 }}>I</i>, "Italic", () => exec("italic"), fmt.italic)}
          {tool(<u>U</u>, "Underline", () => exec("underline"), fmt.underline)}
          {tool("color", "Color", (e) => {
            if (colorMenu) return setColorMenu(null)
            // drops down under the button (outside the bar, which may scroll on phones)
            const b = e.currentTarget.getBoundingClientRect()
            const root = e.currentTarget.closest(".wpRoot").getBoundingClientRect()
            setColorMenu({ left: Math.max(0, Math.min(b.left - root.left, root.width - 130)), top: b.bottom - root.top })
          })}
          <span className="wpSep" />
          {tool("left", "Align Left", () => align("left"), fmt.align === "left" || fmt.align === "justify")}
          {tool("center", "Center", () => align("center"), fmt.align === "center")}
          {tool("right", "Align Right", () => align("right"), fmt.align === "right")}
          <span className="wpSep" />
          {tool("bullets", "Bullets", () => exec("insertUnorderedList"), fmt.bullets)}
        </div>
      )}

      {prefs.ruler && !preview && (
        <div className="wpRuler" aria-hidden="true">
          <div className="wpRulerTrack">
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} className="wpRulerNum" style={{ left: `${i * 96}px` }}>
                {i || ""}
              </span>
            ))}
          </div>
        </div>
      )}

      {colorMenu && (
        <ul className="window wpColorMenu" role="menu" aria-label="Colors" style={{ left: colorMenu.left, top: colorMenu.top }}>
          {COLORS.map(([label, hex]) => (
            <li key={hex}>
              <button
                type="button"
                role="menuitem"
                onMouseDown={keep}
                onClick={() => {
                  setColorMenu(null)
                  exec("foreColor", hex)
                }}
              >
                <span className="wpSwatch" style={{ background: hex }} />
                {label}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="wpScroll" hidden={!!preview} onPointerDown={() => colorMenu && setColorMenu(null)}>
        <div
          ref={edRef}
          className="wpDoc wpPage"
          contentEditable={!loading}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={`${name} - WordPad`}
          spellCheck="false"
          onPaste={onPaste}
          onDrop={onDrop}
          onDragStart={() => (dragging.current = true)}
          onDragEnd={() => (dragging.current = false)}
          onKeyUp={readFormat}
          onMouseUp={readFormat}
        />
      </div>

      {preview && <Preview preview={preview} setPreview={setPreview} onPrint={() => setDialog({ kind: "print" })} />}

      {prefs.statusBar && (
        <div className="wpStatus" role="status">
          <span>{preview ? `Page ${preview.page + 1}` : "For Help, press F1"}</span>
          <span className="wpStatusRight">{format === "text" ? "Text" : "Rich Text"}</span>
        </div>
      )}

      {printHtml !== null &&
        createPortal(
          <div className="wpPrintArea">
            <div className="wpDoc" dangerouslySetInnerHTML={{ __html: printHtml }} />
          </div>,
          document.body
        )}

      {find && (
        <form
          ref={findBox}
          className="window wpFind"
          onSubmit={(e) => {
            e.preventDefault()
            findNext({ query: find.query, matchCase: find.matchCase, wholeWord: find.wholeWord })
          }}
          onKeyDown={(e) => e.key === "Escape" && closeFind()}
        >
          <div className="title-bar">
            <div className="title-bar-text">{find.mode === "find" ? "Find" : "Replace"}</div>
            <div className="title-bar-controls">
              <button type="button" aria-label="Close" onClick={closeFind} />
            </div>
          </div>
          <div className="window-body wpFindBody">
            <div className="wpFindFields">
              <label>
                Find what:
                <input autoFocus value={find.query} onChange={(e) => setFind({ ...find, query: e.target.value })} />
              </label>
              {find.mode === "replace" && (
                <label>
                  Replace with:
                  <input value={find.replace} onChange={(e) => setFind({ ...find, replace: e.target.value })} />
                </label>
              )}
              <div className="wpFindOptions">
                <input id="wp-word" type="checkbox" checked={!!find.wholeWord} onChange={(e) => setFind({ ...find, wholeWord: e.target.checked })} />
                <label htmlFor="wp-word">Match whole word only</label>
              </div>
              <div className="wpFindOptions">
                <input id="wp-case" type="checkbox" checked={!!find.matchCase} onChange={(e) => setFind({ ...find, matchCase: e.target.checked })} />
                <label htmlFor="wp-case">Match case</label>
              </div>
            </div>
            <div className="wpFindButtons">
              <button type="submit" disabled={!find.query}>
                Find Next
              </button>
              {find.mode === "replace" && (
                <>
                  <button type="button" disabled={!find.query} onClick={replaceOne}>
                    Replace
                  </button>
                  <button type="button" disabled={!find.query} onClick={replaceAll}>
                    Replace All
                  </button>
                </>
              )}
              <button type="button" onClick={closeFind}>
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      {dialog?.kind === "changed" && (
        <Dialog
          title="WordPad"
          sound="chord"
          okLabel="Yes"
          onOk={() => {
            setDialog(null)
            save()
          }}
          onNo={() => {
            setDialog(null)
            savedHtml.current = ed().innerHTML
            setDirty(false)
            const next = afterSave.current
            afterSave.current = null
            next?.()
          }}
          onCancel={() => {
            afterSave.current = null
            setDialog(null)
          }}
        >
          <p className="dialogText">Save changes to {name}?</p>
        </Dialog>
      )}

      {dialog?.kind === "new" && (
        <Dialog title="New" onOk={() => newDocument(dialog.as || "rich")} onCancel={() => setDialog(null)}>
          <label htmlFor="wp-new">New document type:</label>
          <select id="wp-new" size={2} className="wpList" value={dialog.as || "rich"} onChange={(e) => setDialog({ ...dialog, as: e.target.value })} onDoubleClick={() => newDocument(dialog.as || "rich")}>
            <option value="rich">Rich Text Document</option>
            <option value="text">Text Document</option>
          </select>
        </Dialog>
      )}

      {dialog?.kind === "saveAs" && (
        <FileDialog
          mode="save"
          startDir={file && onDrive(file) ? file.parent : null}
          initialName={file ? file.name : "Document"}
          accept={isDocument}
          fileType={saveType === "text" ? "text" : "richtext"}
          types={TYPES}
          type={saveType}
          onTypeChange={setSaveType}
          onPick={(dir, fileName) => writeTo(dir, fileName, saveType)}
          onCancel={() => {
            afterSave.current = null
            setDialog(null)
          }}
        />
      )}

      {dialog?.kind === "textOnly" && (
        <Dialog
          title="WordPad"
          sound="chord"
          okLabel="Yes"
          cancelLabel="No"
          onOk={() => writeTo(dialog.dir, dialog.fileName, "text", true)}
          onCancel={() => {
            afterSave.current = null
            setDialog(null)
          }}
        >
          <p className="dialogText">You are about to save the document in a Text-Only format, which will remove all formatting. Are you sure you want to do this?</p>
        </Dialog>
      )}

      {dialog?.kind === "open" && (
        <FileDialog mode="open" startDir={file && onDrive(file) ? file.parent : null} accept={isDocument} typeLabel="Documents (Rich Text and Text)" fileType="richtext" onPick={openFile} onCancel={() => setDialog(null)} />
      )}

      {dialog?.kind === "object" && (
        <FileDialog
          mode="open"
          startDir={null}
          accept={(item) => item.isImage}
          typeLabel="Bitmap Images (*.png)"
          fileType="image"
          onPick={async (picture) => {
            setDialog(null)
            insertPicture(await readContent(picture))
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "date" && (
        <Dialog
          title="Date/Time"
          onOk={() => {
            const text = dialog.formats[dialog.pick]
            setDialog(null)
            insertText(text)
          }}
          onCancel={() => setDialog(null)}
        >
          <label htmlFor="wp-date">Available formats:</label>
          <select id="wp-date" size={8} className="wpList" value={dialog.pick} onChange={(e) => setDialog({ ...dialog, pick: Number(e.target.value) })}>
            {dialog.formats.map((f, i) => (
              <option key={i} value={i}>
                {f}
              </option>
            ))}
          </select>
        </Dialog>
      )}

      {dialog?.kind === "font" && (
        <Dialog
          title="Font"
          onOk={() => {
            const f = dialog.font
            setDialog(null)
            applyFontDialog(f)
          }}
          onCancel={() => setDialog(null)}
        >
          <div className="wpFontGrid">
            <label>
              Font:
              <select value={dialog.font.font} onChange={(e) => setDialog({ ...dialog, font: { ...dialog.font, font: e.target.value } })}>
                {fontOptions.map((f) => (
                  <option key={f} value={f} style={{ fontFamily: f }}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Font style:
              <select
                value={`${dialog.font.bold ? "b" : ""}${dialog.font.italic ? "i" : ""}`}
                onChange={(e) => setDialog({ ...dialog, font: { ...dialog.font, bold: e.target.value.includes("b"), italic: e.target.value.includes("i") } })}
              >
                <option value="">Regular</option>
                <option value="i">Italic</option>
                <option value="b">Bold</option>
                <option value="bi">Bold Italic</option>
              </select>
            </label>
            <label>
              Size:
              <select value={dialog.font.size} onChange={(e) => setDialog({ ...dialog, font: { ...dialog.font, size: Number(e.target.value) } })}>
                {sizeOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="wpEffects">
            <legend>Effects</legend>
            <div className="wpFindOptions">
              <input id="wp-strike" type="checkbox" checked={dialog.font.strike} onChange={(e) => setDialog({ ...dialog, font: { ...dialog.font, strike: e.target.checked } })} />
              <label htmlFor="wp-strike">Strikeout</label>
              <input id="wp-under" type="checkbox" checked={dialog.font.underline} onChange={(e) => setDialog({ ...dialog, font: { ...dialog.font, underline: e.target.checked } })} />
              <label htmlFor="wp-under">Underline</label>
            </div>
            <label className="wpColorRow">
              Color:
              <select value={dialog.font.color} onChange={(e) => setDialog({ ...dialog, font: { ...dialog.font, color: e.target.value } })}>
                <option value="">(unchanged)</option>
                {COLORS.map(([label, hex]) => (
                  <option key={hex} value={hex}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
          <fieldset className="wpSample">
            <legend>Sample</legend>
            <span
              style={{
                fontFamily: dialog.font.font,
                fontSize: `${Math.min(dialog.font.size, 28)}pt`,
                fontWeight: dialog.font.bold ? "bold" : "normal",
                fontStyle: dialog.font.italic ? "italic" : "normal",
                textDecoration: [dialog.font.underline && "underline", dialog.font.strike && "line-through"].filter(Boolean).join(" ") || "none",
                color: dialog.font.color || undefined,
              }}
            >
              AaBbYyZz
            </span>
          </fieldset>
        </Dialog>
      )}

      {dialog?.kind === "paragraph" && (
        <Dialog
          title="Paragraph"
          onOk={() => {
            const num = (v) => Math.max(-5, Math.min(10, parseFloat(v) || 0))
            const p = dialog.p
            setDialog(null)
            paragraph({ left: num(p.left), right: num(p.right), first: num(p.first), align: p.align })
          }}
          onCancel={() => setDialog(null)}
        >
          <fieldset className="wpEffects">
            <legend>Indentation</legend>
            {[
              ["left", "Left:"],
              ["right", "Right:"],
              ["first", "First line:"],
            ].map(([key, label]) => (
              <label key={key} className="wpIndentRow">
                {label}
                <input type="number" step="0.25" value={dialog.p[key]} onChange={(e) => setDialog({ ...dialog, p: { ...dialog.p, [key]: e.target.value } })} />
                <span>in.</span>
              </label>
            ))}
          </fieldset>
          <label className="wpIndentRow">
            Alignment:
            <select value={dialog.p.align === "justify" ? "left" : dialog.p.align} onChange={(e) => setDialog({ ...dialog, p: { ...dialog.p, align: e.target.value } })}>
              <option value="left">Left</option>
              <option value="right">Right</option>
              <option value="center">Center</option>
            </select>
          </label>
        </Dialog>
      )}

      {dialog?.kind === "print" && (
        <Dialog title="Print" okLabel="OK" onOk={print} onCancel={() => setDialog(null)}>
          <p className="dialogText">
            <b>Printer:</b> your browser&apos;s printer
          </p>
          <p className="dialogText">WordPad prints {name} on its own, without the desktop around it. Choose a printer (or Save as PDF) in the next window.</p>
        </Dialog>
      )}

      {dialog?.kind === "alert" && (
        <Dialog title={dialog.title || "WordPad"} sound="ding" onOk={() => setDialog(null)}>
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}
    </div>
  )
}

// Print Preview: Letter pages (8.5 x 11 in., 1.25 in. side and 1 in. top/bottom margins),
// each a window onto the document, shrunk to fit
const PAGE = { w: 816, h: 1056, mx: 120, my: 96 }
const BODY = { w: PAGE.w - PAGE.mx * 2, h: PAGE.h - PAGE.my * 2 }

const Preview = ({ preview, setPreview, onPrint }) => {
  const measure = useRef(null)
  const area = useRef(null)
  const [pages, setPages] = useState(1)
  const [fit, setFit] = useState(0.5)

  useLayoutEffect(() => {
    setPages(Math.max(1, Math.ceil((measure.current?.scrollHeight || 1) / BODY.h)))
    const size = () => {
      const box = area.current?.getBoundingClientRect()
      if (box) setFit(Math.max(0.15, Math.min((box.width - 24) / PAGE.w, (box.height - 24) / PAGE.h)))
    }
    size()
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(size) : null
    ro?.observe(area.current)
    return () => ro?.disconnect()
  }, [preview.html])

  const page = Math.min(preview.page, pages - 1)
  const scale = preview.zoom ? Math.max(fit, Math.min(1, (area.current?.clientWidth || PAGE.w) / PAGE.w - 0.02)) : fit

  return (
    <div className="wpPreview">
      <div className="wpBar wpPreviewBar">
        <button type="button" onClick={onPrint}>
          Print...
        </button>
        <button type="button" disabled={page >= pages - 1} onClick={() => setPreview({ ...preview, page: page + 1 })}>
          Next Page
        </button>
        <button type="button" disabled={page <= 0} onClick={() => setPreview({ ...preview, page: page - 1 })}>
          Prev Page
        </button>
        <button type="button" onClick={() => setPreview({ ...preview, zoom: !preview.zoom })}>
          {preview.zoom ? "Zoom Out" : "Zoom In"}
        </button>
        <button type="button" onClick={() => setPreview(null)}>
          Close
        </button>
        <span className="wpPreviewCount">
          Page {page + 1} of {pages}
        </span>
      </div>
      <div className="wpPreviewArea" ref={area}>
        {/* the document laid out at page width, to count the pages */}
        <div className="wpDoc wpMeasure" ref={measure} style={{ width: BODY.w }} dangerouslySetInnerHTML={{ __html: preview.html }} />
        <div className="wpSheetBox" style={{ width: PAGE.w * scale, height: PAGE.h * scale }}>
          <div className="wpSheet" style={{ transform: `scale(${scale})` }} aria-label={`Page ${page + 1}`}>
            <div className="wpSheetBody" style={{ left: PAGE.mx, top: PAGE.my, width: BODY.w, height: BODY.h }}>
              <div className="wpDoc" style={{ width: BODY.w, transform: `translateY(${-page * BODY.h}px)` }} dangerouslySetInnerHTML={{ __html: preview.html }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default WordPad
