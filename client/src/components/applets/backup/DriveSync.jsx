import React, { useEffect, useRef, useState } from "react"
import Dialog from "../../shared/Dialog"
import { keyOf, useAim } from "../aim/AimContext"
import { resolveConflict, setSyncAccount, useDriveSync } from "../../../utils/driveSync"
import "./Backup.css"

// Always on the desktop (loaded in the background): tells the online drive who's signed on
// to 98 Messenger, and asks which copy to keep when the drive changed both here and online.

const when = (date) =>
  date ? new Date(date).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "earlier"

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`
const describe = (c) => `${plural(c.files, "file")}, ${plural(c.folders, "folder")}`

const ConflictDialog = ({ conflict }) => {
  const [choice, setChoice] = useState("both")
  const ref = useRef(null)
  // start on OK (not the first choice), so Enter keeps both
  useEffect(() => {
    const id = setTimeout(() => ref.current?.querySelector(".dialogButtons button")?.focus({ preventScroll: true }))
    return () => clearTimeout(id)
  }, [])
  const options = [
    ["local", "Keep this computer's files", "The online copy is replaced."],
    ["online", "Use the online copy", "The files on this computer are replaced."],
    ["both", "Keep both", "The online copy goes in C:\\Online Copy."],
  ]
  return (
    <div className="desktopDialogLayer bkConflict" ref={ref}>
      <Dialog title="Online Copy" okLabel="OK" cancelLabel="Decide Later" onOk={() => resolveConflict(choice)} onCancel={() => resolveConflict("later")} sound="chord">
        <p className="dialogText">
          {conflict.firstTime
            ? `Your 98 Messenger account already has an online copy of a C: drive (saved ${when(conflict.savedAt)}), and this computer has its own files.`
            : `Your files changed on this computer and in your online copy (saved ${when(conflict.savedAt)}) since they last synced.`}
        </p>
        <table className="bkCompare">
          <tbody>
            <tr>
              <th>This computer:</th>
              <td>{describe(conflict.local)}</td>
            </tr>
            <tr>
              <th>Online copy:</th>
              <td>{describe(conflict.online)}</td>
            </tr>
          </tbody>
        </table>
        <p className="dialogText">Which do you want to keep?</p>
        {options.map(([id, label, hint]) => (
          <div className="bkChoice" key={id}>
            <input type="radio" name="bk-choice" id={`bk-choice-${id}`} checked={choice === id} onChange={() => setChoice(id)} />
            <label htmlFor={`bk-choice-${id}`}>
              <b>{label}</b>
              <br />
              {hint}
            </label>
          </div>
        ))}
      </Dialog>
    </div>
  )
}

const DriveSync = () => {
  const aim = useAim()
  const sync = useDriveSync()
  const online = aim?.status === "online"
  const screenName = aim?.me?.screenName
  const token = online ? aim.getToken?.() : null

  useEffect(() => {
    setSyncAccount(token && screenName ? { key: keyOf(screenName), screenName, token } : null)
  }, [token, screenName])

  if (!sync.conflict || sync.conflict.deferred) return null
  return <ConflictDialog key={sync.conflict.revision} conflict={sync.conflict} />
}

export default DriveSync
