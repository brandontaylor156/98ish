import React, { useEffect, useRef, useState } from "react"
import { launch } from "../../../utils/programs"
import { formatBytes } from "../../../utils/fileInfo"
import { statusText, syncNow, useDriveSync } from "../../../utils/driveSync"
import "./Backup.css"

// The taskbar tray's sync icon (only while sync is on): two arrows around a folder,
// green when synced, turning while syncing, grey offline, red when it needs you. Click for
// the status and Sync Now; double-click (or Settings...) for the sync settings.

const LIGHT = { idle: "#20c020", syncing: "#e0c000", pending: "#e0c000", offline: "#808080", signedOut: "#808080", error: "#e02020" }
const LABEL = { idle: "Synced", syncing: "Syncing", pending: "Syncing", offline: "Offline", signedOut: "Signed off", error: "Sync problem" }

const SyncIcon = ({ phase }) => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className={phase === "syncing" ? "syncSpin" : undefined}>
    <path d="M3 4h4l1 1h5v8H3z" fill="#ffd34d" stroke="#806000" strokeWidth=".8" />
    <path d="M13.5 6.5A6 6 0 0 0 3 4" fill="none" stroke="#000080" strokeWidth="1.3" />
    <path d="M2.5 9.5A6 6 0 0 0 13 12" fill="none" stroke="#000080" strokeWidth="1.3" />
    <path d="M1.5 2.5L3 4.6 5.2 3.4" fill="none" stroke="#000080" strokeWidth="1.2" />
    <path d="M14.5 13.5L13 11.4 10.8 12.6" fill="none" stroke="#000080" strokeWidth="1.2" />
    <circle cx="12.5" cy="12.5" r="2.6" fill={LIGHT[phase] || "#808080"} stroke="#000" strokeWidth=".6" />
  </svg>
)

const SyncTray = ({ dispatch }) => {
  const sync = useDriveSync()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const away = (e) => !ref.current?.contains(e.target) && setOpen(false)
    document.addEventListener("pointerdown", away, true)
    return () => document.removeEventListener("pointerdown", away, true)
  }, [open])

  if (sync.phase === "off") return null
  const settings = () => {
    setOpen(false)
    dispatch?.({ type: "open_window", payload: launch("Backup") })
  }
  return (
    <span className="syncTrayWrap" ref={ref}>
      <button
        type="button"
        className="trayIcon syncTray"
        data-phase={sync.phase}
        title={`File sync: ${statusText(sync)}`}
        aria-label={`File sync: ${LABEL[sync.phase] || "Sync problem"}`}
        onClick={() => setOpen(!open)}
        onDoubleClick={settings}
      >
        <SyncIcon phase={sync.phase === "pending" ? "syncing" : sync.phase} />
      </button>
      {open && (
        <div className="trayPopup trayBalloon syncBalloon" role="status">
          <b>File sync: {LABEL[sync.phase] || "Sync problem"}</b>
          <p>{statusText(sync)}</p>
          {sync.quota > 0 && (
            <p>
              Online: {formatBytes(sync.usage || 0)} of {formatBytes(sync.quota)}
            </p>
          )}
          <div className="syncBalloonButtons">
            <button type="button" disabled={sync.busy || sync.phase === "signedOut"} onClick={() => (setOpen(false), syncNow())}>
              Sync Now
            </button>
            <button type="button" onClick={settings}>
              Settings...
            </button>
          </div>
        </div>
      )}
    </span>
  )
}

export default SyncTray
