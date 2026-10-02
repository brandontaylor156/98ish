import React from "react"

// Original chess piece drawings: simple solid shapes on a 45 x 45 grid. White pieces are
// white with black outlines; black pieces are near-black with light detail lines.

const SHAPES = {
  p: (d) => (
    <>
      <rect x="10" y="35" width="25" height="5" rx="1.5" />
      <path d="M19 21c-1 6-4 10-7 14h21c-3-4-6-8-7-14z" />
      <path d="M17.5 18.5h10l-1.5 3h-7z" />
      <circle cx="22.5" cy="12.5" r="5" />
      <path d="M15 35h15" stroke={d} fill="none" />
    </>
  ),
  r: (d) => (
    <>
      <rect x="9" y="36" width="27" height="4.5" rx="1.5" />
      <path d="M11.5 36l1.5-4h19l1.5 4z" />
      <path d="M14.5 32l1.5-14h13l1.5 14z" />
      <path d="M12 18V9.5h4.5v3h3.5v-3h5v3h3.5v-3H33V18z" />
      <path d="M15.5 18h14M15 31.5h15" stroke={d} fill="none" />
    </>
  ),
  n: (d) => (
    <>
      <rect x="10" y="36" width="26" height="4.5" rx="1.5" />
      <path d="M13 36c0-5 2.5-8.5 7-10.5L12.5 28c-2 .5-4-1-3.5-3.2L11 19c1-3.2 3.3-6 6-7.8L18.5 6l3.5 4 2.5-4.5 2 5.2C32.5 13 35.5 19.5 35.5 27v9z" />
      <circle cx="18.5" cy="15.5" r="1.3" fill={d} stroke="none" />
      <circle cx="11.6" cy="24.6" r=".9" fill={d} stroke="none" />
      <path d="M26.5 11.5c3.3 3 5 8 5 15.5" stroke={d} fill="none" />
    </>
  ),
  b: (d) => (
    <>
      <rect x="10" y="36" width="25" height="4.5" rx="1.5" />
      <path d="M13 36c3-2 4.5-4.5 4.5-7.5h10c0 3 1.5 5.5 4.5 7.5z" />
      <path d="M22.5 9.5c-5 4-8 9-7 14 .6 3 3.2 5 7 5s6.4-2 7-5c1-5-2-10-7-14z" />
      <circle cx="22.5" cy="7" r="2.6" />
      <path d="M25 14l-4.5 6.5M17.5 28.5h10" stroke={d} fill="none" />
    </>
  ),
  q: (d) => (
    <>
      <rect x="9" y="36" width="27" height="4.5" rx="1.5" />
      <path d="M11.5 36l2.5-5h17l2.5 5z" />
      <path d="M14 31L9 15l6.5 6.5L16 11l3.5 8.5 3-11 3 11L29 11l.5 10.5L36 15l-5 16z" />
      <circle cx="9" cy="13.5" r="2.2" />
      <circle cx="16" cy="9.5" r="2.2" />
      <circle cx="22.5" cy="6.5" r="2.2" />
      <circle cx="29" cy="9.5" r="2.2" />
      <circle cx="36" cy="13.5" r="2.2" />
      <path d="M14.5 27.5h16" stroke={d} fill="none" />
    </>
  ),
  k: (d) => (
    <>
      <rect x="9" y="36" width="27" height="4.5" rx="1.5" />
      <path d="M11.5 36l2.5-5h17l2.5 5z" />
      <path d="M14 31l-2.5-11.5c3.5-3.5 8.5-3.5 11 .5 2.5-4 7.5-4 11-.5L31 31z" />
      <path d="M21 4h3v3.5h3.5v3H24V17h-3v-6.5h-3.5v-3H21z" />
      <path d="M14.5 27h16M22.5 17v3" stroke={d} fill="none" />
    </>
  ),
}

export const ChessPiece = ({ piece, className = "chPiece" }) => {
  const white = piece === piece.toUpperCase()
  const detail = white ? "#000" : "#e8e8e8"
  return (
    <svg className={className} viewBox="0 0 45 45" aria-hidden="true">
      <g fill={white ? "#fff" : "#1c1c1c"} stroke="#000" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
        {SHAPES[piece.toLowerCase()](detail)}
      </g>
    </svg>
  )
}

export const PIECE_NAMES = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" }
