import React, { useEffect, useState } from "react"
import Dialog from "../../shared/Dialog"
import { onStorageStatus, storageInfo } from "../../../utils/fs"
import "./Backup.css"

// Always on the desktop (loaded in the background): tells you, the 98 way, when the drive
// can't be kept the normal way (a private window, the move to the bigger storage didn't
// work this time) and when drive C: is full and a change couldn't be saved.

const SEEN_KEY = "98ish.storageNotice" // sessionStorage: each problem is told once per visit

const seen = (kind) => {
  try {
    return sessionStorage.getItem(SEEN_KEY)?.split(",").includes(kind)
  } catch {
    return false
  }
}
const markSeen = (kind) => {
  try {
    const list = (sessionStorage.getItem(SEEN_KEY) || "").split(",").filter(Boolean)
    sessionStorage.setItem(SEEN_KEY, [...new Set([...list, kind])].join(","))
  } catch {
    // fine
  }
}

const TITLES = { noidb: "Drive C:", migrate: "Drive C:", unavailable: "Drive C:", full: "Drive C: is full" }

const StorageNotice = () => {
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    const show = (info) => {
      if (!info.problem || seen(info.problem)) return
      let text = info.problemText
      if (info.problem === "migrate") text = `98ish couldn't move your files to this browser's bigger storage this time. ${info.problemText} Nothing was lost: your files are where they were, and 98ish tries again the next time it starts.`
      setNotice({ kind: info.problem, text })
    }
    show(storageInfo())
    return onStorageStatus(show)
  }, [])

  if (!notice) return null
  const close = () => {
    // "full" can come back later this visit (after you make room); the others are told once
    if (notice.kind !== "full") markSeen(notice.kind)
    setNotice(null)
  }
  return (
    <div className="desktopDialogLayer">
      <Dialog title={TITLES[notice.kind] || "Drive C:"} onOk={close} sound={notice.kind === "full" ? "critical" : "ding"}>
        <div className="bkConfirm">
          <img src="/assets/hard_drive.png" alt="" width="32" height="32" />
          <p className="dialogText">{notice.text}</p>
        </div>
      </Dialog>
    </div>
  )
}

export default StorageNotice
