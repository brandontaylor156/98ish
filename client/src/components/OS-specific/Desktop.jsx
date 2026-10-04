import React, { useEffect, useRef, useState } from "react"
import { Rnd } from "react-rnd"
import { compassWindow, desktopPrograms, ieWindow, launch, paintWindow, programByName, windowFor } from "../../utils/programs"
import { useSettings } from "../../utils/settings"
import { openItem, openTarget } from "../../utils/openItem"
import { fs, readContent, uniqueName, validName } from "../../utils/fs"
import { iconFor } from "../../utils/fileInfo"
import { DRAG_TYPE, desktopFolder, getClipboard, moveInto, pasteInto, setClipboard } from "../../utils/fsActions"
import { useFsVersion } from "../../hooks/useFs"
import { playSystemSound } from "../../utils/systemSounds"
import { AimProvider } from "../applets/aim/AimContext"
import MailNotifier from "../applets/mail/MailNotifier"
import NotifyBridge from "./NotifyBridge"
import CoupleBridge, { FlowerSpot } from "../applets/couples/CoupleBridge"
import { useCouple } from "../../utils/couple"
import { NetProvider } from "../applets/network/NetContext"
import ContextMenu from "../shared/ContextMenu"
import Dialog from "../shared/Dialog"
import { useOpenGesture } from "../../hooks/useMediaQuery"
import { useLongPress } from "../../hooks/useLongPress"
import MobileIcons, { resetMobileIcons } from "./MobileIcons"
import io from "socket.io-client"
import { lazyApp } from "./LazyApp"
import { PROJECTS } from "../../utils/projects"
import { CLOSE_EVENT, quickLaunchDrop, watchSocket } from "../../utils/shell"
import { readClipboard } from "../../utils/systemClipboard"
import { openHelp } from "../../utils/help"

// Sharing with the phone (Send To, Received Items, Upload from Phone): its own download,
// fetched when a menu that needs it opens, so a tap can call the share sheet at once
const ShareCenter = React.lazy(() => import("./ShareCenter"))
let shareModule = null
const loadShare = () => import("../../utils/share").then((m) => (shareModule = m))
const withShare = (fn) => () => (shareModule ? fn(shareModule) : loadShare().then(fn))
const loadReceive = () => import("../../utils/receive")
const UPLOAD_LABEL = () => (window.matchMedia?.("(pointer: coarse)").matches ? "Upload from Phone..." : "Upload from Your Device...")
const PHONE_ACCEPT = "image/*,.heic,.heif,text/*,audio/*,.txt,.md,.csv,.json,.html,.htm,.rtf,.wav,.mp3,.m4a"

// each app is its own download, fetched the first time it opens
const Calculator = lazyApp(() => import("../applets/calculator/Calculator"))
const CharMap = lazyApp(() => import("../applets/charmap/CharMap"))
const DateTimeProperties = lazyApp(() => import("../applets/datetime/DateTimeProperties"))
const KeyboardProperties = lazyApp(() => import("../applets/keyboard/KeyboardProperties"))
const Passwords = lazyApp(() => import("../applets/passwords/Passwords"))
const Solitaire = lazyApp(() => import("../applets/cards/Solitaire"))
const FreeCell = lazyApp(() => import("../applets/cards/FreeCell"))
const Paint = lazyApp(() => import("../applets/paint/Paint"))
const WordPad = lazyApp(() => import("../applets/wordpad/WordPad"))
const SoundRecorder = lazyApp(() => import("../applets/soundRecorder/SoundRecorder"))
const Pinball = lazyApp(() => import("../applets/pinball/Pinball"))
const MediaPlayer = lazyApp(() => import("../applets/mediaPlayer/MediaPlayer"))
const NetWindow = lazyApp(() => import("../applets/network/NetWindow"))
const Mail = lazyApp(() => import("../applets/mail/Mail"))
const HomePageStudio = lazyApp(() => import("../applets/homepage/HomePageStudio"))
const Ski = lazyApp(() => import("../applets/ski/Ski"))
const Pickleball = lazyApp(() => import("../applets/pickleball/Pickleball"))
const Shred = lazyApp(() => import("../applets/shred/Shred"))
const BlockTen = lazyApp(() => import("../applets/blockten/BlockTen"))
const WordDuel = lazyApp(() => import("../applets/wordduel/WordDuel"))
const SpeedType = lazyApp(() => import("../applets/speedtype/SpeedType"))
const LastCard = lazyApp(() => import("../applets/lastcard/LastCard"))
const Hexlands = lazyApp(() => import("../applets/hexlands/Hexlands"))
const MonsterDuel = lazyApp(() => import("../applets/monsterduel/MonsterDuel"))
const Town = lazyApp(() => import("../applets/town/Town"))
const Puzzle = lazyApp(() => import("../applets/puzzle/Puzzle"))
const Doodle = lazyApp(() => import("../applets/doodle/Doodle"))
const Quiz = lazyApp(() => import("../applets/quiz/Quiz"))
const Us = lazyApp(() => import("../applets/couples/Us"))
const LoveLetters = lazyApp(() => import("../applets/couples/LoveLetters"))
const OurStory = lazyApp(() => import("../applets/couples/OurStory"))
const Dollhouse = lazyApp(() => import("../applets/dollhouse/Dollhouse"))
const Pet = lazyApp(() => import("../applets/pet/Pet"))
const Appward = lazyApp(() => import("../applets/appward/Appward"))
const Welcome = lazyApp(() => import("../applets/welcome/Welcome"))
const CalendarApp = lazyApp(() => import("../applets/calendar/Calendar"))
const ClockApp = lazyApp(() => import("../applets/calendar/Clock"))
// reminders, alarms and live calendar notices, whether or not Calendar is open (its own download)
const CalendarBridge = React.lazy(() => import("../applets/calendar/CalendarBridge"))
const Camera = lazyApp(() => import("../applets/camera/Camera"))
const Photos = lazyApp(() => import("../applets/photos/Photos"))
const AddressBook = lazyApp(() => import("../applets/addressbook/AddressBook"))
const Find = lazyApp(() => import("../applets/find/Find"))
// 98ish Help (Start > Help, F1, Help > Help Topics: utils/help.js openHelp)
const HelpViewer = lazyApp(() => import("../applets/help/HelpViewer"))
// Our Pet out for a walk on the desktop (couples only, its own small download)
const PetWalker = React.lazy(() => import("../applets/pet/PetWalker"))
// Network Neighborhood and the head-to-head games
const isNetWindow = (w) => w.app === "network" || !!w.app?.startsWith("net-")
const FileExplorer = lazyApp(() => import("../applets/fileExplorer/FileExplorer"))
const RecycleBin = lazyApp(() => import("../applets/fileExplorer/RecycleBin"))
const Notepad = lazyApp(() => import("../applets/notepad/Notepad"))
const MsDos = lazyApp(() => import("../applets/dos/MsDos"))
const DisplayProperties = lazyApp(() => import("../applets/display/DisplayProperties"))
const Tetris = lazyApp(() => import("../applets/tetris/Tetris"))
const Hover = lazyApp(() => import("../applets/hover/Hover"))
const Spectra = lazyApp(() => import("../applets/spectra/Spectra"))
const InternetExplorer = lazyApp(() => import("../applets/internetExplorer/InternetExplorer"))
const Compass = lazyApp(() => import("../applets/compass/Compass"))
const VideoPlayer = lazyApp(() => import("../applets/videoPlayer/VideoPlayer"))
const Minesweeper = lazyApp(() => import("../applets/minesweeper/Minesweeper"))
const WindowsUpdate = lazyApp(() => import("../applets/update/WindowsUpdate"))
const TaskManager = lazyApp(() => import("../applets/taskManager/TaskManager"))
const Messenger = lazyApp(() => import("../applets/aim/Messenger"))
const ImWindow = lazyApp(() => import("../applets/aim/ImWindow"))
const ChatRoom = lazyApp(() => import("../applets/aim/ChatRoom"))
const BuddyInfo = lazyApp(() => import("../applets/aim/BuddyInfo"))
const ChatInvite = lazyApp(() => import("../applets/aim/ChatInvite"))
const AimNotice = lazyApp(() => import("../applets/aim/ChatInvite").then((m) => ({ default: m.AimNotice })))
const DeleteAccount = lazyApp(() => import("../applets/aim/DeleteAccount"))
const CallWindow = lazyApp(() => import("../applets/aim/call/CallWindow"))
const RingWindow = lazyApp(() => import("../applets/aim/call/RingWindow"))
const DesktopThemes = lazyApp(() => import("../applets/themes/DesktopThemes"))
const SystemProperties = lazyApp(() => import("../applets/system/SystemProperties"))
const WebApp = lazyApp(() => import("../applets/webapp/WebApp"))
const Backup = lazyApp(() => import("../applets/backup/Backup"))
// Control Panel, its own applets (Accessibility Options, Mouse, Regional Settings...) and Magnifier
const ControlPanel = lazyApp(() => import("../applets/controlPanel/ControlPanel"))
const CplApplet = lazyApp(() => import("../applets/controlPanel/CplApplet"))
const Magnifier = lazyApp(() => import("../applets/controlPanel/Magnifier"))
// tells file sync who is signed on to 98 Messenger (its own small download)
const DriveSync = React.lazy(() => import("../applets/backup/DriveSync"))
// "drive C: is full", a private window's small drive, a move to the bigger storage that didn't work
const StorageNotice = React.lazy(() => import("../applets/backup/StorageNotice"))

const ICONS_KEY = "98ish.desktopIcons"
const VIEW_KEY = "98ish.desktopView"
// icon spacing (desktop right-click > View): the grid icons line up on
const SPACINGS = {
  small: { w: 80, h: 78 },
  medium: { w: 94, h: 88 },
  large: { w: 116, h: 104 },
}
const DEFAULT_VIEW = { spacing: "medium", autoArrange: false, alignToGrid: false, order: null }
const loadView = () => {
  try {
    return { ...DEFAULT_VIEW, ...JSON.parse(localStorage.getItem(VIEW_KEY)) }
  } catch {
    return { ...DEFAULT_VIEW }
  }
}
const ICON_W = 88
const ICON_H = 76

// Narrowest a window may get. 98 Messenger's Buddy List and IMs are tall and narrow.
const minWidthFor = (window) =>
  window.name === "Minesweeper" ? 150
  : window.app === "calc" ? 200
  : window.app === "net-race" ? 250 // room for its title and the race bars
  : window.name === "98 Messenger" || window.app?.startsWith("aim-") || window.app?.startsWith("net-") ? 220
  : 300

// windows with a "?" in the title bar (Windows 98's property sheets): it opens their help topic
const HELP_BUTTON = new Set(["Display Properties", "Date/Time Properties", "Keyboard Properties", "Passwords", "Desktop Themes", "System Properties", "Accessibility Options", "Add/Remove Programs", "Mouse", "Regional Settings", "Storage", "Internet Options", "Fonts", "Power Management", "Sounds"])

// High Contrast leaves these windows' contents in their own colors (games, pictures)
const KEEP_COLORS = new Set(["paint", "photos", "camera", "webapp", "magnifier", "pinball"])
const keepsColors = (window) => {
  const p = programByName(window.program)
  return KEEP_COLORS.has(window.app) || p?.group === "Games" || !!p?.also?.includes("Games") || !!window.app?.startsWith("net-")
}

// Screen size (and the taskbar's height) for sizing maximized windows
const useViewport = () => {
  const measure = () => ({
    width: document.documentElement.clientWidth,
    height: window.innerHeight,
    taskbar: document.querySelector(".taskbar")?.offsetHeight || 35,
  })
  const [viewport, setViewport] = useState(measure)
  useEffect(() => {
    const update = () => setViewport(measure())
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])
  return viewport
}

// My Computer and the Recycle Bin first, as in Windows
const defaultOrder = () => {
  const first = ["My Computer", "Recycle Bin"]
  // (Us only shows up for couples: it takes the next free spot then)
  return [...first, ...desktopPrograms.filter((p) => p.desktop !== "paired").map((p) => p.name).filter((n) => !first.includes(n))]
}

// Columns down the left side, top to bottom
const rowsFor = (viewport, cell) => Math.max(1, Math.floor((viewport.height - viewport.taskbar - 10) / cell.h))
const cellAt = (i, rows, cell) => ({ x: 6 + Math.floor(i / rows) * cell.w, y: 6 + (i % rows) * cell.h })
const gridLayout = (names, viewport, cell = SPACINGS.medium) => {
  const rows = rowsFor(viewport, cell)
  return Object.fromEntries(names.map((name, i) => [name, cellAt(i, rows, cell)]))
}

// the first grid spot (column by column) no icon is sitting on
const freeSpot = (taken, viewport, cell = SPACINGS.medium) => {
  const rows = rowsFor(viewport, cell)
  const near = (p, q) => Math.abs(p.x - q.x) < cell.w * 0.6 && Math.abs(p.y - q.y) < cell.h * 0.6
  for (let i = 0; ; i++) {
    const spot = cellAt(i, rows, cell)
    if (!taken.some((p) => near(p, spot))) return spot
  }
}

// the grid cell nearest a point
const snapToGrid = (p, cell) => ({ x: 6 + Math.max(0, Math.round((p.x - 6) / cell.w)) * cell.w, y: 6 + Math.max(0, Math.round((p.y - 6) / cell.h)) * cell.h })

const loadIcons = () => {
  try {
    return JSON.parse(localStorage.getItem(ICONS_KEY)) || null
  } catch {
    return null
  }
}

const saveIcons = (positions) => {
  try {
    localStorage.setItem(ICONS_KEY, JSON.stringify(positions))
  } catch {
    // fine: they just won't be remembered
  }
}

const Desktop = ({ windows, dispatch, closeMenu, mobile }) => {
  useFsVersion()
  const [socket] = useState(() =>
    io(import.meta.env.VITE_SOCKET_URL || "http://localhost:8000")
  )
  const [share, setShare] = useState("")
  const [menu, setMenu] = useState(null) // { x, y, items }
  // selected icons (a lasso or Ctrl+click picks several); `selected` is the main one
  const [selection, setSelection] = useState(() => new Set())
  const selected = selection.size ? [...selection].at(-1) : null
  const setSelected = (key) => setSelection(key ? new Set([key]) : new Set())
  const isSelected = (key) => selection.has(key)
  const [lasso, setLasso] = useState(null) // { x0, y0, x1, y1 } while dragging one out
  const [groupDrag, setGroupDrag] = useState(null) // { key, dx, dy } moving several icons
  const [view, setViewState] = useState(loadView)
  const setView = (patch) =>
    setViewState((v) => {
      const next = { ...v, ...patch }
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify(next))
      } catch {
        // fine: lasts for this visit
      }
      return next
    })
  const cell = SPACINGS[view.spacing] || SPACINGS.medium
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [dialog, setDialog] = useState(null) // naming, renaming and deleting desktop files
  const [mobileLayout, setMobileLayout] = useState(0)
  const openGesture = useOpenGesture()
  const viewport = useViewport()
  const [positions, setPositions] = useState(() => ({ ...gridLayout(defaultOrder(), viewport), ...loadIcons() }))
  const paired = useCouple().status === "paired"
  // Add/Remove Programs can take programs off the desktop
  const { hiddenDesktop = [] } = useSettings()

  // the browser window got smaller: pull windows back on screen (a window left past the
  // new edge had no reachable Close button)
  useEffect(() => {
    if (!mobile) dispatch({ type: "fit_windows", payload: { width: viewport.width, height: viewport.height - viewport.taskbar } })
  }, [viewport.width, viewport.height, viewport.taskbar, mobile])

  // logging off or shutting down unmounts the desktop: sign out of 98 Messenger
  useEffect(() => () => socket.disconnect(), [])
  // the taskbar's network icon
  useEffect(() => watchSocket(socket), [])

  // Switching windows without a click (Alt+Q, the taskbar, Show Desktop, minimize) leaves
  // the keyboard focus in the old window, so games kept playing behind other windows and
  // took the arrow keys. Take the focus out of a window that is no longer the active one:
  // its blur handler pauses it.
  const activeIndex = windows.findIndex((w) => w.active && !w.closed && !w.minimized)
  useEffect(() => {
    const el = document.activeElement
    const owner = el?.closest?.("[data-window-index]")
    if (owner && Number(owner.dataset.windowIndex) !== activeIndex) el.blur()
  }, [activeIndex])

  // once the desktop has settled, fetch the everyday apps in the background so they
  // open instantly (the big ones still load on first use)
  useEffect(() => {
    const id = setTimeout(() => {
      for (const app of [FileExplorer, Notepad, RecycleBin, MsDos, Minesweeper, Tetris, TaskManager, DisplayProperties]) app.preload().catch(() => {})
    }, 4000)
    return () => clearTimeout(id)
  }, [])

  const binFull = fs.recycleBin.content.length > 0
  // the programs, then whatever is in C:\Desktop (files, folders, shortcuts)
  const deskDir = fs.resolve("C:/Desktop")
  const icons = [
    ...desktopPrograms.filter((p) => (p.desktop !== "paired" || paired) && !hiddenDesktop.includes(p.name)).map((p) => ({
      ...p,
      key: p.name,
      icon: p.app === "recycle" ? (binFull ? "/assets/recycle_bin_full.png" : "/assets/recycle_bin_empty.png") : p.icon,
    })),
    ...(deskDir?.isDirectory ? deskDir.content : []).map((item) => ({ key: `file:${item.name}`, name: `file:${item.name}`, label: item.name, icon: iconFor(item), item })),
  ]

  // Auto Arrange keeps every icon in the grid, in its own order (dragging one reorders);
  // otherwise icons stay where they're put and new ones take the next free spot
  const autoOrder = (() => {
    const keys = icons.map((i) => i.key)
    const kept = (view.order || []).filter((k) => keys.includes(k))
    return [...kept, ...keys.filter((k) => !kept.includes(k))]
  })()
  const placed = view.autoArrange ? gridLayout(autoOrder, viewport, cell) : { ...positions }
  if (!view.autoArrange) for (const icon of icons) if (!placed[icon.key]) placed[icon.key] = freeSpot(Object.values(placed), viewport, cell)

  const savePosition = (key, x, y) => {
    const next = { ...placed, [key]: { x, y } }
    setPositions(next)
    saveIcons(next)
  }

  const openIcon = (icon) => {
    if (!icon.item) return dispatch({ type: "open_window", payload: windowFor(icon) })
    if (!openItem(icon.item, dispatch)) setDialog({ kind: "alert", text: icon.item.type === "shortcut" ? "The item this shortcut refers to has been changed or moved." : "There's no program associated with this file." })
  }
  const openProgram = openIcon

  // ---- closing (Notepad asks about unsaved changes first) ----

  const guards = useRef({})
  const registrars = useRef({})
  const registerFor = (index) =>
    (registrars.current[index] ||= (fn) => {
      guards.current[index] = fn
      return () => {
        if (guards.current[index] === fn) delete guards.current[index]
      }
    })

  const closeWindow = (window, index, force = false) => {
    if (!force && guards.current[index]?.() === false) return
    dispatch({ type: "close_window", payload: { name: window.name, index } })
  }

  // a taskbar button's Close
  const latestClose = useRef(null)
  latestClose.current = (index) => windows[index] && !windows[index].closed && closeWindow(windows[index], index)
  useEffect(() => {
    const onClose = (e) => latestClose.current(e.detail.index)
    window.addEventListener(CLOSE_EVENT, onClose)
    return () => window.removeEventListener(CLOSE_EVENT, onClose)
  }, [])

  // YouTube links in 98 Messenger play in a View Video window
  const openVideo = (url) => {
    setShare(url)
    dispatch({
      type: "open_window",
      payload: {
        name: "View Video",
        minimized: false,
        maximized: false,
        active: true,
        closed: false,
        width: 768,
        height: 432,
        positionX: 10,
        positionY: 0,
        icon_url: "/assets/program_icons/video.png",
      },
    })
  }

  const rename = (index) => (name) => dispatch({ type: "rename_window", payload: { index, name } })

  // ---- right-click menus ----

  const arrange = (by) => {
    const names = defaultOrder()
    if (by === "name") names.sort((a, b) => a.localeCompare(b))
    if (by === "type") {
      const rank = (n) => (n === "My Computer" ? 0 : n === "Recycle Bin" ? 1 : 2)
      names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    }
    const files = icons
      .filter((i) => i.item)
      .sort((a, b) => (by === "type" ? a.item.type.localeCompare(b.item.type) : 0) || a.label.localeCompare(b.label))
    const order = [...names, ...files.map((f) => f.key)]
    const next = gridLayout(order, viewport, cell)
    if (view.autoArrange) setView({ order })
    setPositions(next)
    saveIcons(next)
    if (mobile) {
      resetMobileIcons(by === "name" ? [...names] : names)
      setMobileLayout((n) => n + 1)
    }
  }

  const lineUp = () => {
    const next = Object.fromEntries(
      Object.entries(placed).map(([name, p]) => [name, snapToGrid(p, cell)])
    )
    setPositions(next)
    saveIcons(next)
  }

  const setSpacing = (spacing) => {
    const next = SPACINGS[spacing]
    // keep each icon in the same grid slot, on the new grid
    const moved = Object.fromEntries(Object.entries(placed).map(([k, p]) => [k, { x: 6 + Math.round((p.x - 6) / cell.w) * next.w, y: 6 + Math.round((p.y - 6) / cell.h) * next.h }]))
    setView({ spacing })
    setPositions(moved)
    saveIcons(moved)
  }

  const toggleAutoArrange = () => {
    if (!view.autoArrange) {
      // start from where the icons are now, column by column
      const order = [...icons].sort((a, b) => placed[a.key].x - placed[b.key].x || placed[a.key].y - placed[b.key].y).map((i) => i.key)
      setView({ autoArrange: true, order })
    } else {
      setPositions(placed)
      saveIcons(placed)
      setView({ autoArrange: false })
    }
  }

  const desktopMenu = () => [
    {
      label: "View",
      items: [
        { label: "Large Icon Spacing", checked: view.spacing === "large", onClick: () => setSpacing("large") },
        { label: "Medium Icon Spacing", checked: view.spacing === "medium", onClick: () => setSpacing("medium") },
        { label: "Small Icon Spacing", checked: view.spacing === "small", onClick: () => setSpacing("small") },
        "-",
        { label: "Auto Arrange", checked: view.autoArrange, onClick: toggleAutoArrange },
        { label: "Align to Grid", checked: view.alignToGrid, disabled: view.autoArrange, onClick: () => setView({ alignToGrid: !view.alignToGrid }) },
      ],
    },
    {
      label: "Arrange Icons",
      items: [
        { label: "by Name", onClick: () => arrange("name") },
        { label: "by Type", onClick: () => arrange("type") },
        { label: "Default", onClick: () => arrange("default") },
      ],
    },
    ...(mobile ? [] : [{ label: "Line Up Icons", disabled: view.autoArrange, onClick: lineUp }, { label: "Select All", onClick: () => setSelection(new Set(icons.map((i) => i.key))) }]),
    "-",
    { label: "Refresh", onClick: () => setPositions((p) => ({ ...p })) },
    "-",
    { label: "Paste", onClick: paste },
    { label: "Paste from Device Clipboard", onClick: pasteFromDevice },
    { label: UPLOAD_LABEL(), onClick: () => uploadRef.current?.click() },
    "-",
    {
      label: "New",
      items: [
        { label: "Folder", onClick: () => newOnDesktop("folder") },
        { label: "Text Document", onClick: () => newOnDesktop("file") },
        { label: "Bitmap Image", onClick: () => dispatch({ type: "open_window", payload: paintWindow() }) },
      ],
    },
    "-",
    { label: "Properties", onClick: () => dispatch({ type: "open_window", payload: launch("Display Properties") }) },
  ]

  const paste = () => {
    // nothing copied in 98ish: whatever is on the phone's/computer's clipboard
    if (!getClipboard()) return pasteFromDevice()
    try {
      pasteInto(desktopFolder())
    } catch (error) {
      setDialog({ kind: "alert", text: error.message })
    }
  }

  const reportIncoming = (result, verb) => {
    if (result.error) return setDialog({ kind: "alert", text: result.error })
    if (result.added.length) setSelected(`file:${result.added.at(-1).name}`)
    const text = result.problems.length || result.notes.length ? [result.added.length ? `${result.added.length} item${result.added.length === 1 ? " was" : "s were"} ${verb}.` : `Nothing was ${verb}.`, ...result.problems, ...result.notes].join(" ") : null
    if (text) setDialog({ kind: "alert", text })
  }

  // the system clipboard: read inside the tap (the browser may ask first, or say no)
  const pasteFromDevice = () => {
    const reading = readClipboard()
    Promise.all([reading, loadReceive()]).then(async ([clip, receive]) => {
      if (!clip.ok) return setDialog({ kind: "alert", text: clip.message })
      if (!clip.images.length && !String(clip.text || "").trim()) return setDialog({ kind: "alert", text: "The clipboard is empty (or holds something 98ish can't paste: pictures and text can come in)." })
      reportIncoming(await receive.savePasted(desktopFolder(), clip), "pasted")
    })
  }

  // Upload from Phone: photos and files picked on the device land on the desktop
  const uploadRef = useRef(null)
  const uploadFiles = async (files) => {
    if (!files.length) return
    const receive = await loadReceive()
    reportIncoming(await receive.receiveFiles(desktopFolder(), files), "added")
  }

  const newOnDesktop = (kind) => {
    const dir = desktopFolder()
    setDialog({ kind: "name", create: kind, title: kind === "folder" ? "New Folder" : "New Text Document", text: uniqueName(dir, kind === "folder" ? "New Folder" : "New Text Document") })
  }

  const finishName = () => {
    const name = dialog.text.trim()
    const problem = validName(name)
    if (problem) return setDialog({ ...dialog, error: problem })
    try {
      const dir = desktopFolder()
      if (dialog.create === "folder") fs.createDirectoryIn(dir, name)
      else if (dialog.create === "file") fs.createFileIn(dir, name, "text", "")
      else {
        // keep its spot on the desktop under the new name
        const old = `file:${dialog.item.name}`
        dialog.item.name = name
        if (placed[old]) savePosition(`file:${name}`, placed[old].x, placed[old].y)
      }
      setSelected(`file:${name}`)
      setDialog(null)
    } catch (error) {
      setDialog({ ...dialog, error: error.message })
    }
  }

  const fileMenu = (icon) => {
    // a big file loads lazily: start now, so Send To has it inside the tap
    if (!icon.item.isDirectory) readContent(icon.item).catch(() => {})
    return fileMenuItems(icon)
  }
  const fileMenuItems = (icon) => [
    { label: "Open", bold: true, onClick: () => openIcon(icon) },
    ...(icon.item.isDirectory ? [{ label: "Explore", onClick: () => dispatch({ type: "open_window", payload: launch("My Computer", { path: fs.partsOf(icon.item) }) }) }] : []),
    "-",
    { label: "Cut", onClick: () => setClipboard({ mode: "cut", items: [icon.item] }) },
    { label: "Copy", onClick: () => setClipboard({ mode: "copy", items: [icon.item] }) },
    "-",
    {
      label: "Send To",
      disabled: icon.item.isDirectory,
      items: [
        { label: "My Phone", onClick: withShare((m) => m.shareOut(m.itemPayload(icon.item), "phone")) },
        { label: "Other Apps...", onClick: withShare((m) => m.shareOut(m.itemPayload(icon.item), "apps")) },
      ],
    },
    "-",
    { label: "Delete", onClick: () => setDialog({ kind: "delete", item: icon.item }) },
    { label: "Rename", onClick: () => setDialog({ kind: "name", title: "Rename", text: icon.item.name, item: icon.item }) },
  ]

  // Delete, F2 and Enter on a selected desktop file
  useEffect(() => {
    const onKey = (e) => {
      if (dialog || menu || e.target.closest?.("input, textarea, [contenteditable], .desktopWindow, .mobileWindow")) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && !mobile) {
        e.preventDefault()
        return setSelection(new Set(icons.map((i) => i.key)))
      }
      if (selection.size > 1) {
        const many = icons.filter((i) => selection.has(i.key))
        if (e.key === "Delete" && many.some((i) => i.item)) setDialog({ kind: "deleteMany", items: many.filter((i) => i.item).map((i) => i.item) })
        else if (e.key === "Enter") many.slice(0, 6).forEach(openIcon)
        else return
        return e.preventDefault()
      }
      const icon = icons.find((i) => i.key === selected)
      if (!icon?.item) return
      if (e.key === "Delete") setDialog({ kind: "delete", item: icon.item })
      else if (e.key === "F2") setDialog({ kind: "name", title: "Rename", text: icon.item.name, item: icon.item })
      else if (e.key === "Enter") openIcon(icon)
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  // something dragged out of My Computer lands on the desktop
  const onDragOver = (e) => {
    if (e.dataTransfer.types.includes(DRAG_TYPE) && !e.target.closest(".desktopWindow")) e.preventDefault()
  }
  const onDrop = (e) => {
    const from = e.dataTransfer.getData(DRAG_TYPE)
    if (!from || e.target.closest(".desktopWindow")) return
    e.preventDefault()
    const item = fs.resolve(from)
    if (!item) return
    try {
      const moved = moveInto(item, desktopFolder())
      savePosition(`file:${moved.name}`, Math.max(0, e.clientX - 44), Math.max(0, e.clientY - 30))
      setSelected(`file:${moved.name}`)
    } catch (error) {
      setDialog({ kind: "alert", text: error.message })
    }
  }

  const iconMenu = (program) => [
    { label: "Open", bold: true, onClick: () => openProgram(program) },
    ...(program.app === "recycle" ? [{ label: "Empty Recycle Bin", disabled: !binFull, onClick: () => setConfirmEmpty(true) }] : []),
    ...(program.app === "explorer" ? [{ label: "Explore", onClick: () => dispatch({ type: "open_window", payload: launch("My Computer", { path: ["C:"] }) }) }] : []),
    "-",
    // (a program's Properties used to open Display Properties, which isn't about it at all)
    { label: "Properties", onClick: () => (program.app === "explorer" ? dispatch({ type: "open_window", payload: launch("System Properties") }) : program.app === "recycle" ? openProgram(program) : setDialog({ kind: "props", program })) },
  ]

  const manyMenu = (keys) => {
    const many = icons.filter((i) => keys.has(i.key))
    const files = many.filter((i) => i.item).map((i) => i.item)
    return [
      { label: `Open (${many.length})`, bold: true, onClick: () => many.slice(0, 6).forEach(openIcon) },
      "-",
      { label: "Cut", disabled: !files.length, onClick: () => setClipboard({ mode: "cut", items: files }) },
      { label: "Copy", disabled: !files.length, onClick: () => setClipboard({ mode: "copy", items: files }) },
      "-",
      { label: files.length ? `Delete ${files.length} item${files.length === 1 ? "" : "s"}` : "Delete", disabled: !files.length, onClick: () => setDialog({ kind: "deleteMany", items: files }) },
    ]
  }

  const showMenu = (x, y, icon) => {
    closeMenu()
    if (icon && selection.size > 1 && selection.has(icon.key)) return setMenu({ x, y, items: manyMenu(selection) })
    setSelected(icon?.key || null)
    if (icon?.item && !shareModule) loadShare().catch(() => {})
    setMenu({ x, y, items: icon ? (icon.item ? fileMenu(icon) : iconMenu(icon)) : desktopMenu() })
  }

  // ---- lasso: drag a box across the desktop to select icons ----
  const onSurfacePointerDown = (e) => {
    if (mobile || e.button !== 0 || e.target.closest(".desktopIcon, .desktopWindow, .contextMenu, .helper, .dialog, button, a, input")) return
    const add = e.ctrlKey || e.metaKey || e.shiftKey
    const before = add ? new Set(selection) : new Set()
    const start = { x: e.clientX, y: e.clientY }
    let moved = false
    const pick = (box) => {
      const next = new Set(before)
      for (const icon of icons) {
        const p = placed[icon.key]
        if (p.x < box.x1 && p.x + ICON_W > box.x0 && p.y < box.y1 && p.y + ICON_H > box.y0) next.add(icon.key)
      }
      setSelection(next)
    }
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return
      moved = true
      const box = { x0: Math.min(start.x, ev.clientX), y0: Math.min(start.y, ev.clientY), x1: Math.max(start.x, ev.clientX), y1: Math.max(start.y, ev.clientY) }
      setLasso(box)
      pick(box)
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
      setLasso(null)
      if (moved) swallowClick.current = true
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
  }
  // the click that ends a lasso mustn't clear what it just selected
  const swallowClick = useRef(false)
  const dragged = useRef(false)

  // dropping one icon of a group moves them all (or reorders, with Auto Arrange)
  const finishDrag = (icon, pos, data) => {
    const dx = data.x - pos.x
    const dy = data.y - pos.y
    setGroupDrag(null)
    if (view.autoArrange) {
      const rows = rowsFor(viewport, cell)
      const col = Math.max(0, Math.round((data.x - 6) / cell.w))
      const row = Math.min(rows - 1, Math.max(0, Math.round((data.y - 6) / cell.h)))
      const moving = selection.has(icon.key) ? autoOrder.filter((k) => selection.has(k)) : [icon.key]
      const rest = autoOrder.filter((k) => !moving.includes(k))
      const at = Math.min(rest.length, col * rows + row)
      return setView({ order: [...rest.slice(0, at), ...moving, ...rest.slice(at)] })
    }
    const group = selection.has(icon.key) && selection.size > 1 ? [...selection] : [icon.key]
    const next = { ...placed }
    for (const key of group) {
      const p = placed[key]
      if (!p) continue
      const raw = { x: Math.max(0, p.x + dx), y: Math.max(0, p.y + dy) }
      next[key] = view.alignToGrid ? snapToGrid(raw, cell) : raw
    }
    setPositions(next)
    saveIcons(next)
  }

  const longPress = useLongPress((x, y, { target }) => {
    if (target.closest?.(".mobileWindow, .desktopWindow, .startArea, .taskbar")) return
    const iconEl = target.closest?.("[data-program]")
    showMenu(x, y, iconEl ? icons.find((p) => p.key === iconEl.dataset.program) : null)
  })

  const onContextMenu = (e) => {
    if (e.target.closest(".desktopWindow, .mobileWindow, .contextMenuLayer")) return
    e.preventDefault()
    const iconEl = e.target.closest("[data-program]")
    showMenu(e.clientX, e.clientY, iconEl ? icons.find((p) => p.key === iconEl.dataset.program) : null)
  }

  // ---- window contents ----

  const renderContents = (window, index) => (
    <>
      {window.name == "Tetris" && (
        <Tetris
          mobile={mobile}
          // Tetris Online widens the window for opponents' boards
          fitWindow={
            mobile || window.maximized
              ? null
              : (width, height) => dispatch({ type: "resize_window", payload: { index, width, height } })
          }
        />
      )}
      {window.name == "Hover" && <Hover />}
      {window.name == "SPECTRA" && <Spectra />}
      {window.app === "ie" && (
        <InternetExplorer
          initialUrl={window.url}
          onTitle={rename(index)}
          onNewWindow={(url) => dispatch({ type: "open_window", payload: ieWindow(url) })}
          onClose={() => closeWindow(window, index)}
        />
      )}
      {window.app === "compass" && (
        <Compass
          initialUrl={window.url}
          mobile={mobile}
          dispatch={dispatch}
          onTitle={rename(index)}
          onNewWindow={(url) => dispatch({ type: "open_window", payload: compassWindow(url) })}
          onClose={() => closeWindow(window, index)}
        />
      )}
      {window.app === "explorer" && <FileExplorer path={window.path ?? []} dispatch={dispatch} onTitle={rename(index)} />}
      {window.app === "recycle" && <RecycleBin />}
      {window.app === "notepad" && (
        <Notepad
          file={window.file}
          onTitle={rename(index)}
          // Notepad's own Exit has already asked about saving
          onClose={() => closeWindow(window, index, true)}
          registerCloseGuard={registerFor(index)}
        />
      )}
      {window.app === "paint" && (
        <Paint
          file={window.file}
          mobile={mobile}
          onTitle={rename(index)}
          // Paint's own Exit has already asked about saving
          onClose={() => closeWindow(window, index, true)}
          registerCloseGuard={registerFor(index)}
        />
      )}
      {window.app === "wordpad" && (
        <WordPad
          file={window.file}
          mobile={mobile}
          onTitle={rename(index)}
          // WordPad's own Exit has already asked about saving
          onClose={() => closeWindow(window, index, true)}
          registerCloseGuard={registerFor(index)}
        />
      )}
      {window.app === "recorder" && (
        <SoundRecorder
          file={window.file}
          // its small window grows while a dialog (Open, Save As) needs the room
          fitWindow={
            mobile || window.maximized
              ? null
              : (width, height) => dispatch({ type: "resize_window", payload: { index, width, height } })
          }
          onTitle={rename(index)}
          onClose={() => closeWindow(window, index, true)}
          registerCloseGuard={registerFor(index)}
        />
      )}
      {window.app === "dos" && (
        <MsDos onClose={() => closeWindow(window, index)} onOpen={(target) => openTarget(target, dispatch)} onTitle={rename(index)} />
      )}
      {window.app === "display" && <DisplayProperties tab={window.tab} onClose={() => closeWindow(window, index)} />}
      {window.app === "themes" && <DesktopThemes onClose={() => closeWindow(window, index)} />}
      {window.app === "sysprops" && <SystemProperties tab={window.tab} onClose={() => closeWindow(window, index)} />}
      {window.app === "update" && <WindowsUpdate onClose={() => closeWindow(window, index)} />}
      {window.app === "media" && (
        <MediaPlayer song={window.song} windowIndex={index} onTitle={rename(index)} onClose={() => closeWindow(window, index)} />
      )}
      {window.name == "Minesweeper" && (
        <Minesweeper
          // On a desktop the window resizes to fit the board; phones and maximized
          // windows scale the board to the space instead
          fitWindow={
            mobile || window.maximized
              ? null
              : (width, height) =>
                  dispatch({ type: "resize_window", payload: { index, width, height } })
          }
          onClose={() => closeWindow(window, index)}
        />
      )}
      {window.app === "solitaire" && <Solitaire onClose={() => closeWindow(window, index)} />}
      {window.app === "freecell" && <FreeCell onClose={() => closeWindow(window, index)} onTitle={rename(index)} />}
      {window.app === "pinball" && <Pinball mobile={mobile} onClose={() => closeWindow(window, index)} onTitle={rename(index)} />}
      {window.app === "ski" && <Ski mobile={mobile} onClose={() => closeWindow(window, index)} />}
      {window.app === "pickleball" && <Pickleball mobile={mobile} onClose={() => closeWindow(window, index)} />}
      {window.app === "shred" && <Shred mobile={mobile} onClose={() => closeWindow(window, index)} />}
      {window.app === "blockten" && <BlockTen mobile={mobile} onClose={() => closeWindow(window, index)} />}
      {window.app === "wordduel" && <WordDuel mobile={mobile} onClose={() => closeWindow(window, index)} />}
      {window.app === "speedtype" && <SpeedType mobile={mobile} onClose={() => closeWindow(window, index)} />}
      {window.app === "lastcard" && <LastCard mobile={mobile} onClose={() => closeWindow(window, index)} />}
      {window.app === "hexlands" && <Hexlands mobile={mobile} onClose={() => closeWindow(window, index)} />}
      {window.app === "monsterduel" && <MonsterDuel mobile={mobile} onClose={() => closeWindow(window, index)} />}
      {window.app === "town" && <Town mobile={mobile} coopId={window.coopId} onClose={() => closeWindow(window, index)} onTitle={rename(index)} />}
      {window.app === "camera" && <Camera mobile={mobile} dispatch={dispatch} onTitle={rename(index)} onClose={() => closeWindow(window, index)} paused={!!window.minimized || (mobile && !window.active)} />}
      {window.app === "photos" && (
        <Photos
          file={window.file}
          path={window.path}
          mobile={mobile}
          dispatch={dispatch}
          onTitle={rename(index)}
          // Photos asks about unsaved edits itself before calling this
          onClose={() => closeWindow(window, index, true)}
          registerCloseGuard={registerFor(index)}
        />
      )}
      {window.app === "puzzle" && <Puzzle mobile={mobile} dispatch={dispatch} handoff={window.handoff} onClose={() => closeWindow(window, index)} onTitle={rename(index)} />}
      {window.app === "dollhouse" && <Dollhouse mobile={mobile} dispatch={dispatch} onClose={() => closeWindow(window, index)} onTitle={rename(index)} />}
      {window.app === "doodle" && <Doodle mobile={mobile} dispatch={dispatch} inviteTo={window.inviteTo} onClose={() => closeWindow(window, index)} onTitle={rename(index)} />}
      {window.app === "quiz" && <Quiz mobile={mobile} dispatch={dispatch} onClose={() => closeWindow(window, index)} onTitle={rename(index)} />}
      {window.app === "us" && <Us view={window.view} mobile={mobile} />}
      {window.app === "loveletters" && <LoveLetters view={window.view} mobile={mobile} />}
      {window.app === "ourstory" && <OurStory focus={window.focus} mobile={mobile} />}
      {window.app === "pet" && <Pet mobile={mobile} onTitle={rename(index)} />}
      {window.app === "appward" && <Appward mobile={mobile} onTitle={rename(index)} onClose={() => closeWindow(window, index)} />}

      {window.app === "calc" && (
        <Calculator
          // fits its window to the buttons (Standard, Scientific); phones stretch them
          fitWindow={
            mobile || window.maximized
              ? null
              : (width, height) => dispatch({ type: "resize_window", payload: { index, width, height } })
          }
        />
      )}
      {window.app === "charmap" && <CharMap onClose={() => closeWindow(window, index)} />}
      {window.app === "datetime" && <DateTimeProperties tab={window.tab} onClose={() => closeWindow(window, index)} />}
      {window.app === "keyboard" && <KeyboardProperties tab={window.tab} onClose={() => closeWindow(window, index)} />}
      {window.app === "passwords" && <Passwords tab={window.tab} reason={window.reason} onClose={() => closeWindow(window, index)} />}
      {window.app === "webapp" && PROJECTS.find((p) => p.name === window.program) && (
        <WebApp project={PROJECTS.find((p) => p.name === window.program)} mobile={mobile} />
      )}
      {window.app === "backup" && <Backup dispatch={dispatch} mobile={mobile} />}
      {window.app === "control" && <ControlPanel dispatch={dispatch} mobile={mobile} />}
      {window.app === "cpl" && <CplApplet program={window.program} tab={window.tab} dispatch={dispatch} mobile={mobile} onClose={() => closeWindow(window, index)} />}
      {window.app === "magnifier" && <Magnifier mobile={mobile} dispatch={dispatch} onClose={() => closeWindow(window, index)} />}
      {window.app === "calendar" && <CalendarApp calendarView={window.calendarView} mobile={mobile} dispatch={dispatch} onClose={() => closeWindow(window, index)} />}
      {window.app === "clock" && <ClockApp clockTab={window.calendarView?.tab} mobile={mobile} />}
      {window.app === "addressbook" && <AddressBook mobile={mobile} dispatch={dispatch} handoff={window.handoff} onTitle={rename(index)} onClose={() => closeWindow(window, index)} />}
      {window.app === "find" && <Find mobile={mobile} dispatch={dispatch} query={window.query} handoff={window.handoff} onTitle={rename(index)} onClose={() => closeWindow(window, index)} />}
      {window.app === "welcome" && <Welcome dispatch={dispatch} mobile={mobile} onClose={() => closeWindow(window, index)} />}
      {window.app === "help" && <HelpViewer handoff={window.handoff} mobile={mobile} dispatch={dispatch} />}
      {window.app === "mail" && <Mail dispatch={dispatch} handoff={window.handoff} onTitle={rename(index)} mobile={mobile} />}
      {window.app === "homepage" && (
        <HomePageStudio dispatch={dispatch} onTitle={rename(index)} onClose={() => closeWindow(window, index)} mobile={mobile} />
      )}

      {window.name == "YouTube '98" && <VideoPlayer />}
      {window.name == "98 Messenger" && <Messenger />}
      {window.app && window.app.startsWith("aim-") && (
        <div className="aimRoot">
          {window.app === "aim-im" && <ImWindow buddy={window.buddy} focusInput={window.focusInput} />}
          {window.app === "aim-chat" && <ChatRoom room={window.room} />}
          {window.app === "aim-info" && <BuddyInfo buddy={window.buddy} />}
          {window.app === "aim-invite" && (
            <ChatInvite invite={window.invite} onClose={() => closeWindow(window, index)} />
          )}
          {window.app === "aim-notice" && (
            <AimNotice text={window.text} onClose={() => closeWindow(window, index)} />
          )}
          {window.app === "aim-delete" && <DeleteAccount onClose={() => closeWindow(window, index)} />}
          {window.app === "aim-call" && <CallWindow />}
          {window.app === "aim-ring" && <RingWindow />}
        </div>
      )}
      {window.name == "View Video" && (
        <iframe
          src={share}
          className="w-100"
          style={{ height: "calc(100% - 25px" }}
          allowFullScreen
        />
      )}
      {window.name == "Task Manager" && (
        <TaskManager dispatch={dispatch} windows={windows} selfIndex={index} />
      )}
      {isNetWindow(window) && (
        <NetWindow
          window={window}
          dispatch={dispatch}
          onClose={() => closeWindow(window, index)}
          // Minesweeper Race sizes its window like Minesweeper does
          fitWindow={
            window.app !== "net-race" || mobile || window.maximized
              ? null
              : (width, height) => dispatch({ type: "resize_window", payload: { index, width, height } })
          }
        />
      )}
    </>
  )

  // Title bar shared by floating and full-screen windows. Phones have no maximize: every
  // window already fills the screen.
  const renderTitleBar = (window, index) => {
    const toggleMaximize = () => {
      playSystemSound(window.maximized ? "restore" : "maximize")
      dispatch({
        type: "toggle_maximize",
        payload: { name: window.name, maximized: window.maximized, index },
      })
    }

    return (
      <div
        className={window.active ? "title-bar" : "title-bar inactive"}
        // 25px, taller with Accessibility Options' larger text
        style={{ height: "var(--title-h, 25px)" }}
        onDoubleClick={mobile ? undefined : toggleMaximize}
      >
        <div
          className="title-bar-text d-flex align-items-center"
          style={{ height: "100%" }}
        >
          <img src={window.icon_url} className="h-100" draggable="false" dragstart="false" alt="" />
          &nbsp;
          <span id={`win-title-${index}`}>{window.name}</span>
        </div>
        <div className="title-bar-controls h-100" role="group" aria-label={`${window.name} window controls`}>
          {/* property sheets have a "?" button, as in Windows 98: help for this window */}
          {HELP_BUTTON.has(window.program) && (
            <button className="titleBarButton" aria-label="Help" title="Help for this window" onClick={() => openHelp({ program: window.program })}></button>
          )}
          <button
            className="titleBarButton"
            aria-label="Minimize"
            onClick={() => {
              playSystemSound("minimize")
              dispatch({
                type: "toggle_minimize",
                payload: {
                  name: window.name,
                  minimized: window.minimized,
                  active: window.active,
                  index,
                },
              })
            }}
          ></button>
          {!mobile && (
            <button
              className="titleBarButton"
              aria-label={window.maximized ? "Restore" : "Maximize"}
              onClick={toggleMaximize}
            ></button>
          )}
          <button
            className="titleBarButton"
            aria-label="Close"
            onClick={() => closeWindow(window, index)}
          ></button>
        </div>
      </div>
    )
  }

  // what screen readers hear for a window: its title (and High Contrast leaves games alone)
  const windowA11y = (window, index) => ({
    role: "dialog",
    "aria-modal": "false",
    "aria-labelledby": `win-title-${index}`,
    "data-hc-keep": keepsColors(window) ? "" : undefined,
  })

  const selectActive = (window, index) =>
    dispatch({
      type: "select_active",
      payload: { name: window.name, active: window.active, index },
    })

  const overlays = (
    <>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      <input
        ref={uploadRef}
        type="file"
        accept={PHONE_ACCEPT}
        multiple
        hidden
        data-testid="desktop-upload"
        onChange={(e) => {
          uploadFiles([...e.target.files])
          e.target.value = ""
        }}
      />
      <React.Suspense fallback={null}>
        <ShareCenter dispatch={dispatch} />
      </React.Suspense>
      {confirmEmpty && (
        <div className="desktopDialogLayer">
          <Dialog
            title="Confirm Multiple File Delete"
            okLabel="Yes"
            cancelLabel="No"
            onOk={() => {
              fs.emptyRecycleBin()
              playSystemSound("recycle")
              setConfirmEmpty(false)
            }}
            onCancel={() => setConfirmEmpty(false)}
          >
            <p className="dialogText">Are you sure you want to delete all of the items in the Recycle Bin? This can't be undone.</p>
          </Dialog>
        </div>
      )}
      {dialog && (
        <div className="desktopDialogLayer">
          {dialog.kind === "name" && (
            <Dialog title={dialog.title} onOk={finishName} onCancel={() => setDialog(null)}>
              <label htmlFor="desk-name">Name:</label>
              <input id="desk-name" value={dialog.text} maxLength={64} onChange={(e) => setDialog({ ...dialog, text: e.target.value, error: null })} />
              {dialog.error && <p className="dialogText fxError">{dialog.error}</p>}
            </Dialog>
          )}
          {dialog.kind === "delete" && (
            <Dialog
              title="Confirm File Delete"
              okLabel="Yes"
              cancelLabel="No"
              onOk={() => {
                try {
                  fs.deleteItem(dialog.item)
                } catch (error) {
                  return setDialog({ kind: "alert", text: error.message })
                }
                setSelected(null)
                setDialog(null)
              }}
              onCancel={() => setDialog(null)}
            >
              <p className="dialogText">Are you sure you want to send '{dialog.item.name}' to the Recycle Bin?</p>
            </Dialog>
          )}
          {dialog.kind === "deleteMany" && (
            <Dialog
              title="Confirm Multiple File Delete"
              okLabel="Yes"
              cancelLabel="No"
              onOk={() => {
                for (const item of dialog.items) {
                  try {
                    fs.deleteItem(item)
                  } catch {
                    // already gone
                  }
                }
                setSelected(null)
                setDialog(null)
              }}
              onCancel={() => setDialog(null)}
            >
              <p className="dialogText">Are you sure you want to send these {dialog.items.length} items to the Recycle Bin?</p>
            </Dialog>
          )}
          {dialog.kind === "props" && (
            <Dialog title={`${dialog.program.name} Properties`} onOk={() => setDialog(null)}>
              <div className="deskProps">
                <img src={dialog.program.icon} alt="" width="32" height="32" />
                <b>{dialog.program.name}</b>
              </div>
              <p className="dialogText">Type: Shortcut to a program</p>
              <p className="dialogText">Start menu: {dialog.program.group ? `Programs > ${dialog.program.group}` : "(not in the Start menu)"}</p>
              <p className="dialogText">Run: Start &gt; Run... and type "{dialog.program.name}"</p>
            </Dialog>
          )}
          {dialog.kind === "alert" && (
            <Dialog title="Desktop" sound="ding" onOk={() => setDialog(null)}>
              <p className="dialogText">{dialog.text}</p>
            </Dialog>
          )}
        </div>
      )}
    </>
  )

  // dropping a desktop file onto the Recycle Bin, a folder icon or a My Computer window
  const dropFile = (icon, event, node) => {
    const point = event.changedTouches?.[0] || event
    const under = document.elementsFromPoint(point.clientX, point.clientY).filter((el) => !node.contains(el))
    const targetIcon = under.map((el) => el.closest("[data-program]")).find(Boolean)
    const target = targetIcon && icons.find((i) => i.key === targetIcon.dataset.program)
    if (target?.app === "recycle") {
      setDialog({ kind: "delete", item: icon.item })
      return true
    }
    const folder = target?.item?.isDirectory ? target.item : fs.resolve(under.map((el) => el.closest("[data-folder]")).find(Boolean)?.dataset.folder || "\u0000")
    if (!folder?.isDirectory || folder === icon.item) return false
    try {
      moveInto(icon.item, folder)
    } catch (error) {
      setDialog({ kind: "alert", text: error.message })
    }
    return true
  }

  const withAim = (desktop) => (
    <AimProvider socket={socket} windows={windows} dispatch={dispatch} onOpenVideo={openVideo}>
      <NetProvider socket={socket} windows={windows} dispatch={dispatch} mobile={mobile}>
        {desktop}
        <React.Suspense fallback={null}>
          <DriveSync dispatch={dispatch} />
          <StorageNotice />
        </React.Suspense>
        <MailNotifier socket={socket} windows={windows} dispatch={dispatch} />
        <NotifyBridge windows={windows} dispatch={dispatch} />
        <CoupleBridge socket={socket} windows={windows} dispatch={dispatch} mobile={mobile} />
        <React.Suspense fallback={null}>
          <CalendarBridge socket={socket} windows={windows} dispatch={dispatch} mobile={mobile} />
        </React.Suspense>
      </NetProvider>
    </AimProvider>
  )

  if (mobile) {
    return withAim(
      <div className="mobileDesktop" onClick={() => closeMenu()} onContextMenu={onContextMenu} {...longPress}>
        <FlowerSpot mobile />
        {paired && (
          <React.Suspense fallback={null}>
            <PetWalker windows={windows} mobile />
          </React.Suspense>
        )}
        <MobileIcons key={mobileLayout} programs={icons} onOpen={openIcon} />
        {windows.map(
          (window, index) =>
            !window.closed && (
              <div
                key={index}
                className={window.minimized ? "mobileWindow d-none" : "mobileWindow"}
                style={window.active ? { zIndex: 2 } : undefined}
                // Activate on press (capture phase, so no app can swallow it), not on
                // click: a click that opens another window (a buddy, a link) must not
                // hand focus back to this one afterwards
                onPointerDownCapture={() => selectActive(window, index)}
              >
                <div className="window" data-window-index={index} {...windowA11y(window, index)}>
                  {renderTitleBar(window, index)}
                  {renderContents(window, index)}
                </div>
              </div>
            )
        )}
        {overlays}
      </div>
    )
  }

  return withAim(
    <div
      className="desktopSurface"
      onPointerDown={onSurfacePointerDown}
      onClick={(e) => {
        closeMenu()
        if (swallowClick.current) return (swallowClick.current = false)
        if (!e.target.closest(".desktopIcon")) setSelected(null)
      }}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <FlowerSpot />
      {paired && (
        <React.Suspense fallback={null}>
          <PetWalker windows={windows} />
        </React.Suspense>
      )}
      {lasso && <div className="desktopLasso" style={{ left: lasso.x0, top: lasso.y0, width: lasso.x1 - lasso.x0, height: lasso.y1 - lasso.y0 }} />}
      {icons.map((icon) => {
        const pos = placed[icon.key]
        // the other icons of a group follow the one being dragged
        const follow = groupDrag && groupDrag.key !== icon.key && selection.has(icon.key)
        const shown = follow ? { x: pos.x + groupDrag.dx, y: pos.y + groupDrag.dy } : pos
        return (
          <Rnd
            key={icon.key}
            position={shown}
            size={{ width: ICON_W, height: ICON_H }}
            className="p-0 desktopIcon"
            enableResizing={false}
            dragGrid={view.alignToGrid || view.autoArrange ? [1, 1] : [15, 15]}
            bounds="parent"
            onDrag={(e, data) => {
              dragged.current = true
              if (selection.size > 1 && selection.has(icon.key)) setGroupDrag({ key: icon.key, dx: data.x - pos.x, dy: data.y - pos.y })
            }}
            onDragStop={(e, data) => {
              if (data.x === pos.x && data.y === pos.y) return setGroupDrag(null)
              if (selection.size <= 1 || !selection.has(icon.key)) {
                if (quickLaunchDrop(icon, e, data.node)) return
                if (icon.item && dropFile(icon, e, data.node)) return
              }
              finishDrag(icon, pos, data)
            }}
          >
            <div
              className={(isSelected(icon.key) ? "desktopIconInner is-selected" : "desktopIconInner") + (icon.item?.type === "shortcut" ? " isShortcut" : "")}
              data-program={icon.key}
              onPointerDown={(e) => {
                // Ctrl+click adds or removes one; pressing a selected icon keeps the group
                if (e.ctrlKey || e.metaKey) {
                  const next = new Set(selection)
                  next.has(icon.key) ? next.delete(icon.key) : next.add(icon.key)
                  return setSelection(next)
                }
                dragged.current = false
                if (!selection.has(icon.key)) setSelected(icon.key)
              }}
              onClick={(e) => {
                if (!dragged.current && !(e.ctrlKey || e.metaKey) && selection.size > 1) setSelected(icon.key)
              }}
              {...openGesture(() => openIcon(icon))}
              // a button for keyboards and screen readers: Tab to it, Enter opens it
              role="button"
              tabIndex={0}
              aria-label={icon.label ?? icon.name}
              onFocus={(e) => e.target.matches(":focus-visible") && !selection.has(icon.key) && setSelected(icon.key)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return
                e.preventDefault()
                e.stopPropagation()
                if (selection.size > 1 && selection.has(icon.key)) icons.filter((i) => selection.has(i.key)).slice(0, 6).forEach(openIcon)
                else openIcon(icon)
              }}
            >
              <img src={icon.icon} draggable="false" alt="" />
              <label className="desktopIconLabel">{icon.label ?? icon.name}</label>
            </div>
          </Rnd>
        )
      })}

      {/* Windows are positioned from the screen's top-left corner */}
      <div className="windowLayer">
        {windows &&
          windows.map((window, index) => {
            if (window.closed) return null
            const minWidth = minWidthFor(window)
            // Maximized fills the screen above the taskbar (Rnd is positioned against the
            // full-screen .os-root)
            const box = window.maximized
              ? { x: 0, y: 0, width: viewport.width, height: viewport.height - viewport.taskbar }
              : { x: window.x, y: window.y, width: Math.max(window.width, minWidth), height: window.height }

            return (
              <Rnd
                key={index}
                position={{ x: box.x, y: box.y }}
                size={{ width: box.width, height: box.height }}
                minWidth={minWidth}
                minHeight={120}
                enableResizing={!window.maximized}
                disableDragging={window.maximized}
                // Drag by the title bar only, so touches inside an app (a Tetris
                // button, a canvas) don't move the window
                dragHandleClassName="title-bar"
                cancel=".title-bar-controls"
                bounds="window"
                onDragStop={(e, data) =>
                  dispatch({ type: "move_window", payload: { index, x: data.x, y: data.y } })
                }
                onResizeStop={(e, direction, ref, delta, position) =>
                  dispatch({
                    type: "resize_window",
                    payload: {
                      index,
                      width: ref.offsetWidth,
                      height: ref.offsetHeight,
                      x: position.x,
                      y: position.y,
                    },
                  })
                }
                className={window.minimized ? "p-0 d-none" : "p-0"}
                // Task Manager can stay above everything else (Options > Always On Top)
                style={window.onTop && !window.minimized ? { zIndex: 111112 } : window.active ? { zIndex: 111111 } : undefined}
              >
                {/* Activate on press, as on phones above */}
                <div
                  className="window desktopWindow"
                  data-window-index={index}
                  {...windowA11y(window, index)}
                  onPointerDownCapture={() => selectActive(window, index)}
                >
                  {renderTitleBar(window, index)}
                  {renderContents(window, index)}
                </div>
              </Rnd>
            )
          })}
      </div>
      {overlays}
    </div>
  )
}

export default Desktop
