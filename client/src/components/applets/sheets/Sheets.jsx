import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import PrintDialog from "../../shared/PrintDialog"
import MoreOptions from "../../shared/MoreOptions"
import FileDialog from "../notepad/FileDialog"
import { escapeHtml, printDocument } from "../../../utils/print"
import { FILE_TYPE, fs, readContent, writeAndSave } from "../../../utils/fs"
import { trackUnsaved } from "../../../utils/unsaved"
import { copyText } from "../../../utils/systemClipboard"
import { helpItem } from "../../../utils/help"
import * as S from "./engine"
import SheetChart from "./SheetChart"
import "./Sheets.css"

// Sheets 98: a small spreadsheet. The baseline is the File menu, the formula bar and the grid;
// formats, AutoSum, Fill Down and the chart wait under More options and the menus. Formulas,
// recalculation, copying and files are in engine.js (pure, unit tested).
// Phones: tap a cell to select it, drag the handle at the selection's corner for a range, tap
// the formula bar to type (the bar moves just above the 98ish keyboard). While a formula is
// being typed, tapping a cell puts its address in it (type ":" then tap another for a range).

const ROW_H = 22
const HEAD_H = 20
const ROW_HEAD_W = 40
const COL_W = 76
const MIN_ROWS = 100
const MIN_COLS = 26
const UNDO_MAX = 100

const EMPTY = { cells: {}, formats: {}, widths: {}, chart: null }
const QUICK = ["=", "SUM(", ":", "(", ")", ",", "+", "-", "*", "/", "$"]
const isSheetFile = (item) => item.type === FILE_TYPE.sheet || (item.isText && /\.csv$/i.test(item.name))
const onDrive = (file) => !!file && fs.partsOf(file)[0] === "C:" && fs.resolve(fs.partsOf(file)) === file
const TYPES = [
  { value: "sheet", label: "Sheets 98 Workbook" },
  { value: "csv", label: "CSV (Comma delimited) (*.csv)" },
]

// text for a cell's tooltip-free, plain display
const cellClass = (v) => (typeof v === "number" ? " is-num" : S.isError(v) ? " is-err" : typeof v === "boolean" ? " is-bool" : "")

// the start of a formula where a cell address can go next ("=", "SUM(", "A1+", "A1:")
const POINTABLE = /(^=|[(,:+\-*/^&=<>])\s*$/

const Sheets = ({ file: initialFile = null, mobile = false, onTitle, onClose, registerCloseGuard }) => {
  const [sheet, setSheet] = useState(EMPTY)
  const [file, setFile] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [sel, setSel] = useState({ anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } })
  const [draft, setDraft] = useState(null) // the formula bar's text while editing, else null
  const [dialog, setDialog] = useState(null)
  const [status, setStatus] = useState(null)
  const [saveType, setSaveType] = useState("sheet")
  const [view, setView] = useState({ top: 0, height: 400 })
  const gridRef = useRef(null)
  const inputRef = useRef(null)
  const undoStack = useRef([])
  const redoStack = useRef([])
  const clip = useRef(null) // { block, text, cut: range | null }
  const afterSave = useRef(null)

  const values = useMemo(() => S.recalc(sheet.cells), [sheet.cells])
  const range = S.rangeOf(sel.anchor, sel.focus)
  // the active cell (the one the formula bar edits) is where the selection started; the other
  // corner (focus) is what Shift+arrows and dragging move
  const active = sel.anchor
  const activeAddr = S.addr(active.row, active.col)
  const used = useMemo(() => S.usedSize(sheet.cells), [sheet.cells])
  const rows = Math.min(S.MAX_ROWS, Math.max(MIN_ROWS, used.rows + 20, range.r1 + 10))
  const cols = Math.min(S.MAX_COLS, Math.max(MIN_COLS, used.cols + 2, range.c1 + 2))
  const widthOf = (c) => sheet.widths[c] || COL_W
  const colLeft = useMemo(() => {
    const out = [0]
    for (let c = 0; c < cols; c++) out.push(out[c] + (sheet.widths[c] || COL_W))
    return out
  }, [cols, sheet.widths])
  const name = file ? file.name.replace(/\.csv$/i, "") : "Book1"

  const live = useRef({})
  live.current = { sheet, sel, draft, dirty, file, range, active }

  useEffect(() => onTitle?.(`${file ? file.name : "Book1"}${dirty ? " *" : ""} - Sheets 98`), [file, dirty])
  useEffect(() => (dirty ? trackUnsaved("Sheets 98") : undefined), [dirty])
  // a message in the status bar stays a few seconds
  useEffect(() => {
    if (!status) return
    const t = setTimeout(() => setStatus(null), 5000)
    return () => clearTimeout(t)
  }, [status])

  // ---- files ----

  const load = async (target) => {
    try {
      const text = (await readContent(target)) || ""
      const next = target.type === FILE_TYPE.sheet ? (text.trim() ? S.deserialize(text) : EMPTY) : S.csvToSheet(text)
      setSheet({ ...EMPTY, ...next })
      setFile(target)
      setDirty(false)
      setDraft(null)
      undoStack.current = []
      redoStack.current = []
      setSel({ anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } })
      setSaveType(target.type === FILE_TYPE.sheet ? "sheet" : "csv")
    } catch (error) {
      setDialog({ kind: "alert", text: `${target.name} couldn't be opened. ${error.message || ""}` })
    }
  }
  useEffect(() => {
    if (initialFile) load(initialFile)
  }, [])

  const contentAs = (as) => (as === "csv" ? S.sheetToCsv(sheet) : S.serialize(sheet))

  const writeTo = async (dir, fileName, as = saveType) => {
    let target = null
    const finalName = as === "csv" && !/\.csv$/i.test(fileName) ? `${fileName}.csv` : fileName
    try {
      target = dir.getItem(finalName)
      const type = as === "csv" ? FILE_TYPE.text : FILE_TYPE.sheet
      let ok
      if (target && target.type === type) ok = await writeAndSave(target, contentAs(as))
      else {
        if (target) {
          if (!isSheetFile(target)) throw new Error(`'${finalName}' can't be replaced.`)
          dir.removeItem(finalName)
        }
        target = fs.createFileIn(dir, finalName, type, "")
        ok = await writeAndSave(target, contentAs(as), { created: true })
      }
      if (!ok) {
        afterSave.current = null
        return setDialog({ kind: "alert", text: "There isn't enough room on the drive to save this. Delete some files and try again." })
      }
      setFile(target)
      setSaveType(as)
      setDirty(false)
      setDialog(null)
      setStatus(as === "csv" ? "Saved as CSV: formulas were saved as their results." : `Saved ${finalName}.`)
      const next = afterSave.current
      afterSave.current = null
      next?.()
    } catch (error) {
      afterSave.current = null
      setDialog({ kind: "alert", text: error.message })
    }
  }

  const save = () => {
    commit()
    if (file && onDrive(file)) return writeTo(file.parent, file.name, file.type === FILE_TYPE.sheet ? "sheet" : "csv")
    setDialog({ kind: "saveAs" })
  }

  // with unsaved changes, ask first (then `then`)
  const guard = (then) => {
    if (!live.current.dirty) return then()
    afterSave.current = then
    setDialog({ kind: "changed" })
  }

  useEffect(() => {
    if (!registerCloseGuard) return
    return registerCloseGuard(() => {
      if (!live.current.dirty) return true
      afterSave.current = () => onClose?.()
      setDialog({ kind: "changed" })
      return false
    })
  }, [registerCloseGuard])

  const newSheet = () => {
    setSheet(EMPTY)
    setFile(null)
    setDirty(false)
    setDraft(null)
    undoStack.current = []
    redoStack.current = []
    setSel({ anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } })
  }

  // ---- changing the sheet (undoable) ----

  const change = (fn) => {
    setSheet((prev) => {
      const next = fn(prev)
      if (next === prev) return prev
      undoStack.current.push(prev)
      if (undoStack.current.length > UNDO_MAX) undoStack.current.shift()
      redoStack.current = []
      return next
    })
    setDirty(true)
  }
  // { address: raw } -> cells ("" clears)
  const setCells = (patch) =>
    change((prev) => {
      const cells = { ...prev.cells }
      let formats = prev.formats
      for (const [a, raw] of Object.entries(patch)) {
        if (raw === "" || raw == null) delete cells[a]
        else {
          cells[a] = String(raw).slice(0, 5000)
          const hint = S.suggestedFormat(raw)
          if (hint && !formats[a]) formats = { ...formats, [a]: hint }
        }
      }
      return { ...prev, cells, formats }
    })
  const undo = () => {
    const prev = undoStack.current.pop()
    if (!prev) return
    redoStack.current.push(live.current.sheet)
    setSheet(prev)
    setDraft(null)
    setDirty(true)
  }
  const redo = () => {
    const next = redoStack.current.pop()
    if (!next) return
    undoStack.current.push(live.current.sheet)
    setSheet(next)
    setDraft(null)
    setDirty(true)
  }

  // ---- selection and editing ----

  const clampCell = (row, col) => ({ row: Math.max(0, Math.min(S.MAX_ROWS - 1, row)), col: Math.max(0, Math.min(S.MAX_COLS - 1, col)) })
  const select = (cell, extend = false) => setSel((s) => ({ anchor: extend ? s.anchor : cell, focus: cell }))
  const move = (dr, dc, extend = false) => {
    const { sel } = live.current
    const from = extend ? sel.focus : sel.anchor
    select(clampCell(from.row + dr, from.col + dc), extend)
  }

  // put the formula bar's text in the active cell
  const commit = () => {
    const { draft, active } = live.current
    if (draft === null) return false
    const a = S.addr(active.row, active.col)
    if ((live.current.sheet.cells[a] ?? "") !== draft) setCells({ [a]: draft })
    setDraft(null)
    return true
  }
  // put text at the formula bar's caret (the quick keys)
  const insertText = (t) => {
    const el = inputRef.current
    const draft = live.current.draft ?? ""
    const s = el?.selectionStart ?? draft.length
    const e = el?.selectionEnd ?? draft.length
    setDraft(draft.slice(0, s) + t + draft.slice(e))
    pointRef.current = null
    requestAnimationFrame(() => {
      if (!el) return
      if (document.activeElement !== el) el.focus({ preventScroll: true })
      el.setSelectionRange?.(s + t.length, s + t.length)
    })
  }
  const cancel = () => {
    setDraft(null)
    gridRef.current?.focus({ preventScroll: true })
  }
  const startEdit = (text = null) => {
    setDraft(text ?? live.current.sheet.cells[S.addr(live.current.active.row, live.current.active.col)] ?? "")
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus({ preventScroll: true })
      const end = el.value.length
      el.setSelectionRange?.(end, end)
    })
  }

  // keep the moving corner in view (not after picking a whole row or column)
  const target = sel.focus
  useLayoutEffect(() => {
    const g = gridRef.current
    if (!g || sel.noScroll) return
    const top = HEAD_H + target.row * ROW_H
    const left = ROW_HEAD_W + colLeft[target.col]
    if (top - HEAD_H < g.scrollTop) g.scrollTop = top - HEAD_H
    else if (top + ROW_H > g.scrollTop + g.clientHeight) g.scrollTop = top + ROW_H - g.clientHeight
    if (left - ROW_HEAD_W < g.scrollLeft) g.scrollLeft = left - ROW_HEAD_W
    else if (left + widthOf(target.col) > g.scrollLeft + g.clientWidth) g.scrollLeft = left + widthOf(target.col) - g.clientWidth
  }, [target.row, target.col])

  // which rows to draw (only those near the screen)
  const onScroll = () => {
    const g = gridRef.current
    if (g) setView({ top: g.scrollTop, height: g.clientHeight })
  }
  useEffect(() => {
    onScroll()
    const g = gridRef.current
    if (!g || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(onScroll)
    ro.observe(g)
    return () => ro.disconnect()
  }, [])
  const firstRow = Math.max(0, Math.floor((view.top - HEAD_H) / ROW_H) - 6)
  const lastRow = Math.min(rows - 1, Math.ceil((view.top + view.height) / ROW_H) + 6)

  // where a pointer is -> cell
  const cellAt = (clientX, clientY) => {
    const g = gridRef.current
    const rect = g.getBoundingClientRect()
    const x = clientX - rect.left + g.scrollLeft - ROW_HEAD_W
    const y = clientY - rect.top + g.scrollTop - HEAD_H
    let col = 0
    while (col < cols - 1 && colLeft[col + 1] <= x) col++
    return clampCell(Math.floor(y / ROW_H), x < 0 ? 0 : col)
  }

  // while a formula is being typed and the caret is where an address can go, a tap on a
  // cell types its address (and a drag, a range) instead of moving the selection
  const pointing = () => {
    const el = inputRef.current
    const { draft } = live.current
    if (draft === null || draft[0] !== "=" || !el) return null
    const caret = el.selectionStart ?? draft.length
    const before = draft.slice(0, caret)
    // replace an address just typed by pointing ("=A1" then tapping B2 -> "=B2")
    const m = /(\$?[A-Z]{1,2}\$?\d{1,4}(:\$?[A-Z]{1,2}\$?\d{1,4})?)$/.exec(before)
    if (m && POINTABLE.test(before.slice(0, before.length - m[1].length)) && pointRef.current?.at === before.length) return { from: caret - m[1].length, to: caret }
    if (POINTABLE.test(before)) return { from: caret, to: caret }
    return null
  }
  const pointRef = useRef(null) // { from, at, start } the address being pointed
  const typeRef = (spot, a, b = null) => {
    const { draft } = live.current
    const text = b && (b.row !== a.row || b.col !== a.col) ? S.rangeText(S.rangeOf(a, b)) : S.addr(a.row, a.col)
    const next = draft.slice(0, spot.from) + text + draft.slice(spot.to)
    setDraft(next)
    const at = spot.from + text.length
    pointRef.current = { from: spot.from, at, start: a }
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      if (document.activeElement !== el) el.focus({ preventScroll: true })
      el.setSelectionRange?.(at, at)
    })
  }

  const drag = useRef(null)
  const onCellDown = (event) => {
    if (event.button > 0) return
    const cell = cellAt(event.clientX, event.clientY)
    const spot = pointing()
    if (spot) {
      // keep the formula bar focused (and the keyboard up)
      event.preventDefault()
      typeRef(spot, cell)
      if (event.pointerType === "mouse") {
        drag.current = { kind: "point", spot: { from: spot.from, to: spot.from + S.addr(cell.row, cell.col).length }, start: cell }
        gridRef.current.setPointerCapture?.(event.pointerId)
      }
      return
    }
    if (live.current.draft !== null) commit()
    pointRef.current = null
    select(cell, event.shiftKey)
    if (event.pointerType === "mouse") {
      drag.current = { kind: "select" }
      gridRef.current.setPointerCapture?.(event.pointerId)
      gridRef.current.focus({ preventScroll: true })
    }
  }
  const onGridMove = (event) => {
    const d = drag.current
    if (!d) return
    const cell = cellAt(event.clientX - (d.dx || 0), event.clientY - (d.dy || 0))
    if (d.kind === "select" || d.kind === "handle") setSel((s) => (s.focus.row === cell.row && s.focus.col === cell.col ? s : { anchor: s.anchor, focus: cell }))
    else if (d.kind === "point") {
      const text = S.rangeText(S.rangeOf(d.start, cell))
      typeRef(d.spot, d.start, cell)
      d.spot = { from: d.spot.from, to: d.spot.from + text.length }
    }
  }
  const onGridUp = () => {
    drag.current = null
  }
  // the selection's corner handle: drag it to make a range (phones: the grid itself scrolls)
  const onHandleDown = (event) => {
    event.preventDefault()
    event.stopPropagation()
    // the handle sits on the corner between cells: measure from the corner cell's middle, so
    // grabbing it doesn't already reach into the next row or column
    const g = gridRef.current
    const rect = g.getBoundingClientRect()
    const f = live.current.sel.focus
    const midX = rect.left - g.scrollLeft + ROW_HEAD_W + colLeft[f.col] + widthOf(f.col) / 2
    const midY = rect.top - g.scrollTop + HEAD_H + f.row * ROW_H + ROW_H / 2
    drag.current = { kind: "handle", dx: event.clientX - midX, dy: event.clientY - midY }
    gridRef.current.setPointerCapture?.(event.pointerId)
  }
  const onCellDouble = () => startEdit()

  // ---- clipboard ----

  const tsv = (r) => {
    const lines = []
    for (let row = r.r0; row <= r.r1; row++) {
      const line = []
      for (let col = r.c0; col <= r.c1; col++) {
        const a = S.addr(row, col)
        line.push(S.display(values.get(a), sheet.formats[a]).replace(/[\t\n]/g, " "))
      }
      lines.push(line.join("\t"))
    }
    return lines.join("\n")
  }
  const copy = (cut = false) => {
    commit()
    const r = live.current.range
    const text = tsv(r)
    clip.current = { block: S.copyBlock(live.current.sheet.cells, r), text, cut: cut ? r : null }
    copyText(text)
    setStatus(cut ? "Cut. Select where it goes and Paste." : "Copied. Select where it goes and Paste.")
  }
  const pasteText = (text) => {
    const { active } = live.current
    const c = clip.current
    const patch = {}
    if (c && (text == null || text.replace(/\r/g, "") === c.text)) {
      Object.assign(patch, S.pasteBlock(c.block, active.row, active.col))
      if (c.cut) {
        for (let row = c.cut.r0; row <= c.cut.r1; row++) for (let col = c.cut.c0; col <= c.cut.c1; col++) if (!(S.addr(row, col) in patch)) patch[S.addr(row, col)] = ""
        clip.current = null
      }
      const h = c.block.cells.length
      const w = c.block.cells[0]?.length || 1
      setSel({ anchor: active, focus: clampCell(active.row + h - 1, active.col + w - 1) })
    } else if (text) {
      const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n")
      const grid = lines.some((l) => l.includes("\t")) ? lines.map((l) => l.split("\t")) : S.parseCsv(text)
      grid.forEach((line, i) =>
        line.forEach((v, j) => {
          const row = active.row + i
          const col = active.col + j
          if (row < S.MAX_ROWS && col < S.MAX_COLS) patch[S.addr(row, col)] = v
        })
      )
    }
    if (Object.keys(patch).length) setCells(patch)
  }
  const pasteMenu = async () => {
    commit()
    if (clip.current) return pasteText(null)
    try {
      pasteText(await navigator.clipboard.readText())
    } catch {
      setDialog({ kind: "alert", text: "Use Ctrl+V (or the phone's Paste) to paste from another program." })
    }
  }
  const clearRange = () => {
    const r = live.current.range
    const patch = {}
    for (let row = r.r0; row <= r.r1; row++) for (let col = r.c0; col <= r.c1; col++) if (live.current.sheet.cells[S.addr(row, col)] !== undefined) patch[S.addr(row, col)] = ""
    if (Object.keys(patch).length) setCells(patch)
  }

  // ---- commands ----

  const fill = (down) => {
    commit()
    const r = live.current.range
    const cells = live.current.sheet.cells
    const patch = {}
    if (down) {
      if (r.r1 === r.r0) return setStatus("Select the cells to fill, starting with the one to copy.")
      for (let col = r.c0; col <= r.c1; col++) for (let row = r.r0 + 1; row <= r.r1; row++) patch[S.addr(row, col)] = S.shiftFormula(cells[S.addr(r.r0, col)] ?? "", row - r.r0, 0)
    } else {
      if (r.c1 === r.c0) return setStatus("Select the cells to fill, starting with the one to copy.")
      for (let row = r.r0; row <= r.r1; row++) for (let col = r.c0 + 1; col <= r.c1; col++) patch[S.addr(row, col)] = S.shiftFormula(cells[S.addr(row, r.c0)] ?? "", 0, col - r.c0)
    }
    setCells(patch)
  }

  // Σ: a SUM of the numbers above (or to the left of) the active cell, or under each column of
  // a selected block
  const autoSum = () => {
    commit()
    const { range: r, active } = live.current
    const isNum = (row, col) => typeof values.get(S.addr(row, col)) === "number"
    if (r.r0 !== r.r1 || r.c0 !== r.c1) {
      const patch = {}
      const row = Math.min(S.MAX_ROWS - 1, r.r1 + 1)
      for (let col = r.c0; col <= r.c1; col++) patch[S.addr(row, col)] = `=SUM(${S.addr(r.r0, col)}:${S.addr(r.r1, col)})`
      setCells(patch)
      return
    }
    let top = active.row
    while (top > 0 && isNum(top - 1, active.col)) top--
    if (top < active.row) return startEdit(`=SUM(${S.addr(top, active.col)}:${S.addr(active.row - 1, active.col)})`)
    let left = active.col
    while (left > 0 && isNum(active.row, left - 1)) left--
    if (left < active.col) return startEdit(`=SUM(${S.addr(active.row, left)}:${S.addr(active.row, active.col - 1)})`)
    startEdit("=SUM()")
    requestAnimationFrame(() => inputRef.current?.setSelectionRange?.(5, 5))
  }

  const setFormat = (format) => {
    commit()
    const r = live.current.range
    change((prev) => {
      const formats = { ...prev.formats }
      for (let row = r.r0; row <= r.r1; row++)
        for (let col = r.c0; col <= r.c1; col++) {
          if (format === "general") delete formats[S.addr(row, col)]
          else formats[S.addr(row, col)] = format
        }
      return { ...prev, formats }
    })
  }

  const setWidth = (col, width) => change((prev) => ({ ...prev, widths: { ...prev.widths, [col]: Math.max(30, Math.min(400, Math.round(width))) } }))

  const toggleChart = () => {
    commit()
    const r = live.current.range
    change((prev) => {
      if (prev.chart && (r.r0 === r.r1 && r.c0 === r.c1)) return { ...prev, chart: null }
      const pick = r.r0 === r.r1 && r.c0 === r.c1 ? null : S.rangeText(r)
      if (!pick) return prev
      return { ...prev, chart: { range: pick, type: prev.chart?.type || "bar" } }
    })
    if (r.r0 === r.r1 && r.c0 === r.c1 && !live.current.sheet.chart) setStatus("Select the cells to chart first (labels in the first column, numbers next to them).")
  }

  // ---- printing: the used cells as a table ----

  const print = () => {
    setDialog(null)
    const { rows: nr, cols: nc } = S.usedSize(sheet.cells)
    if (!nr) return setDialog({ kind: "alert", text: "There's nothing to print yet." })
    let html = `<table class="shPrint"><thead><tr><th></th>${Array.from({ length: nc }, (_, c) => `<th>${S.colName(c)}</th>`).join("")}</tr></thead><tbody>`
    for (let r = 0; r < nr; r++) {
      html += `<tr><th>${r + 1}</th>`
      for (let c = 0; c < nc; c++) {
        const a = S.addr(r, c)
        const v = values.get(a)
        html += `<td class="${typeof v === "number" ? "n" : ""}">${escapeHtml(S.display(v, sheet.formats[a]))}</td>`
      }
      html += "</tr>"
    }
    html += "</tbody></table>"
    const css = ".shPrint{border-collapse:collapse;font:10pt Arial,sans-serif}.shPrint th,.shPrint td{border:1px solid #999;padding:2px 6px;white-space:nowrap}.shPrint th{background:#eee;font-weight:normal;color:#444}.shPrint td.n{text-align:right}"
    const ok = printDocument({ title: name, html: `<h3 style="font:bold 12pt Arial">${escapeHtml(name)}</h3>${html}`, css, page: `size: ${nc > 7 ? "landscape" : "portrait"}; margin: 0.5in` })
    if (!ok) setDialog({ kind: "alert", text: "This browser can't print from here." })
  }

  // ---- keys on the grid (computers; also a Bluetooth keyboard) ----

  const onGridKey = (e) => {
    if (dialog) return
    const ctrl = e.ctrlKey || e.metaKey
    const k = e.key
    if (ctrl && !e.altKey) {
      const lower = k.toLowerCase()
      const map = { c: () => copy(false), x: () => copy(true), z: undo, y: redo, s: save, p: () => setDialog({ kind: "print" }), d: () => fill(true), r: () => fill(false), a: () => setSel({ anchor: { row: 0, col: 0 }, focus: { row: Math.max(0, used.rows - 1), col: Math.max(0, used.cols - 1) }, noScroll: true }), o: () => guard(() => setDialog({ kind: "open" })) }
      if (map[lower]) {
        e.preventDefault()
        map[lower]()
      }
      return // Ctrl+V comes as a paste event
    }
    const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    if (arrows[k]) {
      e.preventDefault()
      move(...arrows[k], e.shiftKey)
    } else if (k === "Enter") {
      e.preventDefault()
      move(e.shiftKey ? -1 : 1, 0)
    } else if (k === "Tab") {
      e.preventDefault()
      move(0, e.shiftKey ? -1 : 1)
    } else if (k === "Delete" || k === "Backspace") {
      e.preventDefault()
      clearRange()
    } else if (k === "F2") {
      e.preventDefault()
      startEdit()
    } else if (k === "PageDown" || k === "PageUp") {
      e.preventDefault()
      const page = Math.max(1, Math.floor((gridRef.current?.clientHeight || 300) / ROW_H) - 1)
      move(k === "PageDown" ? page : -page, 0, e.shiftKey)
    } else if (k.length === 1 && !e.altKey) {
      // typing starts a new entry (keys that come before the formula bar has the focus are
      // added to it, not lost)
      e.preventDefault()
      setDraft((d) => (d === null ? k : d + k))
      requestAnimationFrame(() => {
        const el = inputRef.current
        if (!el) return
        if (document.activeElement !== el) el.focus({ preventScroll: true })
        const end = el.value.length
        el.setSelectionRange?.(end, end)
      })
    }
  }
  const onGridPaste = (e) => {
    if (document.activeElement === inputRef.current) return
    e.preventDefault()
    commit()
    pasteText(e.clipboardData?.getData("text/plain") ?? null)
  }

  const onBarKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      commit()
      move(e.shiftKey ? -1 : 1, 0)
      if (!mobile) gridRef.current?.focus({ preventScroll: true })
    } else if (e.key === "Tab") {
      e.preventDefault()
      commit()
      move(0, e.shiftKey ? -1 : 1)
      gridRef.current?.focus({ preventScroll: true })
    } else if (e.key === "Escape") {
      e.preventDefault()
      cancel()
    }
  }

  // ---- what's selected (status bar) ----

  const summary = useMemo(() => {
    if (range.r0 === range.r1 && range.c0 === range.c1) return null
    let sum = 0
    let count = 0
    let n = 0
    for (let row = range.r0; row <= range.r1; row++)
      for (let col = range.c0; col <= range.c1; col++) {
        const v = values.get(S.addr(row, col))
        if (v === undefined || v === null || v === "") continue
        count++
        if (typeof v === "number") (sum += v), n++
      }
    if (!count) return null
    return n ? `Sum=${S.display(sum)}  Average=${S.display(sum / n)}  Count=${count}` : `Count=${count}`
  }, [range.r0, range.r1, range.c0, range.c1, values])

  const menus = [
    {
      label: "File",
      items: [
        { label: "New Ctrl+N", onClick: () => guard(newSheet) },
        { label: "Open... Ctrl+O", onClick: () => guard(() => setDialog({ kind: "open" })) },
        { label: "Save Ctrl+S", onClick: save },
        { label: "Save As...", onClick: () => (commit(), setDialog({ kind: "saveAs" })) },
        "-",
        { label: "Print... Ctrl+P", onClick: () => (commit(), setDialog({ kind: "print" })) },
        "-",
        { label: "Exit", onClick: () => guard(() => onClose?.()) },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo Ctrl+Z", onClick: undo, disabled: !undoStack.current.length },
        { label: "Redo Ctrl+Y", onClick: redo, disabled: !redoStack.current.length },
        "-",
        { label: "Cut Ctrl+X", onClick: () => copy(true) },
        { label: "Copy Ctrl+C", onClick: () => copy(false) },
        { label: "Paste Ctrl+V", onClick: pasteMenu },
        { label: "Clear Del", onClick: clearRange },
        "-",
        { label: "Fill Down Ctrl+D", onClick: () => fill(true) },
        { label: "Fill Right Ctrl+R", onClick: () => fill(false) },
        { label: "Select All Ctrl+A", onClick: () => setSel({ anchor: { row: 0, col: 0 }, focus: { row: Math.max(0, used.rows - 1), col: Math.max(0, used.cols - 1) }, noScroll: true }) },
      ],
    },
    {
      label: "Format",
      items: [
        ...S.FORMATS.map((f) => ({ label: f.label, checked: (sheet.formats[activeAddr] || "general") === f.id, onClick: () => setFormat(f.id) })),
        "-",
        { label: "Column Width...", onClick: () => setDialog({ kind: "width", col: active.col, value: String(widthOf(active.col)) }) },
      ],
    },
    {
      label: "Insert",
      items: [
        { label: "AutoSum", onClick: autoSum },
        { label: "Function...", onClick: () => setDialog({ kind: "functions" }) },
        { label: sheet.chart ? "Remove Chart" : "Chart of Selection", onClick: () => (sheet.chart ? change((p) => ({ ...p, chart: null })) : toggleChart()) },
      ],
    },
    { label: "Help", items: [helpItem({ program: "Sheets 98" })] },
  ]

  const editing = draft !== null
  const shown = editing ? draft : sheet.cells[activeAddr] ?? ""
  const selBox = {
    left: ROW_HEAD_W + colLeft[range.c0],
    top: HEAD_H + range.r0 * ROW_H,
    width: colLeft[range.c1 + 1] - colLeft[range.c0],
    height: (range.r1 - range.r0 + 1) * ROW_H,
  }

  return (
    <div className={`shRoot${mobile ? " is-mobile" : ""}${editing ? " is-editing" : ""}`} data-sheets="">
      <MenuBar menus={menus} />

      {mobile && editing && (
        // phones: the characters formulas need, one tap away (the keyboard's letters page has none)
        <div className="shQuick" data-kb-keep="">
          {QUICK.map((t) => (
            <button key={t} type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => insertText(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
      <div className="shBar" data-kb-keep="">
        <div className="shName" title="The selected cell">
          {S.rangeText(range)}
        </div>
        {editing ? (
          <>
            <button type="button" className="shBarBtn" aria-label="Cancel" title="Cancel (Esc)" onPointerDown={(e) => e.preventDefault()} onClick={cancel}>
              <span className="shX">✕</span>
            </button>
            <button
              type="button"
              className="shBarBtn"
              aria-label="Enter"
              title="Enter"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                commit()
                move(1, 0)
              }}
            >
              <span className="shCheck">✓</span>
            </button>
          </>
        ) : (
          <span className="shFx" aria-hidden="true">
            <i>fx</i>
          </span>
        )}
        <input
          ref={inputRef}
          className="shInput"
          value={shown}
          onFocus={() => {
            if (live.current.draft === null) setDraft(sheet.cells[activeAddr] ?? "")
          }}
          onChange={(e) => {
            pointRef.current = null
            setDraft(e.target.value)
          }}
          onKeyDown={onBarKey}
          aria-label={`Contents of ${activeAddr}`}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck="false"
          enterKeyHint="done"
          data-sheet-input=""
        />
      </div>

      <MoreOptions id="sheets.tools" inline className="shMore" summary="AutoSum, number formats, Fill Down, chart">
        <div className="shTools">
          <button type="button" onClick={autoSum} title="AutoSum">
            <b>Σ</b> AutoSum
          </button>
          <button type="button" onClick={() => setFormat("currency")} title="Currency">
            $
          </button>
          <button type="button" onClick={() => setFormat("percent")} title="Percent">
            %
          </button>
          <button type="button" onClick={() => setFormat("number")} title="Two decimals">
            .00
          </button>
          <button type="button" onClick={() => setFormat("general")} title="General">
            123
          </button>
          <button type="button" onClick={() => fill(true)} title="Fill Down">
            Fill ↓
          </button>
          <button type="button" onClick={toggleChart} aria-pressed={!!sheet.chart} title="Chart of the selection">
            Chart
          </button>
        </div>
      </MoreOptions>

      <div
        className="shGrid"
        ref={gridRef}
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={onGridKey}
        onPaste={onGridPaste}
        onPointerMove={onGridMove}
        onPointerUp={onGridUp}
        onPointerCancel={onGridUp}
        data-kb-keep=""
        data-touch-surface=""
        aria-label="Sheet"
      >
        <div className="shInner" style={{ width: ROW_HEAD_W + colLeft[cols], height: HEAD_H + rows * ROW_H }}>
          <div className="shColHeads" style={{ width: ROW_HEAD_W + colLeft[cols] }}>
            <div className="shCorner" />
            {Array.from({ length: cols }, (_, c) => (
              <div key={c} className={`shColHead${c >= range.c0 && c <= range.c1 ? " is-sel" : ""}`} style={{ left: ROW_HEAD_W + colLeft[c], width: widthOf(c) }} onPointerDown={(e) => {
                if (e.button > 0) return
                commit()
                setSel({ anchor: { row: 0, col: c }, focus: { row: Math.max(rows - 1, 0), col: c }, noScroll: true })
              }}>
                {S.colName(c)}
                {!mobile && <ColResizer width={widthOf(c)} onResize={(w) => setWidth(c, w)} />}
              </div>
            ))}
          </div>
          {Array.from({ length: Math.max(0, lastRow - firstRow + 1) }, (_, i) => {
            const r = firstRow + i
            return (
              <div key={r} className="shRow" style={{ top: HEAD_H + r * ROW_H, width: ROW_HEAD_W + colLeft[cols] }}>
                <div className={`shRowHead${r >= range.r0 && r <= range.r1 ? " is-sel" : ""}`} onPointerDown={(e) => {
                  if (e.button > 0) return
                  commit()
                  setSel({ anchor: { row: r, col: 0 }, focus: { row: r, col: Math.max(used.cols - 1, cols - 1) }, noScroll: true })
                }}>
                  {r + 1}
                </div>
                {Array.from({ length: cols }, (_, c) => {
                  const a = S.addr(r, c)
                  const v = values.get(a)
                  return (
                    <div key={c} className={`shCell${cellClass(v)}`} style={{ left: ROW_HEAD_W + colLeft[c], width: widthOf(c) }} onPointerDown={onCellDown} onDoubleClick={onCellDouble} data-cell={a}>
                      {S.display(v, sheet.formats[a])}
                    </div>
                  )
                })}
              </div>
            )
          })}
          <div className="shSel" style={selBox}>
            <div className="shSelActive" style={{ left: colLeft[active.col] - colLeft[range.c0], top: (active.row - range.r0) * ROW_H, width: widthOf(active.col), height: ROW_H }} />
            <div className="shHandle" onPointerDown={onHandleDown} title="Drag to select more cells" />
          </div>
        </div>
      </div>

      {sheet.chart && <SheetChart chart={sheet.chart} values={values} formats={sheet.formats} onType={(type) => change((p) => ({ ...p, chart: { ...p.chart, type } }))} onClose={() => change((p) => ({ ...p, chart: null }))} />}

      <div className="shStatus status-bar" data-kb-status="keep">
        <p className="status-bar-field">{status || (editing ? (pointing() ? "Point: tap a cell to add it" : "Enter") : "Ready")}</p>
        {summary && <p className="status-bar-field shSum">{summary}</p>}
      </div>

      {dialog?.kind === "alert" && (
        <Dialog title="Sheets 98" onOk={() => setDialog(null)}>
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}
      {dialog?.kind === "changed" && (
        <Dialog
          title="Sheets 98"
          sound="chord"
          okLabel="Yes"
          onOk={() => {
            setDialog(null)
            save()
          }}
          onNo={() => {
            setDialog(null)
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
          <p className="dialogText">Do you want to save the changes you made to {name}?</p>
        </Dialog>
      )}
      {dialog?.kind === "open" && (
        <FileDialog mode="open" startDir={file && onDrive(file) ? file.parent : null} accept={isSheetFile} typeLabel="Sheets and CSV files" fileType="sheet" onPick={(target) => (setDialog(null), load(target))} onCancel={() => setDialog(null)} />
      )}
      {dialog?.kind === "saveAs" && (
        <FileDialog
          mode="save"
          startDir={file && onDrive(file) ? file.parent : null}
          initialName={name}
          accept={isSheetFile}
          fileType="sheet"
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
      {dialog?.kind === "print" && <PrintDialog name={name} onPrint={print} onCancel={() => setDialog(null)} />}
      {dialog?.kind === "width" && (
        <Dialog
          title="Column Width"
          onOk={() => {
            const w = Number(dialog.value)
            if (Number.isFinite(w) && w > 0) setWidth(dialog.col, w)
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        >
          <label className="shDlgRow">
            Column {S.colName(dialog.col)} width (pixels):
            <input type="number" inputMode="numeric" pattern="[0-9]*" min="30" max="400" value={dialog.value} onChange={(e) => setDialog({ ...dialog, value: e.target.value })} />
          </label>
        </Dialog>
      )}
      {dialog?.kind === "functions" && (
        <Dialog title="Insert Function" onCancel={() => setDialog(null)} cancelLabel="Close">
          <div className="shFnList">
            {FUNCTION_HELP.map(([fn, text]) => (
              <button
                type="button"
                key={fn}
                onClick={() => {
                  setDialog(null)
                  const base = live.current.draft
                  startEdit(base && base[0] === "=" ? `${base}${fn}(` : `=${fn}(`)
                }}
              >
                <b>{fn}</b> {text}
              </button>
            ))}
          </div>
        </Dialog>
      )}
    </div>
  )
}

const FUNCTION_HELP = [
  ["SUM", "adds numbers: =SUM(A1:A10)"],
  ["AVERAGE", "the average: =AVERAGE(B2:B9)"],
  ["MIN", "the smallest: =MIN(A1:A10)"],
  ["MAX", "the largest: =MAX(A1:A10)"],
  ["COUNT", "how many numbers: =COUNT(A1:A10)"],
  ["COUNTA", "how many cells aren't empty"],
  ["IF", 'a choice: =IF(A1>100,"Over","OK")'],
  ["ROUND", "rounds: =ROUND(A1,2)"],
  ["ROUNDUP", "rounds up: =ROUNDUP(A1,0)"],
  ["ROUNDDOWN", "rounds down: =ROUNDDOWN(A1,0)"],
  ["ABS", "without the minus sign"],
  ["INT", "the whole number below"],
  ["MOD", "the remainder: =MOD(A1,7)"],
  ["POWER", "a power: =POWER(2,8)"],
  ["SQRT", "a square root"],
  ["AND", "TRUE if all are true"],
  ["OR", "TRUE if any is true"],
  ["NOT", "the opposite"],
  ["CONCATENATE", 'joins text: =CONCATENATE(A1," ",B1)'],
  ["LEN", "how many characters"],
  ["UPPER", "CAPITALS"],
  ["LOWER", "small letters"],
  ["TRIM", "removes extra spaces"],
]

// drag a column header's right edge (mouse)
const ColResizer = ({ width, onResize }) => {
  const start = useRef(null)
  return (
    <span
      className="shResize"
      onPointerDown={(e) => {
        e.stopPropagation()
        e.preventDefault()
        start.current = { x: e.clientX, w: width }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (start.current) onResize(start.current.w + e.clientX - start.current.x)
      }}
      onPointerUp={() => (start.current = null)}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  )
}

export default Sheets
