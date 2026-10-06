import React, { Suspense, useEffect, useState } from "react"
import { fs, readContent } from "../../../utils/fs"
import { launch } from "../../../utils/programs"
import { validateProject } from "./vbfile"
import { vbMeName, vbOpen } from "../../../utils/vbapps"
import Runner from "./Runner"
import "./VB98.css"

const Designer = React.lazy(() => import("./Designer"))

// Visual Basic 98's window. What it shows comes from how it was opened (handoff):
//   { vbapp: id }        a program someone sent in 98 Messenger: run it, Shared with them
//   { run: path }        a .vb98 file double-clicked on the drive: run it
//   { project }          the designer's Run (F5): run this copy
//   { open: path }       edit a .vb98 file;  { edit: project } edit a copy
//   (nothing)            the designer, with your last unsaved work
const VB98 = ({ handoff, mobile, onTitle, onClose, dispatch }) => {
  const [mode, setMode] = useState(() => (handoff?.vbapp || handoff?.run || handoff?.project ? "loading" : "design"))
  const [project, setProject] = useState(handoff?.project || null)
  const [shared, setShared] = useState(null)
  const [error, setError] = useState("")
  const [runErrors, setRunErrors] = useState(0)

  useEffect(() => {
    let gone = false
    const done = (p, s = null) => {
      if (gone) return
      setProject(p)
      setShared(s)
      setMode("run")
      onTitle?.(p.form.caption || p.name || "Program")
    }
    const fail = (message) => !gone && (setError(message), setMode("error"))
    ;(async () => {
      if (handoff?.vbapp) {
        const res = await vbOpen(handoff.vbapp)
        if (!res?.ok) return fail(res?.error || "Couldn't open that program.")
        const v = validateProject(res.app)
        if (!v.ok) return fail(v.error)
        return done(v.project, { id: res.id, state: res.state || {}, people: res.people || [], me: res.me, owner: res.owner })
      }
      if (handoff?.run) {
        const file = fs.resolve(handoff.run)
        if (!file) return fail("That program file isn't there any more.")
        const v = validateProject(await readContent(file))
        if (!v.ok) return fail(v.error)
        return done(v.project)
      }
      if (handoff?.project) {
        const v = validateProject(handoff.project)
        return v.ok ? done(v.project) : fail(v.error)
      }
    })()
    return () => {
      gone = true
    }
  }, [handoff?.id])

  const editCopy = (line) =>
    dispatch?.({ type: "open_window", payload: launch("Visual Basic 98", { handoff: { id: Date.now(), edit: { ...project, name: `${project.name} (copy)` }, line } }) })

  if (mode === "loading") return <div className="vbCenter">Starting...</div>
  if (mode === "error")
    return (
      <div className="vbCenter vbRunError" data-run-error>
        <p data-selectable>{error}</p>
        <button type="button" onClick={onClose}>
          OK
        </button>
      </div>
    )
  if (mode === "run")
    return (
      <div className="vbRunner" data-vb-runner>
        <div className="vbRunBar">
          <button type="button" onClick={onClose} data-vb-end title="End the program">
            ■ End
          </button>
          {shared ? (
            <span className="vbRunWho" title={shared.people.join(", ")}>
              Shared with {shared.people.filter((p) => p !== shared.me).join(", ") || "you"}
            </span>
          ) : (
            <span className="vbRunWho">{project.name}</span>
          )}
          {runErrors > 0 && <span className="vbRunErrs">{runErrors} error{runErrors === 1 ? "" : "s"}</span>}
          <button type="button" onClick={() => editCopy()} data-vb-editcopy title="Open a copy in the designer">
            Edit a Copy
          </button>
        </div>
        <Runner project={project} shared={shared} me={shared?.me || vbMeName() || "You"} mobile={mobile} onEnd={onClose} onError={() => setRunErrors((n) => n + 1)} onEdit={editCopy} />
      </div>
    )
  return (
    <Suspense fallback={<div className="vbCenter">Loading Visual Basic 98...</div>}>
      <Designer handoff={handoff} mobile={mobile} onTitle={onTitle} onClose={onClose} dispatch={dispatch} />
    </Suspense>
  )
}

export default VB98
