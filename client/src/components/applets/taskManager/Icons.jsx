import React from "react"

// Pixel-ish Win9x/NT message box glyphs, drawn as inline SVG so no assets are needed.

export const WarningIcon = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" className="tm-msg-icon" aria-hidden="true">
    <path d="M15 2h2l14 26v2H1v-2z" fill="#000" />
    <path d="M16 4l13.4 24.6H2.6z" fill="#ff0" />
    <rect x="14" y="10" width="4" height="11" fill="#000" />
    <rect x="14" y="23" width="4" height="4" fill="#000" />
  </svg>
)

export const ErrorIcon = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" className="tm-msg-icon" aria-hidden="true">
    <circle cx="17" cy="17" r="14" fill="#808080" />
    <circle cx="15" cy="15" r="14" fill="#f00" />
    <circle cx="15" cy="15" r="14" fill="none" stroke="#800000" strokeWidth="1" />
    <path d="M9 9l12 12M21 9L9 21" stroke="#fff" strokeWidth="3.4" strokeLinecap="square" />
  </svg>
)

export const InfoIcon = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" className="tm-msg-icon" aria-hidden="true">
    <circle cx="17" cy="17" r="14" fill="#808080" />
    <circle cx="15" cy="15" r="14" fill="#fff" stroke="#000" strokeWidth="1" />
    <rect x="13" y="6" width="4" height="4" fill="#00f" />
    <path d="M11 12h6v10h2v2h-8v-2h2v-8h-2z" fill="#00f" />
  </svg>
)

// Menu check mark / radio bullet (7x7 pixel glyphs).
export const CheckGlyph = () => (
  <svg width="7" height="7" viewBox="0 0 7 7" shapeRendering="crispEdges" aria-hidden="true">
    <path
      d="M6 0h1v3H6zM5 1h1v3H5zM4 2h1v3H4zM3 3h1v3H3zM2 4h1v3H2zM1 3h1v3H1zM0 2h1v3H0z"
      fill="currentColor"
    />
  </svg>
)

export const RadioGlyph = () => (
  <svg width="6" height="6" viewBox="0 0 6 6" shapeRendering="crispEdges" aria-hidden="true">
    <path d="M2 0h2v1h1v1h1v2H5v1H4v1H2V5H1V4H0V2h1V1h1z" fill="currentColor" />
  </svg>
)

export const SubmenuArrow = () => (
  <svg width="4" height="7" viewBox="0 0 4 7" shapeRendering="crispEdges" aria-hidden="true">
    <path d="M0 0h1v7H0zM1 1h1v5H1zM2 2h1v3H2zM3 3h1v1H3z" fill="currentColor" />
  </svg>
)
