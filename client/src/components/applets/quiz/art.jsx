import { useEffect, useState } from "react"

// Little pictures for the Quiz Show, drawn here (no image files): mode icons, hearts and
// a burst of hearts for a match.

const S = ({ size = 32, children, label }) => (
  <svg className="qzIcon" viewBox="0 0 32 32" width={size} height={size} aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label}>
    {children}
  </svg>
)

export const HeartPath = "M16 28C6 21 3 15.5 3 11.5A6.5 6.5 0 0 1 16 8.5a6.5 6.5 0 0 1 13 3c0 4-3 9.5-13 16.5z"

export const Heart = ({ size = 16, color = "#ff4f8b", stroke = "#a3123f" }) => (
  <S size={size}>
    <path d={HeartPath} fill={color} stroke={stroke} strokeWidth="1.5" />
    <path d="M8 10.5a3 3 0 0 1 3.5-2" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
  </S>
)

export const ICONS = {
  knowme: (size) => (
    <S size={size}>
      <path d="M11 26C4 21 2 17 2 14a4.5 4.5 0 0 1 9-2 4.5 4.5 0 0 1 9 2c0 3-2 7-9 12z" fill="#ff7aa8" stroke="#a3123f" />
      <path d="M21 22c-5-3.5-6.5-6.5-6.5-8.5a3.3 3.3 0 0 1 6.5-1.4 3.3 3.3 0 0 1 6.5 1.4c0 2-1.5 5-6.5 8.5z" fill="#ffd1e1" stroke="#a3123f" transform="translate(2 -6)" />
      <text x="23" y="14" fontSize="8" fontWeight="bold" fill="#7b3fa0" fontFamily="Arial">?</text>
    </S>
  ),
  tot: (size) => (
    <S size={size}>
      <rect x="2" y="6" width="12" height="20" rx="2" fill="#7ec8ff" stroke="#1d5f99" />
      <rect x="18" y="6" width="12" height="20" rx="2" fill="#ffb86b" stroke="#a35a12" />
      <path d="M17.5 3l-3 12h4l-3 14" stroke="#7b3fa0" strokeWidth="2" fill="none" strokeLinejoin="round" />
    </S>
  ),
  compat: (size) => (
    <S size={size}>
      <rect x="3" y="8" width="26" height="18" rx="1.5" fill="#fff6d6" stroke="#8a6d1a" />
      <path d="M3.5 9l12.5 9 12.5-9" fill="none" stroke="#8a6d1a" />
      <path d="M16 23c-4-2.6-5.2-4.6-5.2-6a2.5 2.5 0 0 1 5.2-1 2.5 2.5 0 0 1 5.2 1c0 1.4-1.2 3.4-5.2 6z" fill="#ff4f8b" stroke="#a3123f" strokeWidth="0.8" />
    </S>
  ),
  deep: (size) => (
    <S size={size}>
      <rect x="9" y="3" width="17" height="23" rx="2" fill="#b49cff" stroke="#3d2a80" transform="rotate(12 17 15)" />
      <rect x="5" y="5" width="17" height="23" rx="2" fill="#fff" stroke="#3d2a80" />
      <path d="M9 11h9M9 15h9M9 19h6" stroke="#9a8ac9" strokeWidth="1.4" />
      <path d="M17.5 24c-2-1.3-2.6-2.3-2.6-3a1.3 1.3 0 0 1 2.6-.5 1.3 1.3 0 0 1 2.6.5c0 .7-.6 1.7-2.6 3z" fill="#ff4f8b" />
    </S>
  ),
  aboutus: (size) => (
    <S size={size}>
      <circle cx="16" cy="13" r="9" fill="#ffe066" stroke="#a37f00" />
      <rect x="12" y="21" width="8" height="5" fill="#c0c0c0" stroke="#404040" />
      <path d="M12 28h8" stroke="#404040" strokeWidth="1.5" />
      <path d="M16 17c-2.6-1.7-3.4-3-3.4-4a1.7 1.7 0 0 1 3.4-.6 1.7 1.7 0 0 1 3.4.6c0 1-.8 2.3-3.4 4z" fill="#ff4f8b" />
      <path d="M7 4l2 2M25 4l-2 2M3 13h2M27 13h2" stroke="#a37f00" strokeWidth="1.5" strokeLinecap="round" />
    </S>
  ),
  party: (size) => (
    <S size={size}>
      <path d="M4 28L12 8l12 12z" fill="#ffb86b" stroke="#a35a12" strokeLinejoin="round" />
      <path d="M8 18l6 6M10 13l8 8" stroke="#ff4f8b" strokeWidth="2" />
      <circle cx="22" cy="6" r="2" fill="#7ec8ff" />
      <circle cx="27" cy="13" r="1.6" fill="#ff4f8b" />
      <path d="M18 3l1 3M28 6l-3 2M26 20l3 1" stroke="#7b3fa0" strokeWidth="1.6" strokeLinecap="round" />
    </S>
  ),
  builder: (size) => (
    <S size={size}>
      <rect x="4" y="3" width="18" height="25" fill="#fff" stroke="#404040" />
      <path d="M7 9h12M7 13h12M7 17h8" stroke="#7ec8ff" strokeWidth="1.4" />
      <path d="M27 9l3 3-12 12-4 1 1-4z" fill="#ffe066" stroke="#7a5a00" strokeLinejoin="round" />
      <path d="M14 25l1-4 3 3z" fill="#404040" />
    </S>
  ),
  inbox: (size) => (
    <S size={size}>
      <path d="M4 14l4-8h16l4 8v12H4z" fill="#d8d0ff" stroke="#3d2a80" strokeLinejoin="round" />
      <path d="M4 14h7l2 3h6l2-3h7" fill="none" stroke="#3d2a80" />
      <path d="M16 13c-2.4-1.6-3.1-2.8-3.1-3.7a1.6 1.6 0 0 1 3.1-.6 1.6 1.6 0 0 1 3.1.6c0 .9-.7 2.1-3.1 3.7z" fill="#ff4f8b" />
    </S>
  ),
  history: (size) => (
    <S size={size}>
      <path d="M9 4h14v7a7 7 0 0 1-14 0z" fill="#ffd23f" stroke="#8a6d1a" />
      <path d="M9 7H5a4 4 0 0 0 5 6M23 7h4a4 4 0 0 1-5 6" fill="none" stroke="#8a6d1a" strokeWidth="1.5" />
      <path d="M14 18h4v5h-4z" fill="#ffd23f" stroke="#8a6d1a" />
      <rect x="10" y="23" width="12" height="5" fill="#8a6d1a" />
      <path d="M16 13c-2-1.3-2.6-2.3-2.6-3a1.3 1.3 0 0 1 2.6-.5 1.3 1.3 0 0 1 2.6.5c0 .7-.6 1.7-2.6 3z" fill="#ff4f8b" />
    </S>
  ),
}

export const ModeIcon = ({ mode, size = 32 }) => (ICONS[mode] ? ICONS[mode](size) : null)

// Badges: a rosette with a heart
export const Rosette = ({ on, size = 36 }) => (
  <S size={size}>
    <path d="M10 20l-3 10 5-3 3 4 2-10M22 20l3 10-5-3-3 4-2-10" fill={on ? "#ff7aa8" : "#bbb"} stroke={on ? "#a3123f" : "#777"} strokeLinejoin="round" />
    <circle cx="16" cy="13" r="10" fill={on ? "#ffe066" : "#ddd"} stroke={on ? "#a37f00" : "#888"} strokeWidth="1.5" />
    <circle cx="16" cy="13" r="7" fill="none" stroke={on ? "#a37f00" : "#999"} strokeDasharray="2 1.5" />
    <path d="M16 17c-2.6-1.7-3.4-3-3.4-4a1.7 1.7 0 0 1 3.4-.6 1.7 1.7 0 0 1 3.4.6c0 1-.8 2.3-3.4 4z" fill={on ? "#ff4f8b" : "#aaa"} />
  </S>
)

// Hearts flying out from the middle: show it with a new `burst` number each time
const COLORS = ["#ff4f8b", "#ff7aa8", "#ffb3cf", "#e0457b", "#ff9ec4", "#c94fff"]
export const HeartBurst = ({ burst, count = 16 }) => {
  const [shown, setShown] = useState(null)
  useEffect(() => {
    if (!burst) return
    setShown(burst)
    const t = setTimeout(() => setShown(null), 1500)
    return () => clearTimeout(t)
  }, [burst])
  if (!shown) return null
  return (
    <div className="qzBurst" key={shown} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 + (shown % 7) * 0.3
        const dist = 90 + ((i * 37 + shown * 13) % 70)
        const style = {
          "--dx": `${Math.cos(angle) * dist}px`,
          "--dy": `${Math.sin(angle) * dist - 30}px`,
          "--rot": `${((i * 47) % 60) - 30}deg`,
          "--delay": `${(i % 4) * 40}ms`,
        }
        return (
          <span key={i} className="qzBurstHeart" style={style}>
            <Heart size={12 + ((i * 5) % 14)} color={COLORS[i % COLORS.length]} stroke="none" />
          </span>
        )
      })}
    </div>
  )
}
