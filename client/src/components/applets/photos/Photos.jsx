import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import ContextMenu from "../../shared/ContextMenu"
import { fs, previewOf, readContent, validName, writeAndSave } from "../../../utils/fs"
import { useDriveUsage, useFsVersion } from "../../../hooks/useFs"
import { useOpenGesture } from "../../../hooks/useMediaQuery"
import { launch, paintWindow } from "../../../utils/programs"
import { downloadItem } from "../../../utils/fileTransfer"
import { itemPayload, shareOut } from "../../../utils/share"
import { getSettings, saveWallpaperImage, setSettings } from "../../../utils/settings"
import { trackUnsaved } from "../../../utils/unsaved"
import { isKeyForWindow } from "../../../utils/windowKeys"
import { unlock } from "../../../utils/achievements"
import { formatBytes, formatSize } from "../../../utils/fileInfo"
import { useNet, canSend, describe, fileBytes, maxBytesFor, sizeLimitText } from "../network/NetContext"
import { EFFECTS } from "../camera/effects"
import { FRAMES } from "../camera/frames"
import Viewer from "./Viewer"
import Slideshow from "./Slideshow"
import * as E from "./edits"
import { CROP_ASPECTS, DRIVE_FULL, decodeUpload, editedName, imagesIn, initialCrop, kindOf, loadImage, pictureFolders, picturesFolder, savePicture, toJpeg, uploadName } from "./library"
import { adjustFilterCss } from "../camera/effects"
import "./Photos.css"

// Photos: the picture viewer. Browse a folder of pictures as thumbnails (C:\My Pictures to
// start), open one to zoom (buttons, the wheel, or pinch), swipe or arrow between them,
// and edit: rotate, crop, brightness and contrast, the Camera's retro effects and frames.
// Edits stack up in memory (Undo goes back) and are written once, on Save. Pictures can
// become the wallpaper, open in Paint or Photo Puzzle, travel by 98ish Mail or Network
// Neighborhood, go to the Recycle Bin, come in from the real device and go back out.

const PREFS_KEY = "98ish.photos"
const loadPrefs = () => {
  try {
    return { transition: "random", seconds: 4, ...JSON.parse(localStorage.getItem(PREFS_KEY)) }
  } catch {
    return { transition: "random", seconds: 4 }
  }
}

const UNDO_STEPS = 6

const onDrive = (item) => !!item && fs.partsOf(item)[0] === "C:" && fs.resolve(fs.partsOf(item)) === item

const ICONS = {
  back: "M10 3L4 8l6 5M4 8h9",
  prev: "M10 3L5 8l5 5",
  next: "M6 3l5 5-5 5",
  zoomIn: "M7 3.5v7M3.5 7h7M10.5 10.5L14 14",
  zoomOut: "M3.5 7h7M10.5 10.5L14 14",
  fit: "M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4",
  rotL: "M3 3v4h4M3.5 7A5 5 0 1 1 5 12",
  rotR: "M13 3v4H9M12.5 7A5 5 0 1 0 11 12",
  crop: "M4 1v11h11M1 4h11v11",
  adjust: "M8 2a6 6 0 1 0 0 12z",
  effects: "M3 13L10 6M11 2l.6 1.4L13 4l-1.4.6L11 6l-.6-1.4L9 4l1.4-.6zM13.5 8l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4z",
  show: "M2 3h12v8H2zM6 14h4M8 11v3M7 5.5v3l3-1.5z",
  wallpaper: "M1 2h14v10H1zM3 10l3-4 2 3 2-2 3 3zM5 14h6",
  trash: "M4 4h8l-1 10H5zM3 4h10M6 2h4M7 6v6M9 6v6",
  upload: "M8 11V2M4.5 5.5L8 2l3.5 3.5M2 11v3h12v-3",
  download: "M8 2v9M4.5 7.5L8 11l3.5-3.5M2 11v3h12v-3",
  save: "M2 2h10l2 2v10H2zM4 2v4h7V2M5 10h6v4H5z",
  undo: "M5 3L2 6l3 3M2 6h7a4 4 0 0 1 0 8H6",
  share: "M11 3l3 3-3 3M14 6H7a4 4 0 0 0-4 4v3",
  up: "M8 13V3M4 7l4-4 4 4",
  camera: "M2 5h3l1-2h4l1 2h3v8H2zM8 6.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
}

const Icon = ({ name }) => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="phIcon">
    <path d={ICONS[name]} fill={name === "adjust" ? "#000" : "none"} stroke="#000" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const Tool = ({ icon, label, onClick, disabled, on, title }) => (
  <button type="button" className={`phTool${on ? " is-on" : ""}`} onClick={onClick} disabled={disabled} title={title || label} aria-label={title || label} aria-pressed={on || undefined}>
    <Icon name={icon} />
    <span className="phToolLabel">{label}</span>
  </button>
)

const FolderIcon = () => <img src="/assets/directory_folder.png" alt="" width="40" height="40" draggable={false} />

const Photos = ({ file: initialFile = null, path = null, mobile, dispatch, onTitle, onClose, registerCloseGuard }) => {
  useFsVersion()
  const net = useNet()
  const openGesture = useOpenGesture()
  const [dir, setDir] = useState(() => (initialFile?.parent && onDrive(initialFile) ? initialFile.parent : (path && fs.resolve(path)?.isDirectory && fs.resolve(path)) || picturesFolder()))
  const [current, setCurrent] = useState(initialFile && onDrive(initialFile) && initialFile.isImage ? initialFile : null)
  const [selected, setSelected] = useState(initialFile)
  const [meta, setMeta] = useState(null) // { src, width, height } of what's showing
  const [working, setWorking] = useState(null) // { canvas, url, width, height } once edited
  const [undo, setUndo] = useState([]) // earlier `working`s (null = the saved picture)
  const [tool, setTool] = useState(null) // null | "crop" | "adjust" | "effects"
  const [cropAspect, setCropAspect] = useState("free")
  const [cropRect, setCropRect] = useState(null)
  const [adjustValues, setAdjustValues] = useState({ brightness: 0, contrast: 0 })
  const [fx, setFx] = useState({ effect: "none", frame: "none", url: null })
  const [zoom, setZoom] = useState(100)
  const [slideshow, setSlideshow] = useState(null) // start index
  const [showPrefs, setShowPrefs] = useState(loadPrefs)
  const [dialog, setDialog] = useState(null)
  const [menu, setMenu] = useState(null)
  const [busy, setBusy] = useState(null)
  const controls = useRef(null)
  const uploadRef = useRef(null)
  const rootRef = useRef(null)
  const afterSave = useRef(null)

  // the folder or picture may have gone (deleted, moved, renamed elsewhere)
  const dirOk = dir && (dir === fs.root.getItem("C:") || onDrive(dir))
  const folder = dirOk ? dir : picturesFolder()
  const items = imagesIn(folder)
  const subfolders = folder.content.filter((i) => i.isDirectory).sort((a, b) => a.name.localeCompare(b.name))
  const index = current ? items.indexOf(current) : -1
  useEffect(() => {
    if (!dirOk) setDir(picturesFolder())
    if (current && (!onDrive(current) || !current.isImage)) closePhoto(true)
  })

  const dirty = !!working
  const live = useRef({})
  live.current = { dirty }

  // ---- the picture showing ----

  useEffect(() => {
    if (!current) return setMeta(null)
    let gone = false
    // a big picture that isn't loaded yet shows "Opening..." until it is
    if (!current.loaded) {
      setMeta(null)
      readContent(current)
      return
    }
    const src = current.textContent
    if (!src) return setMeta({ src: null, width: 1, height: 1, empty: true })
    loadImage(src)
      .then((img) => !gone && setMeta({ src, width: img.naturalWidth, height: img.naturalHeight }))
      .catch(() => !gone && setMeta({ src: null, width: 1, height: 1, broken: true }))
    return () => {
      gone = true
    }
  }, [current, current?.textContent])

  useEffect(() => {
    if (!onTitle) return
    onTitle(current ? `${current.name}${dirty ? " *" : ""} - Photos` : `${folder.name === "C:" ? "C:\\" : folder.name} - Photos`)
  }, [current?.name, folder.name, dirty])

  // shutting down / closing warns about unsaved edits
  useEffect(() => (dirty ? trackUnsaved("Photos") : undefined), [dirty])
  useEffect(() => {
    if (!registerCloseGuard) return
    return registerCloseGuard(() => {
      if (!live.current.dirty) return true
      askSave(() => onClose?.())
      return false
    })
  }, [registerCloseGuard])

  // object URLs are freed when they go
  useEffect(() => () => working?.url?.startsWith("blob:") && URL.revokeObjectURL(working.url), [working])
  useEffect(() => () => fx.url?.startsWith("blob:") && URL.revokeObjectURL(fx.url), [fx.url])

  const shown = working ? { src: working.url, width: working.width, height: working.height } : meta

  // ---- moving around ----

  const resetEdits = () => {
    live.current.dirty = false
    setWorking(null)
    setUndo([])
    setTool(null)
  }

  // run `then` now, or after asking about unsaved edits
  const askSave = (then) => {
    if (!live.current.dirty) return then()
    setDialog({ kind: "save", then })
  }

  const openPhoto = (file) => askSave(() => {
    resetEdits()
    setCurrent(file)
    setSelected(file)
  })
  const closePhoto = (force = false) => {
    const go = () => {
      resetEdits()
      setSelected(current)
      setCurrent(null)
    }
    force ? go() : askSave(go)
  }
  const step = (dir) => {
    if (!current || items.length < 2 || tool) return
    openPhoto(items[(index + dir + items.length) % items.length])
  }
  const openFolder = (d) => {
    setDir(d)
    setSelected(null)
    setCurrent(null)
  }
  const open = (item) => (item.isDirectory ? openFolder(item) : openPhoto(item))

  // ---- edits ----

  // the picture as something drawable: the working canvas, or the saved picture
  const sourceNow = async () => working?.canvas || (await loadImage(await readContent(current)))

  const commit = async (canvas) => {
    const url = await E.canvasUrl(canvas)
    setUndo((u) => [...u.slice(-(UNDO_STEPS - 1)), working])
    setWorking({ canvas, url, width: canvas.width, height: canvas.height })
  }

  const edit = async (fn, label) => {
    if (!current || !shown?.src) return
    setBusy(label || "Working...")
    try {
      await commit(fn(await sourceNow()))
    } catch {
      setDialog({ kind: "alert", title: "Photos", text: "That picture couldn't be changed." })
    } finally {
      setBusy(null)
    }
  }

  const rotateBy = (turns) => edit((src) => E.rotate(src, turns), "Rotating...")

  const undoLast = () => {
    if (!undo.length) return
    setWorking(undo.at(-1))
    setUndo((u) => u.slice(0, -1))
    setTool(null)
  }

  const startTool = async (name) => {
    if (!current || !shown?.src) return
    if (tool === name) return setTool(null)
    setTool(name)
    if (name === "crop") {
      const aspect = CROP_ASPECTS.find((a) => a.id === cropAspect)?.value || null
      const r = initialCrop(shown.width, shown.height, aspect)
      // start a little inside the edges (free) so the handles are easy to see
      setCropRect(aspect ? r : { x: r.w * 0.08, y: r.h * 0.08, w: r.w * 0.84, h: r.h * 0.84 })
    }
    if (name === "adjust") setAdjustValues({ brightness: 0, contrast: 0 })
    if (name === "effects") setFx({ effect: "none", frame: "none", url: null })
  }

  const pickAspect = (id) => {
    setCropAspect(id)
    const aspect = CROP_ASPECTS.find((a) => a.id === id)?.value || null
    setCropRect(initialCrop(shown.width, shown.height, aspect))
  }

  const applyCrop = async () => {
    const rect = cropRect
    setTool(null)
    await edit((src) => E.crop(src, rect), "Cropping...")
  }
  const applyAdjust = async () => {
    const values = adjustValues
    setTool(null)
    if (!values.brightness && !values.contrast) return
    await edit((src) => E.adjust(src, values), "Adjusting...")
  }

  // the effects preview: a small copy with the effect, shown in place of the picture
  useEffect(() => {
    if (tool !== "effects" || !current) return
    if (fx.effect === "none" && fx.frame === "none") return setFx((f) => (f.url ? { ...f, url: null } : f))
    let gone = false
    ;(async () => {
      const src = await sourceNow()
      const canvas = E.effect(src, fx.effect, fx.frame, 640)
      const url = await E.canvasUrl(canvas)
      if (gone) return URL.revokeObjectURL(url)
      setFx((f) => ({ ...f, url }))
    })().catch(() => {})
    return () => {
      gone = true
    }
  }, [tool, fx.effect, fx.frame])

  const applyEffects = async () => {
    const { effect, frame } = fx
    setTool(null)
    if (effect === "none" && frame === "none") return
    await edit((src) => E.effect(src, effect, frame), "Applying the effect...")
  }

  const revert = () => {
    resetEdits()
  }

  // the edited picture, as what gets saved
  const encoded = () => {
    const png = /^data:image\/png/i.test(current.head || "")
    return toJpeg(working.canvas, { keepPng: png, maxSide: 4096 }).data
  }

  // resolves true when saved (or there was nothing to save)
  const save = async () => {
    if (!working || !current) return true
    if (!(await writeAndSave(current, encoded()))) {
      setDialog({ kind: "alert", title: "Save", text: DRIVE_FULL })
      return false
    }
    resetEdits()
    return true
  }

  const saveCopy = async () => {
    if (!working || !current) return
    const result = await savePicture(current.parent, editedName(current.name), encoded())
    if (!result.ok) return setDialog({ kind: "alert", title: "Save As Copy", text: result.error })
    resetEdits()
    setCurrent(result.file)
    setSelected(result.file)
  }

  // ---- sharing ----

  const target = current || selected
  const pictureData = async () => (working && current === target ? encoded() : target ? await readContent(target) : "")

  const setWallpaper = async () => {
    if (!target) return
    const data = await pictureData()
    if (!data) return
    if (!saveWallpaperImage(data)) return setDialog({ kind: "alert", title: "Set as Wallpaper", text: "There isn't room in this browser's storage for that wallpaper. Delete some pictures and try again." })
    const display = getSettings().display
    setSettings({ wallpaper: "custom", display: display === "tile" ? "stretch" : display })
    unlock("wallpaper")
    setDialog({ kind: "alert", title: "Set as Wallpaper", text: `${target.name} is now your desktop wallpaper. Change it any time in Display Properties.` })
  }

  const openInPaint = () => target && askSave(() => dispatch?.({ type: "open_window", payload: paintWindow(target) }))
  const usePuzzle = () => target && askSave(() => dispatch?.({ type: "open_window", payload: launch("Photo Puzzle", { handoff: { id: Date.now(), file: target } }) }))
  const sendMail = () => target && askSave(() => dispatch?.({ type: "open_window", payload: launch("98ish Mail", { handoff: { id: Date.now(), attach: target } }) }))
  const sendNetwork = () => {
    if (!target) return
    if (!net || net.status !== "online") return setDialog({ kind: "alert", title: "Send to Network Neighborhood", text: "Network Neighborhood isn't connected right now. Open it from the desktop and try again in a moment." })
    if (!canSend(target)) return setDialog({ kind: "alert", title: "Send to Network Neighborhood", text: "Pictures can't be sent over the network from this computer." })
    if (fileBytes(target) > maxBytesFor(target.type)) return setDialog({ kind: "alert", title: "Send to Network Neighborhood", text: `${target.name} is too big to send. Pictures can be up to ${sizeLimitText(target.type)}.` })
    askSave(() => setDialog({ kind: "network" }))
  }
  const sendTo = async (computer) => {
    setDialog({ kind: "alert", title: "Send File", text: `Sending "${target.name}" to ${computer.name}...` })
    const result = await net.sendFile(computer, target)
    setDialog({ kind: "alert", title: "Send File", text: result.ok ? `"${target.name}" is on its way. ${result.to} has 2 minutes to accept it.` : result.error })
  }

  const download = async () => {
    if (!target) return
    const result = await downloadItem(target)
    if (!result.ok) setDialog({ kind: "alert", title: "Download", text: result.error })
  }

  const askDelete = () => target && setDialog({ kind: "delete", item: target })
  const doDelete = (item) => {
    setDialog(null)
    const i = items.indexOf(item)
    try {
      fs.deleteItem(item)
    } catch (error) {
      return setDialog({ kind: "alert", title: "Delete", text: error.message })
    }
    if (current === item) {
      resetEdits()
      const rest = items.filter((x) => x !== item)
      if (rest.length) setCurrent(rest[Math.min(i, rest.length - 1)])
      else setCurrent(null)
    }
    setSelected(null)
  }

  const askRename = () => target && setDialog({ kind: "rename", item: target, value: target.name })
  const doRename = () => {
    const { item, value } = dialog
    const name = String(value).trim()
    const problem = validName(name)
    if (problem) return setDialog({ ...dialog, error: problem })
    try {
      item.name = name
      setDialog(null)
    } catch (error) {
      setDialog({ ...dialog, error: error.message })
    }
  }

  // ---- from the real device ----

  const upload = async (fileList) => {
    const list = [...(fileList || [])]
    if (!list.length) return
    const into = folder
    const added = []
    const problems = []
    for (let i = 0; i < list.length; i++) {
      setBusy(`Bringing in ${i + 1} of ${list.length}...`)
      try {
        const picture = await decodeUpload(list[i])
        const result = await savePicture(into, uploadName(list[i].name), picture.data)
        if (!result.ok) {
          problems.push(result.error)
          break
        }
        added.push(result.file)
      } catch (error) {
        problems.push(error.message || `${list[i].name} couldn't be read.`)
      }
    }
    setBusy(null)
    if (added.length) setSelected(added.at(-1))
    if (added.length === 1 && !problems.length) openPhoto(added[0])
    if (problems.length) setDialog({ kind: "alert", title: "Upload", text: `${added.length ? `${added.length} picture${added.length === 1 ? " was" : "s were"} added. ` : ""}${problems.join(" ")}` })
  }

  // ---- keys ----
  // on the page, for whenever this window is the one in use: toolbar buttons that turn
  // disabled while they work drop the focus to the page

  const onKeyDown = (e) => {
    if (e.defaultPrevented || !isKeyForWindow(rootRef.current, e)) return
    if (dialog || slideshow !== null || e.target.closest("input, select, textarea, .menuBar")) return
    const ctrl = e.ctrlKey || e.metaKey
    if (current) {
      if (ctrl && e.key.toLowerCase() === "z") return e.preventDefault(), undoLast()
      if (ctrl && e.key.toLowerCase() === "s") return e.preventDefault(), save()
      if (e.key === "Escape") return e.stopPropagation(), tool ? setTool(null) : closePhoto()
      if (tool) return
      if (e.key === "ArrowRight" || e.key === "PageDown") return e.preventDefault(), step(1)
      if (e.key === "ArrowLeft" || e.key === "PageUp") return e.preventDefault(), step(-1)
      if (e.key === "+" || e.key === "=") return controls.current?.zoomIn()
      if (e.key === "-") return controls.current?.zoomOut()
      if (e.key === "0") return controls.current?.fit()
      if (e.key === "Delete") return askDelete()
      if (e.key === "F5") return e.preventDefault(), setSlideshow(Math.max(0, index))
      return
    }
    if (e.key === "Enter" && selected) return open(selected)
    if (e.key === "Delete" && selected) return askDelete()
    if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && items.length) {
      e.preventDefault()
      const i = items.indexOf(selected)
      setSelected(items[Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)))] || items[0])
    }
  }

  const keyRef = useRef(onKeyDown)
  keyRef.current = onKeyDown
  useEffect(() => {
    const onKey = (e) => keyRef.current(e)
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  // ---- menus ----

  const has = !!target
  const viewing = !!current
  const shareItems = [
    { label: "Set as Wallpaper", disabled: !has, onClick: setWallpaper },
    { label: "Open in Paint", disabled: !has, onClick: openInPaint },
    { label: "Use in Photo Puzzle", disabled: !has, onClick: usePuzzle },
    "-",
    { label: "Send by 98ish Mail...", disabled: !has, onClick: sendMail },
    { label: "Send to Network Neighborhood...", disabled: !has, onClick: sendNetwork },
    { label: "Download to Your Device", disabled: !has, onClick: download },
    "-",
    // the saved picture (edits not saved yet stay behind), straight from the tap for iOS
    { label: "Send to My Phone", disabled: !has, onClick: () => shareOut(itemPayload(target), "phone", { title: "Photos" }) },
    { label: "Send to Other Apps...", disabled: !has, onClick: () => shareOut(itemPayload(target), "apps", { title: "Photos" }) },
  ]
  const menus = [
    {
      label: "File",
      items: [
        { label: "Upload from Your Device...", onClick: () => uploadRef.current?.click() },
        { label: "Download to Your Device", disabled: !has, onClick: download },
        "-",
        { label: "Save Ctrl+S", disabled: !dirty, onClick: save },
        { label: "Save As Copy", disabled: !dirty, onClick: saveCopy },
        { label: "Revert", disabled: !dirty, onClick: revert },
        "-",
        { label: "Rename", disabled: !has, onClick: askRename },
        { label: "Delete Del", disabled: !has, onClick: askDelete },
        "-",
        { label: "Open Camera", onClick: () => dispatch?.({ type: "open_window", payload: launch("Camera") }) },
        { label: "Close Photos", onClick: () => askSave(() => onClose?.()) },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo Ctrl+Z", disabled: !undo.length, onClick: undoLast },
        "-",
        { label: "Rotate Left", disabled: !viewing, onClick: () => rotateBy(3) },
        { label: "Rotate Right", disabled: !viewing, onClick: () => rotateBy(1) },
        { label: "Crop", disabled: !viewing, checked: tool === "crop", onClick: () => startTool("crop") },
        { label: "Brightness/Contrast...", disabled: !viewing, checked: tool === "adjust", onClick: () => startTool("adjust") },
        { label: "Effects and Frames...", disabled: !viewing, checked: tool === "effects", onClick: () => startTool("effects") },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Thumbnails", checked: !viewing, onClick: () => viewing && closePhoto() },
        { label: "Previous Picture", disabled: !viewing || items.length < 2, onClick: () => step(-1) },
        { label: "Next Picture", disabled: !viewing || items.length < 2, onClick: () => step(1) },
        "-",
        { label: "Zoom In", disabled: !viewing, onClick: () => controls.current?.zoomIn() },
        { label: "Zoom Out", disabled: !viewing, onClick: () => controls.current?.zoomOut() },
        { label: "Best Fit", disabled: !viewing, onClick: () => controls.current?.fit() },
        { label: "Actual Size", disabled: !viewing, onClick: () => controls.current?.actual() },
        "-",
        { label: "Slideshow F5", disabled: !items.length, onClick: () => askSave(() => setSlideshow(Math.max(0, items.indexOf(target)))) },
      ],
    },
    { label: "Share", items: shareItems },
    { label: "Help", items: [{ label: "About Photos", onClick: () => setDialog({ kind: "alert", title: "About Photos", text: "98ish Photos. Swipe or use the arrow keys between pictures; pinch, the mouse wheel or the + and - buttons to zoom. Edits aren't written to the drive until you Save." }) }] },
  ]

  const tileMenu = (item) => [
    { label: "Open", bold: true, onClick: () => open(item) },
    ...(item.isDirectory
      ? []
      : [
          { label: "Slideshow from Here", onClick: () => setSlideshow(Math.max(0, items.indexOf(item))) },
          "-",
          ...shareItems,
          "-",
          { label: "Rename", onClick: askRename },
          { label: "Delete", onClick: askDelete },
        ]),
  ]

  // ---- the parts ----

  const folders = useMemo(() => pictureFolders(), [folder, items.length])
  const usage = useDriveUsage()
  const up = folder.parent && folder.parent !== fs.root ? folder.parent : null

  const browseTools = (
    <>
      <Tool icon="up" label="Up" onClick={() => up && openFolder(up)} disabled={!up} title="Up one folder" />
      <Tool icon="upload" label="Upload" onClick={() => uploadRef.current?.click()} title="Upload pictures from your device" />
      <Tool icon="show" label="Slideshow" onClick={() => setSlideshow(Math.max(0, items.indexOf(selected)))} disabled={!items.length} />
      <Tool icon="camera" label="Camera" onClick={() => dispatch?.({ type: "open_window", payload: launch("Camera") })} />
      <span className="phSep" />
      <Tool icon="wallpaper" label="Wallpaper" onClick={setWallpaper} disabled={!selected || selected.isDirectory} title="Set as Wallpaper" />
      <Tool icon="trash" label="Delete" onClick={askDelete} disabled={!selected || selected.isDirectory} />
    </>
  )

  const viewTools = (
    <>
      <Tool icon="back" label="Pictures" onClick={() => closePhoto()} title="Back to the thumbnails (Esc)" />
      <Tool icon="prev" label="Back" onClick={() => step(-1)} disabled={items.length < 2 || !!tool} title="Previous picture" />
      <Tool icon="next" label="Next" onClick={() => step(1)} disabled={items.length < 2 || !!tool} title="Next picture" />
      <span className="phSep" />
      <Tool icon="zoomOut" label="Out" onClick={() => controls.current?.zoomOut()} disabled={!!tool} title="Zoom out" />
      <Tool icon="fit" label="Fit" onClick={() => controls.current?.fit()} disabled={!!tool} title="Best fit" />
      <Tool icon="zoomIn" label="In" onClick={() => controls.current?.zoomIn()} disabled={!!tool} title="Zoom in" />
      <span className="phSep" />
      <Tool icon="rotL" label="Left" onClick={() => rotateBy(3)} disabled={!!tool || !!busy} title="Rotate left" />
      <Tool icon="rotR" label="Right" onClick={() => rotateBy(1)} disabled={!!tool || !!busy} title="Rotate right" />
      <Tool icon="crop" label="Crop" onClick={() => startTool("crop")} on={tool === "crop"} disabled={!!busy} />
      <Tool icon="adjust" label="Adjust" onClick={() => startTool("adjust")} on={tool === "adjust"} disabled={!!busy} title="Brightness and contrast" />
      <Tool icon="effects" label="Effects" onClick={() => startTool("effects")} on={tool === "effects"} disabled={!!busy} title="Effects and frames" />
      <Tool icon="undo" label="Undo" onClick={undoLast} disabled={!undo.length || !!tool} />
      {dirty && <Tool icon="save" label="Save" onClick={save} disabled={!!tool} title="Save (Ctrl+S)" />}
      <span className="phSep" />
      <Tool icon="show" label="Slideshow" onClick={() => askSave(() => setSlideshow(Math.max(0, index)))} />
      <Tool
        icon="share"
        label="Share"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setMenu({ x: r.left, y: r.bottom, items: shareItems })
        }}
        title="Share"
      />
      <Tool icon="trash" label="Delete" onClick={askDelete} />
    </>
  )

  const toolPanel = tool && (
    <div className="phPanel">
      {tool === "crop" && (
        <>
          <span className="phPanelLabel">Shape:</span>
          {CROP_ASPECTS.map((a) => (
            <button key={a.id} type="button" className={cropAspect === a.id ? "is-on" : ""} onClick={() => pickAspect(a.id)}>
              {a.label}
            </button>
          ))}
          <span className="phPanelGrow" />
          <button type="button" onClick={applyCrop} className="phDefault">
            Crop
          </button>
          <button type="button" onClick={() => setTool(null)}>
            Cancel
          </button>
        </>
      )}
      {tool === "adjust" && (
        <>
          {["brightness", "contrast"].map((k) => (
            <label key={k} className="phSlider">
              <span>
                {k === "brightness" ? "Brightness" : "Contrast"}: {adjustValues[k] > 0 ? "+" : ""}
                {adjustValues[k]}
              </span>
              <input type="range" min="-100" max="100" step="1" value={adjustValues[k]} aria-label={k === "brightness" ? "Brightness" : "Contrast"} onChange={(e) => setAdjustValues((v) => ({ ...v, [k]: Number(e.target.value) }))} />
            </label>
          ))}
          <span className="phPanelGrow" />
          <button type="button" onClick={() => setAdjustValues({ brightness: 0, contrast: 0 })}>
            Reset
          </button>
          <button type="button" onClick={applyAdjust} className="phDefault">
            OK
          </button>
          <button type="button" onClick={() => setTool(null)}>
            Cancel
          </button>
        </>
      )}
      {tool === "effects" && (
        <div className="phFx">
          <div className="phFxRow" aria-label="Effects">
            {EFFECTS.map((e) => (
              <button key={e.id} type="button" className={fx.effect === e.id ? "is-on" : ""} aria-pressed={fx.effect === e.id} onClick={() => setFx((f) => ({ ...f, effect: e.id }))}>
                {e.label}
              </button>
            ))}
          </div>
          <div className="phFxRow" aria-label="Frames">
            {FRAMES.map((f) => (
              <button key={f.id} type="button" className={fx.frame === f.id ? "is-on" : ""} aria-pressed={fx.frame === f.id} onClick={() => setFx((x) => ({ ...x, frame: f.id }))}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="phFxButtons">
            <button type="button" onClick={applyEffects} className="phDefault">
              Apply
            </button>
            <button type="button" onClick={() => setTool(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )

  const grid = (
    <div className="phGrid" role="listbox" aria-label={`Pictures in ${folder.name}`} onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}>
      {subfolders.map((d) => (
        <button
          key={`d:${d.name}`}
          type="button"
          role="option"
          aria-selected={selected === d}
          className={`phTile phTile--folder${selected === d ? " is-selected" : ""}`}
          onClick={() => setSelected(d)}
          {...openGesture(() => openFolder(d))}
          onContextMenu={(e) => (e.preventDefault(), setSelected(d), setMenu({ x: e.clientX, y: e.clientY, items: tileMenu(d) }))}
        >
          <span className="phThumb">
            <FolderIcon />
          </span>
          <span className="phTileName">{d.name}</span>
        </button>
      ))}
      {items.map((item) => (
        <button
          key={`f:${item.name}`}
          type="button"
          role="option"
          aria-selected={selected === item}
          className={`phTile${selected === item ? " is-selected" : ""}`}
          onClick={() => setSelected(item)}
          {...openGesture(() => openPhoto(item))}
          onContextMenu={(e) => (e.preventDefault(), setSelected(item), setMenu({ x: e.clientX, y: e.clientY, items: tileMenu(item) }))}
          title={item.name}
        >
          <span className="phThumb">{previewOf(item) ? <img src={previewOf(item)} alt="" loading="lazy" decoding="async" draggable={false} /> : null}</span>
          <span className="phTileName">{item.name}</span>
        </button>
      ))}
      {!items.length && !subfolders.length && (
        <div className="phEmpty">
          <p>There are no pictures in {folder.name === "C:" ? "C:\\" : folder.name} yet.</p>
          <p>Take some with Camera, or bring them in from your {mobile ? "phone" : "computer"}.</p>
          <div className="phEmptyButtons">
            <button type="button" onClick={() => dispatch?.({ type: "open_window", payload: launch("Camera") })}>
              Open Camera
            </button>
            <button type="button" onClick={() => uploadRef.current?.click()}>
              Upload Pictures...
            </button>
          </div>
        </div>
      )}
    </div>
  )

  const viewer = current && (
    <div className="phViewer">
      {shown?.src ? (
        <Viewer
          src={tool === "effects" && fx.url ? fx.url : shown.src}
          width={shown.width}
          height={shown.height}
          alt={current.name}
          controls={controls}
          onZoom={setZoom}
          onSwipe={tool ? null : (dir) => step(dir)}
          filter={tool === "adjust" ? adjustFilterCss(adjustValues) : null}
          cropMode={tool === "crop"}
          cropRect={cropRect}
          cropAspect={CROP_ASPECTS.find((a) => a.id === cropAspect)?.value || null}
          onCrop={setCropRect}
        />
      ) : (
        <div className="phBroken">{meta?.broken ? `${current.name} can't be shown. It may be damaged.` : meta?.empty ? `${current.name} is empty.` : "Opening..."}</div>
      )}
      {busy && <div className="phBusy">{busy}</div>}
    </div>
  )

  const statusLeft = current
    ? `${current.name}${dirty ? " (edited)" : ""}`
    : selected && !selected.isDirectory
      ? selected.name
      : `${items.length} picture${items.length === 1 ? "" : "s"}${subfolders.length ? `, ${subfolders.length} folder${subfolders.length === 1 ? "" : "s"}` : ""}`
  const statusInfo = current && shown?.src
    ? `${shown.width} x ${shown.height}  ${tool === "crop" && cropRect ? `crop ${Math.round(cropRect.w)} x ${Math.round(cropRect.h)}` : formatSize(current.size)}`
    : selected && !selected.isDirectory
      ? `${kindOf(selected.head)}, ${formatSize(selected.size)}`
      : usage?.free != null
        ? `${formatBytes(usage.free)} free on drive C:`
        : ""

  return (
    <div ref={rootRef} className={`phRoot${mobile ? " phRoot--mobile" : ""}`} tabIndex={-1}>
      <MenuBar menus={menus} />
      <div className="phTools" role="toolbar" aria-label="Photos">
        {current ? viewTools : browseTools}
      </div>
      {!current && (
        <div className="phAddress">
          <label htmlFor="ph-folder">Look in:</label>
          <select
            id="ph-folder"
            value={fs.displayPath(folder)}
            onChange={(e) => {
              const d = fs.resolve(e.target.value)
              if (d?.isDirectory) openFolder(d)
            }}
          >
            {!folders.some((f) => f.dir === folder) && <option value={fs.displayPath(folder)}>{fs.displayPath(folder)}</option>}
            {folders.map(({ dir: d, count }) => (
              <option key={fs.displayPath(d)} value={fs.displayPath(d)}>
                {fs.displayPath(d)}
                {count ? ` (${count})` : ""}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="phBody">{current ? viewer : grid}</div>
      {current && toolPanel}
      <div className="status-bar phStatus">
        <p className="status-bar-field">{statusLeft}</p>
        <p className="status-bar-field phStatusInfo">{statusInfo}</p>
        {current && <p className="status-bar-field phStatusSmall">{index >= 0 ? `${index + 1} of ${items.length}` : ""}</p>}
        {current && <p className="status-bar-field phStatusSmall">{zoom}%</p>}
      </div>
      <input ref={uploadRef} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(e) => (upload(e.target.files), (e.target.value = ""))} />
      {slideshow !== null && items.length > 0 && (
        <Slideshow
          items={items}
          start={slideshow}
          prefs={showPrefs}
          onPrefs={(patch) =>
            setShowPrefs((p) => {
              const next = { ...p, ...patch }
              try {
                localStorage.setItem(PREFS_KEY, JSON.stringify(next))
              } catch {
                // this visit only
              }
              return next
            })
          }
          onExit={(item) => {
            setSlideshow(null)
            if (current && item && item !== current) setCurrent(item)
            rootRef.current?.focus({ preventScroll: true })
          }}
        />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {dialog?.kind === "alert" && (
        <Dialog title={dialog.title} onOk={() => setDialog(null)}>
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}
      {dialog?.kind === "save" && (
        <Dialog
          title="Photos"
          sound="ding"
          okLabel="Yes"
          onOk={() => {
            const then = dialog.then
            setDialog(null)
            save().then((ok) => ok && then())
          }}
          onNo={() => {
            const then = dialog.then
            setDialog(null)
            resetEdits()
            live.current.dirty = false
            then()
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">Save the changes to {current?.name}?</p>
        </Dialog>
      )}
      {dialog?.kind === "delete" && (
        <Dialog title="Confirm File Delete" sound="ding" okLabel="Yes" cancelLabel="No" onOk={() => doDelete(dialog.item)} onCancel={() => setDialog(null)}>
          <p className="dialogText">Are you sure you want to send '{dialog.item.name}' to the Recycle Bin?</p>
        </Dialog>
      )}
      {dialog?.kind === "rename" && (
        <Dialog title="Rename" onOk={doRename} onCancel={() => setDialog(null)}>
          <label className="dialogText" htmlFor="ph-rename">
            New name:
          </label>
          <input id="ph-rename" type="text" value={dialog.value} maxLength={64} onChange={(e) => setDialog({ ...dialog, value: e.target.value, error: null })} style={{ width: "100%" }} />
          {dialog.error && <p className="dialogText phError">{dialog.error}</p>}
        </Dialog>
      )}
      {dialog?.kind === "network" && (
        <Dialog title="Send to Network Neighborhood" onCancel={() => setDialog(null)}>
          <p className="dialogText">Send {target?.name} to:</p>
          <div className="phComputers">
            {(net?.computers || []).filter((c) => !c.me).length === 0 && <p className="dialogText">Nobody else is on the network right now.</p>}
            {(net?.computers || [])
              .filter((c) => !c.me)
              .map((c) => (
                <button key={c.id} type="button" onClick={() => sendTo(c)} title={describe(c)}>
                  \\{c.name}
                </button>
              ))}
          </div>
        </Dialog>
      )}
    </div>
  )
}

export default Photos
