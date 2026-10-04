import React from "react"

// 98ish Help's little pictures (original pixel-style art): books and pages for Contents, the
// toolbar's buttons, and the icons of tips, notes and cautions.

const Svg = ({ size = 16, w = size, h = size, children, className }) => (
  <svg className={className} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false" shapeRendering="crispEdges">
    {children}
  </svg>
)

export const BookIcon = ({ open }) =>
  open ? (
    <Svg>
      <path d="M1 3h6l1 1 1-1h6v10H9l-1 1-1-1H1z" fill="#fff" stroke="#000" />
      <path d="M8 4v9" stroke="#000" />
      <path d="M2.5 5.5h4M2.5 7.5h4M2.5 9.5h4M9.5 5.5h4M9.5 7.5h4M9.5 9.5h4" stroke="#7a7a7a" />
      <path d="M1 13h6l1 1 1-1h6v1H1z" fill="#1b44a8" />
    </Svg>
  ) : (
    <Svg>
      <path d="M3 1h10v12H3z" fill="#1b44a8" stroke="#000" />
      <path d="M3 13h10v2H4l-1-1z" fill="#fff" stroke="#000" />
      <path d="M4 2v10" stroke="#0b2266" />
      <path d="M6 4h5v2H6z" fill="#ffd400" />
    </Svg>
  )

export const PageIcon = () => (
  <Svg>
    <path d="M3 1h7l3 3v11H3z" fill="#fff" stroke="#000" />
    <path d="M10 1v3h3" fill="#dcdcdc" stroke="#000" />
    <path d="M6 5h3v1h1v2H9v1H8v1H7V8h1V7h1V6H7v1H6z" fill="#1b44a8" />
    <path d="M7 11h1v1H7z" fill="#1b44a8" />
  </Svg>
)

const TOOLS = {
  hide: (
    <>
      <path d="M2 4h20v16H2z" fill="#fff" stroke="#000" />
      <path d="M2 4h7v16H2z" fill="#c0c0c0" stroke="#000" />
      <path d="M17 9l-4 3 4 3z" fill="#000" />
    </>
  ),
  show: (
    <>
      <path d="M2 4h20v16H2z" fill="#fff" stroke="#000" />
      <path d="M2 4h7v16H2z" fill="#c0c0c0" stroke="#000" />
      <path d="M13 9l4 3-4 3z" fill="#000" />
    </>
  ),
  back: <path d="M3 12l8-7v4h10v6H11v4z" fill="#1d8a2a" stroke="#000" />,
  forward: <path d="M21 12l-8-7v4H3v6h10v4z" fill="#1d8a2a" stroke="#000" />,
  home: (
    <>
      <path d="M12 3l9 8h-3v9h-5v-5h-2v5H6v-9H3z" fill="#f5e7b0" stroke="#000" />
      <path d="M12 3l9 8h-2L12 5 5 11H3z" fill="#b8312f" stroke="#000" />
    </>
  ),
  print: (
    <>
      <path d="M6 2h12v6H6z" fill="#fff" stroke="#000" />
      <path d="M2 8h20v9H2z" fill="#c0c0c0" stroke="#000" />
      <path d="M6 14h12v8H6z" fill="#fff" stroke="#000" />
      <path d="M8 17h8M8 19h6" stroke="#7a7a7a" />
      <path d="M18 10h2v1h-2z" fill="#1d8a2a" />
    </>
  ),
  options: (
    <>
      <path d="M3 5h18v15H3z" fill="#fff" stroke="#000" />
      <path d="M3 5h18v3H3z" fill="#1b44a8" stroke="#000" />
      <path d="M6 11h3v2H6zM6 15h3v2H6z" fill="#000" />
      <path d="M11 12h7M11 16h7" stroke="#7a7a7a" />
    </>
  ),
}

export const ToolIcon = ({ kind }) => <Svg size={24}>{TOOLS[kind]}</Svg>

export const TipIcon = () => (
  <Svg size={20} className="hlpBoxIcon">
    <path d="M10 1a6 6 0 0 1 4 10.5V14H6v-2.5A6 6 0 0 1 10 1z" fill="#ffe94a" stroke="#000" />
    <path d="M7 15h6v2H7zM8 18h4v1H8z" fill="#9a9a9a" stroke="#000" />
    <path d="M8 4h2v1H8z" fill="#fff" />
  </Svg>
)

export const NoteIcon = () => (
  <Svg size={20} className="hlpBoxIcon">
    <path d="M3 2h11l3 3v13H3z" fill="#fffbd6" stroke="#000" />
    <path d="M6 7h8M6 10h8M6 13h6" stroke="#1b44a8" />
  </Svg>
)

export const WarnIcon = () => (
  <Svg size={20} className="hlpBoxIcon">
    <path d="M10 1l9 17H1z" fill="#ffd400" stroke="#000" />
    <path d="M9 6h2v7H9zM9 14h2v2H9z" fill="#000" />
  </Svg>
)

export const PhoneIcon = () => (
  <Svg size={14}>
    <path d="M3 0h8v14H3z" fill="#333" />
    <path d="M4 2h6v9H4z" fill="#8fd1ff" />
    <path d="M6 12h2v1H6z" fill="#ccc" />
  </Svg>
)

export const MouseIcon = () => (
  <Svg size={14}>
    <path d="M3 4a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0z" fill="#eee" stroke="#000" />
    <path d="M7 1v5M3 6h8" stroke="#000" />
  </Svg>
)
