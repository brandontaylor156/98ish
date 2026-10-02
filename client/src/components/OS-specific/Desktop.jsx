import React, { useEffect, useRef, useState } from "react"
import { Rnd } from "react-rnd"
import FileExplorer from "../applets/fileExplorer/FileExplorer"
import RecycleBin from "../applets/fileExplorer/RecycleBin"
import Notepad from "../applets/notepad/Notepad"
import MsDos from "../applets/dos/MsDos"
import DisplayProperties from "../applets/display/DisplayProperties"
import Tetris from "../applets/tetris/Tetris"
import Hover from "../applets/hover/Hover"
import Spectra from "../applets/spectra/Spectra"
import InternetExplorer from "../applets/internetExplorer/InternetExplorer"
import { desktopPrograms, ieWindow, launch, notepadWindow, windowFor } from "../../utils/programs"
import { openTarget } from "../../utils/openItem"
import { fs } from "../../utils/fs"
import { useFsVersion } from "../../hooks/useFs"
import VideoPlayer from "../applets/videoPlayer/VideoPlayer"
import Minesweeper from "../applets/minesweeper/Minesweeper"
import { AimProvider } from "../applets/aim/AimContext"
import Messenger from "../applets/aim/Messenger"
import ImWindow from "../applets/aim/ImWindow"
import ChatRoom from "../applets/aim/ChatRoom"
import BuddyInfo from "../applets/aim/BuddyInfo"
import ChatInvite, { AimNotice } from "../applets/aim/ChatInvite"
import TaskManager from "../applets/taskManager/TaskManager"
import ContextMenu from "../shared/ContextMenu"
import Dialog from "../shared/Dialog"
import { useOpenGesture } from "../../hooks/useMediaQuery"
import { useLongPress } from "../../hooks/useLongPress"
import MobileIcons, { resetMobileIcons } from "./MobileIcons"
import io from "socket.io-client"

const ICONS_KEY = "98ish.desktopIcons"
const CELL_W = 94
const CELL_H = 88

// Narrowest a window may get. 98 Messenger's Buddy List and IMs are tall and narrow.
const minWidthFor = (window) =>
  window.name === "Minesweeper" ? 150
  : window.name === "98 Messenger" || window.app?.startsWith("aim-") ? 220
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
  const [mobileLayout, setMobileLayout] = useState(0)
  const openGesture = useOpenGesture()
  const viewport = useViewport()
  const [positions, setPositions] = useState(() => ({ ...gridLayout(defaultOrder(), viewport), ...loadIcons() }))

  // logging off or shutting down unmounts the desktop: sign out of 98 Messenger
  useEffect(() => () => socket.disconnect(), [])

  const binFull = fs.recycleBin.content.length > 0
  const icons = desktopPrograms.map((p) =>
    p.app === "recycle" ? { ...p, icon: binFull ? "/assets/recycle_bin_full.png" : "/assets/recycle_bin_empty.png" } : p
  )

  const openProgram = (program) => dispatch({ type: "open_window", payload: windowFor(program) })

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
    const next = gridLayout(names, viewport)
    setPositions(next)
    saveIcons(next)
    if (mobile) {
      resetMobileIcons(by === "name" ? [...names] : names)
      setMobileLayout((n) => n + 1)
    }
  }

  const lineUp = () => {
    const next = Object.fromEntries(
      Object.entries(positions).map(([name, p]) => [name, { x: 6 + Math.round((p.x - 6) / CELL_W) * CELL_W, y: 6 + Math.round((p.y - 6) / CELL_H) * CELL_H }])
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
    {
      label: "New",
      items: [
        { label: "Text Document", onClick: () => dispatch({ type: "open_window", payload: notepadWindow() }) },
        { label: "Folder (in My Documents)", onClick: () => dispatch({ type: "open_window", payload: launch("My Computer", { path: ["C:", "Documents"] }) }) },
      ],
    },
    "-",
    { label: "Properties", onClick: () => dispatch({ type: "open_window", payload: launch("Display Properties") }) },
  ]

  const iconMenu = (program) => [
    { label: "Open", bold: true, onClick: () => openProgram(program) },
    ...(program.app === "recycle" ? [{ label: "Empty Recycle Bin", disabled: !binFull, onClick: () => setConfirmEmpty(true) }] : []),
    ...(program.app === "explorer" ? [{ label: "Explore", onClick: () => dispatch({ type: "open_window", payload: launch("My Computer", { path: ["C:"] }) }) }] : []),
    "-",
    { label: "Properties", onClick: () => (program.app === "recycle" || program.app === "explorer" ? openProgram(program) : dispatch({ type: "open_window", payload: launch("Display Properties") })) },
  ]

  const showMenu = (x, y, program) => {
    closeMenu()
    setSelected(program?.name || null)
    setMenu({ x, y, items: program ? iconMenu(program) : desktopMenu() })
  }

  const longPress = useLongPress((x, y, { target }) => {
    if (target.closest?.(".mobileWindow, .desktopWindow, .startArea, .taskbar")) return
    const iconEl = target.closest?.("[data-program]")
    showMenu(x, y, iconEl ? icons.find((p) => p.name === iconEl.dataset.program) : null)
  })

  const onContextMenu = (e) => {
    if (e.target.closest(".desktopWindow, .mobileWindow, .contextMenuLayer")) return
    e.preventDefault()
    const iconEl = e.target.closest("[data-program]")
    showMenu(e.clientX, e.clientY, iconEl ? icons.find((p) => p.name === iconEl.dataset.program) : null)
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
      {window.app === "dos" && (
        <MsDos onClose={() => closeWindow(window, index)} onOpen={(target) => openTarget(target, dispatch)} onTitle={rename(index)} />
      )}
      {window.app === "display" && <DisplayProperties onClose={() => closeWindow(window, index)} />}
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
    </>
  )

  // Title bar shared by floating and full-screen windows. Phones have no maximize: every
  // window already fills the screen.
  const renderTitleBar = (window, index) => {
    const toggleMaximize = () =>
      dispatch({
        type: "toggle_maximize",
        payload: { name: window.name, maximized: window.maximized, index },
      })

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
            onClick={() =>
              dispatch({
                type: "toggle_minimize",
                payload: {
                  name: window.name,
                  minimized: window.minimized,
                  active: window.active,
                  index,
                },
              })
            }
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
              setConfirmEmpty(false)
            }}
            onCancel={() => setConfirmEmpty(false)}
          >
            <p className="dialogText">Are you sure you want to delete all of the items in the Recycle Bin? This can't be undone.</p>
          </Dialog>
        </div>
      )}
    </>
  )

  const withAim = (desktop) => (
    <AimProvider socket={socket} windows={windows} dispatch={dispatch} onOpenVideo={openVideo}>
      {desktop}
    </AimProvider>
  )

  if (mobile) {
    return withAim(
      <div className="mobileDesktop" onClick={() => closeMenu()} onContextMenu={onContextMenu} {...longPress}>
        <MobileIcons key={mobileLayout} programs={icons} onOpen={openProgram} />
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
    >
      {icons.map((program) => {
        const pos = positions[program.name] || { x: 6, y: 6 }
        return (
          <Rnd
            key={program.name}
            position={pos}
            size={{ width: 88, height: 76 }}
            className="p-0 desktopIcon"
            enableResizing={false}
            dragGrid={[15, 15]}
            bounds="parent"
            onDragStop={(e, data) => {
              if (data.x === pos.x && data.y === pos.y) return
              const next = { ...positions, [program.name]: { x: data.x, y: data.y } }
              setPositions(next)
              saveIcons(next)
            }}
          >
            <div
              className={selected === program.name ? "desktopIconInner is-selected" : "desktopIconInner"}
              data-program={program.name}
              onPointerDown={() => setSelected(program.name)}
              {...openGesture(() => openProgram(program))}
            >
              <img src={program.icon} draggable="false" alt="" />
              <label className="desktopIconLabel">{program.name}</label>
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
