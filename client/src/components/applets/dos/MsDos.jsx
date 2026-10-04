import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import { run, promptFor, complete, VERSION } from "./commands"
import { fs } from "../../../utils/fs"
import "./MsDos.css"

const MAX_LINES = 600
const HISTORY_KEY = "98ish.dos.history"

const loadHistory = () => {
  try {
    const h = JSON.parse(localStorage.getItem(HISTORY_KEY))
    return Array.isArray(h) ? h.slice(-50) : []
  } catch {
    return []
  }
}

// MS-DOS Prompt over the 98ish drive. In a window it's a normal app; with fullScreen it's
// "Restart in MS-DOS mode" (type WIN or EXIT to go back to Windows).
const MsDos = ({ onClose, onOpen, fullScreen = false, onTitle }) => {
  const [shell] = useState(() => ({ cwd: ["C:"], color: { bg: "#000000", fg: "#c0c0c0" } }))
  const [lines, setLines] = useState(() =>
    fullScreen
      ? ["", VERSION, "(C)Copyright 98ish 1981-1998.", "", "Type WIN to return to Windows, or HELP for a list of commands.", ""]
      : ["", "Microsoft(R) Windows 98ish", "   (C)Copyright 98ish 1981-1998.", "", "Type HELP for a list of commands.", ""]
  )
  const [input, setInput] = useState("")
  const history = useRef(loadHistory())
  const historyAt = useRef(null)
  const tabState = useRef(null)
  const inputRef = useRef(null)
  const screenRef = useRef(null)

  useEffect(() => onTitle?.("MS-DOS Prompt"), [])

  useLayoutEffect(() => {
    const el = screenRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines, input])

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
  }, [])

  const submit = () => {
    const prompt = promptFor(shell.cwd)
    const text = input
    setInput("")
    historyAt.current = null
    tabState.current = null
    if (text.trim()) {
      history.current = [...history.current.filter((h) => h !== text), text].slice(-50)
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history.current))
      } catch {
        // fine without history
      }
    }
    let result
    try {
      result = run(text, shell)
    } catch (error) {
      result = { out: [error.message || "General failure"], open: [] }
    }
    if (result.cls) {
      setLines([])
      return
    }
    // folder vanished (deleted elsewhere)? fall back to the root
    if (!fs.resolve(shell.cwd)?.isDirectory) shell.cwd = ["C:"]
    for (const target of result.open || []) onOpen?.(target)
    setLines((prev) => [...prev, prompt + text, ...result.out, ...(result.out.length ? [""] : [])].slice(-MAX_LINES))
    if (result.exit) onClose?.(result)
  }

  const onKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      submit()
      return
    }
    if (e.key === "Tab") {
      e.preventDefault()
      const state = tabState.current?.after === input ? tabState.current : { base: input, n: 0 }
      const next = complete(state.base, shell, state.n)
      if (next != null) {
        setInput(next)
        tabState.current = { base: state.base, n: state.n + 1, after: next }
      }
      return
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault()
      const h = history.current
      if (!h.length) return
      let at = historyAt.current ?? h.length
      at = e.key === "ArrowUp" ? Math.max(0, at - 1) : at + 1
      if (at >= h.length) {
        historyAt.current = null
        setInput("")
      } else {
        historyAt.current = at
        setInput(h[at])
      }
      return
    }
    if (e.key === "Escape") {
      e.preventDefault()
      setInput("")
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && !window.getSelection()?.toString()) {
      e.preventDefault()
      setLines((prev) => [...prev, promptFor(shell.cwd) + input + "^C", ""])
      setInput("")
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
      e.preventDefault()
      setLines([])
    }
  }

  return (
    <div
      className={fullScreen ? "dosRoot dosRoot--full" : "dosRoot"}
      style={{ background: shell.color.bg, color: shell.color.fg }}
      data-kb-keep
      onMouseUp={() => {
        // click anywhere to type, unless text is being selected for copying
        if (!window.getSelection()?.toString()) inputRef.current?.focus({ preventScroll: true })
      }}
    >
      <div className="dosScreen" ref={screenRef}>
        {lines.map((line, i) => (
          <div key={i} className="dosLine">
            {line || " "}
          </div>
        ))}
        <div className="dosLine dosInputLine">
          <span>{promptFor(shell.cwd)}</span>
          <span className="dosTyped">
            {input}
            <span className="dosCursor" style={{ background: shell.color.fg }} />
          </span>
          <input
            ref={inputRef}
            className="dosInput"
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              tabState.current = null
            }}
            onKeyDown={onKeyDown}
            aria-label="MS-DOS command"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck="false"
            enterKeyHint="go"
            data-kb-layout="dos"
          />
        </div>
      </div>
    </div>
  )
}

export default MsDos
