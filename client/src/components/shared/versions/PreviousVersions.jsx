import React, { useEffect, useState } from "react"
import Dialog from "../Dialog"
import { formatSize } from "../../../utils/fileInfo"
import { copyName, previewText, whenLabel } from "../../../utils/versionsCore"
import { readVersion, restoreVersion, saveVersionCopy, versionsOf } from "../../../utils/versions"
import { uniqueName } from "../../../utils/fs"
import "./PreviousVersions.css"

// "Restore Previous Version" (Notepad/WordPad/Paint File menus, a file's Properties): the
// versions a file had before its last saves on this device (utils/versions.js), newest
// first, with a preview of the picked one. Restore puts it back (what the file holds now
// becomes a version itself, so a restore can be undone); Save a Copy makes a new file next
// to it. onRestored(text) lets an open program show what was put back.
const PreviousVersions = ({ file, onClose, onRestored, onCopied }) => {
  const [list, setList] = useState(null)
  const [pick, setPick] = useState(null)
  const [preview, setPreview] = useState({ id: null, text: null })
  const [problem, setProblem] = useState("")
  const [busy, setBusy] = useState(false)

  const refresh = () =>
    versionsOf(file).then((l) => {
      setList(l)
      setPick((p) => (l.some((v) => v.id === p) ? p : l[0]?.id || null))
    })
  useEffect(() => {
    refresh()
  }, [file])

  useEffect(() => {
    if (!pick) return setPreview({ id: null, text: null })
    let gone = false
    readVersion(pick).then((text) => !gone && setPreview({ id: pick, text }))
    return () => {
      gone = true
    }
  }, [pick])

  const chosen = list?.find((v) => v.id === pick)
  const restore = async () => {
    if (!chosen || busy) return
    setBusy(true)
    const result = await restoreVersion(file, chosen.id)
    setBusy(false)
    if (!result.ok) return setProblem(result.error)
    onRestored?.(result.text)
    onClose()
  }
  const copy = async () => {
    if (!chosen || busy) return
    setBusy(true)
    const result = await saveVersionCopy(file, chosen.id, uniqueName(file.parent, copyName(file.name, chosen.at)))
    setBusy(false)
    if (!result.ok) return setProblem(result.error)
    onCopied?.(result.file)
    setProblem(`Saved a copy: ${result.file.name}`)
  }

  const isImage = file.type === "image"
  return (
    <Dialog
      title={`${file.name}: Previous Versions`}
      okLabel={busy ? "Working..." : "Restore"}
      okDisabled={!chosen || busy}
      onOk={restore}
      noLabel="Save a Copy"
      onNo={chosen ? copy : undefined}
      cancelLabel="Close"
      onCancel={onClose}
    >
      <div className="pvBox" data-previous-versions>
        {list === null && <p className="dialogText">Looking for earlier versions...</p>}
        {list?.length === 0 && (
          <p className="dialogText">
            There are no previous versions of this file yet. Each time you save it, what it held before is kept here, on this device only, for 7 days (the last 10 saves).
          </p>
        )}
        {!!list?.length && (
          <>
            <ul className="pvList sunken-panel" role="listbox" aria-label="Versions">
              {list.map((v) => (
                <li key={v.id} role="option" aria-selected={v.id === pick} className={v.id === pick ? "is-on" : ""} tabIndex={0} onClick={() => setPick(v.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setPick(v.id))}>
                  <span>{whenLabel(v.at)}</span>
                  <span className="pvSize">{formatSize(v.size)}</span>
                </li>
              ))}
            </ul>
            <div className="pvPreview sunken-panel" aria-label="Preview" data-selectable>
              {preview.id !== pick || preview.text === null ? (
                <span className="pvNote">{preview.id === pick ? "That version couldn't be read." : "Loading..."}</span>
              ) : isImage ? (
                <img src={preview.text} alt="This version" draggable="false" />
              ) : (
                <pre>{previewText(preview.text, file.type) || "(empty)"}</pre>
              )}
            </div>
            <p className="pvHint">Restore puts this version back; what the file holds now is kept as a version too.</p>
          </>
        )}
        {problem && (
          <p className="pvProblem" role="status">
            {problem}
          </p>
        )}
      </div>
    </Dialog>
  )
}

export default PreviousVersions
