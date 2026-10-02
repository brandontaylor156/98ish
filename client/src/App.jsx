import React, { useState, useReducer } from "react"
import TaskBar from "./components/OS-specific/TaskBar"
import StartMenu from "./components/OS-specific/StartMenu"
import Desktop from "./components/OS-specific/Desktop"
import { fs } from "./utils/fs"
import { programs } from "./utils/programs"
import LiveSearch from "./components/OS-specific/LiveSearch"
import { useIsMobile } from "./hooks/useMediaQuery"

const reducer = (state, action) => {
  switch (action.type) {
    // Windows track their real position and size (x, y, width, height); new ones
    // cascade unless the opener picks a spot
    case "open_window":
      return [
        ...state.map((window, idx) => {
          return { ...window, active: false }
        }),
        {
          ...action.payload,
          x: action.payload.initialX ?? 10 + state.length * 10,
          y: action.payload.positionY ?? 0,
        },
      ]

    case "close_window":
      return state.map((window, idx) => {
        if (idx === action.payload.index) {
          return { ...window, closed: true }
        }
        return window
      })

    case "end_all":
      return state.map((window, idx) => {
        if (window.name != "Task Manager") {
          return { ...window, closed: true }
        }
        return window
      })

    case "toggle_minimize_tab":
      return state.map((window, idx) => {
        if (idx === action.payload.index) {
          if (action.payload.minimized === true)
            return { ...window, minimized: !window.minimized, active: true }
          else if (action.payload.minimized === false) {
            if (action.payload.active === false)
              return { ...window, minimized: false, active: true }
            else if (action.payload.active === true)
              return { ...window, minimized: !window.minimized, active: false }
          }
        }
        return { ...window, active: false }
      })

    case "toggle_minimize":
      return state.map((window, idx) => {
        if (idx === action.payload.index) {
          return { ...window, minimized: !window.minimized, active: false }
        }
        return { ...window, active: false }
      })

    case "toggle_maximize":
      return state.map((window, idx) => {
        if (idx === action.payload.index) {
          return { ...window, maximized: !window.maximized }
        }
        return window
      })

    case "select_active":
      return state.map((window, idx) => {
        if (idx === action.payload.index) {
          if (window.minimized == true) return { ...window, active: false }
          else if (window.minimized == false) return { ...window, active: true }
        }
        return { ...window, active: false }
      })

    // Bring an open window to the front, restoring it if minimized
    case "focus_window":
      return state.map((window, idx) =>
        idx === action.payload.index
          ? { ...window, minimized: false, active: true }
          : { ...window, active: false }
      )

    case "move_window":
      return state.map((window, idx) =>
        idx === action.payload.index
          ? { ...window, x: action.payload.x, y: action.payload.y }
          : window
      )

    // width/height from a resize handle or an app sizing its own window (Minesweeper);
    // x/y optional (resizing from the left or top edge moves the window too)
    case "resize_window":
      return state.map((window, idx) =>
        idx === action.payload.index
          ? {
              ...window,
              width: action.payload.width,
              height: action.payload.height,
              x: action.payload.x ?? window.x,
              y: action.payload.y ?? window.y,
            }
          : window
      )
    default:
      return state
  }
}

function App() {
  const [windows, dispatch] = useReducer(reducer, [])
  const [startMenuVisible, setStartMenuVisible] = useState(false)
  const [results, setResults] = useState([])
  const mobile = useIsMobile()

  const closeMenu = () => {
    setResults([])
    setStartMenuVisible(false)
  }

  return (
    <div className={mobile ? "os-root os-mobile" : "os-root"}>
      <Desktop
        fs={fs}
        programs={programs}
        windows={windows}
        dispatch={dispatch}
        closeMenu={closeMenu}
        mobile={mobile}
      />
      <TaskBar
        windows={windows}
        dispatch={dispatch}
        startMenuVisible={startMenuVisible}
        setStartMenuVisible={setStartMenuVisible}
      />
      {/* Start menu and search results sit just above the taskbar */}
      {startMenuVisible && (
        <div className="startArea">
          <StartMenu
            windows={windows}
            dispatch={dispatch}
            setResults={setResults}
            closeMenu={closeMenu}
          />
          {results.length !== 0 && (
            <LiveSearch results={results} dispatch={dispatch} closeMenu={closeMenu} />
          )}
        </div>
      )}
    </div>
  )
}

export default App
