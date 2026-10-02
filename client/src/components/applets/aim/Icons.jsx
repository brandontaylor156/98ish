// Tiny pixel icons for the Buddy List, drawn in SVG so they stay crisp at any scale

const Icon = ({ children, title }) => (
  <svg className="aimIcon" viewBox="0 0 16 16" width="16" height="16" shapeRendering="crispEdges" aria-label={title} role="img">
    {children}
  </svg>
)

// Buddy just signed on: door swung open
export const DoorOpen = () => (
  <Icon title="Signed on">
    <rect x="3" y="1" width="10" height="14" fill="#3a2a10" />
    <rect x="4" y="2" width="8" height="13" fill="#fff8c0" />
    <path d="M4 2l5 2v11l-5-0z" fill="#b5651d" stroke="#5a3210" strokeWidth="0.6" />
    <rect x="7" y="9" width="1" height="1" fill="#ffd700" />
  </Icon>
)

// Buddy just signed off: door shut
export const DoorClosed = () => (
  <Icon title="Signed off">
    <rect x="3" y="1" width="10" height="14" fill="#3a2a10" />
    <rect x="4" y="2" width="8" height="13" fill="#b5651d" />
    <rect x="5" y="3" width="6" height="4" fill="#9a5418" />
    <rect x="5" y="9" width="6" height="4" fill="#9a5418" />
    <rect x="10" y="8" width="1" height="1" fill="#ffd700" />
  </Icon>
)

// Away: a little note
export const AwayNote = () => (
  <Icon title="Away">
    <path d="M3 1h8l3 3v11H3z" fill="#fff" stroke="#000" strokeWidth="1" />
    <path d="M11 1v3h3" fill="#ddd" stroke="#000" strokeWidth="1" />
    <rect x="5" y="6" width="7" height="1" fill="#000080" />
    <rect x="5" y="8" width="7" height="1" fill="#000080" />
    <rect x="5" y="10" width="5" height="1" fill="#000080" />
  </Icon>
)

// Blank spacer keeps names aligned
export const NoIcon = () => <span className="aimIcon" />
