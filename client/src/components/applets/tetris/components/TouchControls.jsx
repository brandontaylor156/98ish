import React, { useRef, useState } from "react"

// Pixel-style glyphs. SVG rather than ◀ ▶ characters, which iOS draws as color emoji.
const Glyph = ({ children }) => (
    <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" shapeRendering="crispEdges">
        {children}
    </svg>
)

const ICONS = {
    left: <Glyph><path d="M10 3v10L4 8z" /></Glyph>,
    right: <Glyph><path d="M6 3v10l6-5z" /></Glyph>,
    softDrop: <Glyph><path d="M3 5h10l-5 6z" /></Glyph>,
    hardDrop: <Glyph><path d="M3 2h10l-5 5zM3 8h10l-5 5zM3 14h10v1H3z" /></Glyph>,
    rotateRight: (
        <Glyph>
            <path d="M8 2a6 6 0 1 0 6 6h-2a4 4 0 1 1-4-4v2l4-3-4-3z" />
        </Glyph>
    ),
}

// Acts on pointer down (no click delay) and holds until the finger lifts, so left/right
// auto-repeat and soft drop work like held keys. Several buttons can be held at once.
export const PadButton = ({ action, label, press, release, onActivate, className = "", children }) => {
    const held = useRef(false)
    const [down, setDown] = useState(false)

    const onPointerDown = (event) => {
        // Keep focus on the game window and stop long-press menus / text selection
        event.preventDefault()
        event.currentTarget.setPointerCapture?.(event.pointerId)
        held.current = true
        setDown(true)
        onActivate()
        press(action)
    }

    const end = () => {
        if (!held.current) return
        held.current = false
        setDown(false)
        release(action)
    }

    return (
        <button
            type="button"
            tabIndex={-1}
            aria-label={label}
            className={`tetrisPadButton ${down ? "is-pressed" : ""} ${className}`}
            onPointerDown={onPointerDown}
            onPointerUp={end}
            onPointerCancel={end}
            onLostPointerCapture={end}
            onContextMenu={(event) => event.preventDefault()}
        >
            {children ?? ICONS[action]}
        </button>
    )
}

// On-screen controls for touch screens: a d-pad on the left thumb with rotate on top (like
// the Up key), and one big hard drop button on the right thumb. Hold and Pause live in
// the side panel (see TetrisWindow).
const TouchControls = ({ press, release, onActivate }) => {
    const props = { press, release, onActivate }
    return (
        <div className="tetrisPad">
            <div className="tetrisPadCluster tetrisPadCluster--move">
                <PadButton action="rotateRight" label="Rotate" className="tetrisPad--up" {...props} />
                <PadButton action="left" label="Move left" {...props} />
                <PadButton action="softDrop" label="Soft drop" {...props} />
                <PadButton action="right" label="Move right" {...props} />
            </div>
            <div className="tetrisPadCluster tetrisPadCluster--drop">
                <PadButton action="hardDrop" label="Hard drop" className="tetrisPad--drop" {...props} />
            </div>
        </div>
    )
}

export default React.memo(TouchControls)
