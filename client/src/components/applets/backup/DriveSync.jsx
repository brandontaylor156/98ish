import { useEffect, useRef } from "react"
import { keyOf, useAim } from "../aim/AimContext"
import { setSyncSession, statusText, useDriveSync } from "../../../utils/driveSync"
import { notify } from "../../../utils/notifications"

// Always on the desktop (loaded in the background): tells file sync who's signed on to
// 98 Messenger. Signed off because the account signed on somewhere else ("kicked"), this
// device keeps syncing with its own token; signed off on purpose, it stops.

const KNOWN_PHASES = new Set(["off", "signedOut", "syncing", "pending", "offline", "idle"])

const DriveSync = () => {
  const aim = useAim()
  const online = aim?.status === "online"
  const screenName = aim?.me?.screenName
  const token = online ? aim.getToken?.() : null
  const wasOnline = useRef(false)
  const sync = useDriveSync()

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

  return null
}

export default DriveSync
