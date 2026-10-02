import React from "react"

// WordPad's toolbar pictures: small 16x16 drawings (original art)

const Svg = ({ children }) => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" shapeRendering="crispEdges">
    {children}
  </svg>
)

const page = <path d="M3.5 1.5h6l3 3v10h-9z" fill="#fff" stroke="#000" />

const lines = (rows) => rows.map(([x, y, w]) => <rect key={`${x}-${y}`} x={x} y={y} width={w} height="1" fill="#000" />)

export const ICONS = {
  new: (
    <Svg>
      {page}
      <path d="M9.5 1.5v3h3" fill="none" stroke="#000" />
    </Svg>
  ),
  open: (
    <Svg>
      <path d="M1.5 4.5h4l1 1h6v8h-11z" fill="#e8c840" stroke="#000" />
      <path d="M3.5 8.5h11l-2 5h-11z" fill="#fff0a0" stroke="#000" />
    </Svg>
  ),
  save: (
    <Svg>
      <path d="M1.5 1.5h12l1 1v12h-13z" fill="#000080" stroke="#000" />
      <rect x="4" y="2" width="8" height="5" fill="#fff" />
      <rect x="4" y="10" width="8" height="5" fill="#c0c0c0" />
      <rect x="9" y="11" width="2" height="3" fill="#000080" />
    </Svg>
  ),
  print: (
    <Svg>
      <path d="M4.5 1.5h7v5h-7z" fill="#fff" stroke="#000" />
      <path d="M1.5 6.5h13v6h-13z" fill="#c0c0c0" stroke="#000" />
      <path d="M4.5 10.5h7v4h-7z" fill="#fff" stroke="#000" />
      <rect x="12" y="8" width="1" height="1" fill="#00c000" />
    </Svg>
  ),
  preview: (
    <Svg>
      {page}
      <circle cx="9" cy="9" r="3" fill="#bfe8ff" stroke="#000" />
      <path d="M11 11l3.5 3.5" stroke="#000" strokeWidth="2" />
    </Svg>
  ),
  find: (
    <Svg>
      <circle cx="6.5" cy="6.5" r="4.5" fill="#bfe8ff" stroke="#000" />
      <path d="M10 10l4.5 4.5" stroke="#000" strokeWidth="2.2" />
    </Svg>
  ),
  cut: (
    <Svg>
      <path d="M5 1l5 9M11 1L6 10" stroke="#000" />
      <circle cx="4.5" cy="12.5" r="2" fill="none" stroke="#000080" strokeWidth="1.4" />
      <circle cx="11.5" cy="12.5" r="2" fill="none" stroke="#000080" strokeWidth="1.4" />
    </Svg>
  ),
  copy: (
    <Svg>
      <path d="M1.5 1.5h6l2 2v7h-8z" fill="#fff" stroke="#000" />
      <path d="M6.5 5.5h6l2 2v7h-8z" fill="#fff" stroke="#000" />
      {lines([
        [8, 8, 5],
        [8, 10, 5],
        [8, 12, 4],
      ])}
    </Svg>
  ),
  paste: (
    <Svg>
      <path d="M2.5 2.5h9v12h-9z" fill="#c08040" stroke="#000" />
      <path d="M5.5 1.5h3v2h-3z" fill="#c0c0c0" stroke="#000" />
      <path d="M7.5 6.5h7v8h-7z" fill="#fff" stroke="#000" />
      {lines([
        [9, 9, 4],
        [9, 11, 4],
      ])}
    </Svg>
  ),
  undo: (
    <Svg>
      <path d="M5 4h5a4 4 0 0 1 0 8H6" fill="none" stroke="#000080" strokeWidth="2" shapeRendering="auto" />
      <path d="M1 4l5-3.5v7z" fill="#000080" />
    </Svg>
  ),
  datetime: (
    <Svg>
      <path d="M1.5 2.5h13v12h-13z" fill="#fff" stroke="#000" />
      <rect x="2" y="3" width="12" height="3" fill="#c00000" />
      {[4, 7, 10].flatMap((x) => [8, 11].map((y) => <rect key={`${x}${y}`} x={x} y={y} width="2" height="2" fill="#000080" />))}
    </Svg>
  ),
  color: (
    <Svg>
      <path d="M8 1.5c4 0 6.5 2.5 6.5 5.5 0 2-1.5 3-3 3-1.2 0-2 .6-2 1.6 0 1 .6 1.4.6 2.2 0 .8-.8 1.2-2.1 1.2C4 15 1.5 12 1.5 8.2 1.5 4.4 4.3 1.5 8 1.5z" fill="#e0c890" stroke="#000" shapeRendering="auto" />
      <rect x="4" y="5" width="2" height="2" fill="#e00000" />
      <rect x="7" y="3" width="2" height="2" fill="#00a000" />
      <rect x="10" y="5" width="2" height="2" fill="#0000e0" />
      <rect x="4" y="9" width="2" height="2" fill="#e0e000" />
    </Svg>
  ),
  left: (
    <Svg>
      {lines([
        [1, 2, 14],
        [1, 5, 9],
        [1, 8, 14],
        [1, 11, 9],
        [1, 14, 12],
      ])}
    </Svg>
  ),
  center: (
    <Svg>
      {lines([
        [1, 2, 14],
        [4, 5, 8],
        [1, 8, 14],
        [4, 11, 8],
        [2, 14, 12],
      ])}
    </Svg>
  ),
  right: (
    <Svg>
      {lines([
        [1, 2, 14],
        [6, 5, 9],
        [1, 8, 14],
        [6, 11, 9],
        [3, 14, 12],
      ])}
    </Svg>
  ),
  bullets: (
    <Svg>
      {[3, 8, 13].map((y) => (
        <React.Fragment key={y}>
          <rect x="1" y={y - 1} width="3" height="3" fill="#000" />
          <rect x="6" y={y} width="9" height="1" fill="#000" />
        </React.Fragment>
      ))}
    </Svg>
  ),
}
