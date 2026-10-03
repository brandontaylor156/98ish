import React from "react"
import { cardName } from "./cards"

// Last Card's own card faces (CSS in LastCard.css): a dark rim, the color's field with a
// fine pixel dither, a bevelled white diamond in the middle holding the number or symbol,
// and corner marks. Wilds are black with a four-color pinwheel. The back is teal with a
// little 98-style window plaque that says LAST CARD.

const SkipIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M2.5 5l7 7-7 7M9.5 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="miter" />
    <rect x="18.5" y="4" width="3.2" height="16" fill="currentColor" />
  </svg>
)
const SkipAllIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M1.5 6l5 6-5 6M7 6l5 6-5 6M12.5 6l5 6-5 6" fill="none" stroke="currentColor" strokeWidth="2.6" />
    <rect x="19" y="4" width="3" height="16" fill="currentColor" />
  </svg>
)
const RevIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 8.5h14" stroke="currentColor" strokeWidth="3" />
    <path d="M14 3.5l6 5-6 5z" fill="currentColor" />
    <path d="M21 15.5H7" stroke="currentColor" strokeWidth="3" />
    <path d="M10 10.5l-6 5 6 5z" fill="currentColor" />
  </svg>
)
const DiscardIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3" y="3" width="10" height="13" fill="none" stroke="currentColor" strokeWidth="2" />
    <rect x="7" y="6" width="10" height="13" fill="currentColor" opacity=".55" />
    <path d="M19 6v10M15.5 13l3.5 4 3.5-4" fill="none" stroke="currentColor" strokeWidth="2.4" />
  </svg>
)
export const Pinwheel = ({ className = "lcPin" }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path d="M12 1l11 11H12z" fill="#e2412f" />
    <path d="M23 12L12 23V12z" fill="#f4c21b" />
    <path d="M12 23L1 12h11z" fill="#2f9e4a" />
    <path d="M1 12L12 1v11z" fill="#2667d1" />
    <path d="M12 1l11 11-11 11L1 12z" fill="none" stroke="#fff" strokeWidth="1.2" />
  </svg>
)

const BIG = {
  skip: <SkipIcon />,
  skipall: <SkipAllIcon />,
  rev: <RevIcon />,
  discall: <DiscardIcon />,
}
const DRAW_TEXT = { d2: "+2", wd4: "+4", wd6: "+6" }

// What goes in the middle diamond
const Face = ({ card }) => {
  if (card.v === "wild") return <Pinwheel />
  if (card.v === "wd4" || card.v === "wd6")
    return (
      <>
        <Pinwheel className="lcPin is-faint" />
        <span className="lcBigText is-draw">{DRAW_TEXT[card.v]}</span>
      </>
    )
  if (BIG[card.v]) return <span className="lcBigIcon">{BIG[card.v]}</span>
  if (card.v === "d2") return <span className="lcBigText is-draw">+2</span>
  return <span className={`lcBigText${card.v === "6" || card.v === "9" ? " is-under" : ""}`}>{card.v}</span>
}

// The little mark in the corners
const Corner = ({ card }) => {
  if (DRAW_TEXT[card.v]) return DRAW_TEXT[card.v]
  if (card.v === "wild") return "W"
  if (BIG[card.v]) return <span className="lcCornerIcon">{BIG[card.v]}</span>
  return <span className={card.v === "6" || card.v === "9" ? "is-under" : undefined}>{card.v}</span>
}

const Card = ({ card, back = false, className = "", style, ...rest }) => {
  if (back || !card) {
    return (
      <div className={`lcCard is-back ${className}`} style={style} aria-label="A face-down card" {...rest}>
        <span className="lcBackPlaque" aria-hidden="true">
          <i />
          <b>LAST</b>
          <b>CARD</b>
        </span>
      </div>
    )
  }
  return (
    <div className={`lcCard is-${card.c} ${className}`} style={style} aria-label={cardName(card)} {...rest}>
      <span className="lcCorner is-tl" aria-hidden="true">
        <Corner card={card} />
      </span>
      <span className="lcGem" aria-hidden="true">
        <Face card={card} />
      </span>
      <span className="lcCorner is-br" aria-hidden="true">
        <Corner card={card} />
      </span>
    </div>
  )
}

export default Card
