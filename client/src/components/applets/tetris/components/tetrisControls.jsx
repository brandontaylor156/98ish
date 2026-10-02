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

// The same layout for every mode (so a player's arrangement carries over: positions are
// saved by id). The Item button only exists in the Arena and Pause only offline (a match
// doesn't stop), so neither shows up, even in the layout editor, where it does nothing.
export const controlsFor = ({ item = false, pause = true } = {}) =>
  TETRIS_CONTROLS.filter((c) => (c.id === "item" ? item : c.id === "pause" ? pause : true))
