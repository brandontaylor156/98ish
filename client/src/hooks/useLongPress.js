import { useEffect, useRef } from "react"
import { getSettings } from "../utils/settings"
import { onInputReset, swallowNextClick } from "../utils/inputGuard"

// how long to hold: Control Panel > Mouse > Touch (settings.longPressMs)
const holdMs = () => getSettings().longPressMs || 500
const SLOP_PX = 10

// Touch screens have no right-click: a long press stands in for it. Spread the returned
// props on an element; `onLongPress(x, y, event)` fires after holding still for half a
// second. Mouse right-clicks still use onContextMenu as usual. A press the page loses (the
// app put away, the phone turned: utils/inputGuard.js) is dropped, never finished later.
export const useLongPress = (onLongPress) => {
  const state = useRef(null)

  const cancel = () => {
    if (state.current) clearTimeout(state.current.timer)
    state.current = null
  }
  useEffect(() => onInputReset(cancel), [])

  return {
    onPointerDown: (e) => {
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return
      cancel()
      const { clientX: x, clientY: y } = e
      const target = e.target
      state.current = {
        x,
        y,
        timer: setTimeout(() => {
          state.current = null
          navigator.vibrate?.(12)
          // swallow the click that ends this press
          swallowNextClick(600)
          onLongPress(x, y, { target })
        }, holdMs()),
      }
    },
    onPointerMove: (e) => {
      const s = state.current
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > SLOP_PX) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
  }
}
