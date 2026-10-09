import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import { gadgets, useGadgets } from "../../../utils/gadgets"
import { gadgetInfo, layout } from "../../../utils/gadgetsCore"
import { onInputReset } from "../../../utils/inputGuard"
import { GADGET_VIEWS } from "./Gadgets"
import "./Gadgets.css"

// The desktop gadgets (Vista's sidebar gadgets, drawn as Windows 98 windows): on a computer
// each sits on the wallpaper under every window, at its saved spot or stacked down the right
// edge, and drags by its title bar (mouse or finger); on a phone they sit in one row along
// the bottom of the desktop, which scrolls sideways when there are more than fit. The X takes
// a gadget away; the desktop's right-click / long-press "Gadgets..." adds them.
// Loaded only once someone has a gadget out (Desktop.jsx GadgetSpot).

const Frame = ({ kind, children, style, mobile, onDragStart }) => {
  const info = gadgetInfo(kind)
  return (
    <section className={`window gdg gdg--${kind}${mobile ? " is-phone" : ""}`} style={style} data-gadget={kind} aria-label={`${info.name} gadget`} onContextMenu={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="title-bar gdgBar" onPointerDown={onDragStart} data-touch-surface={mobile ? undefined : ""}>
        <div className="title-bar-text">{info.name}</div>
        <div className="title-bar-controls">
          <button type="button" aria-label="Close" title={`Take ${info.name} off the desktop`} onPointerDown={(e) => e.stopPropagation()} onClick={() => gadgets.remove(kind)} />
        </div>
      </div>
      <div className="window-body gdgWin">{children}</div>
    </section>
  )
}

const GadgetHost = ({ mobile, dispatch }) => {
  const state = useGadgets()
  const ref = useRef(null)
  const [desk, setDesk] = useState(null)
  const [drag, setDrag] = useState(null) // { kind, id, dx, dy, x, y }

  // the desktop's size (the host fills it)
  useLayoutEffect(() => {
    if (mobile) return
    const el = ref.current
    if (!el) return
    const measure = () => setDesk({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [mobile])

  // a drag the page lost (switching apps, turning the phone) just ends
  useEffect(() => onInputReset(() => setDrag(null)), [])

  if (!state.list.length) return null

  if (mobile)
    return (
      <div className="gdgStrip" data-gadget-strip>
        {state.list.map((g) => {
          const View = GADGET_VIEWS[g.kind]
          return (
            <Frame key={g.kind} kind={g.kind} mobile>
              <View config={g.config} dispatch={dispatch} />
            </Frame>
          )
        })}
      </div>
    )

  const spots = desk ? layout(state, desk) : []
  const start = (kind, spot) => (e) => {
    if (e.button > 0 || e.target.closest("button")) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const box = ref.current.getBoundingClientRect()
    setDrag({ kind, id: e.pointerId, dx: e.clientX - box.left - spot.x, dy: e.clientY - box.top - spot.y, x: spot.x, y: spot.y, w: spot.w, h: spot.h })
  }
  const move = (e) => {
    if (!drag || e.pointerId !== drag.id) return
    const box = ref.current.getBoundingClientRect()
    const x = Math.min(Math.max(0, e.clientX - box.left - drag.dx), box.width - drag.w)
    const y = Math.min(Math.max(0, e.clientY - box.top - drag.dy), box.height - drag.h)
    setDrag({ ...drag, x, y })
  }
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return
    gadgets.move(drag.kind, { x: drag.x, y: drag.y }, desk)
    setDrag(null)
  }

  return (
    <div ref={ref} className="gdgHost" onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
      {spots.map((spot) => {
        const g = state.list.find((x) => x.kind === spot.kind)
        const View = GADGET_VIEWS[spot.kind]
        const at = drag?.kind === spot.kind ? drag : spot
        return (
          <Frame key={spot.kind} kind={spot.kind} style={{ left: at.x, top: at.y, width: spot.w, height: spot.h }} onDragStart={start(spot.kind, spot)}>
            <View config={g.config} dispatch={dispatch} />
          </Frame>
        )
      })}
    </div>
  )
}

export default GadgetHost
