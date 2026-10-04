import { GLYPHS, fromPx } from "../../../shared/controls"

// Tetris's on-screen controls for the shared TouchControls (reusable by other Tetris modes).
// The defaults reproduce the classic pad, measured from the grid in main.css (touch layouts
// use the compact 6px padding and gaps):
// - portrait: rotate above a d-pad on the left, one big hard drop on the right, all in a
//   106px row under the board; Pause above Hold at the bottom of the left panel
// - landscape: the d-pad at the left edge, hard drop at the right edge, Pause and Hold at
//   the bottom of the left panel beside the board
// Rotate left is available but off until a player turns it on (the d-pad has clockwise only).

const PAD = 6
const ROW = 50
const PAD_ROW = ROW * 2 + PAD // the pad row under the board (portrait)

// Portrait: the move cluster (200px) and drop column (120px) share the row and shrink alike
const portraitPad = ({ width }) => {
  const room = width - PAD * 2 - 16
  const shrink = Math.max(0, 320 - room) / 320
  const cluster = 200 * (1 - shrink)
  const drop = 120 * (1 - shrink)
  return { col: (cluster - PAD * 2) / 3, drop }
}

// Landscape: columns are "1fr 64px board 64px 1fr", board = min((h - 12) / 2, 40% of w)
const landscapeSide = ({ width, height }) => {
  const board = Math.min((height - 12) / 2, width * 0.4)
  const fr = (width - PAD * 2 - (64 + board + 64) - PAD * 4) / 2
  return PAD + fr + PAD // left edge of the left side panel
}

// A pad button in grid column `i` (0-2) of the move cluster; row 0 is the top row
const portraitCell = (i, row) => (size) => {
  const { col } = portraitPad(size)
  return fromPx(size, { left: PAD + i * (col + PAD), top: size.height - PAD - PAD_ROW + row * (ROW + PAD), width: col, height: ROW })
}
const landscapeCell = (i, row) => (size) =>
  fromPx(size, { left: PAD + i * 58, top: size.height - PAD - PAD_ROW + row * (ROW + PAD), width: 52, height: ROW })

export const TETRIS_CONTROLS = [
  {
    id: "rotateRight",
    label: "Rotate",
    icon: GLYPHS.rotateRight,
    className: "tetrisPadButton",
    default: { portrait: portraitCell(1, 0), landscape: landscapeCell(1, 0) },
  },
  {
    id: "rotateLeft",
    label: "Rotate left",
    icon: GLYPHS.rotateLeft,
    className: "tetrisPadButton",
    enabled: false,
    default: { portrait: portraitCell(2, 0), landscape: landscapeCell(2, 0) },
  },
  { id: "left", label: "Move left", icon: GLYPHS.left, className: "tetrisPadButton", default: { portrait: portraitCell(0, 1), landscape: landscapeCell(0, 1) } },
  { id: "softDrop", label: "Soft drop", icon: GLYPHS.down, className: "tetrisPadButton", default: { portrait: portraitCell(1, 1), landscape: landscapeCell(1, 1) } },
  { id: "right", label: "Move right", icon: GLYPHS.right, className: "tetrisPadButton", default: { portrait: portraitCell(2, 1), landscape: landscapeCell(2, 1) } },
  {
    id: "hardDrop",
    label: "Hard drop",
    icon: GLYPHS.hardDrop,
    className: "tetrisPadButton tetrisPad--drop",
    default: {
      portrait: (size) => {
        const { drop } = portraitPad(size)
        return fromPx(size, { right: PAD, bottom: PAD, width: drop, height: PAD_ROW })
      },
      landscape: (size) => fromPx(size, { right: PAD, bottom: PAD, width: 110, height: PAD_ROW }),
    },
  },
  {
    id: "hold",
    label: "Hold",
    className: "tetrisPadButton tetrisHoldButton",
    default: {
      portrait: (size) => fromPx(size, { left: PAD, bottom: PAD + PAD_ROW + PAD, width: 64, height: ROW }),
      landscape: (size) => fromPx(size, { left: landscapeSide(size), bottom: PAD, width: 64, height: ROW }),
    },
  },
  {
    id: "pause",
    label: "Pause",
    className: "tetrisPauseButton",
    default: {
      portrait: (size) => fromPx(size, { left: PAD, bottom: PAD + PAD_ROW + PAD + ROW + PAD, width: 64, height: 32 }),
      landscape: (size) => fromPx(size, { left: landscapeSide(size), bottom: PAD + ROW + PAD, width: 64, height: 32 }),
    },
  },
  // Arena only: use the item you're holding. Bottom of the right panel, mirroring Hold.
  {
    id: "item",
    label: "Use item",
    className: "tetrisPadButton tetrisItemButton",
    default: {
      portrait: (size) => fromPx(size, { right: PAD, bottom: PAD + PAD_ROW + PAD, width: 64, height: ROW }),
      landscape: (size) => fromPx(size, { right: landscapeSide(size), bottom: PAD, width: 64, height: ROW }),
    },
  },
]

// With swipe gestures on the board (utils/gestures.js) the pad shrinks to one compact,
// see-through row: soft drop and hard drop on the left, rotate left and right on the right
// (portrait: under the board; landscape: at the screen edges). Hold, Pause and Item keep
// their spots in the side panels. Each scheme saves its own arrangement (controlsGameFor),
// so the classic pad's is kept for anyone who switches back.
export const GESTURE_ROW = 48
const SEE_THROUGH = 0.75

const row = (side, offset, width) => (size) => fromPx(size, { [side]: PAD + offset, bottom: PAD, width, height: GESTURE_ROW })
const atRow = (side, offset, width) => ({ portrait: row(side, offset, width), landscape: row(side, offset, width) })

const GESTURE_BUTTONS = [
  { id: "rotateRight", label: "Rotate", icon: GLYPHS.rotateRight, className: "tetrisPadButton", opacity: SEE_THROUGH, default: atRow("right", 0, 72) },
  { id: "rotateLeft", label: "Rotate left", icon: GLYPHS.rotateLeft, className: "tetrisPadButton", opacity: SEE_THROUGH, default: atRow("right", 72 + PAD, 56) },
  { id: "softDrop", label: "Soft drop", icon: GLYPHS.down, className: "tetrisPadButton", opacity: SEE_THROUGH, default: atRow("left", 0, 56) },
  { id: "hardDrop", label: "Hard drop", icon: GLYPHS.hardDrop, className: "tetrisPadButton tetrisPad--drop", opacity: SEE_THROUGH, default: atRow("left", 56 + PAD, 56) },
]

const byId = (id) => TETRIS_CONTROLS.find((c) => c.id === id)
// a side-panel button at `bottom` px (portrait) and the classic spot in landscape
const sideAt = (id, portrait, landscape) => {
  const c = byId(id)
  return { ...c, default: { portrait, landscape: landscape || c.default.landscape } }
}

const SCHEME_CONTROLS = {
  buttons: TETRIS_CONTROLS,
  // the row under the board is lower than the classic pad: Hold and Pause move down with it
  "gestures+buttons": [
    ...GESTURE_BUTTONS,
    sideAt("hold", (size) => fromPx(size, { left: PAD, bottom: PAD + GESTURE_ROW + PAD, width: 64, height: ROW })),
    sideAt("pause", (size) => fromPx(size, { left: PAD, bottom: PAD + GESTURE_ROW + PAD + ROW + PAD, width: 64, height: 32 })),
    sideAt("item", (size) => fromPx(size, { right: PAD, bottom: PAD + GESTURE_ROW + PAD, width: 64, height: ROW })),
  ],
  // gestures only: Pause and Item at the very bottom of the side panels
  gestures: [
    sideAt(
      "pause",
      (size) => fromPx(size, { left: PAD, bottom: PAD, width: 64, height: 32 }),
      (size) => fromPx(size, { left: landscapeSide(size), bottom: PAD, width: 64, height: 32 })
    ),
    sideAt("item", (size) => fromPx(size, { right: PAD, bottom: PAD, width: 64, height: ROW })),
  ],
}

// Where each scheme's arrangement is saved (shared/controls, per orientation)
export const controlsGameFor = (scheme) => ({ buttons: "tetris", gestures: "tetris-swipe" })[scheme] || "tetris-gestures"

// The same layout for every mode (so a player's arrangement carries over: positions are
// saved by id). The Item button only exists in the Arena and Pause only offline (a match
// doesn't stop), so neither shows up, even in the layout editor, where it does nothing.
export const controlsFor = ({ item = false, pause = true, scheme = "buttons" } = {}) =>
  (SCHEME_CONTROLS[scheme] || TETRIS_CONTROLS).filter((c) => (c.id === "item" ? item : c.id === "pause" ? pause : true))
