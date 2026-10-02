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
    case "open_window":
      console.log(action.payload.name)
      return [
        ...state.map((window, idx) => {
          return { ...window, active: false }
        }),
        { ...action.payload },
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

    case "setWindowPosition":
      return state.map((window, idx) => {
        if (idx === action.payload.index) {
          return {
            ...window,
            positionX: action.payload.positionX,
            positionY: action.payload.positionY,
          }
        }
        return window
      })
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
