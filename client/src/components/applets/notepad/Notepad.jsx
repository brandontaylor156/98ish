import React, { useEffect, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import FileDialog from "./FileDialog"
import { fs } from "../../../utils/fs"
import { useFsVersion } from "../../../hooks/useFs"
import { trackUnsaved } from "../../../utils/unsaved"
import { now } from "../../../utils/clock"
import "./Notepad.css"

// Notepad, as in Windows 98: File / Edit / Search / Help, Word Wrap, Set Font, Time/Date
// (F5), Find (F3) and Replace, Open/Save As over the 98ish drive, the "save changes?"
// prompt (also when the window is closed), and the .LOG trick: a file that starts with
// .LOG gets the time and date added each time it's opened.

const PREFS_KEY = "98ish.notepad"
const FONTS = ["Courier New", "Lucida Console", "Arial", "Times New Roman", "Comic Sans MS", "Verdana"]
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24]
const DEFAULT_PREFS = { wrap: false, font: { family: "Courier New", size: 12, bold: false, italic: false } }

const loadPrefs = () => {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY))
    return { ...DEFAULT_PREFS, ...p, font: { ...DEFAULT_PREFS.font, ...p?.font } }
  } catch {
    return DEFAULT_PREFS
  }
}

const timeDate = () => {
  const d = now()
  return `${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} ${d.toLocaleDateString("en-US")}`
}

// still on the drive (not deleted, not in the Recycle Bin)?
const onDrive = (file) => !!file && fs.partsOf(file)[0] === "C:" && fs.resolve(fs.partsOf(file)) === file

const Notepad = ({ file: initialFile = null, onTitle, onClose, registerCloseGuard }) => {
  useFsVersion()
  const [file, setFile] = useState(initialFile)
  const [text, setText] = useState(() => {
    const t = initialFile?.textContent ?? ""
    return t.startsWith(".LOG") ? `${t}${t.endsWith("\n") ? "" : "\r\n"}${timeDate()}\r\n` : t
  })
  const [saved, setSaved] = useState(initialFile?.textContent ?? "")
  const [prefs, setPrefsState] = useState(loadPrefs)
  const [dialog, setDialog] = useState(null)
  const [find, setFind] = useState(null) // { mode: "find" | "replace", query, replace, matchCase, up }
  const lastFind = useRef({ query: "", matchCase: false, up: false })
  const areaRef = useRef(null)
  const afterSave = useRef(null) // what to do once a save finishes (New, Open, Exit)

  const dirty = text !== saved
  const name = file ? file.name : "Untitled"
  const textRef = useRef({ dirty, name })
  textRef.current = { dirty, name }

  useEffect(() => onTitle?.(`${name} - Notepad`), [name])

  useEffect(() => (dirty ? trackUnsaved("Notepad") : undefined), [dirty])

  // .LOG: put the cursor at the end, after the new time stamp
  useEffect(() => {
    const area = areaRef.current
    if (!area) return
    if (text.startsWith(".LOG")) {
      area.setSelectionRange(text.length, text.length)
      area.scrollTop = area.scrollHeight
    }
    area.focus({ preventScroll: true })
  }, [])

  // closing the window with unsaved changes asks first
  useEffect(() => {
    if (!registerCloseGuard) return
    return registerCloseGuard(() => {
      if (!textRef.current.dirty) return true
      afterSave.current = () => onClose?.()
      setDialog({ kind: "changed" })
      return false
    })
  }, [registerCloseGuard])

  const setPrefs = (patch) =>
    setPrefsState((current) => {
      const next = { ...current, ...patch, font: { ...current.font, ...patch.font } }
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next))
      } catch {
        // storage unavailable
      }
      return next
    })

  // ---- files ----

  const writeTo = (dir, fileName) => {
    try {
      let target = dir.getItem(fileName)
      if (target && target.isText) target.textContent = text
      else target = fs.createFileIn(dir, fileName, "text", text)
      setFile(target)
      setSaved(text)
      setDialog(null)
      const next = afterSave.current
      afterSave.current = null
      next?.()
    } catch (error) {
      setDialog({ kind: "alert", title: "Notepad", text: error.message })
    }
  }

  const save = () => {
    if (onDrive(file)) {
      file.textContent = text
      setSaved(text)
      const next = afterSave.current
      afterSave.current = null
      next?.()
      return
    }
    setDialog({ kind: "saveAs" })
  }

  // run `then` now, or after asking about unsaved changes
  const guard = (then) => {
    if (!dirty) return then()
    afterSave.current = then
    setDialog({ kind: "changed" })
  }

  const newFile = () =>
    guard(() => {
      setFile(null)
      setText("")
      setSaved("")
      setDialog(null)
    })

  const openFile = (target) => {
    const t = target.textContent
    const withLog = t.startsWith(".LOG") ? `${t}${t.endsWith("\n") ? "" : "\r\n"}${timeDate()}\r\n` : t
    setFile(target)
    setText(withLog)
    setSaved(t)
    setDialog(null)
    requestAnimationFrame(() => {
      const area = areaRef.current
      if (!area) return
      const at = withLog.startsWith(".LOG") ? withLog.length : 0
      area.setSelectionRange(at, at)
      area.focus({ preventScroll: true })
    })
  }

  // ---- editing ----

  const area = () => areaRef.current
  const insert = (value) => {
    const el = area()
    el.focus()
    const { selectionStart: a, selectionEnd: b } = el
    // execCommand keeps the native undo history; fall back to setting the value
    if (!document.execCommand?.("insertText", false, value)) {
      const next = text.slice(0, a) + value + text.slice(b)
      setText(next)
      requestAnimationFrame(() => el.setSelectionRange(a + value.length, a + value.length))
    }
  }
  const command = (name) => {
    area().focus()
    document.execCommand?.(name)
  }
  const paste = async () => {
    try {
      const clip = await navigator.clipboard.readText()
      insert(clip)
    } catch {
      setDialog({ kind: "alert", title: "Notepad", text: "Use Ctrl+V (or long-press and Paste) to paste here: this browser doesn't let menus read the clipboard." })
    }
  }

  // ---- find / replace ----

  const findNext = (opts = lastFind.current, { quiet = false } = {}) => {
    const { query, matchCase, up } = opts
    if (!query) return false
    lastFind.current = { query, matchCase, up }
    const el = area()
    const hay = matchCase ? text : text.toLowerCase()
    const needle = matchCase ? query : query.toLowerCase()
    const at = up ? hay.lastIndexOf(needle, el.selectionStart - 1) : hay.indexOf(needle, el.selectionEnd)
    if (at < 0 || (up && el.selectionStart === 0)) {
      if (!quiet) setDialog({ kind: "alert", title: "Notepad", text: `Cannot find "${query}"` })
      return false
    }
    el.focus({ preventScroll: true })
    el.setSelectionRange(at, at + query.length)
    // scroll the match into view
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 16
    const line = text.slice(0, at).split("\n").length - 1
    el.scrollTop = Math.max(0, line * lineHeight - el.clientHeight / 3)
    return true
  }

  const selectionMatches = (query, matchCase) => {
    const el = area()
    const sel = text.slice(el.selectionStart, el.selectionEnd)
    return matchCase ? sel === query : sel.toLowerCase() === query.toLowerCase()
  }

  const replaceOne = () => {
    const { query, replace = "", matchCase } = find
    if (!query) return
    if (selectionMatches(query, matchCase)) insert(replace)
    requestAnimationFrame(() => findNext({ query, matchCase, up: false }))
  }

  const replaceAll = () => {
    const { query, replace = "", matchCase } = find
    if (!query) return
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), matchCase ? "g" : "gi")
    const count = (text.match(pattern) || []).length
    if (!count) return setDialog({ kind: "alert", title: "Notepad", text: `Cannot find "${query}"` })
    const el = area()
    el.focus()
    el.setSelectionRange(0, text.length)
    const next = text.replace(pattern, () => replace)
    if (!document.execCommand?.("insertText", false, next)) setText(next)
  }

  const closeFind = () => {
    setFind(null)
    requestAnimationFrame(() => areaRef.current?.focus({ preventScroll: true }))
  }

  // ---- keys ----

  const onKeyDown = (e) => {
    const ctrl = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if (e.key === "F5") return e.preventDefault(), insert(timeDate())
    if (e.key === "F3") return e.preventDefault(), findNext()
    if (ctrl && key === "s") return e.preventDefault(), save()
    if (ctrl && key === "o") return e.preventDefault(), guard(() => setDialog({ kind: "open" }))
    if (ctrl && key === "n") return e.preventDefault(), newFile()
    if (ctrl && key === "f") return e.preventDefault(), setFind({ mode: "find", query: lastFind.current.query, matchCase: lastFind.current.matchCase, up: false })
    if (ctrl && key === "h") return e.preventDefault(), setFind({ mode: "replace", query: lastFind.current.query, replace: "", matchCase: lastFind.current.matchCase })
  }

  const menus = [
    {
      label: "File",
      items: [
        { label: "New Ctrl+N", onClick: newFile },
        { label: "Open... Ctrl+O", onClick: () => guard(() => setDialog({ kind: "open" })) },
        { label: "Save Ctrl+S", onClick: save },
        { label: "Save As...", onClick: () => setDialog({ kind: "saveAs" }) },
        "-",
        { label: "Exit", onClick: () => guard(() => onClose?.()) },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo Ctrl+Z", onClick: () => command("undo") },
        "-",
        { label: "Cut Ctrl+X", onClick: () => command("cut") },
        { label: "Copy Ctrl+C", onClick: () => command("copy") },
        { label: "Paste Ctrl+V", onClick: paste },
        { label: "Delete Del", onClick: () => command("delete") },
        "-",
        { label: "Select All", onClick: () => (area().focus(), area().select()) },
        { label: "Time/Date F5", onClick: () => insert(timeDate()) },
        "-",
        { label: "Word Wrap", checked: prefs.wrap, onClick: () => setPrefs({ wrap: !prefs.wrap }) },
        { label: "Set Font...", onClick: () => setDialog({ kind: "font", font: { ...prefs.font } }) },
      ],
    },
    {
      label: "Search",
      items: [
        { label: "Find... Ctrl+F", onClick: () => setFind({ mode: "find", query: lastFind.current.query, matchCase: lastFind.current.matchCase, up: false }) },
        { label: "Find Next F3", onClick: () => findNext() },
        { label: "Replace... Ctrl+H", onClick: () => setFind({ mode: "replace", query: lastFind.current.query, replace: "", matchCase: lastFind.current.matchCase }) },
      ],
    },
    {
      label: "Help",
      items: [{ label: "About Notepad", onClick: () => setDialog({ kind: "alert", title: "About Notepad", text: "Notepad for 98ish. Tip: start a file with .LOG and Notepad adds the time and date every time you open it." }) }],
    },
  ]

  const fontStyle = {
    fontFamily: `"${prefs.font.family}", monospace`,
    fontSize: `${prefs.font.size}pt`,
    fontWeight: prefs.font.bold ? "bold" : "normal",
    fontStyle: prefs.font.italic ? "italic" : "normal",
  }

  return (
    <div className="npRoot" onKeyDown={onKeyDown}>
      <MenuBar menus={menus} />
      <textarea
        ref={areaRef}
        className={prefs.wrap ? "npText" : "npText npText--nowrap"}
        style={fontStyle}
        value={text}
        wrap={prefs.wrap ? "soft" : "off"}
        spellCheck="false"
        autoCapitalize="off"
        autoCorrect="off"
        aria-label={`${name} - Notepad`}
        onChange={(e) => setText(e.target.value)}
      />

      {find && (
        <form
          className="window npFind"
          onSubmit={(e) => {
            e.preventDefault()
            findNext({ query: find.query, matchCase: find.matchCase, up: !!find.up })
          }}
          onKeyDown={(e) => e.key === "Escape" && closeFind()}
        >
          <div className="title-bar">
            <div className="title-bar-text">{find.mode === "find" ? "Find" : "Replace"}</div>
            <div className="title-bar-controls">
              <button type="button" aria-label="Close" onClick={closeFind} />
            </div>
          </div>
          <div className="window-body npFindBody">
            <div className="npFindFields">
              <label>
                Find what:
                <input autoFocus value={find.query} onChange={(e) => setFind({ ...find, query: e.target.value })} />
              </label>
              {find.mode === "replace" && (
                <label>
                  Replace with:
                  <input value={find.replace} onChange={(e) => setFind({ ...find, replace: e.target.value })} />
                </label>
              )}
              <div className="npFindOptions">
                <input id="np-case" type="checkbox" checked={find.matchCase} onChange={(e) => setFind({ ...find, matchCase: e.target.checked })} />
                <label htmlFor="np-case">Match case</label>
                {find.mode === "find" && (
                  <>
                    <input id="np-up" type="radio" name="np-dir" checked={!!find.up} onChange={() => setFind({ ...find, up: true })} />
                    <label htmlFor="np-up">Up</label>
                    <input id="np-down" type="radio" name="np-dir" checked={!find.up} onChange={() => setFind({ ...find, up: false })} />
                    <label htmlFor="np-down">Down</label>
                  </>
                )}
              </div>
            </div>
            <div className="npFindButtons">
              <button type="submit" disabled={!find.query}>
                Find Next
              </button>
              {find.mode === "replace" && (
                <>
                  <button type="button" disabled={!find.query} onClick={replaceOne}>
                    Replace
                  </button>
                  <button type="button" disabled={!find.query} onClick={replaceAll}>
                    Replace All
                  </button>
                </>
              )}
              <button type="button" onClick={closeFind}>
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      {dialog?.kind === "changed" && (
        <Dialog
          title="Notepad"
          sound="chord"
          okLabel="Yes"
          onOk={() => {
            setDialog(null)
            save()
          }}
          onNo={() => {
            setDialog(null)
            setSaved(text) // discard: nothing unsaved anymore
            const next = afterSave.current
            afterSave.current = null
            next?.()
          }}
          onCancel={() => {
            afterSave.current = null
            setDialog(null)
          }}
        >
          <p className="dialogText">The text in the {name} file has changed.</p>
          <p className="dialogText">Do you want to save the changes?</p>
        </Dialog>
      )}

      {dialog?.kind === "saveAs" && (
        <FileDialog
          mode="save"
          startDir={file && onDrive(file) ? file.parent : null}
          initialName={file ? file.name : "Untitled"}
          onPick={writeTo}
          onCancel={() => {
            afterSave.current = null
            setDialog(null)
          }}
        />
      )}

      {dialog?.kind === "open" && <FileDialog mode="open" startDir={file && onDrive(file) ? file.parent : null} onPick={openFile} onCancel={() => setDialog(null)} />}

      {dialog?.kind === "font" && (
        <Dialog
          title="Font"
          onOk={() => {
            setPrefs({ font: dialog.font })
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        >
          <div className="npFontGrid">
            <label>
              Font:
              <select value={dialog.font.family} onChange={(e) => setDialog({ ...dialog, font: { ...dialog.font, family: e.target.value } })}>
                {FONTS.map((f) => (
                  <option key={f} value={f} style={{ fontFamily: f }}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Font style:
              <select
                value={`${dialog.font.bold ? "b" : ""}${dialog.font.italic ? "i" : ""}`}
                onChange={(e) => setDialog({ ...dialog, font: { ...dialog.font, bold: e.target.value.includes("b"), italic: e.target.value.includes("i") } })}
              >
                <option value="">Regular</option>
                <option value="i">Italic</option>
                <option value="b">Bold</option>
                <option value="bi">Bold Italic</option>
              </select>
            </label>
            <label>
              Size:
              <select value={dialog.font.size} onChange={(e) => setDialog({ ...dialog, font: { ...dialog.font, size: Number(e.target.value) } })}>
                {SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="npSample">
            <legend>Sample</legend>
            <span style={{ fontFamily: dialog.font.family, fontSize: `${dialog.font.size}pt`, fontWeight: dialog.font.bold ? "bold" : "normal", fontStyle: dialog.font.italic ? "italic" : "normal" }}>AaBbYyZz</span>
          </fieldset>
        </Dialog>
      )}

      {dialog?.kind === "alert" && (
        <Dialog title={dialog.title} sound="ding" onOk={() => setDialog(null)}>
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}
    </div>
  )
}

export default Notepad
