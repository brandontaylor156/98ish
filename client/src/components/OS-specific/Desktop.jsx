import React, { useState } from "react"
import { Rnd } from "react-rnd"
import FileExplorer from "../applets/fileExplorer/FileExplorer"
import Notepad from "../applets/notepad/Notepad"
import Tetris from "../applets/tetris/Tetris"
import Hover from "../applets/hover/Hover"
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

const Desktop = ({ fs, programs, windows, dispatch, closeMenu, mobile }) => {
  const [socket] = useState(() =>
    io(import.meta.env.VITE_SOCKET_URL || "http://localhost:8000")
  )
  const [share, setShare] = useState("")
  const openGesture = useOpenGesture()

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
      {window.name == "My Computer" && (
        <FileExplorer fs={fs} dispatch={dispatch} />
      )}
      {window.name == "Notepad" && <Notepad file={window.file} />}
      {window.name == "Minesweeper" && <Minesweeper />}

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
        <div className="mobileIcons">
          {programs.map((program, index) => (
            <IconContent
              key={index}
              program={program}
              openGesture={openGesture}
              dispatch={dispatch}
            />
          ))}
        </div>
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

      <div className="row desktop-row d-flex justify-content-center align-items-center pb-5">
        {windows &&
          windows.map((window, index) => {
            let windowStyles = ["p-0"]
            let activeStyle
            let maximizedStyle
            let resizingValue = true
            let draggingValue = false

            window.minimized ? windowStyles.push("d-none") : ""

            window.active
              ? (activeStyle = { zIndex: "111111" })
              : (activeStyle = {})

            if (window.maximized) {
              maximizedStyle = {
                height: "calc(100dvh - var(--taskbar-h))",
                width: "calc(100vw + 4px)",
                transform: `translate(-${window.positionX}px, -${window.positionY}px)`,
              }
              resizingValue = false
              draggingValue = true
            }

            return (
              !window.closed && (
                <Rnd
                  default={{
                    x: window.initialX ?? 10 + index * 10,
                    y: window.positionY,
                    width: window.width,
                    height: window.height,
                  }}
                  enableResizing={resizingValue}
                  disableDragging={draggingValue}
                  // Drag by the title bar only, so touches inside an app (a Tetris
                  // button, a canvas) don't move the window
                  dragHandleClassName="title-bar"
                  cancel=".title-bar-controls"
                  bounds="window"
                  onDragStop={(e, data) => {
                    dispatch({
                      type: "setWindowPosition",
                      payload: {
                        name: window.name,
                        positionX: data.x - 10,
                        positionY: data.y,
                        index,
                      },
                    })
                  }}
                  className={windowStyles.join(" ")}
                  key={index}
                  style={activeStyle}
                >
                  {/* Activate on press, as on phones above */}
                  <div
                    className="window"
                    style={maximizedStyle}
                    onPointerDownCapture={() => selectActive(window, index)}
                  >
                    {renderTitleBar(window, index)}
                    {renderContents(window, index)}
                  </div>
                </Rnd>
              )
            )
          })}
      </div>
    </div>
  )
}

export default Desktop
