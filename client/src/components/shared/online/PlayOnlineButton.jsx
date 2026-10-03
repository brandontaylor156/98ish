import React from "react"
import { useNet } from "../../applets/network/NetContext"
import "./Online.css"

// The globe every online game uses for "Play Online"
export const GlobeIcon = ({ size = 32 }) => (
  <svg className="olGlobe" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
    <defs>
      <radialGradient id="olGlobeSea" cx="38%" cy="32%" r="70%">
        <stop offset="0" stopColor="#6fb6ff" />
        <stop offset="0.6" stopColor="#1060d0" />
        <stop offset="1" stopColor="#002c80" />
      </radialGradient>
    </defs>
    <circle cx="16" cy="16" r="14" fill="url(#olGlobeSea)" stroke="#001850" strokeWidth="1" />
    <path d="M7 9c3-1 5 0 6 2s-1 3 1 5-1 4-3 4-2 3-4 2-3-5-2-8 0-4 2-5z" fill="#3cb043" stroke="#14601c" strokeWidth=".6" />
    <path d="M18 6c2 0 4 1 5 3s-1 2 0 4 3 1 3 4-2 4-4 5-2-2-3-3 1-3-1-4-3-1-3-3 1-6 3-6z" fill="#3cb043" stroke="#14601c" strokeWidth=".6" />
    <path d="M18 24c1-1 3-1 3 1s-2 3-3 2 0-2 0-3z" fill="#3cb043" stroke="#14601c" strokeWidth=".6" />
    <g fill="none" stroke="#cfe8ff" strokeWidth=".7" opacity=".75">
      <ellipse cx="16" cy="16" rx="6" ry="14" />
      <path d="M2 16h28M4.5 9h23M4.5 23h23M16 2v28" />
    </g>
    <ellipse cx="11" cy="9" rx="4" ry="2.4" fill="#fff" opacity=".35" />
  </svg>
)

// "Play Online" for a game's title screen (size "big") or toolbar ("small"). Shows how many
// other people are on the network right now.
const PlayOnlineButton = ({ onClick, label = "Play Online", sub = "Quick Match, rooms and invites", size = "big", className = "", disabled = false, showCount = true, ...rest }) => {
  const net = useNet()
  const others = net?.status === "online" ? net.computers.filter((c) => !c.me).length : 0
  const count = showCount && others > 0 ? `${others} online now` : null
  if (size === "small") {
    return (
      <button type="button" className={`olPlayButton olPlayButton--small ${className}`} onClick={onClick} disabled={disabled} title={sub} {...rest}>
        <GlobeIcon size={16} />
        <span>{label}</span>
        {count && <span className="olLed" title={count} aria-label={count} />}
      </button>
    )
  }
  return (
    <button type="button" className={`olPlayButton ${className}`} onClick={onClick} disabled={disabled} {...rest}>
      <GlobeIcon size={32} />
      <span className="olPlayText">
        <b>{label}</b>
        {sub && <small>{sub}</small>}
      </span>
      {count && (
        <span className="olPlayCount">
          <span className="olLed" aria-hidden="true" />
          {count}
        </span>
      )}
    </button>
  )
}

export default PlayOnlineButton
