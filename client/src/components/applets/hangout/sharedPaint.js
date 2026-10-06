// A Paint picture shared through Come Over: everyone draws on it at once.
//
// The shared Yjs document holds the picture's size (Y.Map "meta": w, h) and a list of ops
// (Y.Array "ops"): each finished change someone made, as the pixels that changed (runs, see
// hangoutCore.js). The picture is white + every op in order, so:
//   - a friend's stroke lands as soon as they lift their finger (only the changed pixels
//     travel, a few hundred bytes for a pencil line);
//   - Undo removes your own last op (Y.UndoManager tracks only your changes) and the picture
//     is drawn again from the list, so friends' strokes stay;
//   - edits made offline are ops too, and merge when you're back.
// Paint keeps drawing on its own surface exactly as before; after each finished change this
// compares it with a shadow copy (the picture as shared) and sends the difference.

import { useEffect, useRef, useState } from "react"
import * as Y from "yjs"
import * as P from "../paint/paintLogic.js"
import { applyRuns, diffPixels, packRuns, unpackRuns } from "./hangoutCore.js"

export const LOCAL = "local-paint"
const FLATTEN_OPS = 400
const FLATTEN_CHARS = 1_600_000

// the picture an op list draws
export const render = (w, h, ops) => {
  const s = P.createSurface(w, h)
  for (const op of ops) if (op?.r) applyRuns(s.data, unpackRuns(op.r))
  return s
}

export const useSharedPaint = ({ handle, img, show, replaceImage, busy, me }) => {
  const [status, setStatus] = useState(handle ? handle.status : "none")
  const shadow = useRef(null)
  const um = useRef(null)

  useEffect(() => {
    if (!handle) return
    const doc = handle.doc
    const meta = doc.getMap("meta")
    const ops = doc.getArray("ops")
    let alive = true
    const off = handle.subscribe(() => setStatus(handle.status))
    setStatus(handle.status)
    um.current = new Y.UndoManager(ops, { trackedOrigins: new Set([LOCAL]), captureTimeout: 0 })

    const redraw = () => {
      const w = meta.get("w") || img.current.width
      const h = meta.get("h") || img.current.height
      const s = render(w, h, ops.toArray())
      shadow.current = P.cloneSurface(s)
      if (s.width !== img.current.width || s.height !== img.current.height) replaceImage(s)
      else {
        img.current.data.set(s.data)
        show()
      }
    }

    const observer = (event, tx) => {
      if (tx.origin === LOCAL) {
        // our own op: the shadow already has it
        return
      }
      const removed = event.changes.deleted.size > 0
      if (removed || tx.origin !== "remote") return redraw()
      // friends' new ops: paint just those
      for (const item of event.changes.added) {
        for (const op of item.content.getContent()) {
          if (!op?.r) continue
          const runs = unpackRuns(op.r)
          applyRuns(img.current.data, runs)
          if (shadow.current) applyRuns(shadow.current.data, runs)
        }
      }
      show()
    }
    const metaObserver = (event, tx) => {
      if (tx.origin !== LOCAL) redraw()
    }
    ops.observe(observer)
    meta.observe(metaObserver)

    handle.ready.then(() => {
      if (!alive) return
      if (!meta.get("w")) {
        // the first person shares their picture as it is
        const s = img.current
        doc.transact(() => {
          meta.set("w", s.width)
          meta.set("h", s.height)
          const runs = diffPixels(P.createSurface(s.width, s.height).data, s.data)
          if (runs.length) ops.push([{ by: me, r: packRuns(runs) }])
        }, "seed")
        shadow.current = P.cloneSurface(s)
      } else redraw()
    })

    return () => {
      alive = false
      off()
      ops.unobserve(observer)
      meta.unobserve(metaObserver)
      um.current?.destroy()
      um.current = null
      shadow.current = null
    }
  }, [handle])

  // after each finished change (nothing being drawn right now), send what changed
  useEffect(() => {
    if (!handle) return
    const tick = () => {
      if (handle.status !== "live" && handle.status !== "offline") return
      if (!shadow.current || busy()) return
      const s = img.current
      const doc = handle.doc
      const meta = doc.getMap("meta")
      const ops = doc.getArray("ops")
      if (s.width !== shadow.current.width || s.height !== shadow.current.height) {
        // a new size (Image > Attributes, a rotate): everyone gets it, with the picture
        doc.transact(() => {
          meta.set("w", s.width)
          meta.set("h", s.height)
          ops.delete(0, ops.length)
          const runs = diffPixels(P.createSurface(s.width, s.height).data, s.data)
          if (runs.length) ops.push([{ by: me, r: packRuns(runs) }])
        }, "resize")
        shadow.current = P.cloneSurface(s)
        return
      }
      const runs = diffPixels(shadow.current.data, s.data)
      if (!runs.length) return
      const packed = packRuns(runs)
      doc.transact(() => ops.push([{ by: me, r: packed }]), LOCAL)
      applyRuns(shadow.current.data, runs)
      // a long history: fold it into one picture (undo history ends there)
      const total = ops.toArray().reduce((n, op) => n + (op?.r?.length || 0), 0)
      if (ops.length > FLATTEN_OPS || total > FLATTEN_CHARS) {
        doc.transact(() => {
          const runsAll = diffPixels(P.createSurface(s.width, s.height).data, shadow.current.data)
          ops.delete(0, ops.length)
          if (runsAll.length) ops.push([{ by: me, r: packRuns(runsAll) }])
        }, "flatten")
        um.current?.clear()
      }
    }
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [handle])

  const undo = () => um.current?.undo()
  const redo = () => um.current?.redo()
  return { status, undo, redo, shared: !!handle, canUndo: () => !!um.current?.undoStack.length }
}
