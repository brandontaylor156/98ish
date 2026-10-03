import React from "react"

// Original little pictures for the Welcome screen: the banner's computer and the icons
// down the left column (32x32, drawn in the chunky 98 style).

const K = "#1a1a2e"

// a beige computer saying hi, for the banner
export const BannerComputer = () => (
  <svg className="welComputer" viewBox="0 0 96 88" width="96" height="88" aria-hidden="true">
    <ellipse cx="48" cy="84" rx="38" ry="3.5" fill="rgba(0,0,0,.25)" />
    {/* monitor */}
    <rect x="12" y="4" width="72" height="56" rx="5" fill="#e9e1cc" stroke={K} strokeWidth="2" />
    <rect x="12" y="4" width="72" height="5" rx="3" fill="#fff8e6" opacity=".7" />
    <rect x="20" y="11" width="56" height="40" rx="3" fill="#0b6e74" stroke={K} strokeWidth="2" />
    <rect x="22" y="13" width="52" height="36" rx="2" fill="url(#welScreen)" />
    <defs>
      <linearGradient id="welScreen" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#3ec9c1" />
        <stop offset="1" stopColor="#0f7f9a" />
      </linearGradient>
    </defs>
    {/* the screen's face */}
    <g className="welFace">
      <ellipse cx="38" cy="28" rx="3" ry="4" fill={K} />
      <ellipse cx="58" cy="28" rx="3" ry="4" fill={K} />
      <circle cx="39" cy="26.6" r="1" fill="#fff" />
      <circle cx="59" cy="26.6" r="1" fill="#fff" />
      <path d="M40 36q8 7 16 0" fill="none" stroke={K} strokeWidth="2.4" strokeLinecap="round" />
      <ellipse cx="31" cy="35" rx="3.2" ry="1.8" fill="#ff8fb1" opacity=".75" />
      <ellipse cx="65" cy="35" rx="3.2" ry="1.8" fill="#ff8fb1" opacity=".75" />
    </g>
    <path d="M24 15h14" stroke="#fff" strokeWidth="2" opacity=".35" strokeLinecap="round" />
    <circle cx="74" cy="55" r="1.6" fill="#3cb043" />
    {/* stand and keyboard */}
    <path d="M38 60h20l3 7H35z" fill="#d8cfb6" stroke={K} strokeWidth="2" strokeLinejoin="round" />
    <path d="M14 70h68l4 10H10z" fill="#e9e1cc" stroke={K} strokeWidth="2" strokeLinejoin="round" />
    <path d="M20 73h56M18 76.5h60" stroke="#a89f86" strokeWidth="1.6" strokeDasharray="3 1.6" />
    {/* waving hand */}
    <g className="welWave">
      <path d="M84 30c4-1 7 2 6 6l-3 8c-1 3-5 4-8 2" fill="#e9e1cc" stroke={K} strokeWidth="2" strokeLinejoin="round" />
      <path d="M86 28l1-5M90 30l2-4M91 35l3-2" stroke={K} strokeWidth="1.6" strokeLinecap="round" />
    </g>
  </svg>
)

const Svg = ({ children }) => (
  <svg className="welIcon" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
    {children}
  </svg>
)

// a yellow help balloon with a little path of footsteps: the tour
const TourIcon = () => (
  <Svg>
    <path d="M3 4h22a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H13l-6 5v-5H3a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z" transform="translate(2 1)" fill="#ffffe1" stroke={K} strokeWidth="1.6" strokeLinejoin="round" />
    <circle cx="10" cy="12" r="1.8" fill="#1060d0" />
    <circle cx="16" cy="12" r="1.8" fill="#1060d0" />
    <circle cx="22" cy="12" r="1.8" fill="#1060d0" />
    <path d="M22 26l2 3 4-6" fill="none" stroke="#2a9a3a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
)

// a little monitor full of colorful program icons
const ComputerIcon = () => (
  <Svg>
    <rect x="3" y="3" width="26" height="19" rx="2" fill="#e9e1cc" stroke={K} strokeWidth="1.6" />
    <rect x="6" y="6" width="20" height="13" fill="#0f7f9a" />
    <rect x="8" y="8" width="4" height="4" fill="#ffd23f" />
    <rect x="14" y="8" width="4" height="4" fill="#ff6b8b" />
    <rect x="20" y="8" width="4" height="4" fill="#7ee07e" />
    <rect x="8" y="14" width="4" height="3" fill="#b9a8ff" />
    <rect x="14" y="14" width="4" height="3" fill="#fff" />
    <path d="M12 22h8l2 4H10z" fill="#d8cfb6" stroke={K} strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M6 28h20" stroke={K} strokeWidth="2" strokeLinecap="round" />
  </Svg>
)

// a globe with two chat balloons
const FriendsIcon = () => (
  <Svg>
    <circle cx="14" cy="17" r="11" fill="#2f7fe0" stroke={K} strokeWidth="1.5" />
    <path d="M7 12c3-1 4 1 5 2s-1 3 1 4-1 4-3 4-4-3-4-5 0-4 1-5z" fill="#3cb043" />
    <path d="M16 9c2 0 4 1 4 3s-2 2-1 4 3 1 2 4-3 3-4 2 0-3-1-4-2-1-2-3 1-6 2-6z" fill="#3cb043" />
    <path d="M18 2h11a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-5l-3 3v-3h-3a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#fff" stroke={K} strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M20 6.5h7" stroke="#1060d0" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M2 23h7a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5l-2 2v-2H2" fill="#ffe36b" stroke={K} strokeWidth="1.3" strokeLinejoin="round" />
  </Svg>
)

// two hearts, one tucked behind the other
const CouplesIcon = () => (
  <Svg>
    <path d="M20 27C12 21 9 17 9 13a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 4-3 8-7 14z" fill="#ff9ec4" stroke={K} strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M12 29C4 23 1 19 1 15a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 4-3 8-7 14z" fill="#ff4f7b" stroke={K} strokeWidth="1.5" strokeLinejoin="round" />
    <ellipse cx="6" cy="14" rx="2" ry="1.3" fill="#fff" opacity=".7" />
  </Svg>
)

// a painter's palette and brush
const YoursIcon = () => (
  <Svg>
    <path d="M15 3C7 3 2 9 2 15c0 7 6 12 12 12 3 0 4-2 3-4s0-4 3-4h4c4 0 6-3 6-6 0-6-7-10-15-10z" fill="#f2d7a6" stroke={K} strokeWidth="1.5" strokeLinejoin="round" />
    <circle cx="9" cy="11" r="2.4" fill="#e53935" />
    <circle cx="15" cy="8" r="2.4" fill="#ffd23f" />
    <circle cx="22" cy="10" r="2.4" fill="#2f7fe0" />
    <circle cx="8" cy="18" r="2.4" fill="#3cb043" />
    <path d="M30 18L19 29" stroke="#8a5a2b" strokeWidth="2.6" strokeLinecap="round" />
    <path d="M19 29l-3 1 1-3z" fill={K} />
  </Svg>
)

// an open guestbook and a pen
const InvolvedIcon = () => (
  <Svg>
    <path d="M2 7c5-2 9-2 14 1v20c-5-3-9-3-14-1z" fill="#fff" stroke={K} strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M30 7c-5-2-9-2-14 1v20c5-3 9-3 14-1z" fill="#fffbe6" stroke={K} strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M5 12c3-1 5-1 8 0M5 16c3-1 5-1 8 0M5 20c3-1 5-1 8 0" stroke="#8aa0c8" strokeWidth="1.2" />
    <path d="M20 15c1-2 2.5-2 3 0s2 2 3-1" fill="none" stroke="#c0306a" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M27 2l3 3-9 9-4 1 1-4z" fill="#ffd23f" stroke={K} strokeWidth="1.4" strokeLinejoin="round" />
  </Svg>
)

// a door left open
const CloseIcon = () => (
  <Svg>
    <rect x="6" y="3" width="18" height="26" fill="#3a3a5a" stroke={K} strokeWidth="1.5" />
    <path d="M6 3l12 3v26L6 29z" fill="#c98b4a" stroke={K} strokeWidth="1.5" strokeLinejoin="round" />
    <circle cx="15" cy="17" r="1.3" fill="#ffd23f" />
    <path d="M24 16h6M27 13l3 3-3 3" fill="none" stroke="#2a9a3a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
)

export const OPTION_ICONS = {
  tour: TourIcon,
  computer: ComputerIcon,
  friends: FriendsIcon,
  couples: CouplesIcon,
  yours: YoursIcon,
  involved: InvolvedIcon,
  close: CloseIcon,
}

// the small "i" of a help balloon
export const InfoIcon = ({ size = 18 }) => (
  <svg viewBox="0 0 18 18" width={size} height={size} aria-hidden="true" className="welInfo">
    <circle cx="9" cy="9" r="8" fill="#fff" stroke="#1060d0" strokeWidth="1.5" />
    <circle cx="9" cy="5" r="1.3" fill="#1060d0" />
    <path d="M9 8v6" stroke="#1060d0" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
)
