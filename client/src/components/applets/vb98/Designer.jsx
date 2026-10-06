import React, { Suspense, useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import Combo from "../../shared/select/Combo"
import { helpItem } from "../../../utils/help"
import { fs, readContent, uniqueName, writeAndSave } from "../../../utils/fs"
import { launch } from "../../../utils/programs"
import { useAim } from "../aim/AimContext"
import { useHangout } from "../../../utils/hangout"
import { vbForget, vbMine, vbOnline, vbShare } from "../../../utils/vbapps"
import { compile } from "./vblang"
import { CONTROL_TYPES, FORM_PROPS, TOOLBOX, codeObjects, newControl, procStub, propsFor, validName } from "./controls"
import { blankProject, fileNameFor, MAX_PICTURE, serializeProject, validateProject } from "./vbfile"
import { TEMPLATES } from "./templates"

const BlocksEditor = React.lazy(() => import("./BlocksEditor"))

const DRAFT_KEY = "98ish.vb98.draft"
const GRID = 4
const snap = (v) => Math.round(v / GRID) * GRID
const loadDraft = () => {
  try {
    const v = validateProject(localStorage.getItem(DRAFT_KEY) || "")
    return v.ok ? v.project : null
  } catch {
    return null
  }
}
const saveDraft = (p) => {
  try {
    localStorage.setItem(DRAFT_KEY, serializeProject(p))
  } catch {
    // full or blocked: the draft just isn't kept
  }
}

// every .vb98 file on the drive (File > Open)
const findPrograms = () => {
  const out = []
  const walk = (dir, depth) => {
    if (depth > 6 || out.length > 200) return
    for (const item of dir.content || []) {
      if (item.isDirectory) walk(item, depth + 1)
      else if (item.type === "vbapp") out.push(item)
    }
  }
  const c = fs.resolve("C:")
  if (c) walk(c, 0)
  return out
}

// a control as the designer draws it (close to how it looks when it runs)
const Preview = ({ c }) => {
  const style = { color: c.foreColor, fontSize: c.fontSize ? Math.min(48, c.fontSize) : undefined, fontWeight: c.fontBold ? "bold" : undefined }
  const pic = (v) => (/^data:image\//.test(v || "") ? <img src={v} alt="" draggable={false} /> : <span className="vbEmoji" style={{ fontSize: Math.max(10, Math.min(c.width, c.height) * 0.75) }}>{v}</span>)
  switch (c.type) {
    case "Label":
      return <div className="vbPv vbPvLabel" style={{ ...style, background: c.backColor, textAlign: c.alignment }}>{c.caption}</div>
    case "CommandButton":
      return <div className="vbPv vbPvButton" style={{ ...style, background: c.backColor }}>{c.caption}</div>
    case "TextBox":
      return <div className="vbPv vbPvText" style={{ ...style, background: c.backColor }}>{c.text}</div>
    case "CheckBox":
    case "OptionButton":
      return (
        <div className="vbPv vbPvCheck" style={style}>
          <span className={`vbPvBox${c.type === "OptionButton" ? " round" : ""}${c.value ? " on" : ""}`} />
          {c.caption}
        </div>
      )
    case "ListBox":
      return (
        <div className="vbPv vbPvList" style={style}>
          {(c.list || []).slice(0, 20).map((x, i) => (
            <div key={i}>{x}</div>
          ))}
        </div>
      )
    case "ComboBox":
      return (
        <div className="vbPv vbPvCombo" style={style}>
          <span>{c.text}</span>
          <i />
        </div>
      )
    case "PictureBox":
      return <div className="vbPv vbPvPic" style={{ background: c.backColor }}>{pic(c.picture)}</div>
    case "Sprite":
      return <div className="vbPv vbPvPic">{pic(c.costume)}</div>
    case "Shape":
      return <div className="vbPv" style={{ background: c.fillColor, border: `1px solid ${c.borderColor}`, borderRadius: c.shape === "oval" ? "50%" : c.shape === "rounded" ? 12 : 0 }} />
    default:
      return (
        <div className="vbPv vbPvHidden" title={`${c.type} (not seen while the program runs)`}>
          {CONTROL_TYPES[c.type]?.icon}
        </div>
      )
  }
}

// a picture from the device, shrunk until it fits a program (data URL, under MAX_PICTURE)
const pictureFromFile = (file) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let side = 256
      for (;;) {
        const k = Math.min(1, side / Math.max(img.width, img.height))
        const canvas = document.createElement("canvas")
        canvas.width = Math.max(1, Math.round(img.width * k))
        canvas.height = Math.max(1, Math.round(img.height * k))
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height)
        const png = canvas.toDataURL("image/png")
        const data = png.length <= MAX_PICTURE ? png : canvas.toDataURL("image/jpeg", 0.8)
        if (data.length <= MAX_PICTURE || side <= 48) return data.length <= MAX_PICTURE ? resolve(data) : reject(new Error("That picture is too big."))
        side = Math.round(side * 0.7)
      }
    }
    img.onerror = () => reject(new Error("That isn't a picture this device can read."))
    img.src = url
  })

const Designer = ({ handoff, mobile, onTitle, onClose, dispatch }) => {
  const aim = useAim()
  const hangout = useHangout()
  const [project, setProject] = useState(() => {
    if (handoff?.edit) {
      const v = validateProject(handoff.edit)
      if (v.ok) return v.project
    }
    if (handoff?.template) {
      const t = TEMPLATES.find((x) => x.id === handoff.template)
      if (t) return t.make()
    }
    return loadDraft() || blankProject()
  })
  const [path, setPath] = useState(null) // the .vb98 file it was opened from / saved to
  const [dirty, setDirty] = useState(false)
  const [sel, setSel] = useState("Form")
  const [tab, setTab] = useState("form") // form | code | blocks | props (phone)
  const [dialog, setDialog] = useState(null)
  const [codeError, setCodeError] = useState(null)
  const codeRef = useRef(null)
  const formRef = useRef(null)
  const [formScale, setFormScale] = useState(1)

  // a file to edit (File > Open, or Edit on a .vb98)
  useEffect(() => {
    if (!handoff?.open) return
    ;(async () => {
      const file = fs.resolve(handoff.open)
      const v = file ? validateProject(await readContent(file)) : { ok: false, error: "That file isn't there any more." }
      if (!v.ok) return setDialog({ kind: "alert", text: v.error })
      setProject(v.project)
      setPath(handoff.open)
      setDirty(false)
    })()
  }, [handoff?.open])

  useEffect(() => {
    onTitle?.(`${project.name}${dirty ? "*" : ""} - Visual Basic 98`)
  }, [project.name, dirty])

  // the unsaved work is kept on this device (it's there next time Visual Basic 98 opens)
  useEffect(() => {
    const id = setTimeout(() => saveDraft(project), 600)
    return () => clearTimeout(id)
  }, [project])

  // the code is checked as you type
  useEffect(() => {
    const id = setTimeout(() => {
      const r = compile(project.code, { controls: project.controls.map((c) => c.name) })
      setCodeError(r.ok ? null : r.error)
    }, 350)
    return () => clearTimeout(id)
  }, [project.code, project.controls])

  // a line to show (a compile error from Run)
  useEffect(() => {
    if (handoff?.line) setTimeout(() => goToLine(handoff.line), 200)
  }, [handoff?.line])

  // the form fits the space (phones)
  useEffect(() => {
    const el = formRef.current
    if (!el) return
    const fit = () => setFormScale(Math.max(0.35, Math.min(1, (el.clientWidth - 24) / (project.form.width + 8))))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [project.form.width, tab])

  const change = (fn) => {
    setProject((p) => {
      const next = fn(structuredClone(p))
      return next || p
    })
    setDirty(true)
  }
  const selected = project.controls.find((c) => c.name === sel) || null

  // ---- controls ----
  const addControl = (type, at) => {
    change((p) => {
      // a tapped tool lands under the others (not on top of the last one), while it fits
      if (!at) {
        const visible = p.controls.filter((x) => !CONTROL_TYPES[x.type]?.hidden)
        const bottom = visible.reduce((m, x) => Math.max(m, x.top + x.height), 0)
        const [, h] = CONTROL_TYPES[type].size
        if (CONTROL_TYPES[type].hidden) at = { left: p.form.width - 40, top: 8 + p.controls.filter((x) => CONTROL_TYPES[x.type]?.hidden).length * 36 }
        else if (bottom + 8 + h <= p.form.height) at = { left: 16, top: visible.length ? bottom + 8 : 16 }
      }
      const c = newControl(type, p.controls, at)
      c.left = Math.max(0, Math.min(p.form.width - 8, c.left))
      c.top = Math.max(0, Math.min(p.form.height - 8, c.top))
      p.controls.push(c)
      setTimeout(() => setSel(c.name))
      return p
    })
  }
  const removeSelected = () => {
    if (!selected) return
    change((p) => {
      p.controls = p.controls.filter((c) => c.name !== selected.name)
      return p
    })
    setSel("Form")
  }
  const setProp = (name, prop, value) => {
    change((p) => {
      if (name === "Form") {
        p.form[prop] = value
        return p
      }
      const c = p.controls.find((x) => x.name === name)
      if (!c) return null
      if (prop === "name") {
        if (!validName(value)) return setDialog({ kind: "alert", text: "A name starts with a letter and has only letters, numbers and _ (up to 40)." }), null
        if (p.controls.some((x) => x !== c && x.name.toLowerCase() === value.toLowerCase())) return setDialog({ kind: "alert", text: `There's already a control called ${value}.` }), null
        // rename its event procedures and uses in the code, as Visual Basic does for events
        const old = c.name
        p.code = p.code.replace(new RegExp(`\\b${old}(?=_[A-Za-z]+\\s*\\()`, "g"), value).replace(new RegExp(`\\b${old}(?=\\.)`, "g"), value)
        c.name = value
        setTimeout(() => setSel(value))
        return p
      }
      c[prop] = value
      return p
    })
  }

  // ---- files ----
  const save = async (asName) => {
    const name = asName || project.name
    const proj = { ...project, name }
    const v = validateProject(proj)
    if (!v.ok) return setDialog({ kind: "alert", text: v.error })
    let file = path && !asName ? fs.resolve(path) : null
    const created = !file
    if (!file) {
      const dir = fs.resolve("C:/Documents") || fs.resolve("C:")
      try {
        file = fs.createFileIn(dir, uniqueName(dir, fileNameFor(proj)), "vbapp", "")
      } catch (error) {
        return setDialog({ kind: "alert", text: error.message })
      }
    }
    if (!(await writeAndSave(file, serializeProject(v.project), { created }))) return setDialog({ kind: "alert", text: "There isn't enough room on the drive to save it." })
    setProject(v.project)
    setPath(fs.partsOf(file).join("/"))
    setDirty(false)
    return file
  }
  const makeDesktopIcon = async () => {
    const v = validateProject(project)
    if (!v.ok) return setDialog({ kind: "alert", text: v.error })
    const dir = fs.resolve("C:/Desktop")
    if (!dir) return
    const file = fs.createFileIn(dir, uniqueName(dir, fileNameFor(project)), "vbapp", "")
    if (!(await writeAndSave(file, serializeProject(v.project), { created: true }))) return setDialog({ kind: "alert", text: "There isn't enough room on the drive." })
    setDialog({ kind: "alert", text: `${file.name} is on the desktop. Double-click it to run your program.` })
  }
  const openFile = async (item) => {
    const v = validateProject(await readContent(item))
    if (!v.ok) return setDialog({ kind: "alert", text: v.error })
    setProject(v.project)
    setPath(fs.partsOf(item).join("/"))
    setDirty(false)
    setSel("Form")
    setDialog(null)
  }
  const newFrom = (p) => {
    setProject(p)
    setPath(null)
    setDirty(false)
    setSel("Form")
    setTab("form")
    setDialog(null)
  }

  // ---- run ----
  const run = () => {
    const r = compile(project.code, { controls: project.controls.map((c) => c.name) })
    if (!r.ok) {
      setTab("code")
      setTimeout(() => goToLine(r.error.line), 50)
      return setDialog({ kind: "alert", title: "Compile error", text: `Line ${r.error.line}: ${r.error.message}` })
    }
    dispatch?.({ type: "open_window", payload: launch("Visual Basic 98", { name: project.form.caption || project.name, handoff: { id: Date.now(), project }, width: Math.min(900, project.form.width + 40), height: Math.min(900, project.form.height + 90) }) })
  }

  // ---- code window ----
  const goToLine = (line) => {
    const ta = codeRef.current
    if (!ta) return
    const lines = ta.value.split("\n")
    const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0)
    ta.focus({ preventScroll: true })
    ta.setSelectionRange(start, start + (lines[line - 1] || "").length)
    ta.scrollTop = Math.max(0, (line - 4) * 15)
  }
  const objects = useMemo(() => codeObjects(project.controls), [project.controls])
  const [codeObj, setCodeObj] = useState("Form")
  const procs = objects.find((o) => o.object === codeObj)?.events || []
  const goToProc = (object, event) => {
    const re = new RegExp(`^\\s*(Private |Public )?Sub\\s+${object}_${event}\\s*\\(`, "im")
    let code = project.code
    let m = re.exec(code)
    if (!m) {
      code = `${code.trimEnd()}${code.trim() ? "\n\n" : ""}${procStub(object, event)}\n`
      change((p) => ((p.code = code), p))
      m = re.exec(code)
    }
    // the caret goes to the first line inside the Sub
    setTimeout(() => {
      const ta = codeRef.current
      if (!ta) return
      const at = code.indexOf("\n", m.index) + 1
      const line = code.slice(0, at).split("\n").length
      ta.focus({ preventScroll: true })
      ta.setSelectionRange(at + 2, at + 2)
      ta.scrollTop = Math.max(0, (line - 3) * 15)
    }, 30)
  }

  const menus = [
    {
      label: "File",
      items: [
        { label: "New Project", onClick: () => newFrom(blankProject()) },
        { label: "New from Template...", onClick: () => setDialog({ kind: "templates" }) },
        { label: "Open...", onClick: () => setDialog({ kind: "open", files: findPrograms() }) },
        "-",
        { label: "Save", onClick: () => save() },
        { label: "Save As...", onClick: () => setDialog({ kind: "saveas", name: project.name }) },
        { label: "Make Desktop Icon", onClick: makeDesktopIcon },
        "-",
        { label: "Send in Messenger...", onClick: () => setDialog({ kind: "send" }) },
        { label: "Shared with Me...", onClick: () => openShared() },
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Delete Control", disabled: !selected, onClick: removeSelected },
        { label: "Select Form", onClick: () => setSel("Form") },
      ],
    },
    {
      label: "Run",
      items: [
        { label: "Start (F5)", onClick: run },
        { label: "Check Code", onClick: () => setDialog({ kind: "alert", title: "Check Code", text: codeError ? `Line ${codeError.line}: ${codeError.message}` : "No problems found." }) },
      ],
    },
    { label: "Help", items: [helpItem("visual-basic-98"), "-", { label: "About Visual Basic 98...", onClick: () => setDialog({ kind: "about" }) }] },
  ]

  const openShared = async () => {
    setDialog({ kind: "shared", list: null })
    const r = await vbMine()
    setDialog({ kind: "shared", list: r.ok ? r.list : [], error: r.ok ? "" : r.error })
  }

  // F5 runs, Delete removes the selected control, arrows nudge it
  const onKeyDown = (e) => {
    if (e.key === "F5") {
      e.preventDefault()
      return run()
    }
    const t = e.target
    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable || tab !== "form" || !selected) return
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault()
      removeSelected()
    }
    const d = { ArrowLeft: [-GRID, 0], ArrowRight: [GRID, 0], ArrowUp: [0, -GRID], ArrowDown: [0, GRID] }[e.key]
    if (d) {
      e.preventDefault()
      setProp(selected.name, "left", selected.left + d[0])
      setProp(selected.name, "top", selected.top + d[1])
    }
  }

  // ---- pieces ----
  const toolbox = (
    <div className={`vbToolbox${mobile ? " is-row" : ""}`} role="toolbar" aria-label="Toolbox">
      {TOOLBOX.map((type) => (
        <ToolButton key={type} type={type} formRef={formRef} scale={formScale} form={project.form} onAdd={addControl} />
      ))}
    </div>
  )

  const formDesigner = (
    <div className="vbFormArea" ref={formRef} onPointerDown={(e) => e.target === e.currentTarget && setSel("Form")}>
      <div className="vbFormFrame window" style={{ width: (project.form.width + 6) * formScale, transformOrigin: "0 0" }}>
        <div className="title-bar" onPointerDown={() => setSel("Form")}>
          <div className="title-bar-text">{project.form.caption || "Form1"}</div>
        </div>
        <FormSurface project={project} sel={sel} scale={formScale} onSelect={setSel} onChange={change} />
      </div>
    </div>
  )

  const properties = (
    <div className="vbProps" data-vb-props>
      <Combo value={sel} options={[["Form", `Form (${project.form.caption || "Form1"})`], ...project.controls.map((c) => [c.name, `${c.name} (${c.type})`])]} onChange={setSel} ariaLabel="Object" name="vbObject" />
      <div className="vbPropRows">
        {(sel === "Form" ? FORM_PROPS : propsFor(selected?.type)).map(([prop, kind, choices]) => (
          <PropRow key={`${sel}.${prop}`} name={prop} kind={kind} choices={choices} value={sel === "Form" ? project.form[prop] : selected?.[prop]} onChange={(v) => setProp(sel, prop, v)} onError={(text) => setDialog({ kind: "alert", text })} />
        ))}
      </div>
      {selected && (
        <button type="button" className="vbDelete" onClick={removeSelected}>
          Delete {selected.name}
        </button>
      )}
    </div>
  )

  const codeWindow =
    project.mode === "blocks" ? (
      <div className="vbCode">
        <p className="vbNote">
          This program is made of blocks. Here's the code they make.{" "}
          <button type="button" onClick={() => change((p) => ((p.mode = "code"), p))}>
            Switch to Typing Code
          </button>
        </p>
        <textarea className="vbCodeText" readOnly value={project.code} spellCheck={false} aria-label="Generated code" />
      </div>
    ) : (
      <div className="vbCode">
        <div className="vbCodeBar">
          <Combo value={codeObj} options={objects.map((o) => [o.object, o.object])} onChange={setCodeObj} ariaLabel="Object" name="vbCodeObject" />
          <Combo value="" options={[["", "(add an event)"], ...procs.map((ev) => [ev, ev])]} onChange={(ev) => ev && goToProc(codeObj, ev)} ariaLabel="Procedure" name="vbCodeProc" />
        </div>
        <textarea
          ref={codeRef}
          className="vbCodeText"
          value={project.code}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
          aria-label="Code"
          data-vb-code
          onChange={(e) => {
            const v = e.target.value
            change((p) => ((p.code = v), p))
          }}
          onKeyDown={(e) => {
            if (e.key === "Tab") {
              e.preventDefault()
              const ta = e.target
              const s = ta.selectionStart
              const v = `${ta.value.slice(0, s)}  ${ta.value.slice(ta.selectionEnd)}`
              change((p) => ((p.code = v), p))
              setTimeout(() => ta.setSelectionRange(s + 2, s + 2))
            }
          }}
        />
        <div className={`vbCodeStatus${codeError ? " bad" : ""}`} data-code-status>
          {codeError ? (
            <button type="button" className="vbLink" onClick={() => goToLine(codeError.line)}>
              Line {codeError.line}: {codeError.message}
            </button>
          ) : (
            "No problems found."
          )}
        </div>
      </div>
    )

  const blocksWindow = (
    <Suspense fallback={<div className="vbCenter">Loading blocks...</div>}>
      {project.mode !== "blocks" && project.code.trim() ? (
        <div className="vbCenter vbBlocksAsk">
          <p>This program is typed code. Building with blocks starts the code over from your blocks.</p>
          <button type="button" onClick={() => change((p) => ((p.mode = "blocks"), (p.blocks = null), p))}>
            Start Over with Blocks
          </button>
        </div>
      ) : (
        <BlocksEditor
          key={path || "new"}
          controls={project.controls}
          state={project.blocks}
          onChange={(blocks, code) =>
            change((p) => {
              p.blocks = blocks
              p.code = code
              p.mode = "blocks"
              return p
            })
          }
        />
      )}
    </Suspense>
  )

  const tabs = mobile ? ["form", "code", "blocks", "props"] : ["form", "code", "blocks"]
  const tabLabel = { form: "Form", code: "Code", blocks: "Blocks", props: "Properties" }

  return (
    <div className={`vbRoot${mobile ? " is-mobile" : ""}`} onKeyDown={onKeyDown} tabIndex={-1}>
      <MenuBar menus={menus} />
      <div className="vbToolbar">
        <button type="button" className="vbRun" onClick={run} data-vb-run title="Start (F5)">
          ▶ Run
        </button>
        <button type="button" onClick={() => setDialog({ kind: "templates" })} data-vb-templates>
          Templates...
        </button>
        <button type="button" onClick={() => setDialog({ kind: "send" })} data-vb-send>
          Send...
        </button>
        <span className="vbProjName" title={path || "Not saved yet"}>
          {project.name}
          {dirty ? "*" : ""}
        </span>
      </div>
      <menu role="tablist" className="vbTabs">
        {tabs.map((t) => (
          <li key={t} role="tab" aria-selected={tab === t}>
            <a
              href="#"
              data-vb-tab={t}
              onClick={(e) => {
                e.preventDefault()
                setTab(t)
              }}
            >
              {tabLabel[t]}
              {t === "code" && codeError ? " (!)" : ""}
            </a>
          </li>
        ))}
      </menu>
      <div className={`vbBody window`} role="tabpanel">
        {tab === "form" && (
          <div className="vbFormTab">
            {toolbox}
            {formDesigner}
            {!mobile && properties}
          </div>
        )}
        {tab === "code" && codeWindow}
        {tab === "blocks" && blocksWindow}
        {tab === "props" && properties}
      </div>
      {dialog?.kind === "alert" && (
        <Dialog title={dialog.title || "Visual Basic 98"} onOk={() => setDialog(null)} onCancel={() => setDialog(null)}>
          <p data-selectable>{dialog.text}</p>
        </Dialog>
      )}
      {dialog?.kind === "about" && (
        <Dialog title="About Visual Basic 98" onOk={() => setDialog(null)} onCancel={() => setDialog(null)}>
          <p>
            <b>Visual Basic 98</b>: draw a form, write a little code (or snap blocks together), and run it. Send it to friends in 98 Messenger and it runs on their 98ish too, with Shared values you all see change.
          </p>
          <p>Blocks by Blockly (Apache License 2.0).</p>
        </Dialog>
      )}
      {dialog?.kind === "saveas" && <SaveAsDialog name={dialog.name} onCancel={() => setDialog(null)} onSave={async (n) => (await save(n)) && setDialog(null)} />}
      {dialog?.kind === "templates" && <TemplatesDialog dirty={dirty} onCancel={() => setDialog(null)} onPick={(t) => newFrom(t.make())} />}
      {dialog?.kind === "open" && <OpenDialog files={dialog.files} onCancel={() => setDialog(null)} onOpen={openFile} />}
      {dialog?.kind === "send" && <SendDialog aim={aim} inHangout={!!hangout?.id} project={project} codeError={codeError} dispatch={dispatch} onClose={() => setDialog(null)} />}
      {dialog?.kind === "shared" && (
        <SharedDialog
          list={dialog.list}
          error={dialog.error}
          onCancel={() => setDialog(null)}
          onOpen={(id) => {
            dispatch?.({ type: "open_window", payload: launch("Visual Basic 98", { handoff: { id: Date.now(), vbapp: id } }) })
            setDialog(null)
          }}
          onRemove={async (id) => {
            await vbForget(id)
            openShared()
          }}
        />
      )}
    </div>
  )
}

// a Toolbox button: tap adds the control; drag it onto the form to place it
const ToolButton = ({ type, formRef, scale, form, onAdd }) => {
  const def = CONTROL_TYPES[type]
  const drag = useRef(null)
  return (
    <button
      type="button"
      className="vbTool"
      title={def.title}
      aria-label={def.title}
      data-tool={type}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY, moved: false }
        e.currentTarget.setPointerCapture?.(e.pointerId)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) d.moved = true
      }}
      onPointerUp={(e) => {
        const d = drag.current
        drag.current = null
        if (!d) return
        if (!d.moved) return onAdd(type)
        const surface = formRef.current?.querySelector(".vbSurface")
        const r = surface?.getBoundingClientRect()
        if (r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          const [w, h] = def.size
          onAdd(type, { left: snap((e.clientX - r.left) / scale - w / 2), top: snap((e.clientY - r.top) / scale - h / 2) })
        }
      }}
      onPointerCancel={() => (drag.current = null)}
    >
      <span className="vbToolIcon">{def.icon}</span>
    </button>
  )
}

// the form being designed: drag controls to move them, the corner handle to size them
const FormSurface = ({ project, sel, scale, onSelect, onChange }) => {
  const drag = useRef(null)
  const start = (e, c, kind) => {
    e.stopPropagation()
    e.preventDefault()
    onSelect(c ? c.name : "Form")
    drag.current = { kind, name: c?.name, x: e.clientX, y: e.clientY, orig: c ? { left: c.left, top: c.top, width: c.width, height: c.height } : { width: project.form.width, height: project.form.height } }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const move = (e) => {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.x) / scale
    const dy = (e.clientY - d.y) / scale
    onChange((p) => {
      if (d.kind === "form") {
        p.form.width = Math.max(120, Math.min(1200, snap(d.orig.width + dx)))
        p.form.height = Math.max(80, Math.min(1200, snap(d.orig.height + dy)))
        return p
      }
      const c = p.controls.find((x) => x.name === d.name)
      if (!c) return null
      if (d.kind === "move") {
        c.left = snap(d.orig.left + dx)
        c.top = snap(d.orig.top + dy)
      } else {
        c.width = Math.max(8, snap(d.orig.width + dx))
        c.height = Math.max(8, snap(d.orig.height + dy))
      }
      return p
    })
  }
  const end = () => (drag.current = null)
  return (
    <div className="vbSurfaceWrap" style={{ width: project.form.width * scale, height: project.form.height * scale }}>
      <div
        className="vbSurface"
        style={{ width: project.form.width, height: project.form.height, background: project.form.backColor, transform: `scale(${scale})` }}
        onPointerDown={(e) => e.target === e.currentTarget && onSelect("Form")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        data-touch-surface
      >
        {project.controls.map((c) => (
          <div
            key={c.name}
            className={`vbCtl${sel === c.name ? " is-sel" : ""}${c.visible === false ? " is-hidden" : ""}`}
            style={{ left: c.left, top: c.top, width: CONTROL_TYPES[c.type]?.hidden ? 32 : c.width, height: CONTROL_TYPES[c.type]?.hidden ? 32 : c.height }}
            onPointerDown={(e) => start(e, c, "move")}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            data-ctl={c.name}
          >
            <Preview c={c} />
            {sel === c.name && !CONTROL_TYPES[c.type]?.hidden && <span className="vbHandle" onPointerDown={(e) => start(e, c, "size")} onPointerMove={move} onPointerUp={end} data-handle={c.name} />}
          </div>
        ))}
        <span className="vbHandle vbFormHandle" onPointerDown={(e) => start(e, null, "form")} onPointerMove={move} onPointerUp={end} title="Size the form" />
      </div>
    </div>
  )
}

// one row of the Properties window
const PropRow = ({ name, kind, choices, value, onChange, onError }) => {
  const label = name[0].toUpperCase() + name.slice(1)
  const id = `vbp-${name}`
  const [draft, setDraft] = useState(null) // text being typed (applied on blur / Enter)
  const commit = () => {
    if (draft === null) return
    if (kind === "number") {
      const n = Number(draft)
      if (Number.isFinite(n)) onChange(Math.round(n))
    } else if (kind === "list") onChange(draft.split("\n").filter((x, i, a) => x !== "" || i < a.length - 1))
    else onChange(draft)
    setDraft(null)
  }
  const text = (multi) => {
    const shown = draft ?? (kind === "list" ? (value || []).join("\n") : String(value ?? ""))
    const props = { id, value: shown, onChange: (e) => setDraft(e.target.value), onBlur: commit, "data-prop": name }
    return multi ? <textarea rows={kind === "list" ? 4 : 3} {...props} /> : <input type={kind === "number" ? "number" : "text"} {...props} onKeyDown={(e) => e.key === "Enter" && commit()} />
  }
  let editor
  switch (kind) {
    case "bool":
      editor = (
        <>
          <input id={id} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} data-prop={name} />
          <label htmlFor={id}>{value ? "True" : "False"}</label>
        </>
      )
      break
    case "choice":
      editor = <Combo value={value} options={choices.map((c) => [c, c])} onChange={onChange} ariaLabel={label} name={`prop-${name}`} />
      break
    case "color":
      editor = (
        <span className="vbColor">
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(value || "") ? value : "#ffffff"} onChange={(e) => onChange(e.target.value)} aria-label={`${label} color`} />
          {text(false)}
        </span>
      )
      break
    case "picture":
      editor = (
        <span className="vbColor">
          {text(false)}
          <label className="vbFileBtn">
            Picture...
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0]
                e.target.value = ""
                if (!f) return
                try {
                  onChange(await pictureFromFile(f))
                } catch (error) {
                  onError(error.message)
                }
              }}
            />
          </label>
        </span>
      )
      break
    case "longtext":
    case "list":
      editor = text(true)
      break
    default:
      editor = text(false)
  }
  return (
    <div className={`vbPropRow${kind === "list" || kind === "longtext" ? " is-tall" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <div className="vbPropEdit">{editor}</div>
    </div>
  )
}

const SaveAsDialog = ({ name, onSave, onCancel }) => {
  const [value, setValue] = useState(name)
  return (
    <Dialog title="Save Project As" okLabel="Save" okDisabled={!value.trim()} onOk={() => onSave(value.trim())} onCancel={onCancel}>
      <label className="vbField">
        Name
        <input value={value} onChange={(e) => setValue(e.target.value)} maxLength={50} autoFocus data-saveas />
      </label>
      <p className="vbNote">It's saved in C:\Documents as a .vb98 file.</p>
    </Dialog>
  )
}

const TemplatesDialog = ({ dirty, onPick, onCancel }) => {
  const [pick, setPick] = useState(TEMPLATES[0].id)
  return (
    <Dialog title="New from Template" okLabel="Open" onOk={() => onPick(TEMPLATES.find((t) => t.id === pick))} onCancel={onCancel}>
      <div className="vbPickList" role="listbox" aria-label="Templates">
        {TEMPLATES.map((t) => (
          <button key={t.id} type="button" role="option" aria-selected={pick === t.id} className={pick === t.id ? "is-on" : ""} onClick={() => setPick(t.id)} onDoubleClick={() => onPick(t)} data-template={t.id}>
            <b>{t.title}</b>
            {t.shared && <span className="vbBadge">Shared</span>}
            <small>{t.about}</small>
          </button>
        ))}
      </div>
      {dirty && <p className="vbNote">Your program's changes are kept as a draft only. Save first if you want a file.</p>}
    </Dialog>
  )
}

const OpenDialog = ({ files, onOpen, onCancel }) => {
  const [pick, setPick] = useState(files[0] || null)
  return (
    <Dialog title="Open Project" okLabel="Open" okDisabled={!pick} onOk={() => onOpen(pick)} onCancel={onCancel}>
      {files.length ? (
        <div className="vbPickList" role="listbox" aria-label="Programs">
          {files.map((f) => (
            <button key={fs.partsOf(f).join("/")} type="button" role="option" aria-selected={pick === f} className={pick === f ? "is-on" : ""} onClick={() => setPick(f)} onDoubleClick={() => onOpen(f)}>
              <b>{f.name}</b>
            </button>
          ))}
        </div>
      ) : (
        <p>No saved programs yet. Use File &gt; Save to keep one.</p>
      )}
    </Dialog>
  )
}

// who to send it to: a buddy, a chat room you're in, or everyone in Come Over
const SendDialog = ({ aim, inHangout, project, codeError, dispatch, onClose }) => {
  const online = aim?.status === "online" && vbOnline()
  const buddies = useMemo(() => {
    const out = new Set()
    for (const g of aim?.me?.groups || []) for (const b of g.buddies || []) if (b.toLowerCase().replace(/\s+/g, "") !== "smarterchild") out.add(b)
    return [...out].sort((a, b) => a.localeCompare(b))
  }, [aim?.me?.groups])
  const rooms = Object.values(aim?.rooms || {}).map((r) => r.name)
  const options = [...(inHangout ? [["hangout:", "Everyone in Come Over"]] : []), ...buddies.map((b) => [`with:${b}`, b]), ...rooms.map((r) => [`room:${r}`, `Chat room: ${r}`])]
  const [to, setTo] = useState(options[0]?.[0] || "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const send = async () => {
    const [kind, ...rest] = to.split(":")
    const value = rest.join(":")
    setBusy(true)
    const r = await vbShare(project, kind === "with" ? { with: value } : kind === "room" ? { room: value } : { hangout: true })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    // you run it too (the same copy, so Shared values are shared)
    dispatch?.({ type: "open_window", payload: launch("Visual Basic 98", { name: project.form.caption || project.name, handoff: { id: Date.now(), vbapp: r.id } }) })
    onClose()
  }
  if (!online)
    return (
      <Dialog title="Send in Messenger" onOk={onClose} onCancel={onClose}>
        <p>Sign on to 98 Messenger to send your program to friends.</p>
      </Dialog>
    )
  if (codeError)
    return (
      <Dialog title="Send in Messenger" onOk={onClose} onCancel={onClose}>
        <p>Fix the code first (line {codeError.line}: {codeError.message}).</p>
      </Dialog>
    )
  return (
    <Dialog title="Send in Messenger" okLabel="Send" okDisabled={!to || busy} onOk={send} onCancel={onClose}>
      <p>
        Send <b>{project.form.caption || project.name}</b> to:
      </p>
      {options.length ? <Combo value={to} options={options} onChange={setTo} ariaLabel="Send to" name="vbSendTo" /> : <p>Add a buddy (or join a chat room) first.</p>}
      <p className="vbNote">It runs on their 98ish, safely boxed in. Shared values (votes, boards, scores) stay in step for everyone it's sent to.</p>
      {error && <p className="vbError">{error}</p>}
    </Dialog>
  )
}

const SharedDialog = ({ list, error, onOpen, onRemove, onCancel }) => (
  <Dialog title="Shared with Me" onOk={onCancel} onCancel={onCancel}>
    {list === null ? (
      <p>Looking...</p>
    ) : error ? (
      <p>{error}</p>
    ) : list.length ? (
      <div className="vbPickList">
        {list.map((r) => (
          <div key={r.id} className="vbSharedRow">
            <span>
              <b>{r.title}</b>
              <small>
                from {r.from} · with {r.people.join(", ")}
              </small>
            </span>
            <button type="button" onClick={() => onOpen(r.id)}>
              Open
            </button>
            <button type="button" onClick={() => onRemove(r.id)} title="Remove it from your list">
              Remove
            </button>
          </div>
        ))}
      </div>
    ) : (
      <p>Nothing yet. When a friend sends you a program in 98 Messenger it shows up here.</p>
    )}
  </Dialog>
)

export default Designer
