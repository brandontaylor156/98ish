import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import MoreOptions from "../MoreOptions"
import { clipHistoryOn, clipStore } from "../../../utils/clipHistory"
import { ordered, preview } from "../../../utils/clipCore"
import { setSettings, useSettings } from "../../../utils/settings"
import { openHelp } from "../../../utils/help"
import { currentUserName } from "../../../utils/users"
import { pasteClip } from "./clipPaste"
import "./ClipHistory.css"

// The clipboard history panel (Ctrl+Shift+V, the 98ish keyboard's clipboard button): the last
// 25 things copied in 98ish, pinned ones first. Tap one to paste it where you were typing.
// Baseline: the list and Clear all; turning it off is under More options. Taps never take
// the focus from the field (so the 98ish keyboard stays up and the caret stays put).

const keepFocus = (e) => e.preventDefault()

const ClipHistory = ({ target, mobile, onClose }) => {
  const settings = useSettings()
  const on = settings.clipboardHistory !== false
  const [list, setList] = useState(() => clipStore.get())
  const [note, setNote] = useState("")
  const [pos, setPos] = useState(null)
  const ref = useRef(null)
  const listRef = useRef(null)

  useEffect(() => {
    const off = clipStore.subscribe((l) => setList(l))
    clipStore.load().then(setList)
    return off
  }, [])

  // where: by the field on a computer, above the keyboard on a phone (CSS)
  useLayoutEffect(() => {
    if (mobile) return
    const box = ref.current?.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight - (document.querySelector(".taskbar")?.offsetHeight || 30)
    const w = box?.width || 320
    const h = box?.height || 360
    const r = target?.isConnected && target !== document.body ? target.getBoundingClientRect() : null
    let left = r ? r.left + 12 : vw - w - 12
    let top = r ? Math.min(r.bottom, r.top + 40) : vh - h - 8
    if (top + h > vh - 4) top = Math.max(4, (r ? r.top : vh) - h - 4)
    left = Math.max(4, Math.min(left, vw - w - 4))
    top = Math.max(4, Math.min(top, vh - h - 4))
    setPos({ left, top })
  }, [mobile, list.length, on])

  // Escape, and a press outside closes it
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        try {
          target?.focus?.({ preventScroll: true })
        } catch {
          // gone
        }
      }
    }
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || e.target.closest?.(".kb98")) return
      onClose()
    }
    window.addEventListener("keydown", onKey, true)
    window.addEventListener("pointerdown", onDown, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      window.removeEventListener("pointerdown", onDown, true)
    }
  }, [])

  // a computer's keyboard: the first item takes focus, arrows move, Enter pastes
  useEffect(() => {
    if (!mobile && on) listRef.current?.querySelector(".clipItem")?.focus({ preventScroll: true })
  }, [on, list.length > 0])

  const paste = async (item) => {
    const how = await pasteClip(item, target)
    if (how === "pasted") return onClose()
    if (how === "copied") setNote(mobile ? "It's on your phone's clipboard: tap and hold where it goes, then Paste." : "It's on the clipboard: click where it goes and press Ctrl+V.")
    else setNote("That couldn't be pasted here.")
  }

  const onListKey = (e) => {
    const rows = [...(listRef.current?.querySelectorAll(".clipItem") || [])]
    const at = rows.indexOf(document.activeElement)
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))]?.focus()
    }
  }

  const shown = ordered(list)
  const style = mobile ? undefined : pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }
  return (
    <div ref={ref} className={`window clipPanel${mobile ? " is-phone" : ""}`} style={style} role="dialog" aria-label="Clipboard history" data-kb-keep data-clip="off" onMouseDown={keepFocus}>
      <div className="title-bar">
        <div className="title-bar-text">Clipboard</div>
        <div className="title-bar-controls">
          <button type="button" aria-label="Help" onClick={() => (onClose(), openHelp("clipboard-history"))} />
          <button type="button" aria-label="Close" onClick={onClose} />
        </div>
      </div>
      <div className="window-body clipBody">
        {!on ? (
          <div className="clipOff">
            <p>Clipboard history is off.</p>
            <p className="clipSmall">Turn it on to keep the last 25 things you copy in 98ish, on this device only, and paste them again later.</p>
            <button type="button" className="clipPrimary" onClick={() => setSettings({ clipboardHistory: true })}>
              Turn On
            </button>
          </div>
        ) : !shown.length ? (
          <p className="clipEmpty">Nothing copied yet. Copy something in 98ish and it shows up here.</p>
        ) : (
          <ul className="clipList" ref={listRef} onKeyDown={onListKey} aria-label="Copied items">
            {shown.map((item) => (
              <li key={item.id} className={`clipRow${item.pinned ? " is-pinned" : ""}`}>
                <button type="button" className="clipItem" onClick={() => paste(item)} aria-label={`Paste ${preview(item, 60)}`} title="Paste">
                  {item.kind === "image" ? <img src={item.dataUrl} alt="" draggable="false" /> : <span className="clipText">{item.text}</span>}
                </button>
                <span className="clipTools">
                  <button type="button" className="clipTool" aria-pressed={item.pinned} aria-label={item.pinned ? "Unpin" : "Pin"} title={item.pinned ? "Unpin" : "Pin: stays through Clear all"} onClick={() => clipStore.pin(item.id, !item.pinned)}>
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                      <path d="M6 1h4v1l-1 1v4l2 2v1H8.6v5h-1.2v-5H5V9l2-2V3L6 2z" fill={item.pinned ? "#000080" : "none"} stroke="#000" strokeWidth="1" />
                    </svg>
                  </button>
                  <button type="button" className="clipTool" aria-label="Delete" title="Delete" onClick={() => clipStore.remove(item.id)}>
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                      <path d="M4 4l8 8M12 4l-8 8" stroke="#000" strokeWidth="2" />
                    </svg>
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {note && (
          <p className="clipNote" role="status">
            {note}
          </p>
        )}
        {on && (
          <div className="clipFoot">
            <button type="button" onClick={() => clipStore.clear()} disabled={!list.some((i) => !i.pinned)}>
              Clear all
            </button>
            <MoreOptions id="clipboard.more" inline label="More" lessLabel="Less" summary="On this device only · Pinned items stay">
              <p className="clipSmall">Kept on this device for {currentUserName()} only, never synced. Never from password boxes. Turning it off deletes everything in it.</p>
              <button type="button" onClick={() => clipHistoryOn() && setSettings({ clipboardHistory: false })}>
                Turn off clipboard history
              </button>
            </MoreOptions>
          </div>
        )}
      </div>
    </div>
  )
}

export default ClipHistory
