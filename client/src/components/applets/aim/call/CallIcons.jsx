// Small chunky icons for calls, drawn in SVG (original art) so they stay crisp at any size

const Svg = ({ size = 16, children, label }) => (
  <svg className="callIcon" viewBox="0 0 16 16" width={size} height={size} aria-hidden={label ? undefined : "true"} aria-label={label} role={label ? "img" : undefined}>
    {children}
  </svg>
)

// An old desk-phone handset
export const PhoneIcon = ({ size, missed, down, light }) => (
  <Svg size={size}>
    <g transform={down ? "rotate(135 8 8)" : undefined}>
      <path d="M3 2.5c.8-.6 1.8-.5 2.3.3l1.1 1.8c.4.7.2 1.5-.4 2l-.8.6c.6 1.4 1.7 2.6 3.1 3.3l.7-.8c.5-.6 1.4-.7 2-.3l1.8 1.1c.8.5.9 1.6.3 2.3l-.9 1c-.9 1-2.4 1.2-3.6.5C5.5 12.6 3.4 10.4 2.1 7.4c-.6-1.3-.3-2.8.7-3.7z" fill={light ? "#fff" : down ? "#c00000" : missed ? "#a00000" : "#008000"} stroke={light ? "#400000" : "#000"} strokeWidth="0.7" />
    </g>
    {missed && <path d="M10 1.5l4 4M14 1.5l-4 4" stroke="#c00000" strokeWidth="1.6" />}
  </Svg>
)

// A camcorder
export const VideoIcon = ({ size, missed, off }) => (
  <Svg size={size}>
    <rect x="1" y="4.5" width="9.5" height="7" rx="1" fill={missed ? "#a00000" : "#000080"} stroke="#000" strokeWidth="0.7" />
    <path d="M10.5 7l4-2.2v6.4l-4-2.2z" fill={missed ? "#a00000" : "#000080"} stroke="#000" strokeWidth="0.7" />
    <circle cx="4" cy="6.8" r="1" fill="#9cf" />
    {off && <path d="M1.5 14.5l13-13" stroke="#c00000" strokeWidth="1.8" />}
  </Svg>
)

export const MicIcon = ({ size, off }) => (
  <Svg size={size}>
    <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" fill="#404040" stroke="#000" strokeWidth="0.7" />
    <path d="M3.5 7.5a4.5 4.5 0 009 0M8 12v2.5M5.5 14.5h5" fill="none" stroke="#000" strokeWidth="1.2" />
    {off && <path d="M2 14l12-12" stroke="#c00000" strokeWidth="1.8" />}
  </Svg>
)

// Front/back: a camera with turning arrows
export const FlipIcon = ({ size }) => (
  <Svg size={size}>
    <rect x="2" y="4.5" width="12" height="8" rx="1" fill="#808080" stroke="#000" strokeWidth="0.7" />
    <rect x="5.5" y="3" width="5" height="2" fill="#808080" stroke="#000" strokeWidth="0.7" />
    <path d="M5.5 8.5a2.5 2.5 0 014.6-1.3M10.5 8.5a2.5 2.5 0 01-4.6 1.3" fill="none" stroke="#fff" strokeWidth="1.1" />
    <path d="M10.6 5.6v2h-2M5.4 11.4v-2h2" fill="none" stroke="#fff" strokeWidth="1" />
  </Svg>
)

// A little monitor
export const ScreenIcon = ({ size }) => (
  <Svg size={size}>
    <rect x="1.5" y="2" width="13" height="9" fill="#008080" stroke="#000" strokeWidth="0.7" />
    <rect x="2.5" y="3" width="11" height="7" fill="#00a0a0" />
    <path d="M6 13.5h4M8 11v2.5" stroke="#000" strokeWidth="1.2" />
    <path d="M8 4.5l2 2H9v2H7v-2H6z" fill="#fff" />
  </Svg>
)

// Picture-in-picture: a small window inside a big one
export const PipIcon = ({ size }) => (
  <Svg size={size}>
    <rect x="1.5" y="2.5" width="13" height="11" fill="#fff" stroke="#000" strokeWidth="0.9" />
    <rect x="8" y="8" width="5.5" height="4.5" fill="#000080" />
  </Svg>
)
