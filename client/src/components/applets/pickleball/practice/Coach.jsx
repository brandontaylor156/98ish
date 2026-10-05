import React from "react"

// Coach Pat: a simple drawn coach (cap, whistle, a friendly face) who gives the tips
export const Coach = ({ small = false, mood = "happy" }) => (
  <svg className={`pkCoach${small ? " is-small" : ""}`} viewBox="0 0 40 44" role="img" aria-label="Coach Pat">
    <rect x="9" y="30" width="22" height="14" rx="3" fill="#1f6f4a" />
    <path d="M17 30 L20 36 L23 30" fill="#fff" />
    <circle cx="20" cy="19" r="11" fill="#e2a878" stroke="#5a3a22" strokeWidth="1" />
    <path d="M8 16 Q20 2 32 16 Z" fill="#ff7a5c" stroke="#5a3a22" strokeWidth="1" />
    <rect x="25" y="14" width="11" height="3" rx="1.5" fill="#ff7a5c" stroke="#5a3a22" strokeWidth="0.8" />
    <circle cx="16" cy="20" r="1.4" fill="#1b1b1b" />
    <circle cx="24" cy="20" r="1.4" fill="#1b1b1b" />
    {mood === "happy" ? <path d="M15 24 Q20 29 25 24" fill="none" stroke="#5a3a22" strokeWidth="1.4" strokeLinecap="round" /> : <path d="M16 26 L24 26" stroke="#5a3a22" strokeWidth="1.4" strokeLinecap="round" />}
    <path d="M20 30 L26 36" stroke="#ffd23f" strokeWidth="1" />
    <rect x="25" y="35" width="5" height="3" rx="1" fill="#c0c0c0" stroke="#444" strokeWidth="0.5" />
  </svg>
)
