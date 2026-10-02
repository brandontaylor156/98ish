import React, { Suspense, useEffect, useRef, useState } from "react"
import DateAndTime from "./DateAndTime"
import RunDialog from "./RunDialog"
import ContextMenu from "../shared/ContextMenu"
import { explorerWindow, launch, programByName, programs } from "../../utils/programs"
import { openItem } from "../../utils/openItem"
import { fs } from "../../utils/fs"
import { iconFor } from "../../utils/fileInfo"
import { setSettings, useSettings } from "../../utils/settings"
import { previewSound } from "../../utils/systemSounds"
import { unlock } from "../../utils/achievements"
import { useIsMobile } from "../../hooks/useMediaQuery"
import { useLongPress } from "../../hooks/useLongPress"
import { SHELL_EVENT, addQuickLaunch, entryKey, removeQuickLaunch, requestClose, resetQuickLaunch, useNetStatus, useQuickLaunch } from "../../utils/shell"
import MailTray from "../applets/mail/MailTray"
import CoupleTray from "../applets/couples/CoupleTray"
import "./Shell.css"

// Taskbar Properties and Keyboard Shortcuts load the first time they're opened
const TaskbarDialog = React.lazy(() => import("./TaskbarDialogs"))

// ---- little tray and toolbar pictures (original 16x16 art) ----

const ShowDesktopIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <rect x="1" y="2" width="14" height="10" fill="#008080" stroke="#000" />
    <rect x="2" y="3" width="12" height="2" fill="#000080" />
    <rect x="3" y="7" width="3" height="3" fill="#ffff80" stroke="#806000" strokeWidth=".6" />
    <path d="M9 13l-1 2h6l-1-2" fill="#c0c0c0" stroke="#000" strokeWidth=".8" />
    <path d="M10 6l4 4" stroke="#fff" strokeWidth="1.2" />
  </svg>
)

const SpeakerIcon = ({ muted, volume }) => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <path d="M2 6h3l4-3v10l-4-3H2z" fill="#ffff00" stroke="#000" strokeWidth="1" strokeLinejoin="round" />
    {muted ? (
      <path d="M10.5 5.5l4 5M14.5 5.5l-4 5" stroke="#d00000" strokeWidth="1.6" />
    ) : (
      <>
        {volume > 0 && <path d="M11 6q1.5 2 0 4" fill="none" stroke="#000" strokeWidth="1.1" />}
        {volume > 45 && <path d="M12.5 4.5q3 3.5 0 7" fill="none" stroke="#000" strokeWidth="1.1" />}
      </>
    )}
  </svg>
)

const NetIcon = ({ online }) => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <rect x="1" y="2" width="8" height="6" fill={online ? "#00a0a0" : "#808080"} stroke="#000" />
    <rect x="7" y="7" width="8" height="6" fill={online ? "#00c000" : "#808080"} stroke="#000" />
    <path d="M3 9v3h4M10 14v1" stroke="#000" strokeWidth="1" fill="none" />
    {!online && <path d="M1 15l6-6M1 9l6 6" stroke="#d00000" strokeWidth="1.6" />}
  </svg>
)

const FloppyIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <path d="M1.5 1.5h11l2 2v11h-13z" fill="#2d3e9c" stroke="#111a52" />
    <rect x="4" y="1.5" width="7" height="4" fill="#c9ced6" />
    <rect x="3.5" y="8" width="9" height="6" fill="#f4f1e6" />
    <circle cx="6" cy="10.5" r="0.9" fill="#111" />
    <circle cx="10" cy="10.5" r="0.9" fill="#111" />
    <path d="M6.5 12.3q1.5 1 3 0" stroke="#111" strokeWidth=".8" fill="none" />
  </svg>
)

const KONAMI = ["arrowup", "arrowup", "arrowdown", "arrowdown", "arrowleft", "arrowright", "arrowleft", "arrowright", "b", "a"]

// screen space above the taskbar, for Cascade and Tile
const freeScreen = () => ({
  width: document.documentElement.clientWidth,
  height: window.innerHeight - (document.querySelector(".taskbar")?.offsetHeight || 35),
})

const TaskBar = ({ windows, dispatch, setStartMenuVisible, startMenuVisible }) => {
  const settings = useSettings()
  const mobile = useIsMobile()
  const online = useNetStatus()
  const quick = useQuickLaunch()
  const [menu, setMenu] = useState(null) // { x, y, items }
  const [popup, setPopup] = useState(null) // "volume" | "net"
  const [dialog, setDialog] = useState(null) // "run" | "properties" | "shortcuts"
  const [switcher, setSwitcher] = useState(null) // { list: [window indexes], pos }
  const mru = useRef([]) // window indexes, most recently active first

  const open = windows.map((w, i) => (w.closed ? -1 : i)).filter((i) => i >= 0)

  // keep track of which windows were used most recently, for the switcher
  useEffect(() => {
    const active = windows.findIndex((w) => w.active && !w.closed)
    mru.current = mru.current.filter((i) => windows[i] && !windows[i].closed && i !== active)
    if (active >= 0) mru.current.unshift(active)
    for (const i of open) if (!mru.current.includes(i)) mru.current.push(i)
    if (open.length >= 10) unlock("ten-windows")
  }, [windows])

  // ---- actions ----

  const openWindow = (payload) => dispatch({ type: "open_window", payload })

  // the clock opens Date/Time Properties, or brings it back if it's already open
  const openDateTime = () => {
    const index = windows.findIndex((w) => !w.closed && w.app === "datetime")
    if (index >= 0) dispatch({ type: "focus_window", payload: { index } })
    else openWindow(launch("Date/Time Properties"))
  }

  const anyShown = windows.some((w) => !w.closed && !w.minimized)
  const canUndoMinimize = windows.some((w) => !w.closed && w.hiddenByShell)
  const showDesktop = () => dispatch({ type: anyShown ? "minimize_all" : "undo_minimize_all" })
  const arrange = (mode) => dispatch({ type: "arrange_windows", payload: { mode, ...freeScreen() } })

  const latest = useRef({})
  latest.current = { switcher, windows, startMenuVisible, showDesktop }

  // Start > Settings, the desktop and the keyboard ask for these
  useEffect(() => {
    const onShell = (e) => {
      const action = e.detail?.action
      if (action === "show-desktop") latest.current.showDesktop()
      else if (action === "run" || action === "properties" || action === "shortcuts") setDialog(action)
      else if (action === "taskbar-properties") setDialog("properties")
      else if (action === "themes") dispatch({ type: "open_window", payload: launch("Desktop Themes") })
    }
    window.addEventListener(SHELL_EVENT, onShell)
    return () => window.removeEventListener(SHELL_EVENT, onShell)
  }, [])

  // ---- keyboard ----

  useEffect(() => {
    let metaAlone = false
    let konami = 0

    const cycle = (dir) => {
      const { switcher: s, windows: ws } = latest.current
      if (!s) {
        const list = mru.current.filter((i) => ws[i] && !ws[i].closed)
        if (!list.length) return
        const pos = list.length === 1 ? 0 : dir > 0 ? 1 : list.length - 1
        setSwitcher({ list, pos })
      } else setSwitcher({ ...s, pos: (s.pos + dir + s.list.length) % s.list.length })
    }

    const onDown = (e) => {
      if (e.key === "Meta") {
        metaAlone = true
        return
      }
      metaAlone = false
      const key = e.key?.toLowerCase()

      // Alt+Q / Alt+`: the window switcher (e.code, since Option+Q types a letter on a Mac)
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === "KeyQ" || e.code === "Backquote")) {
        e.preventDefault()
        e.stopPropagation()
        cycle(e.shiftKey ? -1 : 1)
        return
      }
      if (latest.current.switcher && e.key === "Escape") {
        e.preventDefault()
        setSwitcher(null)
        return
      }
      if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === "Escape") {
        e.preventDefault()
        // or the Start menu, opening right now, would see this Escape and close again
        e.stopPropagation()
        setStartMenuVisible(!latest.current.startMenuVisible)
        return
      }
      // (not AltGr, which some keyboards use to type letters like ę)
      if (e.ctrlKey && e.altKey && !e.metaKey && !e.getModifierState?.("AltGraph")) {
        const act = {
          KeyE: () => openWindow(explorerWindow([])),
          KeyD: () => latest.current.showDesktop(),
          KeyR: () => setDialog("run"),
          KeyK: () => setDialog("shortcuts"),
        }[e.code]
        if (act) {
          e.preventDefault()
          e.stopPropagation()
          setStartMenuVisible(false)
          act()
          return
        }
      }

      // the famous code, typed on the bare desktop
      if (e.target.closest?.(".desktopWindow, .mobileWindow, input, textarea, select, [contenteditable]")) konami = 0
      else if (key === KONAMI[konami]) {
        konami++
        if (konami === KONAMI.length) {
          konami = 0
          unlock("konami")
        }
      } else konami = key === KONAMI[0] ? 1 : 0
    }

    const onUp = (e) => {
      const { switcher: s, windows: ws } = latest.current
      if (e.key === "Alt" && s) {
        const index = s.list[s.pos]
        setSwitcher(null)
        if (ws[index] && !ws[index].closed) {
          dispatch({ type: "focus_window", payload: { index } })
          unlock("switcher")
        }
      }
      if (e.key === "Meta" && metaAlone) setStartMenuVisible(!latest.current.startMenuVisible)
      metaAlone = false
    }

    const onBlur = () => {
      metaAlone = false
      setSwitcher(null)
    }

    window.addEventListener("keydown", onDown, true)
    window.addEventListener("keyup", onUp, true)
    window.addEventListener("blur", onBlur)
    return () => {
      window.removeEventListener("keydown", onDown, true)
      window.removeEventListener("keyup", onUp, true)
      window.removeEventListener("blur", onBlur)
    }
  }, [])

  // ---- right-click menus ----

  const showMenu = (e, items) => {
    e.preventDefault()
    e.stopPropagation()
    setPopup(null)
    setStartMenuVisible(false)
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  const taskbarMenu = () => [
    ...(mobile
      ? []
      : [
          { label: "Toolbars", items: [{ label: "Quick Launch", checked: settings.quickLaunch, onClick: () => setSettings({ quickLaunch: !settings.quickLaunch }) }] },
          "-",
          { label: "Cascade Windows", disabled: !anyShown, onClick: () => arrange("cascade") },
          { label: "Tile Windows Horizontally", disabled: !anyShown, onClick: () => arrange("horizontal") },
          { label: "Tile Windows Vertically", disabled: !anyShown, onClick: () => arrange("vertical") },
          "-",
        ]),
    { label: "Minimize All Windows", disabled: !anyShown, onClick: () => dispatch({ type: "minimize_all" }) },
    { label: "Undo Minimize All", disabled: !canUndoMinimize, onClick: () => dispatch({ type: "undo_minimize_all" }) },
    "-",
    { label: "Task Manager...", onClick: () => openWindow(launch("Task Manager")) },
    { label: "Keyboard Shortcuts...", onClick: () => setDialog("shortcuts") },
    "-",
    { label: "Properties", onClick: () => setDialog("properties") },
  ]

  const tabMenu = (index) => {
    const w = windows[index]
    return [
      { label: "Restore", disabled: !w.minimized && !w.maximized, onClick: () => dispatch({ type: "restore_window", payload: { index } }) },
      { label: "Minimize", disabled: w.minimized, onClick: () => dispatch({ type: "toggle_minimize", payload: { index } }) },
      ...(mobile
        ? []
        : [
            {
              label: "Maximize",
              disabled: w.maximized && !w.minimized,
              onClick: () => {
                dispatch({ type: "focus_window", payload: { index } })
                if (!w.maximized) dispatch({ type: "toggle_maximize", payload: { index } })
              },
            },
          ]),
      "-",
      { label: "Close", bold: true, onClick: () => requestClose(index) },
    ]
  }

  // the Quick Launch toolbar: its icons, resolved (programs and files that are gone drop out)
  const quickItems = quick
    .map((entry) => {
      const key = entryKey(entry)
      if (entry.kind === "desktop") return { key, label: "Show Desktop", picture: <ShowDesktopIcon />, run: showDesktop }
      if (entry.kind === "program") {
        const p = programByName(entry.name)
        return p && { key, label: p.name, icon: p.icon, run: () => openWindow(launch(p.name)) }
      }
      const item = fs.resolve(entry.path)
      return item && { key, label: item.name, icon: iconFor(item), run: () => openItem(item, dispatch) }
    })
    .filter(Boolean)

  const addMenu = () => {
    const have = new Set(quick.map(entryKey))
    return [
      ...(have.has("desktop") ? [] : [{ label: "Show Desktop", onClick: () => addQuickLaunch({ kind: "desktop" }) }]),
      ...programs
        .filter((p) => !have.has(`program:${p.name}`))
        .map((p) => ({ label: p.name, onClick: () => addQuickLaunch({ kind: "program", name: p.name }) })),
    ]
  }

  const quickMenu = (item) => [
    ...(item
      ? [
          { label: "Open", bold: true, onClick: item.run },
          "-",
          { label: "Remove from Quick Launch", onClick: () => removeQuickLaunch(item.key) },
          "-",
        ]
      : []),
    { label: "Add to Quick Launch", items: addMenu() },
    { label: "Reset Quick Launch", onClick: resetQuickLaunch },
    "-",
    { label: "Hide Quick Launch", onClick: () => setSettings({ quickLaunch: false }) },
  ]

  // phones: hold a taskbar button for its menu
  const longPress = useLongPress((x, y, { target }) => {
    const tab = target.closest?.("[data-tab]")
    if (!tab) return
    setStartMenuVisible(false)
    setMenu({ x, y, items: tabMenu(Number(tab.dataset.tab)) })
  })

  // ---- rendering ----

  const startBtnStyle = {
    cursor: "pointer",
    borderTop: startMenuVisible ? "3px solid #333" : "3px solid #eee",
    borderLeft: startMenuVisible ? "3px solid #333" : "3px solid #eee",
    borderRight: startMenuVisible ? "3px solid #eee" : "3px solid #333",
    borderBottom: startMenuVisible ? "3px solid #eee" : "3px solid #333",
  }

  const autoHide = settings.taskbarAutoHide && !mobile
  const peek = startMenuVisible || popup || menu || switcher || dialog
  const togglePopup = (name) => {
    setMenu(null)
    setStartMenuVisible(false)
    setPopup(popup === name ? null : name)
  }

  return (
    <>
      <div
        className={"taskbar row position-absolute bottom-0 w-100 align-items-center m-0 flex-nowrap" + (autoHide ? " is-autohide" : "") + (autoHide && peek ? " is-peek" : "")}
        onContextMenu={(e) => showMenu(e, taskbarMenu())}
      >
        <div className="col-auto p-0 ps-1 taskbarLeft">
          <div
            className="d-flex px-2"
            style={startBtnStyle}
            onClick={() => setStartMenuVisible(!startMenuVisible)}
            onContextMenu={(e) => e.stopPropagation()}
          >
            <img className="img-fluid me-2" style={{ width: 24 }} src="/assets/start98.png" alt="Start Menu" />
            <p className="mb-0 startBtn">Start</p>
          </div>
        </div>

        {!mobile && settings.quickLaunch && (
          <div className="col-auto p-0 quickLaunch" role="toolbar" aria-label="Quick Launch" onContextMenu={(e) => showMenu(e, quickMenu(null))}>
            {quickItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className="qlButton"
                title={item.label}
                aria-label={item.label}
                data-ql={item.key}
                onClick={item.run}
                onContextMenu={(e) => showMenu(e, quickMenu(item))}
              >
                {item.picture || <img src={item.icon} alt="" draggable="false" />}
              </button>
            ))}
          </div>
        )}

        <div className="col taskbarRight p-0" {...longPress}>
          {windows.map(
            (window, index) =>
              !window.closed && (
                <button
                  key={index}
                  data-tab={index}
                  style={
                    window.active
                      ? { boxShadow: "inset 1px 1px #0a0a0a, inset -1px -1px #fff, inset 2px 2px grey, inset -2px -2px #dfdfdf" }
                      : undefined
                  }
                  className="taskbarTab text-start ms-1 p-0"
                  onClick={() => {
                    dispatch({
                      type: "toggle_minimize_tab",
                      payload: { name: window.name, minimized: window.minimized, active: window.active, index },
                    })
                  }}
                  onContextMenu={(e) => showMenu(e, tabMenu(index))}
                >
                  <img src={window.icon_url} className="p-1 h-100" draggable="false" />
                  <span className="taskbarTabLabel">&nbsp;{window.name}</span>
                </button>
              )
          )}
        </div>

        <div className="col-auto p-0 pe-1">
          <div className="tray" onContextMenu={(e) => e.stopPropagation()}>
            {!mobile && !settings.helper && (
              <button type="button" className="trayIcon" title="Floppy is resting. Click to bring him back." aria-label="Show Floppy" onClick={() => setSettings({ helper: true })}>
                <FloppyIcon />
              </button>
            )}
            {!mobile && (
              <button
                type="button"
                className="trayIcon"
                title={online ? "Connected to the 98ish server" : "Not connected to the 98ish server"}
                aria-label="Network status"
                data-online={online}
                onClick={() => togglePopup("net")}
              >
                <NetIcon online={online} />
              </button>
            )}
            <button
              type="button"
              className="trayIcon"
              title={settings.muted ? "Volume (muted)" : `Volume: ${settings.volume}%`}
              aria-label="Volume"
              onClick={() => togglePopup("volume")}
            >
              <SpeakerIcon muted={settings.muted} volume={settings.volume} />
            </button>
            <MailTray windows={windows} dispatch={dispatch} />
            <CoupleTray />
            {settings.taskbarClock && <DateAndTime onOpen={openDateTime} />}
          </div>
        </div>
      </div>

      {popup === "volume" && <VolumePopup settings={settings} onClose={() => setPopup(null)} />}
      {popup === "net" && (
        <TrayBalloon onClose={() => setPopup(null)} title={online ? "Connected" : "Not connected"}>
          {online
            ? "You're connected to the 98ish server: 98 Messenger and Network Neighborhood are ready."
            : "The 98ish server isn't answering. It may be waking up; give it a minute."}
        </TrayBalloon>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {switcher && <Switcher windows={windows} switcher={switcher} onPick={(index) => (setSwitcher(null), dispatch({ type: "focus_window", payload: { index } }))} />}

      {dialog && (
        <div className="shellLayer">
          {dialog === "run" && <RunDialog dispatch={dispatch} onDone={() => setDialog(null)} onCancel={() => setDialog(null)} />}
          {dialog !== "run" && (
            <Suspense fallback={null}>
              <TaskbarDialog kind={dialog} settings={settings} mobile={mobile} onClose={() => setDialog(null)} />
            </Suspense>
          )}
        </div>
      )}
    </>
  )
}

// ---- the pieces ----

// closes on a press anywhere else
const useOutside = (ref, onClose) => {
  useEffect(() => {
    const onDown = (e) => {
      if (!ref.current?.contains(e.target) && !e.target.closest?.(".trayIcon")) onClose()
    }
    const onKey = (e) => e.key === "Escape" && onClose()
    document.addEventListener("pointerdown", onDown, true)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown, true)
      document.removeEventListener("keydown", onKey)
    }
  }, [])
}

const VolumePopup = ({ settings, onClose }) => {
  const ref = useRef(null)
  useOutside(ref, onClose)
  return (
    <div className="window trayPopup volumePopup" ref={ref} role="dialog" aria-label="Volume">
      <div className="volumeTitle">Volume</div>
      <div className="volumeSlider">
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          value={settings.volume}
          aria-label="Master volume"
          onChange={(e) => setSettings({ volume: Number(e.target.value), muted: false })}
          onPointerUp={() => previewSound("ding")}
          onKeyUp={() => previewSound("ding")}
        />
      </div>
      <div className="field-row volumeMute">
        <input id="tray-mute" type="checkbox" checked={settings.muted} onChange={(e) => setSettings({ muted: e.target.checked })} />
        <label htmlFor="tray-mute">Mute</label>
      </div>
    </div>
  )
}

const TrayBalloon = ({ title, children, onClose }) => {
  const ref = useRef(null)
  useOutside(ref, onClose)
  useEffect(() => {
    const t = setTimeout(onClose, 6000)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="trayPopup trayBalloon" ref={ref} role="status" onClick={onClose}>
      <b>{title}</b>
      <p>{children}</p>
    </div>
  )
}

// the Alt+Q window switcher: icons in a row, the chosen one's name underneath
const Switcher = ({ windows, switcher, onPick }) => {
  const chosen = windows[switcher.list[switcher.pos]]
  return (
    <div className="switcherLayer">
      <div className="window switcher" role="listbox" aria-label="Switch windows">
        <div className="switcherIcons">
          {switcher.list.map((index, i) => (
            <button
              key={index}
              type="button"
              role="option"
              aria-selected={i === switcher.pos}
              className={i === switcher.pos ? "switcherIcon is-selected" : "switcherIcon"}
              title={windows[index]?.name}
              onPointerDown={(e) => (e.preventDefault(), onPick(index))}
            >
              <img src={windows[index]?.icon_url} alt="" draggable="false" />
            </button>
          ))}
        </div>
        <div className="switcherName">{chosen?.name}</div>
      </div>
    </div>
  )
}

export default TaskBar
