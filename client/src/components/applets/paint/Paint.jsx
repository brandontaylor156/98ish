import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import FileDialog from "../notepad/FileDialog"
import EditColors from "./EditColors"
import { BrushSample, EraserSample, FillSample, LineSample, SelectModeSample, SpraySample, ToolIcon } from "./PaintIcons"
import * as P from "./paintLogic"
import { fs, writeAndSave } from "../../../utils/fs"
import { saveWallpaperImage, setSettings } from "../../../utils/settings"
import { useFsVersion } from "../../../hooks/useFs"
import { trackUnsaved } from "../../../utils/unsaved"
import "./Paint.css"
import { progress, unlock } from "../../../utils/achievements"

// Paint, as in Windows 98: the tool box with its options, the color box, menus, undo,
// selections you can drag, cut, copy and paste, text, the canvas resize handles, Open /
// Save over the 98ish drive (pictures are PNGs) and Set As Wallpaper. Mouse, pen and touch
// all draw (Pointer Events); on touch two fingers scroll the picture.

const TOOLS = [
  { id: "freeselect", label: "Free-Form Select", hint: "Selects a free-form part of the picture to move, copy, or edit." },
  { id: "select", label: "Select", hint: "Selects a rectangular part of the picture to move, copy, or edit." },
  { id: "eraser", label: "Eraser/Color Eraser", hint: "Erases a portion of the picture, using the selected eraser shape." },
  { id: "fill", label: "Fill With Color", hint: "Fills an area with the current drawing color." },
  { id: "pick", label: "Pick Color", hint: "Picks up a color from the picture for drawing." },
  { id: "magnifier", label: "Magnifier", hint: "Changes the magnification." },
  { id: "pencil", label: "Pencil", hint: "Draws a free-form line one pixel wide." },
  { id: "brush", label: "Brush", hint: "Draws using a brush with the selected shape and size." },
  { id: "airbrush", label: "Airbrush", hint: "Draws using an airbrush of the selected size." },
  { id: "text", label: "Text", hint: "Inserts text into the picture." },
  { id: "line", label: "Line", hint: "Draws a straight line with the selected line width." },
  { id: "curve", label: "Curve", hint: "Draws a curved line with the selected line width." },
  { id: "rect", label: "Rectangle", hint: "Draws a rectangle with the selected fill style." },
  { id: "polygon", label: "Polygon", hint: "Draws a polygon with the selected fill style." },
  { id: "ellipse", label: "Ellipse", hint: "Draws an ellipse with the selected fill style." },
  { id: "roundrect", label: "Rounded Rectangle", hint: "Draws a rounded rectangle with the selected fill style." },
]

const BRUSHES = [
  ["round", 7], ["round", 4], ["round", 1],
  ["square", 8], ["square", 5], ["square", 2],
  ["slash", 8], ["slash", 5], ["slash", 3],
  ["backslash", 8], ["backslash", 5], ["backslash", 3],
]
const ERASERS = [4, 6, 8, 10]
const SPRAYS = [4, 8, 12]
const ZOOMS = [1, 2, 6, 8]
const WIDTHS = [1, 2, 3, 4, 5]
const FILL_STYLES = ["outline", "both", "fill"]
const FONTS = ["Arial", "Times New Roman", "Courier New", "Comic Sans MS", "Verdana", "Georgia", "Impact"]
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72]
const MAX_UNDO = 30
const MAX_UNDO_BYTES = 160 * 1024 * 1024 // big pictures keep fewer undo levels
const MAX_SIDE = 4000
const DEFAULT_HINT = "For Help, click About Paint on the Help Menu."
const PREFS_KEY = "98ish.paint"

const loadPrefs = () => {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}
  } catch {
    return {}
  }
}
const savePrefs = (patch) => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...patch }))
  } catch {
    // not remembered
  }
}


// one clipboard for every Paint window: a piece (see-through outside a free-form shape)
let clipboard = null

// still on the drive (not deleted, not in the Recycle Bin)?
const onDrive = (file) => !!file && fs.partsOf(file)[0] === "C:" && fs.resolve(fs.partsOf(file)) === file

const toImageData = (s) => new ImageData(s.data, s.width, s.height)

// a surface -> PNG data URL
const surfaceToPng = (s) => {
  const canvas = document.createElement("canvas")
  canvas.width = s.width
  canvas.height = s.height
  canvas.getContext("2d").putImageData(toImageData(s), 0, 0)
  return canvas.toDataURL("image/png")
}

// an image URL (data URL or blob) -> surface, see-through parts on white (or as-is)
const loadSurface = (url, { opaque = true } = {}) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const w = Math.min(MAX_SIDE, img.naturalWidth || 1)
      const h = Math.min(MAX_SIDE, img.naturalHeight || 1)
      const canvas = document.createElement("canvas")
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext("2d")
      if (opaque) {
        ctx.fillStyle = "#ffffff"
        ctx.fillRect(0, 0, w, h)
      }
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(0, 0, w, h)
      resolve({ width: w, height: h, data: data.data })
    }
    img.onerror = () => reject(new Error("bad image"))
    img.src = url
  })

const textFont = (f, zoom = 1) => `${f.italic ? "italic " : ""}${f.bold ? "bold " : ""}${Math.round(((f.size * 4) / 3) * zoom)}px "${f.family}", sans-serif`
const lineHeightFor = (f) => Math.round(((f.size * 4) / 3) * 1.2)

// Word-wrap text the way the text box shows it
const wrapText = (ctx, text, width) => {
  const out = []
  for (const para of text.split("\n")) {
    let line = ""
    for (const word of para.split(/(\s+)/)) {
      const next = line + word
      if (line && ctx.measureText(next).width > width && word.trim()) {
        out.push(line.trimEnd())
        line = word.trimStart()
        // a single word wider than the box breaks by letters
        while (ctx.measureText(line).width > width && line.length > 1) {
          let cut = line.length - 1
          while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > width) cut--
          out.push(line.slice(0, cut))
          line = line.slice(cut)
        }
      } else line = next
    }
    out.push(line)
  }
  return out
}

const Paint = ({ file: initialFile = null, mobile = false, onTitle, onClose, registerCloseGuard }) => {
  useFsVersion()
  const prefs = useRef(loadPrefs()).current

  // ---- state ----
  const [file, setFile] = useState(initialFile)
  const [tool, setToolState] = useState("pencil")
  const [prevTool, setPrevTool] = useState("pencil")
  const [colors, setColors] = useState({ primary: "#000000", secondary: "#ffffff" })
  const [well, setWell] = useState("primary") // which color a tap on the palette sets (touch)
  const [palette, setPalette] = useState(() => (Array.isArray(prefs.palette) && prefs.palette.length === 28 ? prefs.palette : P.PALETTE))
  const [paletteIndex, setPaletteIndex] = useState(0)
  const [opts, setOpts] = useState({ brush: 1, eraser: 1, spray: 1, width: 0, fill: 0, transparent: false })
  const [font, setFont] = useState({ family: "Arial", size: 12, bold: false, italic: false, underline: false })
  const [view, setView] = useState({ toolbox: true, colorbox: true, statusbar: true, grid: false, ...prefs.view })
  const [zoom, setZoom] = useState(1)
  const [size, setSize] = useState(mobile ? { w: 360, h: 360 } : { w: 480, h: 320 })
  const [sel, setSelState] = useState(null) // { x, y, w, h, polygon, piece }
  const [textBox, setTextBoxState] = useState(null) // { x, y, w, h, text }
  const [lasso, setLasso] = useState(null) // free-form select path while drawing
  const [resize, setResize] = useState(null) // { w, h } while dragging a canvas handle
  const [status, setStatus] = useState({ pos: null, hint: null, size: null })
  const [hover, setHover] = useState(null) // { x, y } under the pointer (eraser outline)
  const [dialog, setDialog] = useState(null)
  const [viewBitmap, setViewBitmap] = useState(false)
  const [savedId, setSavedId] = useState(0)
  const [, setRev] = useState(0)

  // ---- the picture ----
  const img = useRef(P.createSurface(size.w, size.h))
  const stateId = useRef(0)
  const idCounter = useRef(0)
  const undoStack = useRef([])
  const redoStack = useRef([])
  const canvasRef = useRef(null)
  const pieceRef = useRef(null)
  const areaRef = useRef(null)
  const rootRef = useRef(null)
  const textRef = useRef(null)
  const drag = useRef(null) // the stroke in progress
  const curve = useRef(null) // { base, p0, p3, c1, c2, phase, right }
  const poly = useRef(null) // { base, points, right, lastUp }
  const selRef = useRef(null)
  const textBoxRef = useRef(null)
  const touches = useRef(new Map())
  const pan = useRef(null)
  const zoomCenter = useRef(null)
  const afterSave = useRef(null)
  const frame = useRef(0)
  const pasteKey = useRef(null)
  const resizeRef = useRef(null)

  const dirty = stateId.current !== savedId
  const name = file ? file.name : "untitled"
  const live = useRef({})
  live.current = { dirty, name }

  const rgb = (hex) => P.parseColor(hex)
  const lineOffsets = (w) => P.stampOffsets("round", w)
  const lineWidth = WIDTHS[opts.width]
  const fillStyle = FILL_STYLES[opts.fill]

  const setSel = (next) => {
    selRef.current = next
    setSelState(next)
  }
  const setTextBox = (next) => {
    textBoxRef.current = next
    setTextBoxState(next)
  }

  useEffect(() => onTitle?.(`${name} - Paint`), [name])

  useEffect(() => (dirty ? trackUnsaved("Paint") : undefined), [dirty])

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

  useEffect(() => savePrefs({ palette, view }), [palette, view])

  // keys go to Paint when it opens and when a dialog closes
  useEffect(() => {
    const focused = document.activeElement
    if (!dialog && (!focused || focused === document.body)) rootRef.current?.focus({ preventScroll: true })
  }, [dialog])

  // ---- drawing to the screen ----

  const show = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const s = img.current
    if (canvas.width !== s.width || canvas.height !== s.height) {
      canvas.width = s.width
      canvas.height = s.height
    }
    canvas.getContext("2d").putImageData(toImageData(s), 0, 0)
  }
  // at most once a frame while drawing
  const showSoon = () => {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      show()
    })
  }
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  // the picture changed size (new, open, attributes, rotate...)
  const replaceImage = (s) => {
    img.current = s
    setSize({ w: s.width, h: s.height })
    show()
  }
  useLayoutEffect(show, [size.w, size.h])

  // the floating selection's own little canvas
  useEffect(() => {
    const canvas = pieceRef.current
    const piece = sel?.piece
    if (!canvas || !piece) return
    canvas.width = piece.width
    canvas.height = piece.height
    let shown = piece
    if (opts.transparent) {
      shown = P.cloneSurface(piece)
      const [r, g, b] = rgb(colors.secondary)
      const d = shown.data
      for (let i = 0; i < d.length; i += 4) if (d[i] === r && d[i + 1] === g && d[i + 2] === b) d[i + 3] = 0
    }
    canvas.getContext("2d").putImageData(toImageData(shown), 0, 0)
  }, [sel?.piece, opts.transparent, colors.secondary])

  // ---- undo ----

  // call before changing the picture
  const record = (snapshot = P.cloneSurface(img.current)) => {
    const stack = undoStack.current
    stack.push({ s: snapshot, id: stateId.current })
    let bytes = stack.reduce((sum, e) => sum + e.s.data.length, 0)
    while (stack.length > 1 && (stack.length > MAX_UNDO || bytes > MAX_UNDO_BYTES)) bytes -= stack.shift().s.data.length
    redoStack.current = []
    stateId.current = ++idCounter.current
    setRev((n) => n + 1)
  }

  const undo = () => {
    if (finishText(false)) return
    if (cancelInProgress()) return
    const entry = undoStack.current.pop()
    if (!entry) return
    redoStack.current.push({ s: img.current, id: stateId.current })
    setSel(null)
    stateId.current = entry.id
    replaceImage(entry.s)
    setRev((n) => n + 1)
  }

  const redo = () => {
    commitAll()
    const entry = redoStack.current.pop()
    if (!entry) return
    undoStack.current.push({ s: img.current, id: stateId.current })
    stateId.current = entry.id
    replaceImage(entry.s)
    setRev((n) => n + 1)
  }

  // ---- finishing things in progress ----

  // drop a polygon or curve that isn't finished (Undo, Escape); true if there was one
  const cancelInProgress = () => {
    const pending = poly.current || curve.current
    if (!pending) return false
    img.current.data.set(pending.base.data)
    poly.current = null
    curve.current = null
    const entry = undoStack.current.pop()
    if (entry) stateId.current = entry.id
    show()
    setRev((n) => n + 1)
    return true
  }

  const finishPolygon = () => {
    const p = poly.current
    if (!p) return
    poly.current = null
    img.current.data.set(p.base.data)
    const line = rgb(p.right ? colors.secondary : colors.primary)
    const fill = rgb(p.right ? colors.primary : colors.secondary)
    if (p.points.length > 2) P.drawPolygon(img.current, p.points, fillStyle, lineOffsets(lineWidth), line, fill)
    else P.drawPolyline(img.current, p.points, lineOffsets(lineWidth), line)
    show()
  }

  // put a floating selection down
  const dropSelection = () => {
    const s = selRef.current
    if (!s) return
    if (s.piece) {
      P.stamp(img.current, s.piece, s.x, s.y, opts.transparent ? rgb(colors.secondary) : null)
      show()
    }
    setSel(null)
  }

  // the text box's text goes into the picture (or is thrown away); true if there was one
  const finishText = (keep = true) => {
    const box = textBoxRef.current
    if (!box) return false
    setTextBox(null)
    if (!keep || !box.text.trim()) {
      // nothing typed (or Escape): no change after all
      const entry = undoStack.current.pop()
      if (entry) stateId.current = entry.id
      setRev((n) => n + 1)
      return true
    }
    const canvas = document.createElement("canvas")
    canvas.width = box.w
    canvas.height = box.h
    const ctx = canvas.getContext("2d")
    ctx.font = textFont(font)
    ctx.textBaseline = "top"
    ctx.fillStyle = "#000"
    const lh = lineHeightFor(font)
    wrapText(ctx, box.text, box.w).forEach((line, i) => {
      ctx.fillText(line, 1, i * lh + 1)
      if (font.underline && line) ctx.fillRect(1, i * lh + Math.round(lh * 0.92), ctx.measureText(line).width, Math.max(1, Math.round(font.size / 12)))
    })
    const glyphs = ctx.getImageData(0, 0, box.w, box.h).data
    const s = img.current
    if (!opts.transparent) P.fillRect(s, box.x, box.y, box.w, box.h, rgb(colors.secondary))
    const ink = rgb(colors.primary)
    // hard edges, like the original: a pixel is ink or it isn't
    for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) if (glyphs[(y * box.w + x) * 4 + 3] >= 128) P.setPixel(s, box.x + x, box.y + y, ink)
    show()
    return true
  }

  // finish everything: before saving, switching tools, menu commands
  const commitAll = () => {
    finishText()
    finishPolygon()
    curve.current = null
    dropSelection()
  }

  const setTool = (id) => {
    commitAll()
    if (id === "pick") setPrevTool(tool)
    setToolState(id)
    progress("paint-tools", id, TOOLS.length)
    setLasso(null)
  }

  // ---- selections ----

  const lift = ({ copy = false } = {}) => {
    const s = selRef.current
    if (!s || s.piece) return s
    record()
    const piece = P.extract(img.current, s.x, s.y, s.w, s.h, s.polygon)
    if (!copy) P.clearUnder(img.current, piece, s.x, s.y, rgb(colors.secondary))
    show()
    const next = { ...s, piece, polygon: null }
    setSel(next)
    return next
  }

  const selectionPiece = () => {
    const s = selRef.current
    if (!s) return null
    return s.piece || P.extract(img.current, s.x, s.y, s.w, s.h, s.polygon)
  }

  const copy = () => {
    const piece = selectionPiece()
    if (!piece) return
    clipboard = P.cloneSurface(piece)
    // the real clipboard too, where the browser allows it
    try {
      const canvas = document.createElement("canvas")
      canvas.width = piece.width
      canvas.height = piece.height
      canvas.getContext("2d").putImageData(toImageData(piece), 0, 0)
      canvas.toBlob((blob) => {
        if (blob && window.ClipboardItem && navigator.clipboard?.write) navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).catch(() => {})
      })
    } catch {
      // only the Paint clipboard then
    }
  }

  const clearSelection = () => {
    const s = selRef.current
    if (!s) return
    if (!s.piece) {
      record()
      P.clearUnder(img.current, P.extract(img.current, s.x, s.y, s.w, s.h, s.polygon), s.x, s.y, rgb(colors.secondary))
      show()
    }
    setSel(null)
  }

  const cut = () => {
    if (!selRef.current) return
    copy()
    clearSelection()
  }

  // a piece arrives (Paint's clipboard, the system clipboard, a dropped file)
  const placePiece = (piece, ask = true) => {
    commitAll()
    const s = img.current
    if (ask && (piece.width > s.width || piece.height > s.height)) {
      setDialog({ kind: "enlarge", piece })
      return
    }
    record()
    const area = areaRef.current
    const x = Math.max(0, Math.min(s.width - 1, Math.floor((area?.scrollLeft || 0) / zoom)))
    const y = Math.max(0, Math.min(s.height - 1, Math.floor((area?.scrollTop || 0) / zoom)))
    setToolState("select")
    setSel({ x: piece.width > s.width ? 0 : Math.min(x, s.width - piece.width), y: piece.height > s.height ? 0 : Math.min(y, s.height - piece.height), w: piece.width, h: piece.height, polygon: null, piece })
  }

  const pasteFromBlob = async (blob) => {
    const url = URL.createObjectURL(blob)
    try {
      placePiece(await loadSurface(url, { opaque: false }))
    } catch {
      setDialog({ kind: "alert", title: "Paint", text: "Paint can't read that picture." })
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  const paste = async () => {
    if (clipboard) return placePiece(P.cloneSurface(clipboard))
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith("image/"))
        if (type) return pasteFromBlob(await item.getType(type))
      }
    } catch {
      // not allowed: fall through
    }
    setDialog({ kind: "alert", title: "Paint", text: "There's no picture to paste. Copy part of a picture first." })
  }

  const selectAll = () => {
    commitAll()
    setToolState("select")
    setSel({ x: 0, y: 0, w: img.current.width, h: img.current.height, polygon: null, piece: null })
  }

  // ---- picture-wide commands (they act on the selection when there is one) ----

  const transform = (fn) => {
    finishText()
    finishPolygon()
    if (selRef.current) {
      const s = lift()
      const piece = fn(s.piece, true)
      setSel({ ...s, piece, w: piece.width, h: piece.height })
      return
    }
    record()
    replaceImage(fn(img.current, false))
  }

  const invertColors = () => transform((s) => P.invert(P.cloneSurface(s)))
  const flipRotate = (how) =>
    transform((s) => (how === "h" ? P.flipHorizontal(s) : how === "v" ? P.flipVertical(s) : P.rotate(s, Number(how))))
  const stretchSkew = ({ sx, sy, kx, ky }) =>
    transform((s, isPiece) => {
      let out = sx !== 100 || sy !== 100 ? P.stretch(s, sx, sy) : s
      if (kx || ky) out = P.skew(out, kx, ky, isPiece ? null : rgb(colors.secondary))
      return out === s ? P.cloneSurface(s) : out
    })

  const setCanvasSize = (w, h) => {
    commitAll()
    w = Math.max(1, Math.min(MAX_SIDE, Math.round(w)))
    h = Math.max(1, Math.min(MAX_SIDE, Math.round(h)))
    if (w === img.current.width && h === img.current.height) return
    record()
    replaceImage(P.resizeCanvas(img.current, w, h, rgb(colors.secondary)))
  }

  const clearImage = () => {
    commitAll()
    record()
    P.fillRect(img.current, 0, 0, img.current.width, img.current.height, rgb(colors.secondary))
    show()
  }

  // ---- files ----

  const pictureUrl = () => {
    commitAll()
    return surfaceToPng(img.current)
  }

  const markSaved = () => {
    setSavedId(stateId.current)
    const next = afterSave.current
    afterSave.current = null
    next?.()
  }

  const tooBig = () =>
    setDialog({ kind: "alert", title: "Paint", text: "There isn't enough room on the 98ish drive to save this picture. Try making it smaller (Image > Attributes), or delete some files and try again." })

  const writeTo = (dir, fileName) => {
    const url = pictureUrl()
    try {
      let target = dir.getItem(fileName)
      let ok
      if (target && target.isImage) ok = writeAndSave(target, url)
      else {
        target = fs.createFileIn(dir, fileName, "image", "")
        ok = writeAndSave(target, url, { created: true })
      }
      if (!ok) {
        afterSave.current = null
        return tooBig()
      }
      setFile(target)
      setDialog(null)
      markSaved()
    } catch (error) {
      afterSave.current = null
      setDialog({ kind: "alert", title: "Paint", text: error.message })
    }
  }

  const save = () => {
    if (onDrive(file) && file.isImage) {
      if (!writeAndSave(file, pictureUrl())) {
        afterSave.current = null
        return tooBig()
      }
      setDialog(null)
      return markSaved()
    }
    commitAll()
    setDialog({ kind: "saveAs" })
  }

  // run `then` now, or after asking about unsaved changes
  const guard = (then) => {
    commitAll()
    if (stateId.current === savedId) return then()
    afterSave.current = then
    setDialog({ kind: "changed" })
  }

  const resetHistory = () => {
    undoStack.current = []
    redoStack.current = []
    stateId.current = ++idCounter.current
    setSavedId(stateId.current)
  }

  const newPicture = () =>
    guard(() => {
      setSel(null)
      setFile(null)
      replaceImage(P.createSurface(img.current.width, img.current.height, rgb("#ffffff")))
      resetHistory()
      setDialog(null)
    })

  const openFile = async (target) => {
    setDialog(null)
    try {
      if (!target.textContent) throw new Error("empty")
      const s = await loadSurface(target.textContent)
      setSel(null)
      setTextBox(null)
      poly.current = null
      curve.current = null
      setFile(target)
      replaceImage(s)
      resetHistory()
    } catch {
      // an empty or broken picture opens as a blank one with that name
      if (!target.textContent) {
        setFile(target)
        resetHistory()
        return
      }
      setDialog({ kind: "alert", title: "Paint", text: `Paint cannot read ${target.name}. It isn't a valid picture.` })
    }
  }

  useEffect(() => {
    if (initialFile) openFile(initialFile)
  }, [])

  const setAsWallpaper = (display) => {
    const url = pictureUrl()
    if (!saveWallpaperImage(url)) return setDialog({ kind: "alert", title: "Paint", text: "This picture is too big to use as the wallpaper. Try making it smaller (Image > Attributes)." })
    setSettings({ wallpaper: "custom", display })
    unlock("wallpaper")
  }

  // ---- colors ----

  const pickSwatch = (hex, which) => setColors((c) => ({ ...c, [which]: hex }))

  const editColor = (index) => {
    setPaletteIndex(index)
    setDialog({ kind: "colors", index, color: palette[index] ?? colors.primary })
  }

  // ---- pointer input on the picture ----

  const toPixel = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    return [Math.floor((e.clientX - r.left) / zoom), Math.floor((e.clientY - r.top) / zoom)]
  }

  const inSelection = ([x, y]) => {
    const s = selRef.current
    return !!s && x >= s.x && y >= s.y && x < s.x + (s.piece?.width ?? s.w) && y < s.y + (s.piece?.height ?? s.h)
  }

  const spray = (x, y, right) => {
    const r = SPRAYS[opts.spray]
    const c = rgb(right ? colors.secondary : colors.primary)
    for (const [px, py] of P.sprayDots(x, y, r, Math.ceil(r * 0.9))) P.setPixel(img.current, px, py, c)
    showSoon()
  }

  const clampToImage = ([x, y]) => [Math.max(0, Math.min(img.current.width - 1, x)), Math.max(0, Math.min(img.current.height - 1, y))]

  const startStroke = (e, p, right) => {
    const s = img.current
    const primary = rgb(colors.primary)
    const secondary = rgb(colors.secondary)
    const c = right ? secondary : primary
    const d = { id: e.pointerId, right, start: p, last: p, tool, touch: e.pointerType !== "mouse" }

    switch (tool) {
      case "pencil":
      case "brush":
      case "eraser": {
        record()
        d.paint = (a, b) => {
          if (tool === "pencil") P.drawStroke(s, a[0], a[1], b[0], b[1], [[0, 0]], c)
          else if (tool === "brush") {
            const [shape, sz] = BRUSHES[opts.brush]
            P.drawStroke(s, a[0], a[1], b[0], b[1], P.stampOffsets(shape, sz), c)
          } else {
            const offsets = P.stampOffsets("square", ERASERS[opts.eraser])
            if (right) P.replaceStroke(s, a[0], a[1], b[0], b[1], offsets, primary, secondary)
            else P.drawStroke(s, a[0], a[1], b[0], b[1], offsets, secondary)
          }
          showSoon()
        }
        d.paint(p, p)
        break
      }
      case "airbrush":
        record()
        spray(p[0], p[1], right)
        d.timer = setInterval(() => spray(drag.current.last[0], drag.current.last[1], right), 40)
        break
      case "fill": {
        const before = P.cloneSurface(s)
        if (P.floodFill(s, p[0], p[1], c)) {
          record(before)
          show()
        }
        return null
      }
      case "pick":
      case "magnifier":
        break
      case "line":
      case "rect":
      case "ellipse":
      case "roundrect":
        d.base = P.cloneSurface(s)
        record(P.cloneSurface(s))
        break
      case "curve": {
        const cv = curve.current
        if (!cv) {
          d.base = P.cloneSurface(s)
          record(P.cloneSurface(s))
          curve.current = { base: d.base, p0: p, p3: p, phase: 0, right }
        } else if (cv.phase === 1) cv.c1 = p
        else cv.c2 = p
        break
      }
      case "polygon": {
        const pg = poly.current
        if (!pg) {
          const base = P.cloneSurface(s)
          record(P.cloneSurface(s))
          poly.current = { base, points: [p, p], right, lastUp: 0 }
        } else pg.points.push(p)
        break
      }
      case "select":
      case "freeselect": {
        if (inSelection(p)) {
          // drag the selection; Ctrl drags a copy
          let current = selRef.current
          if (current.piece && (e.ctrlKey || e.metaKey)) {
            P.stamp(s, current.piece, current.x, current.y, opts.transparent ? secondary : null)
            show()
          } else if (!current.piece) current = lift({ copy: e.ctrlKey || e.metaKey })
          d.move = { x: current.x, y: current.y }
        } else {
          dropSelection()
          if (tool === "freeselect") {
            d.path = [clampToImage(p)]
            setLasso(d.path)
          }
        }
        break
      }
      case "text": {
        const box = textBoxRef.current
        if (box) {
          finishText()
          return null // the first press just finishes the old text
        }
        break
      }
      default:
        break
    }
    return d
  }

  const moveStroke = (d, p, e) => {
    const s = img.current
    const primary = rgb(colors.primary)
    const secondary = rgb(colors.secondary)
    const line = d.right ? secondary : primary
    const fill = d.right ? primary : secondary
    const shift = e.shiftKey
    switch (d.tool) {
      case "pencil":
      case "brush":
      case "eraser":
        d.paint(d.last, p)
        break
      case "airbrush":
        spray(p[0], p[1], d.right)
        break
      case "line": {
        s.data.set(d.base.data)
        const [x1, y1] = shift ? P.snapLine(d.start[0], d.start[1], p[0], p[1]) : p
        P.drawStroke(s, d.start[0], d.start[1], x1, y1, lineOffsets(lineWidth), line)
        setStatus((st) => ({ ...st, size: `${Math.abs(x1 - d.start[0]) + 1}x${Math.abs(y1 - d.start[1]) + 1}` }))
        showSoon()
        break
      }
      case "rect":
      case "ellipse":
      case "roundrect": {
        s.data.set(d.base.data)
        const [x1, y1] = shift ? P.snapSquare(d.start[0], d.start[1], p[0], p[1]) : p
        const box = P.boxOf(d.start[0], d.start[1], x1, y1)
        P.drawShape(s, d.tool, box, fillStyle, lineWidth, line, fill)
        setStatus((st) => ({ ...st, size: `${box.x1 - box.x0 + 1}x${box.y1 - box.y0 + 1}` }))
        showSoon()
        break
      }
      case "curve": {
        const cv = curve.current
        s.data.set(cv.base.data)
        const lc = rgb(cv.right ? colors.secondary : colors.primary)
        if (cv.phase === 0) {
          cv.p3 = p
          P.drawStroke(s, cv.p0[0], cv.p0[1], p[0], p[1], lineOffsets(lineWidth), lc)
        } else {
          if (cv.phase === 1) cv.c1 = p
          else cv.c2 = p
          const c2 = cv.phase === 1 ? cv.c1 : cv.c2
          P.drawPolyline(s, P.bezierPoints(cv.p0, cv.c1, c2, cv.p3), lineOffsets(lineWidth), lc)
        }
        showSoon()
        break
      }
      case "polygon": {
        const pg = poly.current
        pg.points[pg.points.length - 1] = shift ? P.snapLine(...pg.points.at(-2), p[0], p[1]) : p
        s.data.set(pg.base.data)
        P.drawPolyline(s, pg.points, lineOffsets(lineWidth), rgb(pg.right ? colors.secondary : colors.primary))
        showSoon()
        break
      }
      case "select":
      case "freeselect": {
        if (d.move) {
          const cur = selRef.current
          setSel({ ...cur, x: d.move.x + p[0] - d.start[0], y: d.move.y + p[1] - d.start[1] })
        } else if (d.path) {
          const q = clampToImage(p)
          const last = d.path.at(-1)
          if (q[0] !== last[0] || q[1] !== last[1]) {
            d.path = [...d.path, q]
            setLasso(d.path)
          }
        } else {
          const a = clampToImage(d.start)
          const b = clampToImage(p)
          const box = P.boxOf(a[0], a[1], b[0], b[1])
          d.marquee = box
          setSel({ x: box.x0, y: box.y0, w: box.x1 - box.x0 + 1, h: box.y1 - box.y0 + 1, polygon: null, piece: null, marquee: true })
        }
        break
      }
      case "text": {
        const a = clampToImage(d.start)
        const b = clampToImage(p)
        const box = P.boxOf(a[0], a[1], b[0], b[1])
        d.box = box
        setSel({ x: box.x0, y: box.y0, w: box.x1 - box.x0 + 1, h: box.y1 - box.y0 + 1, polygon: null, piece: null, marquee: true })
        break
      }
      default:
        break
    }
    d.last = p
  }

  const endStroke = (d, p, e) => {
    clearInterval(d.timer)
    const s = img.current
    switch (d.tool) {
      case "pick": {
        const c = P.getPixel(s, p[0], p[1])
        // on touch the color well says which color to set
        if (c) pickSwatch(P.toHex(c), d.right ? "secondary" : d.touch ? well : "primary")
        setToolState(prevTool === "pick" ? "pencil" : prevTool)
        break
      }
      case "magnifier":
        zoomCenter.current = p
        setZoom(d.right || zoom !== 1 ? 1 : 4)
        break
      case "curve": {
        // drag the line, then drag (or tap) twice to bend it
        const cv = curve.current
        if (cv.phase === 0) cv.phase = 1
        else if (cv.phase === 1) cv.phase = 2
        else curve.current = null // done: the curve is in the picture
        break
      }
      case "polygon": {
        const pg = poly.current
        const now = performance.now()
        const first = pg.points[0]
        const last = pg.points.at(-1)
        const near = Math.max(3, Math.ceil(8 / zoom))
        const prev = pg.points.at(-2)
        // close it: back at the start, or a double-click
        const closes =
          pg.points.length > 3 && Math.abs(last[0] - first[0]) <= near && Math.abs(last[1] - first[1]) <= near
        const doubled = now - pg.lastUp < 400 && prev && Math.abs(last[0] - prev[0]) <= near && Math.abs(last[1] - prev[1]) <= near
        pg.lastUp = now
        if (closes) {
          pg.points.pop()
          finishPolygon()
        } else if (doubled && pg.points.length > 2) {
          pg.points.pop()
          finishPolygon()
        }
        break
      }
      case "select":
      case "freeselect": {
        if (d.move) break
        if (d.path) {
          setLasso(null)
          const path = d.path
          if (path.length < 3) break
          const xs = path.map((q) => q[0])
          const ys = path.map((q) => q[1])
          const x0 = Math.min(...xs)
          const y0 = Math.min(...ys)
          setSel({ x: x0, y: y0, w: Math.max(...xs) - x0 + 1, h: Math.max(...ys) - y0 + 1, polygon: path, piece: null })
        } else if (d.marquee) {
          const b = d.marquee
          setSel({ x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1, polygon: null, piece: null })
        } else setSel(null)
        break
      }
      case "text": {
        const fontPx = Math.round((font.size * 4) / 3)
        let box = d.box
        const s2 = img.current
        if (!box || box.x1 - box.x0 < 8) {
          // a tap: a box big enough to start typing
          const [x, y] = clampToImage(d.start)
          box = { x0: x, y0: y, x1: Math.min(s2.width - 1, x + Math.max(120, fontPx * 8)), y1: Math.min(s2.height - 1, y + lineHeightFor(font) + 3) }
        }
        setSel(null)
        record()
        setTextBox({ x: box.x0, y: box.y0, w: box.x1 - box.x0 + 1, h: Math.max(box.y1 - box.y0 + 1, lineHeightFor(font) + 3), text: "", recorded: true })
        requestAnimationFrame(() => textRef.current?.focus({ preventScroll: true }))
        break
      }
      default:
        break
    }
    setStatus((st) => ({ ...st, size: null }))
    show()
  }

  // Escape while drawing: put everything back
  const cancelStroke = () => {
    const d = drag.current
    if (!d) return
    clearInterval(d.timer)
    drag.current = null
    const entry = undoStack.current.at(-1)
    if (["pencil", "brush", "eraser", "airbrush", "line", "rect", "ellipse", "roundrect"].includes(d.tool) && entry) {
      undoStack.current.pop()
      stateId.current = entry.id
      replaceImage(entry.s)
    } else if (d.tool === "curve" || d.tool === "polygon") cancelInProgress()
    else if (d.marquee || d.box) setSel(null)
    setLasso(null)
    setRev((n) => n + 1)
  }

  const onPointerDown = (e) => {
    if (e.target.closest(".pTextBox, .pHandle")) return
    if (e.pointerType === "touch") {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      // a second finger: stop drawing and scroll instead
      if (touches.current.size === 2) {
        cancelStroke()
        const pts = [...touches.current.values()]
        const area = areaRef.current
        pan.current = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2, left: area.scrollLeft, top: area.scrollTop }
        return
      }
      if (touches.current.size > 2 || pan.current) return
    }
    if (drag.current) return
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 2) return
    e.preventDefault()
    rootRef.current?.focus({ preventScroll: true })
    const right = e.button === 2
    const p = toPixel(e)
    if (!["select", "freeselect", "text"].includes(tool)) {
      finishText()
      dropSelection()
    }
    const d = startStroke(e, p, right)
    if (!d) return
    drag.current = d
    // shapes show from the first press (a dot, or the bend of a curve)
    if (["line", "rect", "ellipse", "roundrect", "curve", "polygon"].includes(tool)) moveStroke(d, p, e)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // the pointer is already gone
    }
  }

  const onPointerMove = (e) => {
    if (e.pointerType === "touch" && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pan.current && touches.current.size >= 2) {
        const pts = [...touches.current.values()]
        const mx = (pts[0].x + pts[1].x) / 2
        const my = (pts[0].y + pts[1].y) / 2
        areaRef.current.scrollLeft = pan.current.left - (mx - pan.current.x)
        areaRef.current.scrollTop = pan.current.top - (my - pan.current.y)
        return
      }
    }
    const p = toPixel(e)
    const s = img.current
    setStatus((st) => ({ ...st, pos: p[0] >= 0 && p[1] >= 0 && p[0] < s.width && p[1] < s.height ? p : st.pos }))
    if (e.pointerType === "mouse") setHover(p)
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    // coalesced events keep fast strokes smooth
    const events = e.nativeEvent.getCoalescedEvents?.() || []
    if (events.length > 1 && ["pencil", "brush", "eraser", "airbrush"].includes(d.tool)) {
      for (const ce of events) moveStroke(d, toPixel(ce), e)
    } else moveStroke(d, p, e)
  }

  const onPointerUp = (e) => {
    if (e.pointerType === "touch") {
      touches.current.delete(e.pointerId)
      if (pan.current) {
        if (touches.current.size === 0) pan.current = null
        return
      }
    }
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    endStroke(d, toPixel(e), e)
  }

  // ---- canvas resize handles ----

  const handleDrag = (edge) => ({
    onPointerDown: (e) => {
      e.preventDefault()
      e.stopPropagation()
      commitAll()
      e.currentTarget.setPointerCapture(e.pointerId)
      const r = canvasRef.current.getBoundingClientRect()
      e.currentTarget.dataset.left = r.left
      e.currentTarget.dataset.top = r.top
      resizeRef.current = { w: img.current.width, h: img.current.height }
      setResize(resizeRef.current)
    },
    onPointerMove: (e) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
      const left = Number(e.currentTarget.dataset.left)
      const top = Number(e.currentTarget.dataset.top)
      const w = edge === "bottom" ? img.current.width : Math.max(1, Math.min(MAX_SIDE, Math.round((e.clientX - left) / zoom)))
      const h = edge === "right" ? img.current.height : Math.max(1, Math.min(MAX_SIDE, Math.round((e.clientY - top) / zoom)))
      resizeRef.current = { w, h }
      setResize(resizeRef.current)
      setStatus((st) => ({ ...st, size: `${w}x${h}` }))
    },
    onPointerUp: (e) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
      const r = resizeRef.current
      resizeRef.current = null
      setResize(null)
      setStatus((st) => ({ ...st, size: null }))
      if (r) setCanvasSize(r.w, r.h)
    },
  })

  // keep the magnified spot in view
  useLayoutEffect(() => {
    const area = areaRef.current
    const p = zoomCenter.current
    zoomCenter.current = null
    if (!area || !p) return
    area.scrollLeft = p[0] * zoom - area.clientWidth / 2
    area.scrollTop = p[1] * zoom - area.clientHeight / 2
  }, [zoom])

  // ---- keys ----

  const onKeyDown = (e) => {
    if (e.target.closest("textarea, input, select, .dialog")) {
      if (e.key === "Escape" && e.target === textRef.current) finishText(false)
      return
    }
    const ctrl = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    const run = (fn) => {
      e.preventDefault()
      fn()
    }
    if (e.key === "Escape") {
      if (drag.current) return run(cancelStroke)
      if (poly.current || curve.current) return run(cancelInProgress)
      if (selRef.current) return run(dropSelection)
      return
    }
    if (e.key === "Enter" && poly.current) return run(finishPolygon)
    if (e.key === "Delete") return run(clearSelection)
    if (!ctrl) return
    if (key === "z") return run(e.shiftKey ? redo : undo)
    if (key === "y") return run(redo)
    if (key === "x") return run(cut)
    if (key === "c") return run(copy)
    if (key === "a") return run(selectAll)
    if (key === "s") return run(save)
    if (key === "o") return run(() => guard(() => setDialog({ kind: "open" })))
    if (key === "n" && e.shiftKey) return run(clearImage)
    if (key === "e") return run(() => setDialog({ kind: "attributes", w: img.current.width, h: img.current.height }))
    if (key === "r") return run(() => setDialog({ kind: "flip", how: "h", angle: "90" }))
    if (key === "i") return run(invertColors)
    if (key === "l") return run(() => setView((v) => ({ ...v, colorbox: !v.colorbox })))
    if (key === "g") return run(() => setView((v) => ({ ...v, grid: !v.grid })))
    if (key === "f") return run(() => (commitAll(), setViewBitmap(true)))
    if (e.key === "PageUp") return run(() => setZoom(1))
    if (e.key === "PageDown") return run(() => setZoom(4))
    // Ctrl+V: the paste event below brings the picture (the system clipboard's or ours)
    if (key === "v") pasteKey.current = setTimeout(() => clipboard && placePiece(P.cloneSurface(clipboard)))
  }

  const onPaste = (e) => {
    if (e.target.closest("textarea, input")) return
    clearTimeout(pasteKey.current)
    e.preventDefault()
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"))
    const blob = item?.getAsFile()
    // our own copy wins when there is one: the system copy can lag behind
    if (clipboard) return placePiece(P.cloneSurface(clipboard))
    if (blob) pasteFromBlob(blob)
  }

  // a picture file dropped onto Paint is pasted in
  const onDrop = (e) => {
    const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith("image/"))
    if (!f) return
    e.preventDefault()
    pasteFromBlob(f)
  }

  // ---- menus ----

  const hasSel = !!sel && !sel.marquee
  const menus = [
    {
      label: "File",
      items: [
        { label: "New Ctrl+N", onClick: newPicture },
        { label: "Open... Ctrl+O", onClick: () => guard(() => setDialog({ kind: "open" })) },
        { label: "Save Ctrl+S", onClick: save },
        { label: "Save As...", onClick: () => (commitAll(), setDialog({ kind: "saveAs" })) },
        "-",
        { label: "Set As Wallpaper (Tiled)", onClick: () => setAsWallpaper("tile") },
        { label: "Set As Wallpaper (Centered)", onClick: () => setAsWallpaper("center") },
        { label: "Set As Wallpaper (Stretched)", onClick: () => setAsWallpaper("stretch") },
        "-",
        { label: "Exit", onClick: () => guard(() => onClose?.()) },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo Ctrl+Z", disabled: !undoStack.current.length && !textBox && !poly.current && !curve.current, onClick: undo },
        { label: "Repeat Ctrl+Y", disabled: !redoStack.current.length, onClick: redo },
        "-",
        { label: "Cut Ctrl+X", disabled: !hasSel, onClick: cut },
        { label: "Copy Ctrl+C", disabled: !hasSel, onClick: copy },
        { label: "Paste Ctrl+V", onClick: paste },
        { label: "Clear Selection Del", disabled: !hasSel, onClick: clearSelection },
        { label: "Select All Ctrl+A", onClick: selectAll },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Tool Box", checked: view.toolbox, onClick: () => setView((v) => ({ ...v, toolbox: !v.toolbox })) },
        { label: "Color Box Ctrl+L", checked: view.colorbox, onClick: () => setView((v) => ({ ...v, colorbox: !v.colorbox })) },
        { label: "Status Bar", checked: view.statusbar, onClick: () => setView((v) => ({ ...v, statusbar: !v.statusbar })) },
        "-",
        { label: "Zoom: Normal Size Ctrl+PgUp", checked: zoom === 1, onClick: () => setZoom(1) },
        { label: "Zoom: Large Size Ctrl+PgDn", checked: zoom === 4, onClick: () => setZoom(4) },
        { label: "Zoom: Custom...", onClick: () => setDialog({ kind: "zoom", value: zoom }) },
        { label: "Show Grid Ctrl+G", checked: view.grid, disabled: zoom < 4, onClick: () => setView((v) => ({ ...v, grid: !v.grid })) },
        "-",
        { label: "View Bitmap Ctrl+F", onClick: () => (commitAll(), setViewBitmap(true)) },
      ],
    },
    {
      label: "Image",
      items: [
        { label: "Flip/Rotate... Ctrl+R", onClick: () => setDialog({ kind: "flip", how: "h", angle: "90" }) },
        { label: "Stretch/Skew...", onClick: () => setDialog({ kind: "stretch", sx: 100, sy: 100, kx: 0, ky: 0 }) },
        { label: "Invert Colors Ctrl+I", onClick: invertColors },
        { label: "Attributes... Ctrl+E", onClick: () => (commitAll(), setDialog({ kind: "attributes", w: img.current.width, h: img.current.height })) },
        { label: "Clear Image Ctrl+Shft+N", onClick: clearImage },
        { label: "Draw Opaque", checked: !opts.transparent, onClick: () => setOpts((o) => ({ ...o, transparent: !o.transparent })) },
      ],
    },
    {
      label: "Colors",
      items: [{ label: "Edit Colors...", onClick: () => editColor(paletteIndex) }],
    },
    {
      label: "Help",
      items: [{ label: "About Paint", onClick: () => setDialog({ kind: "about" }) }],
    },
  ]

  // after a menu command the keyboard shortcuts keep working
  for (const m of menus)
    m.items = m.items.map((item) =>
      item === "-" ? item : { ...item, onClick: () => (rootRef.current?.focus({ preventScroll: true }), item.onClick()) }
    )

  // ---- the options box under the tool box ----

  const option = (key, value, i, label, content, extraClass = "") => (
    <button
      key={i}
      type="button"
      className={`pOpt ${extraClass} ${value === i ? "is-on" : ""}`}
      aria-label={label}
      aria-pressed={value === i}
      onClick={() => setOpts((o) => ({ ...o, [key]: i }))}
    >
      {content}
    </button>
  )

  const optionsFor = () => {
    switch (tool) {
      case "select":
      case "freeselect":
      case "text":
        return (
          <div className="pOpts pOpts--col">
            {[false, true].map((t) => (
              <button key={String(t)} type="button" className={`pOpt pOpt--mode ${opts.transparent === t ? "is-on" : ""}`} aria-label={t ? "Draw Transparent" : "Draw Opaque"} aria-pressed={opts.transparent === t} onClick={() => setOpts((o) => ({ ...o, transparent: t }))}>
                <SelectModeSample transparent={t} />
              </button>
            ))}
          </div>
        )
      case "eraser":
        return <div className="pOpts pOpts--col">{ERASERS.map((sz, i) => option("eraser", opts.eraser, i, `Eraser size ${sz}`, <EraserSample size={sz} />))}</div>
      case "magnifier":
        return (
          <div className="pOpts pOpts--col">
            {ZOOMS.map((z) => (
              <button key={z} type="button" className={`pOpt pOpt--zoom ${zoom === z ? "is-on" : ""}`} aria-label={`Zoom ${z}x`} aria-pressed={zoom === z} onClick={() => setZoom(z)}>
                {z}x
              </button>
            ))}
          </div>
        )
      case "brush":
        return <div className="pOpts pOpts--grid">{BRUSHES.map(([shape, sz], i) => option("brush", opts.brush, i, `Brush ${shape} ${sz}`, <BrushSample shape={shape} size={sz} />))}</div>
      case "airbrush":
        return <div className="pOpts pOpts--col">{SPRAYS.map((r, i) => option("spray", opts.spray, i, `Airbrush size ${r}`, <SpraySample radius={r} />))}</div>
      case "line":
      case "curve":
        return <div className="pOpts pOpts--col">{WIDTHS.map((w, i) => option("width", opts.width, i, `Line width ${w}`, <LineSample width={w} />))}</div>
      case "rect":
      case "polygon":
      case "ellipse":
      case "roundrect":
        return (
          <div className="pOpts pOpts--col">
            {FILL_STYLES.map((st, i) =>
              option("fill", opts.fill, i, { outline: "Outline", both: "Outline and fill", fill: "Fill" }[st], <FillSample style={st} />)
            )}
          </div>
        )
      default:
        return <div className="pOpts" />
    }
  }

  // ---- render ----

  const W = size.w
  const H = size.h
  const cursor =
    tool === "text" ? "text" : tool === "magnifier" ? (zoom === 1 ? "zoom-in" : "zoom-out") : tool === "eraser" ? "none" : "crosshair"
  const statusHint = status.hint || DEFAULT_HINT
  const selBox = sel && { x: sel.x, y: sel.y, w: sel.piece?.width ?? sel.w, h: sel.piece?.height ?? sel.h }
  const sizeText = resize ? `${resize.w}x${resize.h}` : status.size || (selBox && !sel.marquee ? `${selBox.w}x${selBox.h}` : "")

  return (
    <div
      ref={rootRef}
      className={`pRoot ${mobile ? "pRoot--mobile" : ""}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onDragOver={(e) => e.dataTransfer?.types?.includes("Files") && e.preventDefault()}
      onDrop={onDrop}
    >
      <MenuBar menus={menus} />
      <div className="pMain">
        {view.toolbox && (
          <div className="pToolbox" role="toolbar" aria-label="Tools">
            <div className="pTools">
              {TOOLS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={tool === t.id ? "pTool is-on" : "pTool"}
                  aria-label={t.label}
                  aria-pressed={tool === t.id}
                  title={t.label}
                  // tools switch on press, as in Windows (a phone's click arrives a beat
                  // later, after a quick tap on the canvas could already have started)
                  onPointerDown={() => tool !== t.id && setTool(t.id)}
                  onClick={() => tool !== t.id && setTool(t.id)}
                  onMouseEnter={() => setStatus((st) => ({ ...st, hint: t.hint }))}
                  onMouseLeave={() => setStatus((st) => ({ ...st, hint: null }))}
                >
                  <ToolIcon tool={t.id} />
                </button>
              ))}
            </div>
            <div className="pOptsBox">{optionsFor()}</div>
          </div>
        )}

        <div className="pArea" ref={areaRef}>
          <div className="pCanvasWrap" style={{ width: W * zoom, height: H * zoom }}>
            <div
              className="pLayer"
              style={{ cursor: hover && inSelection(hover) && (tool === "select" || tool === "freeselect") ? "move" : cursor }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={() => (setHover(null), setStatus((st) => ({ ...st, pos: drag.current ? st.pos : null })))}
              onContextMenu={(e) => e.preventDefault()}
            >
              <canvas ref={canvasRef} className="pCanvas" width={W} height={H} style={{ width: W * zoom, height: H * zoom }} aria-label="Picture" />
              {view.grid && zoom >= 4 && <div className="pGrid" style={{ backgroundSize: `${zoom}px ${zoom}px` }} />}

              {sel?.piece && (
                <canvas
                  ref={pieceRef}
                  className="pPiece"
                  style={{ left: sel.x * zoom, top: sel.y * zoom, width: sel.piece.width * zoom, height: sel.piece.height * zoom }}
                />
              )}
              {selBox && <div className="pMarquee" style={{ left: selBox.x * zoom - 1, top: selBox.y * zoom - 1, width: selBox.w * zoom + 2, height: selBox.h * zoom + 2 }} />}
              {lasso && (
                <svg className="pLasso" width={W * zoom} height={H * zoom}>
                  <polyline points={lasso.map(([x, y]) => `${(x + 0.5) * zoom},${(y + 0.5) * zoom}`).join(" ")} />
                </svg>
              )}
              {tool === "eraser" && hover && (
                <div
                  className="pEraserCursor"
                  style={{
                    left: (hover[0] - Math.floor(ERASERS[opts.eraser] / 2)) * zoom,
                    top: (hover[1] - Math.floor(ERASERS[opts.eraser] / 2)) * zoom,
                    width: ERASERS[opts.eraser] * zoom,
                    height: ERASERS[opts.eraser] * zoom,
                  }}
                />
              )}
              {textBox && (
                <textarea
                  ref={textRef}
                  className="pTextBox"
                  spellCheck="false"
                  autoCapitalize="off"
                  autoCorrect="off"
                  aria-label="Text"
                  value={textBox.text}
                  style={{
                    left: textBox.x * zoom,
                    top: textBox.y * zoom,
                    width: textBox.w * zoom,
                    height: textBox.h * zoom,
                    font: textFont(font, zoom),
                    lineHeight: `${lineHeightFor(font) * zoom}px`,
                    textDecoration: font.underline ? "underline" : "none",
                    color: colors.primary,
                    background: opts.transparent ? "transparent" : colors.secondary,
                  }}
                  onChange={(e) => {
                    const el = e.target
                    let h = textBox.h
                    if (el.scrollHeight > el.clientHeight) h = Math.min(img.current.height - textBox.y, Math.ceil(el.scrollHeight / zoom) + 2)
                    setTextBox({ ...textBox, text: el.value, h })
                  }}
                />
              )}
            </div>

            {resize && <div className="pResizeGhost" style={{ width: resize.w * zoom, height: resize.h * zoom }} />}
            <span className="pHandle pHandle--right" style={{ left: W * zoom, top: (H * zoom) / 2 - 2 }} aria-label="Resize width" {...handleDrag("right")} />
            <span className="pHandle pHandle--bottom" style={{ left: (W * zoom) / 2 - 2, top: H * zoom }} aria-label="Resize height" {...handleDrag("bottom")} />
            <span className="pHandle pHandle--corner" style={{ left: W * zoom, top: H * zoom }} aria-label="Resize picture" {...handleDrag("corner")} />
          </div>

          {textBox && (
            <div className="window pFonts" onPointerDown={(e) => e.stopPropagation()}>
              <div className="title-bar">
                <div className="title-bar-text">Fonts</div>
              </div>
              <div className="pFontsBody">
                <select aria-label="Font" value={font.family} onChange={(e) => setFont({ ...font, family: e.target.value })}>
                  {FONTS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <select aria-label="Font size" value={font.size} onChange={(e) => setFont({ ...font, size: Number(e.target.value) })}>
                  {FONT_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                {[
                  ["bold", "B", "Bold"],
                  ["italic", "I", "Italic"],
                  ["underline", "U", "Underline"],
                ].map(([key, letter, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`pFontBtn pFontBtn--${key} ${font[key] ? "is-on" : ""}`}
                    aria-label={label}
                    aria-pressed={font[key]}
                    onClick={() => {
                      setFont({ ...font, [key]: !font[key] })
                      textRef.current?.focus({ preventScroll: true })
                    }}
                  >
                    {letter}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {view.colorbox && (
        <div className="pColorBox">
          <div
            className={`pWell pWell--${well}`}
            role="group"
            aria-label="Current colors"
            onPointerDown={(e) => {
              const which = e.target.closest("[data-well]")?.dataset.well
              if (which) setWell(which)
            }}
          >
            <span className="pWellSecondary" data-well="secondary" style={{ background: colors.secondary }} aria-label="Background color" />
            <span className="pWellPrimary" data-well="primary" style={{ background: colors.primary }} aria-label="Foreground color" />
          </div>
          <div className="pPalette" role="listbox" aria-label="Colors">
            {palette.map((hex, i) => (
              <button
                key={i}
                type="button"
                className="pSwatch"
                style={{ background: hex }}
                aria-label={`Color ${hex}`}
                onPointerDown={(e) => {
                  if (e.pointerType === "mouse" && e.button === 2) return pickSwatch(hex, "secondary")
                  if (e.pointerType === "mouse" && e.button !== 0) return
                  setPaletteIndex(i)
                  pickSwatch(hex, e.pointerType === "mouse" ? "primary" : well)
                }}
                onContextMenu={(e) => e.preventDefault()}
                onDoubleClick={() => editColor(i)}
              />
            ))}
          </div>
        </div>
      )}

      {view.statusbar && (
        <div className="status-bar pStatus">
          <p className="status-bar-field pStatusHint">{statusHint}</p>
          <p className="status-bar-field pStatusPos">{status.pos ? `${status.pos[0]},${status.pos[1]}` : ""}</p>
          <p className="status-bar-field pStatusSize">{sizeText}</p>
        </div>
      )}

      {/* ---- dialogs ---- */}

      {dialog?.kind === "changed" && (
        <Dialog
          title="Paint"
          okLabel="Yes"
          onOk={() => {
            setDialog(null)
            save()
          }}
          onNo={() => {
            setDialog(null)
            setSavedId(stateId.current) // discard: nothing unsaved anymore
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

      {dialog?.kind === "saveAs" && (
        <FileDialog
          mode="save"
          startDir={file && onDrive(file) ? file.parent : null}
          initialName={file ? file.name : "untitled"}
          accept={(item) => item.isImage}
          typeLabel="Bitmap Images (*.png)"
          fileType="image"
          onPick={writeTo}
          onCancel={() => {
            afterSave.current = null
            setDialog(null)
          }}
        />
      )}

      {dialog?.kind === "open" && (
        <FileDialog
          mode="open"
          startDir={file && onDrive(file) ? file.parent : null}
          accept={(item) => item.isImage}
          typeLabel="Bitmap Images (*.png)"
          fileType="image"
          onPick={openFile}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "colors" && (
        <EditColors
          initial={dialog.color}
          onCancel={() => setDialog(null)}
          onOk={(hex) => {
            setPalette((p) => p.map((c, i) => (i === dialog.index ? hex : c)))
            pickSwatch(hex, mobile ? well : "primary")
            setDialog(null)
          }}
        />
      )}

      {dialog?.kind === "attributes" && (
        <Dialog
          title="Attributes"
          okDisabled={!(dialog.w >= 1 && dialog.h >= 1)}
          onOk={() => {
            setDialog(null)
            setCanvasSize(dialog.w, dialog.h)
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">File last saved: {file && onDrive(file) ? file.name : "Not Available"}</p>
          <div className="pFormRow">
            <label htmlFor="p-w">Width:</label>
            <input id="p-w" type="number" min="1" max={MAX_SIDE} value={dialog.w} onChange={(e) => setDialog({ ...dialog, w: Number(e.target.value) })} />
            <label htmlFor="p-h">Height:</label>
            <input id="p-h" type="number" min="1" max={MAX_SIDE} value={dialog.h} onChange={(e) => setDialog({ ...dialog, h: Number(e.target.value) })} />
          </div>
          <p className="dialogText">Units: pixels</p>
          <div className="pFormRow">
            <button type="button" onClick={() => setDialog({ ...dialog, ...(mobile ? { w: 360, h: 360 } : { w: 480, h: 320 }) })}>
              Default
            </button>
          </div>
        </Dialog>
      )}

      {dialog?.kind === "flip" && (
        <Dialog
          title="Flip and Rotate"
          onOk={() => {
            setDialog(null)
            flipRotate(dialog.how === "r" ? dialog.angle : dialog.how)
          }}
          onCancel={() => setDialog(null)}
        >
          <fieldset className="pFieldset">
            <legend>Flip or rotate</legend>
            {[
              ["h", "Flip horizontal"],
              ["v", "Flip vertical"],
              ["r", "Rotate by angle"],
            ].map(([how, label]) => (
              <div key={how} className="field-row">
                <input id={`p-flip-${how}`} type="radio" name="p-flip" checked={dialog.how === how} onChange={() => setDialog({ ...dialog, how })} />
                <label htmlFor={`p-flip-${how}`}>{label}</label>
              </div>
            ))}
            <div className="pIndent">
              {["90", "180", "270"].map((a) => (
                <div key={a} className="field-row">
                  <input id={`p-rot-${a}`} type="radio" name="p-rot" disabled={dialog.how !== "r"} checked={dialog.angle === a} onChange={() => setDialog({ ...dialog, angle: a })} />
                  <label htmlFor={`p-rot-${a}`}>{a}°</label>
                </div>
              ))}
            </div>
          </fieldset>
        </Dialog>
      )}

      {dialog?.kind === "stretch" && (
        <Dialog
          title="Stretch and Skew"
          okDisabled={!(dialog.sx >= 1 && dialog.sy >= 1 && dialog.sx <= 500 && dialog.sy <= 500 && Math.abs(dialog.kx) <= 89 && Math.abs(dialog.ky) <= 89)}
          onOk={() => {
            setDialog(null)
            stretchSkew(dialog)
          }}
          onCancel={() => setDialog(null)}
        >
          <fieldset className="pFieldset">
            <legend>Stretch</legend>
            <div className="pFormRow">
              <label htmlFor="p-sx">Horizontal:</label>
              <input id="p-sx" type="number" min="1" max="500" value={dialog.sx} onChange={(e) => setDialog({ ...dialog, sx: Number(e.target.value) })} />%
            </div>
            <div className="pFormRow">
              <label htmlFor="p-sy">Vertical:</label>
              <input id="p-sy" type="number" min="1" max="500" value={dialog.sy} onChange={(e) => setDialog({ ...dialog, sy: Number(e.target.value) })} />%
            </div>
          </fieldset>
          <fieldset className="pFieldset">
            <legend>Skew</legend>
            <div className="pFormRow">
              <label htmlFor="p-kx">Horizontal:</label>
              <input id="p-kx" type="number" min="-89" max="89" value={dialog.kx} onChange={(e) => setDialog({ ...dialog, kx: Number(e.target.value) })} />
              Degrees
            </div>
            <div className="pFormRow">
              <label htmlFor="p-ky">Vertical:</label>
              <input id="p-ky" type="number" min="-89" max="89" value={dialog.ky} onChange={(e) => setDialog({ ...dialog, ky: Number(e.target.value) })} />
              Degrees
            </div>
          </fieldset>
        </Dialog>
      )}

      {dialog?.kind === "zoom" && (
        <Dialog
          title="Custom Zoom"
          onOk={() => {
            setDialog(null)
            setZoom(dialog.value)
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">Current zoom: {zoom * 100}%</p>
          <fieldset className="pFieldset pZoomChoices">
            <legend>Zoom to</legend>
            {[1, 2, 4, 6, 8].map((z) => (
              <div key={z} className="field-row">
                <input id={`p-z-${z}`} type="radio" name="p-zoom" checked={dialog.value === z} onChange={() => setDialog({ ...dialog, value: z })} />
                <label htmlFor={`p-z-${z}`}>{z * 100}%</label>
              </div>
            ))}
          </fieldset>
        </Dialog>
      )}

      {dialog?.kind === "enlarge" && (
        <Dialog
          title="Paint"
          okLabel="Yes"
          onOk={() => {
            const piece = dialog.piece
            setDialog(null)
            setCanvasSize(Math.max(img.current.width, piece.width), Math.max(img.current.height, piece.height))
            placePiece(piece, false)
          }}
          onNo={() => {
            const piece = dialog.piece
            setDialog(null)
            placePiece(piece, false)
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">The image in the clipboard is larger than the bitmap.</p>
          <p className="dialogText">Would you like the bitmap enlarged?</p>
        </Dialog>
      )}

      {dialog?.kind === "about" && (
        <Dialog title="About Paint" onOk={() => setDialog(null)}>
          <div className="pAbout">
            <img src="/assets/program_icons/paint.svg" alt="" width="32" height="32" />
            <p className="dialogText">
              Paint for 98ish.
              <br />
              Left-click draws with the foreground color, right-click with the background color. On a touch screen, tap the color well to choose which color the palette sets, and use two fingers to scroll.
            </p>
          </div>
        </Dialog>
      )}

      {dialog?.kind === "alert" && (
        <Dialog title={dialog.title} onOk={() => setDialog(null)}>
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}

      {viewBitmap &&
        createPortal(
          <ViewBitmap surface={img.current} onDone={() => setViewBitmap(false)} />,
          document.body
        )}
    </div>
  )
}

// View Bitmap: the picture alone on the whole screen; any click or key goes back
const ViewBitmap = ({ surface, onDone }) => {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    canvas.width = surface.width
    canvas.height = surface.height
    canvas.getContext("2d").putImageData(toImageData(surface), 0, 0)
    const key = () => onDone()
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [])
  return (
    <div className="pViewBitmap" onPointerDown={onDone} role="dialog" aria-label="View Bitmap">
      <canvas ref={ref} />
    </div>
  )
}

export default Paint
