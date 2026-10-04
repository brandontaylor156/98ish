import React, { useEffect, useState } from "react"
import { playSystemSound } from "../../utils/systemSounds"
import Dialog from "../shared/Dialog"
import { run } from "../applets/dos/commands"
import { openTarget } from "../../utils/openItem"

const KEY = "98ish.run"

// Start > Run...: a program name (TETRIS, WINMINE, COMMAND), a path (C:\Documents), a
// document, or a web address. Same rules as START in the MS-DOS Prompt.
const RunDialog = ({ dispatch, onDone, onCancel }) => {
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(KEY) || ""
    } catch {
      return ""
    }
  })
  const [error, setError] = useState(null)

  useEffect(() => {
    if (error) playSystemSound("chord")
  }, [error])

  const submit = () => {
    const value = text.trim()
    if (!value) return
    const result = run(`start "${value.replace(/"/g, "")}"`, { cwd: ["C:"], color: {} })
    if (!result.open.length) {
      setError(result.out[0] || `Cannot find the file '${value}'.`)
      return
    }
    try {
      localStorage.setItem(KEY, value)
    } catch {
      // fine
    }
    result.open.forEach((target) => openTarget(target, dispatch))
    onDone()
  }

  return (
    <div className="runLayer">
      <Dialog title="Run" okDisabled={!text.trim()} onOk={submit} onCancel={onCancel}>
        <div className="runBody">
          <img src="/assets/executable.png" alt="" />
          <p className="dialogText">Type the name of a program, folder, document, or Internet resource, and Windows will open it for you.</p>
        </div>
        <label htmlFor="run-open">Open:</label>
        <input id="run-open" type="text" value={text} onChange={(e) => (setText(e.target.value), setError(null))} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck="false" />
        {error && <p className="dialogText runError">{error}</p>}
      </Dialog>
    </div>
  )
}

export default RunDialog
