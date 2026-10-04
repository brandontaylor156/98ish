import React, { useEffect, useRef, useState } from "react"
import { keyOf, useAim } from "../aim/AimContext"
import { getSyncFolders, setSyncSession, statusText, useDriveSync } from "../../../utils/driveSync"
import { notify } from "../../../utils/notifications"
import { launch } from "../../../utils/programs"
import Dialog from "../../shared/Dialog"
import "./Backup.css"

// Always on the desktop (loaded in the background): tells file sync who's signed on to
// 98 Messenger. Signed off because the account signed on somewhere else ("kicked"), this
// device keeps syncing with its own token; signed off on purpose, it stops. The first time
// sync turns itself on (a device that never chose), it says so once.

const KNOWN_PHASES = new Set(["off", "signedOut", "syncing", "pending", "offline", "idle"])

const DriveSync = ({ dispatch }) => {
  const aim = useAim()
  const online = aim?.status === "online"
  const screenName = aim?.me?.screenName
  const token = online ? aim.getToken?.() : null
  const wasOnline = useRef(false)
  const sync = useDriveSync()
  const [told, setTold] = useState(null) // when the notice was shown

  useEffect(() => {
    if (token && screenName) {
      wasOnline.current = true
      setSyncSession({ key: keyOf(screenName), screenName, token })
    } else if (aim?.status === "signedOff" && wasOnline.current) {
      wasOnline.current = false
      setSyncSession(null, { kicked: !!aim.error })
    }
  }, [token, screenName, aim?.status])

  // sync trouble, and copies kept after a file changed on two devices, go in the
  // Notification Center (one item each, kept up to date)
  useEffect(() => {
    const target = { kind: "program", name: "My Computer" }
    if (sync && !KNOWN_PHASES.has(sync.phase)) notify({ app: "system", key: "drive-sync", title: "File sync", text: statusText(sync), target })
  }, [sync?.phase, sync?.text])
  useEffect(() => {
    if (sync?.kept) notify({ app: "system", key: "drive-sync-kept", title: "File sync", text: statusText({ ...sync, phase: "idle" }), target: { kind: "program", name: "My Computer" } })
  }, [sync?.kept])

  // sync just turned itself on: say so, once
  const list = getSyncFolders()
  const folders = list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0] || "files"
  const onText = `Your photos and files in ${folders} now also save to your 98 Messenger account (${sync?.screenName || screenName || "you"}), so they're safe if this device clears its storage, and they come back on any device you sign on from. To change this, open Backup.`
  useEffect(() => {
    if (!sync?.turnedOn) return
    setTold(sync.turnedOn)
    notify({ app: "system", key: "drive-sync-on", title: "File sync is on", text: onText, target: { kind: "program", name: "Backup" } })
  }, [sync?.turnedOn])

  if (!told) return null
  return (
    <div className="desktopDialogLayer">
      <Dialog
        title="File Sync"
        onOk={() => setTold(null)}
        onNo={() => {
          setTold(null)
          dispatch?.({ type: "open_window", payload: launch("Backup") })
        }}
        noLabel="Settings..."
        sound="ding"
      >
        <div className="bkConfirm" data-sync-notice>
          <img src="/assets/hard_drive.png" alt="" width="32" height="32" />
          <p className="dialogText">
            <b>File sync is on.</b> {onText}
          </p>
        </div>
      </Dialog>
    </div>
  )
}

export default DriveSync
