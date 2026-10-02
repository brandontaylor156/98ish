import React, { useEffect, useState } from "react"
import { Rnd } from "react-rnd"
import FileExplorer from "../applets/fileExplorer/FileExplorer"
import Notepad from "../applets/notepad/Notepad"
import Tetris from "../applets/tetris/Tetris"
import Hover from "../applets/hover/Hover"
import Spectra from "../applets/spectra/Spectra"
import VideoPlayer from "../applets/videoPlayer/VideoPlayer"
import Minesweeper from "../applets/minesweeper/Minesweeper"
import { AimProvider } from "../applets/aim/AimContext"
import Messenger from "../applets/aim/Messenger"
import ImWindow from "../applets/aim/ImWindow"
import ChatRoom from "../applets/aim/ChatRoom"
import BuddyInfo from "../applets/aim/BuddyInfo"
import ChatInvite, { AimNotice } from "../applets/aim/ChatInvite"
import TaskManager from "../applets/taskManager/TaskManager"
import { useOpenGesture } from "../../hooks/useMediaQuery"
import MobileIcons from "./MobileIcons"
import io from "socket.io-client"

const openProgram = (dispatch, program) =>
  dispatch({
    type: "open_window",
    payload: {
      name: program.name,
      minimized: false,
      maximized: false,
      active: true,
      closed: false,
      width: program.width,
      height: program.height,
      positionX: 10,
      positionY: 0,
      icon_url: program.icon_url,
    },
  })

const IconContent = ({ program, openGesture, dispatch }) => (
  <div
    className="d-flex flex-column align-items-center text-center desktopIcon"
    {...openGesture(() => openProgram(dispatch, program))}
  >
    <img
      src={program.image_url}
      style={{ width: "50px", height: "50px" }}
      draggable="false"
      dragstart="false"
    />
    <label className="desktopIconLabel text-light">{program.name}</label>
  </div>
)

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

const Desktop = ({ fs, programs, windows, dispatch, closeMenu, mobile }) => {
  const [socket] = useState(() =>
    io(import.meta.env.VITE_SOCKET_URL || "http://localhost:8000")
  )
  const [share, setShare] = useState("")
  const openGesture = useOpenGesture()
  const viewport = useViewport()

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

  const closeWindow = (window, index) =>
    dispatch({ type: "close_window", payload: { name: window.name, index } })

  const renderContents = (window, index) => (
    <>
      {window.name == "Tetris" && <Tetris />}
      {window.name == "Hover" && <Hover />}
      {window.name == "SPECTRA" && <Spectra />}
      {window.name == "My Computer" && (
        <FileExplorer fs={fs} dispatch={dispatch} />
      )}
      {window.name == "Notepad" && <Notepad file={window.file} />}
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
        className="title-bar"
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

  const withAim = (desktop) => (
    <AimProvider socket={socket} windows={windows} dispatch={dispatch} onOpenVideo={openVideo}>
      {desktop}
    </AimProvider>
  )

  if (mobile) {
    return withAim(
      <div className="mobileDesktop" onClick={() => closeMenu()}>
        <MobileIcons programs={programs} onOpen={(program) => openProgram(dispatch, program)} />
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
      </div>
    )
  }

  return withAim(
    <div onClick={(e) => closeMenu()}>
      {programs &&
        programs.map((program, index) => {
          return (
            <Rnd
              default={{
                x: 10 + index * 100,
                y: 10,
                width: 50,
                height: 50,
              }}
              className="p-0 desktopIcon"
              key={index}
              enableResizing="false"
              dragGrid={[15, 15]}
              bounds="window"
            >
              <IconContent program={program} openGesture={openGesture} dispatch={dispatch} />
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
    </div>
  )
}

export default Desktop
