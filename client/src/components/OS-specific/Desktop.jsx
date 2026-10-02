import React, { useState } from "react"
import { Rnd } from "react-rnd"
import FileExplorer from "../applets/fileExplorer/FileExplorer"
import Notepad from "../applets/notepad/Notepad"
import Tetris from "../applets/tetris/Tetris"
import Hover from "../applets/hover/Hover"
import VideoPlayer from "../applets/videoPlayer/VideoPlayer"
import Minesweeper from "../applets/minesweeper/Minesweeper"
import ChatApp from "../applets/chatApp/ChatApp"
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

  const renderContents = (window, index) => (
    <>
      {window.name == "Tetris" && <Tetris />}
      {window.name == "Hover" && <Hover />}
      {window.name == "My Computer" && (
        <FileExplorer fs={fs} dispatch={dispatch} />
      )}
      {window.name == "Notepad" && <Notepad file={window.file} />}
      {window.name == "Minesweeper" && <Minesweeper />}

      {window.name == "YouTube '98" && <VideoPlayer socket={socket} />}
      {window.name == "98 Messenger" && (
        <ChatApp dispatch={dispatch} socket={socket} setShare={setShare} />
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
            onClick={() =>
              dispatch({
                type: "close_window",
                payload: { name: window.name, index },
              })
            }
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

  if (mobile) {
    return (
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
                onClick={() => selectActive(window, index)}
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

  return (
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
                    x: 10 + index * 10,
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
                  onClick={() => selectActive(window, index)}
                  className={windowStyles.join(" ")}
                  key={index}
                  style={activeStyle}
                >
                  <div className="window" style={maximizedStyle}>
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
