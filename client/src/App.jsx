import React, { useEffect, useState, useReducer } from "react"
import TaskBar from "./components/OS-specific/TaskBar"
import StartMenu from "./components/OS-specific/StartMenu"
import Desktop from "./components/OS-specific/Desktop"
import LiveSearch from "./components/OS-specific/LiveSearch"
import { useIsMobile } from "./hooks/useMediaQuery"
import MsDos from "./components/applets/dos/MsDos"
import Dialog from "./components/shared/Dialog"
import { hasUnsavedNotepads } from "./components/applets/notepad/Notepad"
import { BootScreen, LogOffDialog, LogOn, SafeToTurnOff, ShutDownDialog, ShuttingDown, playStartupSound } from "./components/OS-specific/Power"
import { getSettings, schemeVars, useSettings, wallpaperStyle } from "./utils/settings"

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

    // logging off or shutting down
    case "close_all":
      return state.map((window) => ({ ...window, closed: true }))

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

    // apps that show a document title in their title bar (Internet Explorer)
    case "rename_window":
      return state.map((window, idx) =>
        idx === action.payload.index ? { ...window, name: action.payload.name } : window
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

// what's on screen: starting up, Windows, or one of the shut down / log off steps
const firstPhase = () => (getSettings().bootScreen ? "boot" : "desktop")

function App() {
  const [windows, dispatch] = useReducer(reducer, [])
  const [startMenuVisible, setStartMenuVisible] = useState(false)
  const [results, setResults] = useState([])
  const [phase, setPhase] = useState(firstPhase)
  const [power, setPower] = useState(null) // "shutdown" | "logoff" dialog
  const [unsavedThen, setUnsavedThen] = useState(null) // what to do if the user says go ahead
  const mobile = useIsMobile()
  const settings = useSettings()

  const closeMenu = () => {
    setResults([])
    setStartMenuVisible(false)
  }

  // the chime, once Windows is up
  const startedUp = () => {
    setPhase("desktop")
    if (getSettings().startupSound) playStartupSound()
  }
  useEffect(() => {
    if (phase === "desktop" && !getSettings().bootScreen && getSettings().startupSound) playStartupSound()
  }, [])

  const restart = () => setPhase(getSettings().bootScreen ? "boot" : "desktop")

  // unsaved Notepad text? ask before throwing it away
  const checkUnsaved = (then) => (hasUnsavedNotepads() ? setUnsavedThen(() => then) : then())

  const chooseShutDown = (choice) => {
    setPower(null)
    checkUnsaved(() => powerOff(choice))
  }

  const powerOff = (choice) => {
    dispatch({ type: "close_all" })
    if (choice === "dos") setPhase("dos")
    else setPhase(choice === "restart" ? "restarting" : "shuttingDown")
  }

  return (
    <div
      className={mobile ? "os-root os-mobile" : "os-root"}
      style={{ ...wallpaperStyle(settings), ...schemeVars(settings) }}
    >
      {phase === "desktop" && (
        <>
          <Desktop windows={windows} dispatch={dispatch} closeMenu={closeMenu} mobile={mobile} />
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
                dispatch={dispatch}
                setResults={setResults}
                closeMenu={closeMenu}
                mobile={mobile}
                onShutDown={() => setPower("shutdown")}
                onLogOff={() => setPower("logoff")}
              />
              {results.length !== 0 && (
                <LiveSearch results={results} dispatch={dispatch} closeMenu={closeMenu} />
              )}
            </div>
          )}
          {power === "shutdown" && <ShutDownDialog onChoose={chooseShutDown} onCancel={() => setPower(null)} />}
          {power === "logoff" && (
            <LogOffDialog
              onYes={() => {
                setPower(null)
                checkUnsaved(() => {
                  dispatch({ type: "close_all" })
                  setPhase("logOn")
                })
              }}
              onCancel={() => setPower(null)}
            />
          )}
          {unsavedThen && (
            <div className="powerDim">
              <Dialog
                title="Windows"
                okLabel="Yes"
                cancelLabel="No"
                onOk={() => {
                  const then = unsavedThen
                  setUnsavedThen(null)
                  then()
                }}
                onCancel={() => setUnsavedThen(null)}
              >
                <p className="dialogText">Notepad has unsaved changes. If you continue, they'll be lost.</p>
                <p className="dialogText">Continue anyway?</p>
              </Dialog>
            </div>
          )}
        </>
      )}
      {phase === "boot" && <BootScreen onDone={startedUp} />}
      {phase === "logOn" && <LogOn onDone={startedUp} />}
      {phase === "shuttingDown" && <ShuttingDown onDone={() => setPhase("off")} />}
      {phase === "restarting" && <ShuttingDown onDone={restart} />}
      {phase === "off" && <SafeToTurnOff onPowerOn={restart} />}
      {phase === "dos" && <MsDos fullScreen onClose={restart} />}
    </div>
  )
}

export default App
