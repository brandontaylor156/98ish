import React, { useState } from "react"
import { useAim } from "../applets/aim/AimContext"
import { useDriveSync } from "../../utils/driveSync"
import { storageInfo } from "../../utils/fs"
import { isIos, isStandalone } from "../../utils/push"
import { openTarget } from "../../utils/notifications"
import { keepSafeAdvice, snoozed } from "../../utils/keepSafe"
import "./KeepSafe.css"

// "Your files are only on this device": shown where it matters while no online copy is kept
// (see utils/keepSafe.js). Closing a note keeps it away from that place for 30 days.

const DISMISS_KEY = "98ish.keepSafe" // { [place]: time closed }

const readDismissed = () => {
  try {
    return JSON.parse(localStorage.getItem(DISMISS_KEY)) || {}
  } catch {
    return {}
  }
}

export const useKeepSafe = () => {
  const sync = useDriveSync()
  const aim = useAim()
  return keepSafeAdvice({ phase: sync.phase, signedOn: aim?.status === "online", persisted: storageInfo().persisted, ios: isIos(), standalone: isStandalone() })
}

export const openSignOn = () => openTarget({ kind: "program", name: "98 Messenger" })
export const openBackup = () => openTarget({ kind: "program", name: "Backup" })

// place: where it shows ("camera", "photos"...); closable: false for Control Panel > Storage
const KeepSafe = ({ place, closable = true, className = "" }) => {
  const advice = useKeepSafe()
  const [closed, setClosed] = useState(() => closable && snoozed(readDismissed(), place))
  if (!advice || closed) return null
  const close = () => {
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify({ ...readDismissed(), [place]: Date.now() }))
    } catch {
      // closed for this visit
    }
    setClosed(true)
  }
  return (
    <div className={`keepSafe ${className}`} role="note" data-keep-safe={place}>
      <img src="/assets/hard_drive.png" alt="" width="24" height="24" />
      <p>{advice.text}</p>
      <div className="keepSafeButtons">
        {advice.kind === "guest" && (
          <button type="button" onClick={openSignOn}>
            Sign On...
          </button>
        )}
        <button type="button" onClick={openBackup}>
          Backup...
        </button>
        {closable && (
          <button type="button" className="keepSafeClose" onClick={close} aria-label="Close this note" title="Don't show this here for a month">
            ×
          </button>
        )}
      </div>
    </div>
  )
}

export default KeepSafe
