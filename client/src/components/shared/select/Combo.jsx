import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import "./Select.css"

// A Windows 98 drop-down drawn from a plain <button> and a list of rows: no native <select>
// at all. For screens where a real <select> can fail to show on an iPhone (the owner saw
// Pickleball 98's combo boxes missing from the Home Screen app on 2026-10-06, while every
// emulator drew them); buttons always draw. Same look as main.css's select, same list as
// SelectHost's (Select.css classes), so it reads as one control.
//
//   <Combo value={v} options={[[value, label], ...]} onChange={(value) => ...} ariaLabel="Opponent" name="opponent" />
//
// Values keep their type (numbers stay numbers). Keys: Space/Enter/Alt+Down open, arrows
// move, Enter picks, Escape closes; a press outside closes.
const Combo = ({ value, options, onChange, disabled = false, ariaLabel, name, className = "" }) => {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [rect, setRect] = useState(null)
  const btnRef = useRef(null)
  const listRef = useRef(null)
  const touchPick = useRef(0)
  const downAt = useRef(null)
  const index = Math.max(0, options.findIndex(([v]) => v === value || String(v) === String(value)))
  const label = options[index]?.[1] ?? ""

  const show = () => {
    if (disabled || !btnRef.current) return
    setRect(btnRef.current.getBoundingClientRect())
    setActive(index)
    setOpen(true)
  }
  const pick = (i) => {
    if (options[i]?.[2]?.disabled) return
    setOpen(false)
    const opt = options[i]
    if (opt && opt[0] !== value) onChange?.(opt[0])
    btnRef.current?.focus({ preventScroll: true })
  }

  // a press anywhere else, the window losing focus or the page resizing closes it
  useEffect(() => {
    if (!open) return
    const outside = (e) => {
      if (listRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const close = () => setOpen(false)
    document.addEventListener("pointerdown", outside, true)
    window.addEventListener("blur", close)
    window.addEventListener("resize", close)
    return () => {
      document.removeEventListener("pointerdown", outside, true)
      window.removeEventListener("blur", close)
      window.removeEventListener("resize", close)
    }
  }, [open])

  // keep the highlighted row in view
  useLayoutEffect(() => {
    if (!open) return
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView?.({ block: "nearest" })
  }, [open, active])

  const onKeyDown = (e) => {
    if (!open) {
      if (e.key === " " || e.key === "Enter" || (e.altKey && e.key === "ArrowDown") || e.key === "F4") {
        e.preventDefault()
        show()
      }
      return
    }
    if (e.key === "Escape") setOpen(false)
    else if (e.key === "ArrowDown") setActive((a) => Math.min(options.length - 1, a + 1))
    else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1))
    else if (e.key === "Enter" || e.key === " ") pick(active)
    else return
    e.preventDefault()
  }

  // the list under the box (above it when there's no room), as wide as the box at least
  let pop = null
  if (open && rect) {
    const vh = window.innerHeight
    const vw = window.innerWidth
    const rowH = document.querySelector(".os-root.os-mobile") ? 40 : 18
    const h = Math.min(options.length * rowH + 2, Math.max(120, Math.max(vh - rect.bottom, rect.top) - 8))
    const down = vh - rect.bottom >= h + 4 || vh - rect.bottom >= rect.top
    const width = Math.max(rect.width, 120)
    const style = { left: Math.max(2, Math.min(rect.left, vw - width - 2)), top: down ? rect.bottom : Math.max(2, rect.top - h), width }
    pop = createPortal(
      <div className="selLayer" onContextMenu={(e) => e.preventDefault()}>
        <div className="selDrop" style={style}>
          <ul ref={listRef} className="selList" role="listbox" aria-label={ariaLabel} style={{ maxHeight: h }} data-combo-list={name || ""}>
            {options.map(([v, l, o], i) => (
              <li
                key={String(v)}
                data-i={i}
                role="option"
                aria-selected={v === value}
                aria-disabled={o?.disabled || undefined}
                className={`selRow${i === active ? " is-active" : ""}${o?.disabled ? " is-disabled" : ""}`}
                onPointerEnter={(e) => e.pointerType === "mouse" && setActive(i)}
                // a finger picks on release (iOS can skip the click on a plain list row); the
                // click that follows is ignored
                onPointerDown={(e) => (downAt.current = { x: e.clientX, y: e.clientY })}
                onPointerUp={(e) => {
                  if (e.pointerType === "mouse") return
                  const d = downAt.current
                  if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) return // a scroll, not a tap
                  touchPick.current = performance.now()
                  pick(i)
                }}
                onClick={() => performance.now() - touchPick.current > 600 && pick(i)}
              >
                {l}
              </li>
            ))}
          </ul>
        </div>
      </div>,
      document.querySelector(".os-root") || document.body
    )
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`selCombo${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        data-field={name}
        data-value={String(value)}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <span className="selComboText">{label}</span>
        <span className="selComboBtn" aria-hidden="true" />
      </button>
      {pop}
    </>
  )
}

// A drop-in for <select>: the same <option> children and the same onChange(event) (with
// event.target.value as a string, as a real select gives), drawn as a Combo.
//   <Select value={x} onChange={(e) => setX(e.target.value)} aria-label="Season"><option value="a">A</option>...</Select>
const textOf = (node) => (node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(textOf).join("") : node.props ? textOf(node.props.children) : "")
const optionsOf = (children, out = []) => {
  React.Children.forEach(children, (c) => {
    if (!c || typeof c !== "object") return
    if (c.type === "option") out.push([String(c.props.value ?? textOf(c.props.children)), textOf(c.props.children), { disabled: !!c.props.disabled }])
    else if (c.type === React.Fragment || c.type === "optgroup") optionsOf(c.props.children, out)
  })
  return out
}
export const Select = ({ value, onChange, children, disabled, id, className, "aria-label": ariaLabel, ...rest }) => {
  const options = optionsOf(children)
  const name = rest["data-field"] || id || Object.keys(rest).find((k) => k.startsWith("data-"))?.slice(5)
  return <Combo value={String(value ?? "")} options={options} disabled={disabled} ariaLabel={ariaLabel} name={name} className={className} onChange={(v) => onChange?.({ target: { value: v }, currentTarget: { value: v } })} />
}

export default Combo
