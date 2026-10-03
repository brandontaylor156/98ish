import React from "react"

// A little pixel portrait made from a name (the same name, the same face). Computer players
// get a robot head with an antenna; people get hair and a smile.

const BGS = ["#3a6ea5", "#7a3fa0", "#a0522d", "#2e8b57", "#b03060", "#4b6b8a", "#8a6d1f", "#2f7f8f"]
const SKINS = ["#f1c9a5", "#e0ac69", "#c68642", "#8d5524", "#ffdbac", "#d4a373"]
const HAIRS = ["#2b1b0e", "#6b3e1e", "#d9a441", "#111", "#a33", "#555"]
const BOTS = ["#c0c0c0", "#9fb7c9", "#c9b38f", "#a9c9a4"]

const hash = (s) => {
  let h = 5381
  for (const ch of String(s)) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0
  return h
}

const Avatar = ({ name = "", bot = false, size = 36 }) => {
  const h = hash(name)
  const bg = BGS[h % BGS.length]
  if (bot) {
    const metal = BOTS[(h >> 3) % BOTS.length]
    const eye = ["#0f0", "#0ff", "#f80", "#f0f"][(h >> 5) % 4]
    return (
      <svg className="lcAvatar" viewBox="0 0 12 12" width={size} height={size} shapeRendering="crispEdges" aria-hidden="true">
        <rect width="12" height="12" fill={bg} />
        <rect x="5.5" y="0.5" width="1" height="2" fill="#333" />
        <rect x="5" y="0" width="2" height="1" fill={eye} />
        <rect x="2" y="2.5" width="8" height="7" fill={metal} />
        <rect x="2" y="2.5" width="8" height="1" fill="#fff" opacity=".5" />
        <rect x="3" y="4.5" width="6" height="2" fill="#123" />
        <rect x="3.5" y="5" width="1.5" height="1" fill={eye} />
        <rect x="7" y="5" width="1.5" height="1" fill={eye} />
        <rect x="4" y="7.5" width="4" height="1" fill="#333" />
        <rect x="1" y="5" width="1" height="2" fill="#666" />
        <rect x="10" y="5" width="1" height="2" fill="#666" />
        <rect x="3" y="10" width="6" height="2" fill="#555" />
      </svg>
    )
  }
  const skin = SKINS[(h >> 2) % SKINS.length]
  const hair = HAIRS[(h >> 4) % HAIRS.length]
  const long = (h >> 7) % 2 === 0
  const shirt = BGS[(h >> 9) % BGS.length]
  return (
    <svg className="lcAvatar" viewBox="0 0 12 12" width={size} height={size} shapeRendering="crispEdges" aria-hidden="true">
      <rect width="12" height="12" fill={bg} />
      {long && <rect x="2" y="2" width="8" height="7" fill={hair} />}
      <rect x="3" y="2.5" width="6" height="6.5" fill={skin} />
      <rect x="2.5" y="1.5" width="7" height="2" fill={hair} />
      <rect x="4" y="5" width="1" height="1" fill="#222" />
      <rect x="7" y="5" width="1" height="1" fill="#222" />
      <rect x="4.5" y="7" width="3" height="0.8" fill="#8a3030" />
      <rect x="2" y="9.5" width="8" height="2.5" fill={shirt} />
      <rect x="2" y="9.5" width="8" height="0.6" fill="#fff" opacity=".35" />
    </svg>
  )
}

export default Avatar
