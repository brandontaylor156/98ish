/*
 * On-screen game controls that players can move and resize (mostly for phones).
 *
 * Quick start:
 *
 *   import TouchControls, { GLYPHS, useTouchControlsVisible } from "../../shared/controls"
 *
 *   const CONTROLS = [
 *     { id: "left", label: "Move left", icon: GLYPHS.left, default: { portrait: { x: 2, y: 80, w: 16, h: 9 }, landscape: ... } },
 *     { id: "drop", label: "Drop", repeat: { delay: 300, interval: 80 }, default: { portrait: (size) => fromPx(size, { right: 8, bottom: 8, width: 64, height: 64 }) } },
 *     { id: "flipL", label: "Left flipper", kind: "zone", mirror: false, default: { x: 0, y: 0, w: 50, h: 100 } },
 *   ]
 *   const showControls = useTouchControlsVisible()   // touch screens, or forced on in a menu
 *   const [editing, setEditing] = useState(false)    // pause your game while this is true
 *   ...
 *   <div style={{ position: "relative" }}>           // the game area the layout is relative to
 *     <canvas ... />
 *     {showControls && (
 *       <TouchControls game="mygame" controls={CONTROLS} onPress={(action) => ...} onRelease={(action) => ...}
 *         editing={editing} onEditingChange={setEditing} />
 *     )}
 *   </div>
 *
 * A control: { id, label, icon?, action? (defaults to id), kind?: "button" | "zone",
 *   shape?: "rect" | "round", className?, hidden? (not shown right now, e.g. LAUNCH only in
 *   the shooter lane; still editable), enabled? (false: off until the player turns it on in
 *   edit mode), repeat? (true or { delay, interval }: onPress again while held),
 *   mirror? (false: stays put in the left-handed mirror), opacity? (0-1; drawn through the
 *   CSS variable --tc-opacity, so a game's CSS can dim further with calc()), ariaDisabled?,
 *   default: { portrait, landscape } each a rect { x, y, w, h } in % of the game area, or
 *   (size) => rect (see fromPx in layout.js for pixel anchors) }.
 * Zones are big invisible touch areas (pinball flippers); they show only while editing.
 *
 * Props: game (storage key), controls, onPress(action, control, { repeat }),
 *   onRelease(action, control), show (false hides the buttons, e.g. while paused),
 *   editing / onEditingChange (edit mode: drag to move, corner or two-finger pinch to
 *   resize, global size/opacity, per-button opacity and on/off, mirror, reset; saved to
 *   localStorage "98ish.controls" per game and per orientation on Done),
 *   gear (show the small gear button that opens edit mode), gearStyle / gearClassName
 *   (where the gear sits and how it looks),
 *   scale / alpha (the default global size and opacity for this game),
 *   settings (the game's own options, drawn at the top of the edit panel; the exported
 *   Check and Slider match the panel's look).
 *
 * Buttons act on pointerdown (no tap delay), capture their pointer, and several can be held
 * at once. onRelease comes once the last finger on a button lifts, and also when a held
 * button gets hidden, the controls are hidden, edit mode starts, or the component unmounts.
 * The layout math lives in layout.js (pure, unit-tested); store.js has the shared prefs.
 */
import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  ALPHA_RANGE,
  GRID_PX,
  SCALE_RANGE,
  clampRect,
  defaultLayout,
  effectiveRects,
  findOverlaps,
  mergeLayout,
  mirrorRects,
  orientationOf,
  savedLayout,
  scaleRect,
  snapRect,
  unscaleRect,
} from "./layout"
import { resetLayout, saveLayout, setControlPrefs, useControlsStore } from "./store"
import { GearIcon } from "./icons"
import "./TouchControls.css"

const useAreaSize = (ref) => {
  const [size, setSize] = useState(null)
  useLayoutEffect(() => {
    const el = ref.current
    const measure = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      setSize((s) => (s && s.width === w && s.height === h ? s : { width: w, height: h }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return size
}

const pxStyle = (r, extra) => ({
  left: `${r.x}%`,
  top: `${r.y}%`,
  width: `${r.w}%`,
  height: `${r.h}%`,
  ...extra,
})

const buzz = (on) => {
  if (on) {
    try {
      navigator.vibrate?.(8)
    } catch {
      // not allowed here
    }
  }
}

const isZone = (c) => c.kind === "zone"

const TouchControls = ({
  game,
  controls,
  onPress,
  onRelease,
  show = true,
  editing = false,
  onEditingChange,
  gear = true,
  gearStyle,
  gearClassName = "",
  scale = 1,
  alpha = 1,
  className = "",
  settings = null,
}) => {
  const layerRef = useRef(null)
  const size = useAreaSize(layerRef)
  const orientation = size ? orientationOf(size) : "portrait"
  const store = useControlsStore()
  const { haptics } = store.prefs

  const defaults = useMemo(
    () => (size ? defaultLayout(controls, size, orientation, { scale, alpha }) : null),
    [controls, size, orientation, scale, alpha]
  )
  const saved = savedLayout(store, game, orientation)
  const layout = useMemo(() => defaults && mergeLayout(defaults, saved), [defaults, saved])
  const zoneIds = controls.filter(isZone).map((c) => c.id)

  // ---- playing: press / release ----
  const latest = useRef({})
  latest.current = { onPress, onRelease, haptics }
  const held = useRef(new Map()) // id -> Set of pointer ids
  const repeats = useRef(new Map()) // id -> timer
  const [pressed, setPressed] = useState(() => new Set())
  const byId = useMemo(() => Object.fromEntries(controls.map((c) => [c.id, c])), [controls])
  const byIdRef = useRef(byId)
  byIdRef.current = byId

  const stopRepeat = (id) => {
    const t = repeats.current.get(id)
    if (t) {
      clearTimeout(t.timeout)
      clearInterval(t.interval)
      repeats.current.delete(id)
    }
  }

  const releaseId = (id) => {
    if (!held.current.has(id)) return
    held.current.delete(id)
    stopRepeat(id)
    setPressed((s) => {
      const next = new Set(s)
      next.delete(id)
      return next
    })
    const c = byIdRef.current[id]
    if (c) latest.current.onRelease?.(c.action ?? c.id, c)
  }
  const releaseAll = () => [...held.current.keys()].forEach(releaseId)

  const down = (c) => (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return
    e.preventDefault() // no focus change, text selection, or long-press menu
    e.stopPropagation() // the game under the button doesn't see this touch
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // the pointer is already gone
    }
    const pointers = held.current.get(c.id) || new Set()
    const first = pointers.size === 0
    pointers.add(e.pointerId)
    held.current.set(c.id, pointers)
    if (!first) return
    setPressed((s) => new Set(s).add(c.id))
    buzz(latest.current.haptics)
    const action = c.action ?? c.id
    latest.current.onPress?.(action, c, { repeat: false })
    if (c.repeat) {
      const { delay = 300, interval = 80 } = c.repeat === true ? {} : c.repeat
      const t = {}
      t.timeout = setTimeout(() => {
        t.interval = setInterval(() => latest.current.onPress?.(action, c, { repeat: true }), interval)
      }, delay)
      repeats.current.set(c.id, t)
    }
  }
  const up = (c) => (e) => {
    const pointers = held.current.get(c.id)
    if (!pointers?.delete(e.pointerId)) return
    if (pointers.size === 0) releaseId(c.id)
  }

  const live = !!layout && show && !editing
  const visibleIds = live ? controls.filter((c) => !c.hidden && layout.enabled[c.id]).map((c) => c.id) : []
  const visibleKey = visibleIds.join(",")
  // A held button that goes away (hidden, edit mode, unmount) lets go
  useEffect(() => {
    for (const id of held.current.keys()) if (!visibleIds.includes(id)) releaseId(id)
  }, [visibleKey])
  useEffect(() => () => {
    releaseAll()
    repeats.current.forEach((_, id) => stopRepeat(id))
  }, [])

  // ---- editing ----
  const [draft, setDraft] = useState(null)
  const [selected, setSelected] = useState(null)
  useEffect(() => {
    if (editing && layout) {
      releaseAll()
      setDraft(structuredClone(layout))
      setSelected(null)
    } else if (!editing) {
      setDraft(null)
    }
  }, [editing, orientation, !!layout])

  const finish = (commit) => {
    if (commit && draft) {
      if (JSON.stringify(draft) === JSON.stringify(defaults)) resetLayout(game, orientation)
      else saveLayout(game, orientation, draft)
    }
    onEditingChange?.(false)
  }

  const shown = editing && draft ? draft : layout
  const rects = shown && size ? effectiveRects(shown, size, controls.map((c) => c.id), zoneIds) : null

  return (
    <div className={`tcLayer ${editing ? "is-editing" : ""} ${className}`} ref={layerRef} data-orientation={orientation}>
      {live &&
        rects &&
        controls
          .filter((c) => visibleIds.includes(c.id))
          .sort((a, b) => isZone(b) - isZone(a)) // zones underneath
          .map((c) => {
            const handlers = {
              onPointerDown: down(c),
              onPointerUp: up(c),
              onPointerCancel: up(c),
              onLostPointerCapture: up(c),
              onContextMenu: (e) => e.preventDefault(),
            }
            if (isZone(c)) {
              return <div key={c.id} className="tcZone" data-control={c.id} aria-label={c.label} style={pxStyle(rects[c.id])} {...handlers} />
            }
            return (
              <button
                key={c.id}
                type="button"
                tabIndex={-1}
                aria-label={c.label}
                aria-disabled={c.ariaDisabled === undefined ? undefined : String(!!c.ariaDisabled)}
                data-control={c.id}
                className={`tcButton tcShape--${c.shape || "rect"} ${pressed.has(c.id) ? "is-pressed" : ""} ${c.className || ""}`}
                style={pxStyle(rects[c.id], { "--tc-opacity": shown.alpha * shown.opacity[c.id] })}
                {...handlers}
              >
                {c.icon ?? c.label}
              </button>
            )
          })}

      {live && gear && onEditingChange && (
        <button
          type="button"
          tabIndex={-1}
          className={`tcGear ${gearClassName}`}
          aria-label="Customize controls"
          title="Customize controls"
          style={gearStyle}
          onPointerDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={(e) => {
            e.stopPropagation()
            onEditingChange(true)
          }}
        >
          <GearIcon />
        </button>
      )}

      {editing && draft && rects && (
        <EditLayer
          controls={controls}
          draft={draft}
          setDraft={setDraft}
          rects={rects}
          size={size}
          zoneIds={zoneIds}
          defaults={defaults}
          selected={selected}
          setSelected={setSelected}
          haptics={haptics}
          settings={settings}
          onDone={() => finish(true)}
          onCancel={() => finish(false)}
        />
      )}
    </div>
  )
}

// ---- edit mode: the dashed boxes and the settings panel ----

const PANEL_PX = 170 // about how tall the settings panel is
const PANEL_SPOTS = ["top", "middle", "bottom"]

const EditLayer = ({ controls, draft, setDraft, rects, size, zoneIds, defaults, selected, setSelected, haptics, settings, onDone, onCancel }) => {
  const layerRef = useRef(null)
  const gesture = useRef({ pointers: new Map(), mode: null, id: null, start: null })
  const [panelAt, setPanelAt] = useState(null) // "top" | "middle" | "bottom"
  const [collapsed, setCollapsed] = useState(false)
  const byId = Object.fromEntries(controls.map((c) => [c.id, c]))

  useEffect(() => {
    layerRef.current?.focus({ preventScroll: true })
  }, [])

  // The panel starts wherever it covers the fewest buttons (top, middle or bottom)
  const autoPanel = useMemo(() => {
    const h = Math.min(100, (PANEL_PX / size.height) * 100)
    const bands = { top: [0, h], middle: [50 - h / 2, 50 + h / 2], bottom: [100 - h, 100] }
    const covered = (band) =>
      controls
        .filter((c) => !zoneIds.includes(c.id))
        .reduce((sum, c) => {
          const r = rects[c.id]
          return sum + Math.max(0, Math.min(r.y + r.h, band[1]) - Math.max(r.y, band[0])) * r.w
        }, 0)
    return PANEL_SPOTS.reduce((best, spot) => (covered(bands[spot]) < covered(bands[best]) ? spot : best))
  }, [])
  const where = panelAt || autoPanel

  // Put an on-screen rect back into the draft (undoing the global size for buttons)
  const place = (id, onScreen) => {
    setDraft((d) => ({
      ...d,
      rects: { ...d.rects, [id]: zoneIds.includes(id) ? onScreen : unscaleRect(onScreen, d.scale) },
    }))
  }

  const pct = (dx, dy) => ({ x: (dx / size.width) * 100, y: (dy / size.height) * 100 })
  const distance = (pointers) => {
    const [a, b] = [...pointers.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  const onPointerDown = (e) => {
    if (e.target.closest(".tcPanel")) return
    if (e.pointerType === "mouse" && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    try {
      layerRef.current.setPointerCapture(e.pointerId)
    } catch {
      // the pointer is already gone
    }
    const g = gesture.current
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (g.pointers.size === 1) {
      const box = e.target.closest("[data-tc-id]")
      const id = box?.dataset.tcId || null
      setSelected(id)
      g.id = id
      g.mode = id ? (e.target.closest(".tcHandle") ? "resize" : "move") : null
      g.start = id ? { rect: rects[id], x: e.clientX, y: e.clientY } : null
    } else if (g.pointers.size === 2) {
      // second finger anywhere: pinch the button under the first one (or the selected one)
      const id = g.id || selected
      if (!id) return
      g.id = id
      g.mode = "pinch"
      g.start = { rect: rects[id], dist: Math.max(10, distance(g.pointers)) }
      setSelected(id)
    }
  }

  const onPointerMove = (e) => {
    const g = gesture.current
    if (!g.pointers.has(e.pointerId)) return
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (!g.mode) return
    const s = g.start.rect
    if (g.mode === "move") {
      const d = pct(e.clientX - g.start.x, e.clientY - g.start.y)
      const snapped = snapRect({ ...s, x: s.x + d.x, y: s.y + d.y }, size)
      place(g.id, clampRect({ ...s, x: snapped.x, y: snapped.y }, size))
    } else if (g.mode === "resize") {
      const d = pct(e.clientX - g.start.x, e.clientY - g.start.y)
      const snapped = snapRect({ ...s, w: s.w + d.x, h: s.h + d.y }, size)
      const r = clampRect({ x: s.x, y: s.y, w: Math.min(snapped.w, 100 - s.x), h: Math.min(snapped.h, 100 - s.y) }, size)
      place(g.id, r)
    } else if (g.mode === "pinch" && g.pointers.size >= 2) {
      const f = Math.max(0.2, Math.min(5, distance(g.pointers) / g.start.dist))
      const r = scaleRect(s, f)
      const snapped = snapRect(r, size)
      place(g.id, clampRect({ x: r.x + (r.w - snapped.w) / 2, y: r.y + (r.h - snapped.h) / 2, w: snapped.w, h: snapped.h }, size))
    }
  }

  const onPointerUp = (e) => {
    const g = gesture.current
    if (!g.pointers.delete(e.pointerId)) return
    if (g.mode === "pinch" || g.pointers.size === 0) {
      // lifting one finger of a pinch ends it, so the other doesn't make the button jump
      g.mode = null
      g.start = null
      if (g.pointers.size === 0) g.id = null
    }
  }

  // Keyboard: arrows nudge the selected button one grid step, Esc cancels
  const onKeyDown = (e) => {
    e.stopPropagation() // the game doesn't get keys while editing
    if (e.key === "Escape") return onCancel()
    const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
    if (!steps || !selected || e.target.closest("input")) return
    e.preventDefault()
    const r = rects[selected]
    const d = pct(steps[0] * GRID_PX, steps[1] * GRID_PX)
    place(selected, clampRect({ ...r, x: r.x + d.x, y: r.y + d.y }, size))
  }

  const buttonIds = controls.filter((c) => !zoneIds.includes(c.id) && draft.enabled[c.id]).map((c) => c.id)
  const overlapping = findOverlaps(Object.fromEntries(buttonIds.map((id) => [id, rects[id]])), size)
  const sel = selected && byId[selected]

  return (
    <div
      className="tcEdit"
      ref={layerRef}
      tabIndex={-1}
      style={{ backgroundSize: `${GRID_PX * 2}px ${GRID_PX * 2}px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {[...controls]
        .sort((a, b) => zoneIds.includes(b.id) - zoneIds.includes(a.id))
        .map((c) => {
          const zone = zoneIds.includes(c.id)
          const cls = [
            "tcBox",
            zone ? "tcBox--zone" : "",
            selected === c.id ? "is-selected" : "",
            overlapping.includes(c.id) ? "is-overlap" : "",
            draft.enabled[c.id] ? "" : "is-off",
          ].join(" ")
          return (
            <div key={c.id} className={cls} data-tc-id={c.id} aria-label={`${c.label} (drag to move)`} style={pxStyle(rects[c.id])}>
              {zone ? (
                <span className="tcZoneLabel">{c.label}</span>
              ) : (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  className={`tcButton tcShape--${c.shape || "rect"} ${c.className || ""}`}
                  style={{ "--tc-opacity": draft.enabled[c.id] ? draft.alpha * draft.opacity[c.id] : 0.3 }}
                >
                  {c.icon ?? c.label}
                </button>
              )}
              <span className="tcHandle" aria-label={`Resize ${c.label}`} />
            </div>
          )
        })}

      <div className={`tcPanel window tcPanel--${where} ${size.height < 340 ? "tcPanel--short" : ""}`} onPointerDown={(e) => e.stopPropagation()}>
        <div className="title-bar">
          <div className="title-bar-text">Customize Controls</div>
          <div className="title-bar-controls">
            <button type="button" aria-label={collapsed ? "Maximize" : "Minimize"} title={collapsed ? "Show options" : "Hide options"} onClick={() => setCollapsed(!collapsed)} />
            <button type="button" className="tcPanelMove" aria-label="Move panel" title="Move this panel" onClick={() => setPanelAt(PANEL_SPOTS[(PANEL_SPOTS.indexOf(where) + 1) % 3])}>
              {where === "bottom" ? "▲︎" : "▼︎"}
            </button>
          </div>
        </div>
        <div className="window-body tcPanelBody">
          {!collapsed && (
            <>
              {settings}
              <div className="tcHint">
                {sel ? (
                  <>
                    <b>{sel.label}</b>
                    <Check label="Show" checked={draft.enabled[sel.id]} onChange={(on) => setDraft((d) => ({ ...d, enabled: { ...d.enabled, [sel.id]: on } }))} />
                  </>
                ) : (
                  "Drag a button to move it. Drag its corner, or pinch, to resize."
                )}
              </div>
              {sel && !zoneIds.includes(sel.id) && (
                <Slider
                  label="Button opacity"
                  name="tc-button-opacity"
                  min={ALPHA_RANGE[0]}
                  max={1}
                  value={draft.opacity[sel.id]}
                  onChange={(v) => setDraft((d) => ({ ...d, opacity: { ...d.opacity, [sel.id]: v } }))}
                />
              )}
              <Slider label="All sizes" name="tc-size" min={SCALE_RANGE[0]} max={SCALE_RANGE[1]} value={draft.scale} onChange={(v) => setDraft((d) => ({ ...d, scale: v }))} />
              <Slider label="All opacity" name="tc-opacity" min={ALPHA_RANGE[0]} max={ALPHA_RANGE[1]} value={draft.alpha} onChange={(v) => setDraft((d) => ({ ...d, alpha: v }))} />
              <div className="tcRow">
                <Check label="Vibrate on press" checked={haptics} onChange={(on) => setControlPrefs({ haptics: on })} />
                {overlapping.length > 0 && <span className="tcWarn">Some buttons overlap</span>}
              </div>
            </>
          )}
          <div className="tcRow tcActions">
            <button
              type="button"
              title="Left-handed: flip the layout"
              onClick={() => setDraft((d) => ({ ...d, rects: mirrorRects(d.rects, controls.filter((c) => c.mirror === false).map((c) => c.id)) }))}
            >
              Mirror
            </button>
            <button type="button" onClick={() => setDraft(structuredClone(defaults))}>
              Reset
            </button>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="tcDone" onClick={onDone}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// 98.css draws the box on the label that follows the input
export const Check = ({ label, checked, onChange }) => {
  const id = useId()
  return (
    <span className="tcCheck">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>{label}</label>
    </span>
  )
}

export const Slider = ({ label, name, min, max, value, onChange }) => {
  const id = useId()
  return (
    <div className="tcSlider">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={name} type="range" min={min} max={max} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span>{Math.round(value * 100)}%</span>
    </div>
  )
}

export default TouchControls
