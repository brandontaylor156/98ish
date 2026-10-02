import React, { useEffect, useRef, useState } from "react"
import { Rnd } from "react-rnd"
import { desktopPrograms, ieWindow, launch, paintWindow, windowFor } from "../../utils/programs"
import { openItem, openTarget } from "../../utils/openItem"
import { fs, uniqueName, validName } from "../../utils/fs"
import { iconFor } from "../../utils/fileInfo"
import { DRAG_TYPE, desktopFolder, getClipboard, moveInto, pasteInto, setClipboard } from "../../utils/fsActions"
import { useFsVersion } from "../../hooks/useFs"
import { playSystemSound } from "../../utils/systemSounds"
import { AimProvider } from "../applets/aim/AimContext"
import MailNotifier from "../applets/mail/MailNotifier"
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

// each app is its own download, fetched the first time it opens
const Calculator = lazyApp(() => import("../applets/calculator/Calculator"))
const CharMap = lazyApp(() => import("../applets/charmap/CharMap"))
const DateTimeProperties = lazyApp(() => import("../applets/datetime/DateTimeProperties"))
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
const BlockTen = lazyApp(() => import("../applets/blockten/BlockTen"))
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
const DesktopThemes = lazyApp(() => import("../applets/themes/DesktopThemes"))
const SystemProperties = lazyApp(() => import("../applets/system/SystemProperties"))
const WebApp = lazyApp(() => import("../applets/webapp/WebApp"))
const Backup = lazyApp(() => import("../applets/backup/Backup"))
// keeps C: in sync with the online copy while signed on to 98 Messenger (its own small download)
const DriveSync = React.lazy(() => import("../applets/backup/DriveSync"))

const ICONS_KEY = "98ish.desktopIcons"
const CELL_W = 94
const CELL_H = 88

// Narrowest a window may get. 98 Messenger's Buddy List and IMs are tall and narrow.
const minWidthFor = (window) =>
  window.name === "Minesweeper" ? 150
  : window.app === "calc" ? 200
  : window.app === "net-race" ? 250 // room for its title and the race bars
  : window.name === "98 Messenger" || window.app?.startsWith("aim-") || window.app?.startsWith("net-") ? 220
  : 300

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
  return [...first, ...desktopPrograms.map((p) => p.name).filter((n) => !first.includes(n))]
}

// Columns down the left side, top to bottom
const gridLayout = (names, viewport) => {
  const rows = Math.max(1, Math.floor((viewport.height - viewport.taskbar - 10) / CELL_H))
  return Object.fromEntries(names.map((name, i) => [name, { x: 6 + Math.floor(i / rows) * CELL_W, y: 6 + (i % rows) * CELL_H }]))
}

// the first grid spot (column by column) no icon is sitting on
const freeSpot = (taken, viewport) => {
  const rows = Math.max(1, Math.floor((viewport.height - viewport.taskbar - 10) / CELL_H))
  const near = (p, q) => Math.abs(p.x - q.x) < CELL_W * 0.6 && Math.abs(p.y - q.y) < CELL_H * 0.6
  for (let i = 0; ; i++) {
    const spot = { x: 6 + Math.floor(i / rows) * CELL_W, y: 6 + (i % rows) * CELL_H }
    if (!taken.some((p) => near(p, spot))) return spot
  }
}

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
  const [selected, setSelected] = useState(null)
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [dialog, setDialog] = useState(null) // naming, renaming and deleting desktop files
  const [mobileLayout, setMobileLayout] = useState(0)
  const openGesture = useOpenGesture()
  const viewport = useViewport()
  const [positions, setPositions] = useState(() => ({ ...gridLayout(defaultOrder(), viewport), ...loadIcons() }))

  // logging off or shutting down unmounts the desktop: sign out of 98 Messenger
  useEffect(() => () => socket.disconnect(), [])
  // the taskbar's network icon
  useEffect(() => watchSocket(socket), [])

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
    ...desktopPrograms.map((p) => ({
      ...p,
      key: p.name,
      icon: p.app === "recycle" ? (binFull ? "/assets/recycle_bin_full.png" : "/assets/recycle_bin_empty.png") : p.icon,
    })),
    ...(deskDir?.isDirectory ? deskDir.content : []).map((item) => ({ key: `file:${item.name}`, name: `file:${item.name}`, label: item.name, icon: iconFor(item), item })),
  ]

  // files new to the desktop get the next free spot
  const placed = { ...positions }
  for (const icon of icons) if (!placed[icon.key]) placed[icon.key] = freeSpot(Object.values(placed), viewport)

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
    const next = gridLayout([...names, ...files.map((f) => f.key)], viewport)
    setPositions(next)
    saveIcons(next)
    if (mobile) {
      resetMobileIcons(by === "name" ? [...names] : names)
      setMobileLayout((n) => n + 1)
    }
  }

  const lineUp = () => {
    const next = Object.fromEntries(
      Object.entries(placed).map(([name, p]) => [name, { x: 6 + Math.round((p.x - 6) / CELL_W) * CELL_W, y: 6 + Math.round((p.y - 6) / CELL_H) * CELL_H }])
    )
    setPositions(next)
    saveIcons(next)
  }

  const desktopMenu = () => [
    {
      label: "Arrange Icons",
      items: [
        { label: "by Name", onClick: () => arrange("name") },
        { label: "by Type", onClick: () => arrange("type") },
        { label: "Default", onClick: () => arrange("default") },
      ],
    },
    ...(mobile ? [] : [{ label: "Line Up Icons", onClick: lineUp }]),
    "-",
    { label: "Refresh", onClick: () => setPositions((p) => ({ ...p })) },
    "-",
    { label: "Paste", disabled: !getClipboard(), onClick: paste },
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
    try {
      pasteInto(desktopFolder())
    } catch (error) {
      setDialog({ kind: "alert", text: error.message })
    }
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

  const fileMenu = (icon) => [
    { label: "Open", bold: true, onClick: () => openIcon(icon) },
    ...(icon.item.isDirectory ? [{ label: "Explore", onClick: () => dispatch({ type: "open_window", payload: launch("My Computer", { path: fs.partsOf(icon.item) }) }) }] : []),
    "-",
    { label: "Cut", onClick: () => setClipboard({ mode: "cut", items: [icon.item] }) },
    { label: "Copy", onClick: () => setClipboard({ mode: "copy", items: [icon.item] }) },
    "-",
    { label: "Delete", onClick: () => setDialog({ kind: "delete", item: icon.item }) },
    { label: "Rename", onClick: () => setDialog({ kind: "name", title: "Rename", text: icon.item.name, item: icon.item }) },
  ]

  // Delete, F2 and Enter on a selected desktop file
  useEffect(() => {
    const onKey = (e) => {
      if (dialog || menu || e.target.closest?.("input, textarea, [contenteditable], .desktopWindow, .mobileWindow")) return
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
    { label: "Properties", onClick: () => (program.app === "explorer" ? dispatch({ type: "open_window", payload: launch("System Properties") }) : program.app === "recycle" ? openProgram(program) : dispatch({ type: "open_window", payload: launch("Display Properties") })) },
  ]

  const showMenu = (x, y, icon) => {
    closeMenu()
    setSelected(icon?.key || null)
    setMenu({ x, y, items: icon ? (icon.item ? fileMenu(icon) : iconMenu(icon)) : desktopMenu() })
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
      {window.name == "Tetris" && <Tetris />}
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
      {window.app === "display" && <DisplayProperties onClose={() => closeWindow(window, index)} />}
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
      {window.app === "blockten" && <BlockTen mobile={mobile} onClose={() => closeWindow(window, index)} />}

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
      {window.app === "datetime" && <DateTimeProperties onClose={() => closeWindow(window, index)} />}
      {window.app === "webapp" && PROJECTS.find((p) => p.name === window.program) && (
        <WebApp project={PROJECTS.find((p) => p.name === window.program)} mobile={mobile} />
      )}
      {window.app === "backup" && <Backup dispatch={dispatch} mobile={mobile} />}
      {window.app === "mail" && <Mail dispatch={dispatch} onTitle={rename(index)} mobile={mobile} />}
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
        style={{ height: "25px" }}
        onDoubleClick={mobile ? undefined : toggleMaximize}
      >
        <div
          className="title-bar-text d-flex align-items-center"
          style={{ height: "100%" }}
        >
          <img src={window.icon_url} className="h-100" draggable="false" dragstart="false" />
          &nbsp;
          <span>{window.name}</span>
        </div>
        <div className="title-bar-controls h-100">
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

  const selectActive = (window, index) =>
    dispatch({
      type: "select_active",
      payload: { name: window.name, active: window.active, index },
    })

  const overlays = (
    <>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
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
          <DriveSync />
        </React.Suspense>
        <MailNotifier socket={socket} windows={windows} dispatch={dispatch} />
      </NetProvider>
    </AimProvider>
  )

  if (mobile) {
    return withAim(
      <div className="mobileDesktop" onClick={() => closeMenu()} onContextMenu={onContextMenu} {...longPress}>
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
                <div className="window">
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
      onClick={(e) => {
        closeMenu()
        if (!e.target.closest(".desktopIcon")) setSelected(null)
      }}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {icons.map((icon) => {
        const pos = placed[icon.key]
        return (
          <Rnd
            key={icon.key}
            position={pos}
            size={{ width: 88, height: 76 }}
            className="p-0 desktopIcon"
            enableResizing={false}
            dragGrid={[15, 15]}
            bounds="parent"
            onDragStop={(e, data) => {
              if (data.x === pos.x && data.y === pos.y) return
              if (quickLaunchDrop(icon, e, data.node)) return
              if (icon.item && dropFile(icon, e, data.node)) return
              savePosition(icon.key, data.x, data.y)
            }}
          >
            <div
              className={(selected === icon.key ? "desktopIconInner is-selected" : "desktopIconInner") + (icon.item?.type === "shortcut" ? " isShortcut" : "")}
              data-program={icon.key}
              onPointerDown={() => setSelected(icon.key)}
              {...openGesture(() => openIcon(icon))}
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
                style={window.active ? { zIndex: 111111 } : undefined}
              >
                {/* Activate on press, as on phones above */}
                <div
                  className="window desktopWindow"
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
