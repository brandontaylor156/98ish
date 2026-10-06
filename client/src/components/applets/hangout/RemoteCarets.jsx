import React, { useEffect, useLayoutEffect, useRef, useState } from "react"

// Friends' carets and selections over a <textarea> (Come Over's shared Notepad). A textarea
// can't color parts of itself, so a see-through copy of its text sits exactly on top, with
// the same font, wrapping and scroll: selected words get a light tint in that friend's
// color, the caret a 2px bar with their name over it. It ignores the pointer.
const STYLES = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "tabSize", "textIndent", "wordSpacing", "boxSizing"]

const RemoteCarets = ({ areaRef, text, carets, colorOf }) => {
  const box = useRef(null)
  const inner = useRef(null)
  const [, setTick] = useState(0)

  // follow the textarea's size, font and scroll
  useLayoutEffect(() => {
    const el = areaRef.current
    const b = box.current
    if (!el || !b) return
    const cs = getComputedStyle(el)
    for (const k of STYLES) b.style[k] = cs[k]
    b.style.borderStyle = "solid"
    b.style.borderColor = "transparent"
    b.style.left = `${el.offsetLeft}px`
    b.style.top = `${el.offsetTop}px`
    b.style.width = `${el.offsetWidth}px`
    b.style.height = `${el.offsetHeight}px`
    const wrap = el.getAttribute("wrap") !== "off"
    inner.current.style.whiteSpace = wrap ? "pre-wrap" : "pre"
    inner.current.style.overflowWrap = wrap ? "break-word" : "normal"
    // the textarea's scrollbar takes width from its text area
    inner.current.style.width = `${el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)}px`
    inner.current.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`
  })
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const bump = () => setTick((n) => n + 1)
    el.addEventListener("scroll", bump)
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(bump) : null
    ro?.observe(el)
    return () => {
      el.removeEventListener("scroll", bump)
      ro?.disconnect()
    }
  }, [areaRef.current])

  if (!carets.length) return null
  // cut the text at every caret and selection edge
  const cuts = new Set([0, text.length])
  for (const c of carets) {
    cuts.add(Math.min(c.s, text.length))
    cuts.add(Math.min(c.e, text.length))
  }
  const points = [...cuts].sort((a, b) => a - b)
  const parts = []
  for (let i = 0; i < points.length; i++) {
    const at = points[i]
    for (const c of carets) if (Math.min(c.e, text.length) === at) parts.push(<span key={`c-${c.key}`} className="rcCaret" style={{ borderColor: colorOf(c.key) }} data-caret={c.key}>
          <span className="rcName" style={{ background: colorOf(c.key) }}>
            {c.name}
          </span>
        </span>)
    const next = points[i + 1]
    if (next == null || next === at) continue
    const piece = text.slice(at, next)
    const over = carets.find((c) => c.s <= at && c.e >= next && c.e > c.s)
    parts.push(
      <span key={`t-${at}`} style={over ? { background: `${colorOf(over.key)}33` } : undefined}>
        {piece}
      </span>
    )
  }
  return (
    <div ref={box} className="rcBox" aria-hidden="true">
      <div ref={inner} className="rcInner">
        {parts}
        {"​"}
      </div>
    </div>
  )
}

export default RemoteCarets
