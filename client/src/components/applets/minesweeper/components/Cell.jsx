import React, { useRef } from "react"
import { mineColor } from "../utils/mineColor"
import Circle from "./Circle"

// Hold a cell this long on a touch screen to flag it (there's no right-click)
const LONG_PRESS_MS = 400

const Cell = ({ data, flagCell, updateBoard }) => {
  const pressTimer = useRef(null)
  const longPressed = useRef(false)
  const lastPointer = useRef("mouse")

  const style = {
    block: {
      width: "var(--ms-cell, 25px)",
      height: "var(--ms-cell, 25px)",
      color: numColorCode(data.value),
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      fontWeight: 800,
      fontSize: 20,
      cursor: "pointer",
      userSelect: "none",
      WebkitUserSelect: "none",
      WebkitTouchCallout: "none",
      background: data.revealed
        ? data.value === "X"
          ? mineColor()
          : bombChexPattern(data.x, data.y)
        : chexPattern(data.x, data.y),
      borderTop: data.revealed ? "0" : "4px solid #eee",
      borderLeft: data.revealed ? "0" : "4px solid #eee",
      borderBottom: data.revealed ? "0" : "4px solid #555",
      borderRight: data.revealed ? "0" : "4px solid #555",
    },
  }

  const cancelLongPress = () => clearTimeout(pressTimer.current)

  const onPointerDown = (e) => {
    lastPointer.current = e.pointerType
    longPressed.current = false
    if (e.pointerType !== "touch") return
    cancelLongPress()
    pressTimer.current = setTimeout(() => {
      longPressed.current = true
      navigator.vibrate?.(15)
      flagCell(data.x, data.y)
    }, LONG_PRESS_MS)
  }

  const onClickUpdate = (e) => {
    // The tap that ended a long press already placed a flag
    if (longPressed.current) {
      longPressed.current = false
      return
    }
    if (data.flagged) {
      return
    }
    updateBoard(data.x, data.y)
  }

  const onClickFlag = (e) => {
    e.preventDefault()
    // Android also reports a long press as a context menu; the timer handles touch
    if (lastPointer.current === "touch") return
    flagCell(data.x, data.y)
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerUp={cancelLongPress}
      onPointerLeave={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onClick={(e) => onClickUpdate(e)}
      onContextMenu={(e) => onClickFlag(e)}
      style={style.block}
    >
      {data.flagged && !data.revealed ? (
        "🚩"
      ) : data.revealed && data.value !== 0 ? (
        data.value === "X" ? (
          <Circle />
        ) : (
          data.value
        )
      ) : (
        ""
      )}
    </div>
  )
}

const chexPattern = (x, y) => {
  if (x % 2 === 0 && y % 2 === 0) {
    return "#C0C0C0"
  } else if (x % 2 === 0 && y % 2 !== 0) {
    return "#C0C0C0"
  } else if (x % 2 !== 0 && y % 2 === 0) {
    return "#C0C0C0"
  } else {
    return "#C0C0C0"
  }
}

const bombChexPattern = (x, y) => {
  if (x % 2 === 0 && y % 2 === 0) {
    return "#C0C0C0"
  } else if (x % 2 === 0 && y % 2 !== 0) {
    return "#ddd"
  } else if (x % 2 !== 0 && y % 2 === 0) {
    return "#ddd"
  } else {
    return "#C0C0C0"
  }
}

const numColorCode = (num) => {
  if (num === 1) {
    return "#1976d2"
  } else if (num === 2) {
    return "#388d3c"
  } else if (num === 3) {
    return "#d33030"
  } else if (num === 4) {
    return "#7c21a2"
  } else if (num === 5) {
    return "#1976d2"
  } else if (num === 6) {
    return "#1976d2"
  } else {
    return "white"
  }
}

export default Cell
