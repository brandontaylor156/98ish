import React from "react"

// Playing cards drawn from scratch in SVG: corner indices, pips laid out like a real deck,
// simple framed court cards, and a blue patterned back. Cards are "QS", "TH", "2C"...

export const SUIT_NAMES = { C: "clubs", D: "diamonds", H: "hearts", S: "spades" }
const RANK_LABEL = { T: "10", J: "J", Q: "Q", K: "K", A: "A" }
export const rankLabel = (card) => RANK_LABEL[card[0]] || card[0]
export const cardName = (card) => `${{ T: "10", J: "jack", Q: "queen", K: "king", A: "ace" }[card[0]] || card[0]} of ${SUIT_NAMES[card[1]]}`
const isRed = (card) => card[1] === "H" || card[1] === "D"

// Suit shapes in a 16x16 box
const SUIT_PATHS = {
  H: "M8 14.5C5.2 11.8 1 9.3 1 5.6 1 3.4 2.7 1.6 4.6 1.6c1.5 0 2.7.9 3.4 2.2.7-1.3 1.9-2.2 3.4-2.2 1.9 0 3.6 1.8 3.6 4 0 3.7-4.2 6.2-7 8.9z",
  D: "M8 1l6 7-6 7-6-7z",
  S: "M8 1C6 4 1 6.6 1 10c0 1.9 1.5 3.2 3.2 3.2 1.1 0 2-.5 2.7-1.3L6 15h4l-.9-3.1c.7.8 1.6 1.3 2.7 1.3 1.7 0 3.2-1.3 3.2-3.2C15 6.6 10 4 8 1z",
  C: "M8 1.2a3.2 3.2 0 0 0-2.4 5.3A3.2 3.2 0 1 0 6.9 11.6L6 15h4l-.9-3.4a3.2 3.2 0 1 0 1.3-5.1A3.2 3.2 0 0 0 8 1.2z",
}

export const Suit = ({ suit, x = 0, y = 0, size = 16, flip, fill }) => (
  <path
    d={SUIT_PATHS[suit]}
    fill={fill}
    transform={`translate(${x} ${y}) scale(${size / 16})${flip ? " rotate(180 8 8)" : ""}`}
  />
)

// Pip centers in a 1x1 box for 2-10
const PIPS = {
  2: [[0.5, 0], [0.5, 1]],
  3: [[0.5, 0], [0.5, 0.5], [0.5, 1]],
  4: [[0, 0], [1, 0], [0, 1], [1, 1]],
  5: [[0, 0], [1, 0], [0.5, 0.5], [0, 1], [1, 1]],
  6: [[0, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  7: [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  8: [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0.5, 0.75], [0, 1], [1, 1]],
  9: [[0, 0], [1, 0], [0, 1 / 3], [1, 1 / 3], [0.5, 0.5], [0, 2 / 3], [1, 2 / 3], [0, 1], [1, 1]],
  10: [[0, 0], [1, 0], [0.5, 1 / 6], [0, 1 / 3], [1, 1 / 3], [0, 2 / 3], [1, 2 / 3], [0.5, 5 / 6], [0, 1], [1, 1]],
}

const W = 60
const H = 84

const Face = ({ card }) => {
  const suit = card[1]
  const color = isRed(card) ? "#c00000" : "#000"
  const rank = card[0]
  const label = rankLabel(card)
  const n = Number(label)

  let middle = null
  if (rank === "A") {
    middle = <Suit suit={suit} x={W / 2 - 13} y={H / 2 - 13} size={26} fill={color} />
  } else if (n >= 2 && n <= 10) {
    // pips inside x 16..44, y 14..70
    middle = PIPS[n].map(([px, py], i) => (
      <Suit key={i} suit={suit} x={16 + px * 28 - 6} y={14 + py * 56 - 6} size={12} flip={py > 0.5} fill={color} />
    ))
  } else {
    // Court cards: a framed panel with a band, a crown and the letter
    const band = isRed(card) ? "#c00000" : "#1a1a8c"
    middle = (
      <g>
        <rect x="12" y="12" width="36" height="60" fill="#fff8dc" stroke={color} strokeWidth="1" />
        <rect x="12" y="38" width="36" height="8" fill={band} />
        <path d="M20 31l3-8 4 5 3-7 3 7 4-5 3 8z" fill="#e0b000" stroke="#7a5a00" strokeWidth="0.7" transform={rank === "J" ? "translate(0 3) scale(1 0.8)" : undefined} />
        <text x="30" y="65" textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontSize="18" fontWeight="bold" fill={color}>
          {label}
        </text>
        <Suit suit={suit} x={24} y={36} size={12} fill="#fff" />
      </g>
    )
  }

  return (
    <>
      <rect x="0.5" y="0.5" width={W - 1} height={H - 1} rx="4" fill="#fff" stroke="#000" />
      <g fill={color}>
        <text x="7" y="12" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize={label.length > 1 ? 9 : 11} fontWeight="bold" letterSpacing={label.length > 1 ? -1 : 0}>
          {label}
        </text>
        <Suit suit={suit} x={2.5} y={14} size={9} fill={color} />
        <g transform={`rotate(180 ${W / 2} ${H / 2})`}>
          <text x="7" y="12" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize={label.length > 1 ? 9 : 11} fontWeight="bold" letterSpacing={label.length > 1 ? -1 : 0}>
            {label}
          </text>
          <Suit suit={suit} x={2.5} y={14} size={9} fill={color} />
        </g>
      </g>
      {middle}
    </>
  )
}

const Back = () => (
  <>
    <defs>
      <pattern id="cardBackPattern" width="6" height="6" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" fill="#1c3fa8" />
        <path d="M0 3L3 0L6 3L3 6Z" fill="#3a63d8" />
        <circle cx="3" cy="3" r="0.8" fill="#fff" />
      </pattern>
    </defs>
    <rect x="0.5" y="0.5" width={W - 1} height={H - 1} rx="4" fill="#fff" stroke="#000" />
    <rect x="4" y="4" width={W - 8} height={H - 8} rx="2" fill="url(#cardBackPattern)" stroke="#0d2470" />
  </>
)

export const Card = ({ card, faceDown, className = "", onClick, disabled, selected, label, style }) => {
  const classes = ["htCard", className, selected && "is-selected", onClick && !disabled && "is-playable", disabled && "is-disabled"].filter(Boolean).join(" ")
  const svg = (
    <svg viewBox={`0 0 ${W} ${H}`} className="htCardSvg" aria-hidden="true">
      {faceDown ? <Back /> : <Face card={card} />}
    </svg>
  )
  if (onClick) {
    return (
      <button type="button" className={classes} style={style} onClick={onClick} disabled={disabled} aria-label={label || cardName(card)} aria-pressed={selected || undefined} data-card={card}>
        {svg}
      </button>
    )
  }
  return (
    <div className={classes} style={style} role="img" aria-label={faceDown ? "card" : label || cardName(card)} data-card={faceDown ? undefined : card}>
      {svg}
    </div>
  )
}
