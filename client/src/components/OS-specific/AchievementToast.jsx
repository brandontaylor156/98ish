import React, { useEffect, useState } from "react"
import { onUnlock } from "../../utils/achievements"
import { notify } from "../../utils/notifications"
import "./Shell.css"

export const Trophy = ({ size = 32, locked = false }) => (
  <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" className={locked ? "trophy is-locked" : "trophy"}>
    <path d="M9 4h14v7a7 7 0 0 1-14 0z" fill="#f2c230" stroke="#6a4a00" strokeWidth="1.5" />
    <path d="M9 7H4v2a5 5 0 0 0 5 5M23 7h5v2a5 5 0 0 1-5 5" fill="none" stroke="#6a4a00" strokeWidth="1.5" />
    <path d="M13 6v6" stroke="#fff6c0" strokeWidth="2" strokeLinecap="round" />
    <rect x="14" y="17" width="4" height="5" fill="#c99a10" stroke="#6a4a00" strokeWidth="1.2" />
    <rect x="10" y="22" width="12" height="5" fill="#8a5a20" stroke="#3a2000" strokeWidth="1.2" />
  </svg>
)

// "Achievement unlocked": a little window that slides up in the bottom-right corner for a
// few seconds (one at a time, in order) with a fanfare (played by unlock()).
const AchievementToast = () => {
  const [queue, setQueue] = useState([])

  useEffect(
    () =>
      onUnlock((a) => {
        setQueue((q) => [...q, a])
        notify({ app: "achievements", global: true, key: `ach:${a.id}`, title: `Achievement: ${a.title}`, text: a.text, read: true })
      }),
    []
  )

  const current = queue[0]
  useEffect(() => {
    if (!current) return
    const t = setTimeout(() => setQueue((q) => q.slice(1)), 4500)
    return () => clearTimeout(t)
  }, [current])

  if (!current) return null
  return (
    <div className="window achToast" role="status" aria-live="polite" key={current.id} onClick={() => setQueue((q) => q.slice(1))}>
      <div className="title-bar">
        <div className="title-bar-text">Achievement unlocked!</div>
      </div>
      <div className="achToastBody">
        <Trophy />
        <div>
          <b>{current.title}</b>
          <p>{current.text}</p>
        </div>
      </div>
    </div>
  )
}

export default AchievementToast
