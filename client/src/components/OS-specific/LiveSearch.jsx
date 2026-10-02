import React from "react"
import { imageMapper } from "../../utils/imageMapper"
import { hyperlinks } from "../../utils/hyperlinks"
import { useOpenGesture } from "../../hooks/useMediaQuery"
import { fs } from "../../utils/fs"

const LiveSearch = ({ results, dispatch, closeMenu }) => {
  const openGesture = useOpenGesture()

  const open = (e, item) => {
    handleDoubleClick(e, item)
    closeMenu()
  }

  const handleDoubleClick = (e, item) => {
    switch (item.type) {
      // Folders open in a new My Computer window, which starts in fs's current directory
      case "bookmarks":
      case "documents":
      case "drive":
      case "folder":
        fs.openDirectory(item.path)
        dispatch({
          type: "open_window",
          payload: {
            name: "My Computer",
            minimized: false,
            maximized: false,
            active: true,
            closed: false,
            width: 600,
            height: 400,
            positionX: 5,
            positionY: 100,
            icon_url: "/assets/program_icons/computer_explorer.png",
          },
        })
        return
      case "text":
        dispatch({
          type: "open_window",
          payload: {
            name: "Notepad",
            file: item,
            minimized: false,
            maximized: false,
            active: true,
            closed: false,
            width: 400,
            height: 400,
            positionX: 10,
            positionY: 0,
            icon_url: "/assets/" + imageMapper.notepad,
          },
        })
        return
      case "note":
        dispatch({
          type: "open_window",
          payload: {
            name: "Notepad",
            file: item,
            minimized: false,
            maximized: false,
            active: true,
            closed: false,
            width: 400,
            height: 400,
            positionX: 10,
            positionY: 0,
            icon_url: "/assets/" + imageMapper.notepad,
          },
        })
        return
      case "internet":
        window.open(hyperlinks[item.name])
        return
      case "tetris":
        dispatch({
          type: "open_window",
          payload: {
            name: "Tetris",
            minimized: false,
            maximized: false,
            active: true,
            closed: false,
            width: 600,
            height: 600,
            positionX: 10,
            positionY: 0,
            icon_url: "/assets/" + imageMapper.tetris,
          },
        })
        return
      case "terminal":
        dispatch({
          type: "open_window",
          payload: {
            name: "Terminal",
            minimized: false,
            maximized: false,
            active: true,
            closed: false,
            width: 200,
            height: 200,
            positionX: 10,
            positionY: 0,
            icon_url: "/assets/" + imageMapper.terminal,
          },
        })
        return
      case "hover":
        dispatch({
          type: "open_window",
          payload: {
            name: "Hover",
            minimized: false,
            maximized: false,
            active: true,
            closed: false,
            width: 600,
            height: 600,
            positionX: 10,
            positionY: 0,
            icon_url: "/assets/" + imageMapper.hover,
          },
        })
        return
      case "video":
        dispatch({
          type: "open_window",
          payload: {
            name: "YouTube '98",
            minimized: false,
            maximized: false,
            active: true,
            closed: false,
            width: 820,
            height: 620,
            positionX: 10,
            positionY: 0,
            icon_url: "/assets/" + imageMapper.video,
          },
        })
        return
      case "notepad":
        dispatch({
          type: "open_window",
          payload: {
            name: "Notepad",
            minimized: false,
            maximized: false,
            active: true,
            closed: false,
            width: 400,
            height: 400,
            positionX: 10,
            positionY: 0,
            icon_url: "/assets/" + imageMapper.notepad,
          },
        })
        return
      case "minesweeper":
        dispatch({
          type: "open_window",
          payload: {
            name: "Minesweeper",
            minimized: false,
            maximized: false,
            active: true,
            closed: false,
            width: 373,
            height: 456,
            positionX: 10,
            positionY: 0,
            icon_url: "/assets/" + imageMapper.minesweeper,
          },
        })
        return
      case "chat":
        dispatch({
          type: "open_window",
          payload: {
            name: "98 Messenger",
            minimized: false,
            maximized: false,
            active: true,
            closed: false,
            width: 260,
            height: 520,
            positionX: 10,
            positionY: 0,
            icon_url: "/assets/" + imageMapper.chat,
          },
        })
        return
      default:
        return
    }
  }
  return (
    <div
      className="window liveSearch"
    >
      <div
        className="bg-light overflow-scroll"
        style={{ height: "calc(100% - 32px)" }}
      >
        <div className="row row-cols-4 row-cols-sm-6 m-0 align-content-start pt-3">
          {results.map((item, idx) => {
            return (
              <div key={idx} className="col p-0 text-center">
                <a
                  href="#"
                  style={{
                    color: "#000",
                    textDecoration: "none",
                  }}
                  onClick={(e) => e.preventDefault()}
                >
                  <div>
                    <img
                      src={"/assets/" + imageMapper[item.type]}
                      alt=""
                      {...openGesture((e) => open(e, item))}
                    />
                    <p>{item.name}</p>
                  </div>
                </a>
              </div>
            )
          })}
        </div>
      </div>
      {/* {results &&
        results.map((result, idx) => {
          return <p>{result.name}</p>
        })} */}
    </div>
  )
}

export default LiveSearch
