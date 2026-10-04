import React, { useLayoutEffect, useRef, useState, useEffect } from "react"
import { fieldName } from "./fields"

const TITLES = {
  list: "Choose an item",
  date: "Choose a date",
  time: "Choose a time",
  "datetime-local": "Choose a date and time",
  month: "Choose a month",
}

// How far the bottom of the visible screen is above the layout's bottom (a phone keyboard
// that stayed up, iOS's toolbar)
const useBottomInset = (on) => {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!on || !vv) return
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop))))
    update()
    vv.addEventListener("resize", update)
    vv.addEventListener("scroll", update)
    return () => {
      vv.removeEventListener("resize", update)
      vv.removeEventListener("scroll", update)
    }
  }, [on])
  return inset
}

// The box a picker opens in, drawn at the desktop level (windows are moved with transforms,
// which would offset a fixed box inside them):
// - with a mouse, a drop-down right under the field (or above it when there's no room
//   below), at least as wide as the field and never off the screen;
// - on a phone, a 98 window across the bottom of the screen with a title bar, over a dim
//   that closes it when tapped.
// The picker inside gets `room`: the most height it may take.
const Popup = ({ popupRef, el, kind, sheet, rect, onCancel, children }) => {
  const boxRef = useRef(null)
  const [pos, setPos] = useState(null)
  const bottomInset = useBottomInset(sheet)
  const vh = window.innerHeight
  const vw = document.documentElement.clientWidth
  const below = vh - rect.bottom - 4
  const above = rect.top - 4
  const room = sheet ? Math.max(200, vh - bottomInset - 120) : Math.max(below, above, 120)

  useLayoutEffect(() => {
    if (sheet) return
    const box = boxRef.current
    if (!box) return
    const w = box.offsetWidth
    const h = box.offsetHeight
    const top = h <= below || below >= above ? rect.bottom : Math.max(2, rect.top - h)
    const left = Math.max(2, Math.min(rect.left, vw - w - 2))
    setPos({ left, top, up: top < rect.top })
  }, [sheet, rect.left, rect.top, rect.bottom, rect.width, below, above, vw])

  const font = getComputedStyle(el)
  const style = sheet
    ? { bottom: bottomInset ? bottomInset + 4 : undefined }
    : {
        left: pos?.left ?? rect.left,
        top: pos?.top ?? rect.bottom,
        minWidth: kind === "list" ? Math.max(rect.width, 40) : undefined,
        visibility: pos ? "visible" : "hidden",
        fontFamily: font.fontFamily,
        fontSize: kind === "list" ? font.fontSize : undefined,
      }

  const content = typeof children === "object" ? React.cloneElement(children, { room }) : children
  const title = fieldName(el) || TITLES[kind]

  return (
    <div ref={popupRef} className={`selLayer${sheet ? " selLayer--sheet" : ""}`} onContextMenu={(e) => e.preventDefault()}>
      {sheet ? (
        <>
          <div className="selDim" onClick={onCancel} aria-hidden="true" />
          <div className={`window selSheet selSheet--${kind === "list" ? "list" : "date"}`} style={style} role="dialog" aria-label={title}>
            <div className="title-bar">
              <div className="title-bar-text">{title}</div>
              <div className="title-bar-controls">
                <button type="button" aria-label="Close" onClick={onCancel} />
              </div>
            </div>
            <div className="selSheetBody">{content}</div>
          </div>
        </>
      ) : (
        <div ref={boxRef} className={`selDrop selDrop--${kind === "list" ? "list" : "date"}${pos?.up ? " is-up" : ""}`} style={style}>
          {content}
        </div>
      )}
    </div>
  )
}

export default Popup
