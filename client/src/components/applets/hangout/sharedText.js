// A <textarea> bound to a shared Yjs text (Come Over): your typing becomes the smallest edit
// (so friends typing at the same time all keep their words), their edits move your caret
// the right way, Undo undoes only your own typing, and everyone's caret and selection is
// passed around as Yjs relative positions (they stay on the right words while others type).
//
//   const shared = useSharedText({ handle, areaRef, text, setText, seed })
//   shared.change(nextValue)  // instead of setText in onChange
//   shared.undo() / shared.redo()

import { useEffect, useRef, useState } from "react"
import * as Y from "yjs"
import { moveCaret, textEdit } from "./hangoutCore.js"

export const LOCAL = "local-typing"

// where an index ends up after a Yjs text delta (someone else's change)
export const throughDelta = (index, delta) => {
  let pos = 0 // position in the old text
  let shift = 0
  for (const op of delta) {
    if (op.retain) pos += op.retain
    else if (op.insert) {
      const n = typeof op.insert === "string" ? op.insert.length : 1
      if (pos <= index) shift += n
    } else if (op.delete) {
      const end = pos + op.delete
      if (index >= end) shift -= op.delete
      else if (index > pos) shift -= index - pos
      pos = end
    }
    if (pos > index) break
  }
  return Math.max(0, index + shift)
}

export const useSharedText = ({ handle, areaRef, text, setText, seed = "" }) => {
  const [others, setOthers] = useState(new Map())
  const [status, setStatus] = useState(handle ? handle.status : "none")
  const um = useRef(null)
  const textRef = useRef(text)
  textRef.current = text

  useEffect(() => {
    if (!handle) return
    const ytext = handle.doc.getText("t")
    let alive = true
    const off = handle.subscribe(() => setStatus(handle.status))
    setStatus(handle.status)
    um.current = new Y.UndoManager(ytext, { trackedOrigins: new Set([LOCAL]), captureTimeout: 600 })

    const observer = (event, tx) => {
      if (tx.origin === LOCAL) return
      const el = areaRef.current
      const next = ytext.toString()
      if (el && document.activeElement === el) {
        const delta = event.changes.delta
        const s = throughDelta(el.selectionStart, delta)
        const e = throughDelta(el.selectionEnd, delta)
        setText(next)
        requestAnimationFrame(() => el.isConnected && el.setSelectionRange(s, e))
      } else setText(next)
    }
    ytext.observe(observer)

    handle.ready.then(() => {
      if (!alive) return
      // the first person shares what they had; everyone else takes the shared text
      if (!ytext.length && seed) handle.doc.transact(() => ytext.insert(0, seed), LOCAL)
      setText(ytext.toString())
    })

    const offAware = handle.onAware((map) => setOthers(new Map(map)))
    return () => {
      alive = false
      off()
      offAware()
      ytext.unobserve(observer)
      um.current?.destroy()
      um.current = null
    }
  }, [handle])

  // tell the others where my caret is (as relative positions), whenever it moves
  useEffect(() => {
    if (!handle) return
    const el = areaRef.current
    if (!el) return
    let last = ""
    const send = () => {
      if (handle.status !== "live") return
      const ytext = handle.doc.getText("t")
      const focused = document.activeElement === el
      const a = focused ? { s: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, el.selectionStart)), e: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, el.selectionEnd)) } : { away: true }
      const key = JSON.stringify(a)
      if (key === last) return
      last = key
      handle.aware(a)
    }
    let t = null
    const soon = () => {
      clearTimeout(t)
      t = setTimeout(send, 60)
    }
    const evs = ["select", "keyup", "mouseup", "input", "focus", "blur", "touchend"]
    evs.forEach((ev) => el.addEventListener(ev, soon))
    document.addEventListener("selectionchange", soon)
    const beat = setInterval(() => {
      last = ""
      send()
    }, 15000)
    return () => {
      clearTimeout(t)
      clearInterval(beat)
      evs.forEach((ev) => el.removeEventListener(ev, soon))
      document.removeEventListener("selectionchange", soon)
      handle.aware(null)
    }
  }, [handle, areaRef.current])

  const change = (next) => {
    if (!handle) return setText(next)
    const ytext = handle.doc.getText("t")
    const prev = textRef.current
    const edit = textEdit(prev, next)
    if (edit) {
      handle.doc.transact(() => {
        if (edit.remove) ytext.delete(edit.at, edit.remove)
        if (edit.insert) ytext.insert(edit.at, edit.insert)
      }, LOCAL)
    }
    // the Y.Text is the truth (it may hold someone's edit that arrived meanwhile)
    setText(ytext.toString())
  }

  const restore = (fn) => {
    const el = areaRef.current
    const before = textRef.current
    const caret = el?.selectionStart ?? 0
    fn()
    const after = handle.doc.getText("t").toString()
    setText(after)
    const edit = textEdit(before, after)
    if (el && edit) requestAnimationFrame(() => el.setSelectionRange(edit.at + edit.insert.length, edit.at + edit.insert.length))
    else if (el) requestAnimationFrame(() => el.setSelectionRange(caret, caret))
  }
  const undo = () => handle && um.current && restore(() => um.current.undo())
  const redo = () => handle && um.current && restore(() => um.current.redo())

  // others' carets as absolute indexes in the current text
  const carets = []
  if (handle) {
    const ytext = handle.doc.getText("t")
    for (const [key, a] of others) {
      if (!a || a.away || !a.s) continue
      try {
        const s = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(a.s), handle.doc)
        const e = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(a.e || a.s), handle.doc)
        if (s && e && s.type === ytext) carets.push({ key, name: a.name, s: Math.min(s.index, e.index), e: Math.max(s.index, e.index) })
      } catch {
        // a position from a version we don't have yet
      }
    }
  }
  return { change, undo, redo, carets, status, shared: !!handle }
}

// keep my caret where it was when a remote edit (given as an edit) lands before it
export const caretAfter = (pos, edit) => moveCaret(pos, edit)
