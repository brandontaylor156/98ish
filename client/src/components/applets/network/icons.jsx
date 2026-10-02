import React from "react"

// Original pixel-style icons for Network Neighborhood

export const ComputerIcon = ({ device = "pc", me, user, size = 32 }) =>
  device === "phone" ? (
    <svg className="nnIcon" viewBox="0 0 32 32" width={size} height={size} shapeRendering="crispEdges" aria-hidden="true">
      <rect x="9.5" y="2.5" width="14" height="27" rx="1" fill="#dfdfdf" stroke="#000" />
      <rect x="11" y="5" width="11" height="18" fill={me ? "#000080" : "#008080"} />
      {user && <path d="M14 9h5v5h-5z" fill="#ffff55" />}
      <rect x="14" y="25" width="5" height="2" fill="#808080" />
    </svg>
  ) : (
    <svg className="nnIcon" viewBox="0 0 32 32" width={size} height={size} shapeRendering="crispEdges" aria-hidden="true">
      <rect x="3.5" y="2.5" width="25" height="19" fill="#dfdfdf" stroke="#000" />
      <rect x="6" y="5" width="20" height="14" fill={me ? "#000080" : "#008080"} />
      <path d="M6 5h20v1H7v13H6z" fill={me ? "#000040" : "#004040"} />
      {user && <path d="M14 8h4v1h1v4h-1v1h-4v-1h-1V9h1zM12 15h8v2h-8z" fill="#ffff55" />}
      <rect x="11.5" y="21.5" width="9" height="2" fill="#808080" stroke="#000" />
      <rect x="2.5" y="23.5" width="27" height="6" fill="#c0c0c0" stroke="#000" />
      <rect x="21" y="26" width="5" height="1" fill="#00a000" />
      <rect x="5" y="26" width="12" height="1" fill="#808080" />
    </svg>
  )

export const EntireNetworkIcon = ({ size = 32 }) => (
  <svg className="nnIcon" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
    <circle cx="16" cy="16" r="13" fill="#0000c0" stroke="#000" />
    <path d="M6 12c4-2 6 2 9 0s5-4 9-2M5 19c4 0 5 3 9 2s6 1 9-2M15 4c-3 6-3 18 1 24" fill="none" stroke="#00d000" strokeWidth="2" />
  </svg>
)

export const SendFileIcon = ({ size = 32 }) => (
  <svg className="nnIcon" viewBox="0 0 32 32" width={size} height={size} shapeRendering="crispEdges" aria-hidden="true">
    <path d="M4.5 2.5h14l5 5v20h-19z" fill="#fff" stroke="#000" />
    <path d="M18.5 2.5v5h5" fill="#c0c0c0" stroke="#000" />
    <path d="M7 11h12v1H7zM7 14h12v1H7zM7 17h9v1H7z" fill="#000080" />
    <path d="M17 20h6v-4l7 7-7 7v-4h-6z" fill="#00a000" stroke="#000" />
  </svg>
)

export const MessageIcon = ({ size = 32 }) => (
  <svg className="nnIcon" viewBox="0 0 32 32" width={size} height={size} shapeRendering="crispEdges" aria-hidden="true">
    <rect x="2.5" y="7.5" width="27" height="18" fill="#ffffc0" stroke="#000" />
    <path d="M3 8l13 10 13-10" fill="none" stroke="#000" />
    <path d="M6 25.5l-2 5 8-5" fill="#ffffc0" stroke="#000" />
  </svg>
)

export const GameIcon = ({ src, size = 32 }) => <img className="nnIcon" src={src} width={size} height={size} alt="" draggable="false" />
