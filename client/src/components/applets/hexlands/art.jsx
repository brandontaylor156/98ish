import React from "react"
import { SQ3 } from "./board.js"
import { PIPS } from "./logic.js"

// Hexlands' pictures, all drawn here in SVG (no image files): the six terrains, the sea,
// number tokens, harbors, the Bandit, the pieces, resource and development card icons.
// Tiles are drawn around (0, 0) with a corner radius of R units.

export const R = 100
export const HEX_POINTS = [0, 1, 2, 3, 4, 5].map((i) => {
  const a = ((60 * i - 90) * Math.PI) / 180
  return `${(Math.cos(a) * R).toFixed(2)},${(Math.sin(a) * R).toFixed(2)}`
}).join(" ")

// a small seeded random for placing trees, sheep and rocks the same way every time
const rnd = (seed) => {
  let s = (seed * 9301 + 49297) % 233280
  return () => (s = (s * 9301 + 49297) % 233280) / 233280
}

// spots spread over the hex (rejecting ones too near the edge or each other)
const spots = (seed, n, { min = 34, edge = 70, avoidCenter = 0 } = {}) => {
  const r = rnd(seed)
  const out = []
  for (let tries = 0; tries < 400 && out.length < n; tries++) {
    const x = (r() * 2 - 1) * edge
    const y = (r() * 2 - 1) * edge
    if (Math.abs(x) > (SQ3 / 2) * edge || Math.abs(y) + Math.abs(x) / SQ3 > edge) continue
    if (avoidCenter && Math.hypot(x, y) < avoidCenter) continue
    if (out.some((p) => Math.hypot(p.x - x, p.y - y) < min)) continue
    out.push({ x, y })
  }
  return out.sort((a, b) => a.y - b.y)
}

// ---------- shared <defs> ----------

export const BoardDefs = () => (
  <defs>
    <clipPath id="hx-clip" clipPathUnits="userSpaceOnUse">
      <polygon points={HEX_POINTS} />
    </clipPath>
    {Object.entries({
      forest: ["#5c9a45", "#2f6a2d"],
      hills: ["#dc9258", "#a8582c"],
      pasture: ["#b9df78", "#7db34a"],
      fields: ["#f4d868", "#d6a334"],
      mountains: ["#a9b0ba", "#6c7480"],
      desert: ["#f3e2ad", "#d9bd76"],
    }).map(([t, [a, b]]) => (
      <radialGradient key={t} id={`hx-g-${t}`} cx="45%" cy="38%" r="75%">
        <stop offset="0%" stopColor={a} />
        <stop offset="100%" stopColor={b} />
      </radialGradient>
    ))}
    <linearGradient id="hx-sea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#3b82c4" />
      <stop offset="100%" stopColor="#1f5a99" />
    </linearGradient>
    <pattern id="hx-waves" width="60" height="34" patternUnits="userSpaceOnUse">
      <path d="M4 10 q8 -7 16 0 t16 0" fill="none" stroke="#9cc9ef" strokeOpacity=".35" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M32 27 q7 -6 14 0 t14 0" fill="none" stroke="#9cc9ef" strokeOpacity=".25" strokeWidth="2" strokeLinecap="round" />
    </pattern>
    <radialGradient id="hx-token" cx="40%" cy="35%" r="70%">
      <stop offset="0%" stopColor="#fffaf0" />
      <stop offset="100%" stopColor="#ecdcb4" />
    </radialGradient>
    <filter id="hx-shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="3" stdDeviation="2.5" floodColor="#000" floodOpacity=".45" />
    </filter>
    <filter id="hx-soft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="1.6" floodColor="#000" floodOpacity=".35" />
    </filter>
  </defs>
)

// ---------- terrains ----------

const Tree = ({ x, y, s = 1, shade = "#1f5a28", light = "#2f7a36" }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <ellipse cx="0" cy="17" rx="11" ry="3.5" fill="#000" opacity=".18" />
    <rect x="-2.5" y="8" width="5" height="10" fill="#5b3a1e" />
    <path d="M0 -24 L13 -4 L6 -4 L16 10 L-16 10 L-6 -4 L-13 -4 Z" fill={shade} />
    <path d="M0 -24 L13 -4 L6 -4 L16 10 L0 10 Z" fill={light} opacity=".55" />
  </g>
)

const Sheep = ({ x, y, flip }) => (
  <g transform={`translate(${x} ${y}) scale(${flip ? -1 : 1} 1)`}>
    <ellipse cx="0" cy="11" rx="12" ry="3" fill="#000" opacity=".15" />
    <path d="M-6 6 v6 M5 6 v6" stroke="#333" strokeWidth="2.2" />
    <g fill="#fbfbf3" stroke="#d7d6c8" strokeWidth=".8">
      <circle cx="-7" cy="0" r="6" />
      <circle cx="0" cy="-3" r="7" />
      <circle cx="7" cy="0" r="6" />
      <circle cx="0" cy="4" r="6.5" />
    </g>
    <ellipse cx="11.5" cy="-3" rx="4" ry="5" fill="#3b3a38" />
    <circle cx="12.5" cy="-4.5" r=".9" fill="#fff" />
  </g>
)

const Peak = ({ x, y, s = 1 }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M-30 18 L0 -30 L30 18 Z" fill="#7b838f" />
    <path d="M0 -30 L30 18 L6 18 Z" fill="#5c636e" />
    <path d="M0 -30 L-10 -14 L-4 -16 L1 -10 L6 -16 L10 -14 Z" fill="#fff" />
    <path d="M-16 6 l5 -3 M12 8 l4 -4" stroke="#4f5560" strokeWidth="1.6" strokeLinecap="round" />
  </g>
)

const Wheat = ({ x, y }) => (
  <g transform={`translate(${x} ${y})`} stroke="#9c6e14" strokeWidth="1.6" strokeLinecap="round">
    <path d="M0 14 L-5 -10 M0 14 L0 -12 M0 14 L5 -10" />
    <g fill="#f7dd73" stroke="#b07f1c" strokeWidth=".8">
      <ellipse cx="-5.5" cy="-12" rx="2.6" ry="5" />
      <ellipse cx="0" cy="-14" rx="2.6" ry="5" />
      <ellipse cx="5.5" cy="-12" rx="2.6" ry="5" />
    </g>
    <path d="M-5 6 h10" stroke="#c7962a" strokeWidth="2.4" />
  </g>
)

const Bricks = ({ x, y }) => (
  <g transform={`translate(${x} ${y})`}>
    <ellipse cx="0" cy="9" rx="18" ry="4" fill="#000" opacity=".15" />
    <g fill="#b9472a" stroke="#7d2a16" strokeWidth="1">
      <rect x="-16" y="0" width="15" height="7" rx="1" />
      <rect x="1" y="0" width="15" height="7" rx="1" />
      <rect x="-8" y="-7" width="15" height="7" rx="1" />
    </g>
    <g fill="#d9673f" opacity=".6">
      <rect x="-15" y="1" width="6" height="2" />
      <rect x="2" y="1" width="6" height="2" />
      <rect x="-7" y="-6" width="6" height="2" />
    </g>
  </g>
)

const Cactus = ({ x, y }) => (
  <g transform={`translate(${x} ${y})`} fill="#4f8a4a" stroke="#2f5a2c" strokeWidth="1.2">
    <ellipse cx="0" cy="16" rx="9" ry="2.6" fill="#000" stroke="none" opacity=".15" />
    <rect x="-4" y="-16" width="8" height="32" rx="4" />
    <path d="M-4 0 h-6 a3 3 0 0 1 -3 -3 v-8 a3 3 0 0 1 6 0 v5 h3 Z" />
    <path d="M4 4 h6 a3 3 0 0 0 3 -3 v-6 a3 3 0 0 0 -6 0 v3 h-3 Z" />
  </g>
)

const Terrain = ({ t, seed }) => {
  switch (t) {
    case "forest":
      return (
        <>
          <path d="M-90 30 q40 -20 90 0 t90 -10" stroke="#24592a" strokeWidth="18" fill="none" opacity=".35" />
          {spots(seed, 9, { min: 30, edge: 78 }).map((p, i) => (
            <Tree key={i} x={p.x} y={p.y} s={0.85 + ((i * 37) % 10) / 30} shade={i % 3 ? "#1f5a28" : "#24662b"} light={i % 2 ? "#3a8a3c" : "#2f7a36"} />
          ))}
        </>
      )
    case "hills":
      return (
        <>
          <path d="M-100 10 q45 -38 95 -6 q45 -30 105 2 v100 h-200 Z" fill="#b8673a" opacity=".55" />
          <path d="M-100 48 q55 -32 110 -2 q40 -22 90 0 v60 h-200 Z" fill="#9a4f26" opacity=".5" />
          <path d="M-60 -30 q30 -20 60 0" stroke="#e7a26b" strokeWidth="5" fill="none" strokeLinecap="round" opacity=".6" />
          {spots(seed, 3, { min: 48, edge: 62, avoidCenter: 30 }).map((p, i) => (
            <Bricks key={i} x={p.x} y={p.y} />
          ))}
        </>
      )
    case "pasture":
      return (
        <>
          {spots(seed + 7, 16, { min: 18, edge: 82 }).map((p, i) => (
            <path key={i} d={`M${p.x - 4} ${p.y + 3} l3 -7 l2 6 l3 -8 l1 9`} stroke="#5f9a35" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          ))}
          <path d="M-80 46 L80 20" stroke="#8a6a3a" strokeWidth="2" />
          {[-70, -40, -10, 20, 50].map((x) => (
            <rect key={x} x={x - 1.5} y={44 - (x + 70) * 0.162 - 10} width="3" height="13" fill="#7a5a2a" />
          ))}
          {spots(seed, 3, { min: 40, edge: 58, avoidCenter: 34 }).map((p, i) => (
            <Sheep key={i} x={p.x} y={p.y} flip={i % 2 === 1} />
          ))}
        </>
      )
    case "fields":
      return (
        <>
          {[-80, -56, -32, -8, 16, 40, 64, 88].map((y) => (
            <path key={y} d={`M-100 ${y} L100 ${y - 40}`} stroke="#c58f22" strokeWidth="7" opacity=".45" />
          ))}
          {[-68, -44, -20, 4, 28, 52, 76].map((y) => (
            <path key={y} d={`M-100 ${y} L100 ${y - 40}`} stroke="#fbe58a" strokeWidth="3" opacity=".5" />
          ))}
          {spots(seed, 4, { min: 44, edge: 60, avoidCenter: 34 }).map((p, i) => (
            <Wheat key={i} x={p.x} y={p.y} />
          ))}
        </>
      )
    case "mountains":
      return (
        <>
          <Peak x={-34} y={-14} s={1.1} />
          <Peak x={36} y={-22} s={0.95} />
          <Peak x={4} y={44} s={1.25} />
          <Peak x={-56} y={46} s={0.7} />
          <Peak x={60} y={40} s={0.75} />
          {spots(seed, 5, { min: 24, edge: 70 }).map((p, i) => (
            <path key={i} d={`M${p.x} ${p.y} l4 -3 l3 3 l-3 3 Z`} fill="#3c5c86" opacity=".7" />
          ))}
        </>
      )
    case "desert":
      return (
        <>
          <path d="M-100 -20 q50 -30 100 0 t100 -6" stroke="#d6b465" strokeWidth="4" fill="none" opacity=".8" />
          <path d="M-100 30 q50 -24 100 0 t100 -4" stroke="#cfa955" strokeWidth="4" fill="none" opacity=".7" />
          <path d="M-90 70 q40 -20 90 0 t100 -4" stroke="#d6b465" strokeWidth="3" fill="none" opacity=".7" />
          <Cactus x={-44} y={-12} />
          <Cactus x={50} y={30} />
          <circle cx="20" cy="-40" r="3" fill="#b99c5a" />
          <circle cx="-24" cy="52" r="2.4" fill="#b99c5a" />
        </>
      )
    default:
      return null
  }
}

// one land tile, drawn at (x, y). dim: the Bandit's tile or a tile you can't pick
export const Tile = ({ t, x, y, seed = 1 }) => (
  <g transform={`translate(${x} ${y})`}>
    <polygon points={HEX_POINTS} fill={`url(#hx-g-${t})`} />
    <g clipPath="url(#hx-clip)">
      <Terrain t={t} seed={seed} />
    </g>
    <polygon points={HEX_POINTS} fill="none" stroke="#000" strokeOpacity=".28" strokeWidth="3" />
    <polygon points={HEX_POINTS} fill="none" stroke="#fff" strokeOpacity=".18" strokeWidth="2" transform="scale(.94)" />
  </g>
)

// ---------- tokens, harbors, the Bandit ----------

export const NumberToken = ({ n, x, y, dim = false, hot = false }) => {
  const red = n === 6 || n === 8
  const pips = PIPS[n] || 0
  return (
    <g transform={`translate(${x} ${y})`} opacity={dim ? 0.55 : 1} filter="url(#hx-soft)" className={hot ? "hxTokenHot" : undefined}>
      <circle r="27" fill="url(#hx-token)" stroke="#8a7650" strokeWidth="2" />
      <text y="6" textAnchor="middle" fontSize={n >= 10 ? 23 : 26} fontWeight="700" fontFamily="Georgia, 'Times New Roman', serif" fill={red ? "#c0262d" : "#2a2418"}>
        {n}
      </text>
      {Array.from({ length: pips }, (_, i) => (
        <circle key={i} cx={(i - (pips - 1) / 2) * 6} cy="16" r="2.3" fill={red ? "#c0262d" : "#2a2418"} />
      ))}
    </g>
  )
}

export const Bandit = ({ x, y, ghost = false }) => (
  <g transform={`translate(${x} ${y})`} opacity={ghost ? 0.55 : 1} className="hxBandit" pointerEvents="none">
    <ellipse cx="0" cy="25" rx="19" ry="6" fill="#000" opacity=".35" />
    <path d="M-17 25 C-19 2 -14 -12 0 -30 C14 -12 19 2 17 25 Z" fill="#26262e" stroke="#0d0d12" strokeWidth="2" />
    <path d="M-10 -10 C-6 -16 6 -16 10 -10 C8 -4 -8 -4 -10 -10 Z" fill="#0d0d12" />
    <circle cx="-4.5" cy="-10" r="1.9" fill="#f2d24b" />
    <circle cx="4.5" cy="-10" r="1.9" fill="#f2d24b" />
    <path d="M-14 6 Q0 12 14 6" stroke="#4a4a58" strokeWidth="2.5" fill="none" />
  </g>
)

// a harbor: two wooden piers from the shore corners out to a badge in the sea
export const Harbor = ({ a, b, out, type }) => {
  const mx = (a.x + b.x) / 2 + out[0] * 62
  const my = (a.y + b.y) / 2 + out[1] * 62
  const pier = (p) => {
    const px = p.x + (mx - p.x) * 0.55
    const py = p.y + (my - p.y) * 0.55
    return <line x1={p.x} y1={p.y} x2={px} y2={py} stroke="#7a5228" strokeWidth="9" strokeLinecap="round" />
  }
  return (
    <g className="hxHarbor">
      {pier(a)}
      {pier(b)}
      <g transform={`translate(${mx} ${my})`} filter="url(#hx-soft)">
        <circle r="25" fill="#f7efd8" stroke="#7a5228" strokeWidth="3" />
        {type === "any" ? (
          <text y="7" textAnchor="middle" fontSize="19" fontWeight="700" fill="#2a2418" fontFamily="Georgia, serif">
            3:1
          </text>
        ) : (
          <>
            <g transform="translate(0 -6) scale(.8)">
              <ResIcon r={type} x={-12} y={-12} size={24} />
            </g>
            <text y="19" textAnchor="middle" fontSize="13" fontWeight="700" fill="#2a2418" fontFamily="Georgia, serif">
              2:1
            </text>
          </>
        )}
      </g>
    </g>
  )
}

// ---------- pieces ----------

export const ROAD = { w: 62, h: 13 }

export const RoadPiece = ({ x, y, angle, fill, dark, ghost = false }) => (
  <g transform={`translate(${x} ${y}) rotate(${angle})`} opacity={ghost ? 0.6 : 1} filter={ghost ? undefined : "url(#hx-soft)"}>
    <rect x={-ROAD.w / 2} y={-ROAD.h / 2} width={ROAD.w} height={ROAD.h} rx="4" fill={fill} stroke={dark} strokeWidth="2.5" />
    <rect x={-ROAD.w / 2 + 5} y={-ROAD.h / 2 + 2.5} width={ROAD.w - 10} height="3" rx="1.5" fill="#fff" opacity=".28" />
  </g>
)

export const SettlementPiece = ({ x, y, fill, dark, ghost = false, scale = 1 }) => (
  <g transform={`translate(${x} ${y}) scale(${scale})`} opacity={ghost ? 0.6 : 1} filter={ghost ? undefined : "url(#hx-shadow)"}>
    <path d="M-15 12 V-4 L0 -19 L15 -4 V12 Z" fill={fill} stroke={dark} strokeWidth="2.5" strokeLinejoin="round" />
    <path d="M0 -19 L15 -4 V12 H4 V-8 Z" fill="#000" opacity=".12" />
    <rect x="-4" y="1" width="8" height="11" fill={dark} opacity=".75" />
  </g>
)

export const CityPiece = ({ x, y, fill, dark, ghost = false, scale = 1 }) => (
  <g transform={`translate(${x} ${y}) scale(${scale})`} opacity={ghost ? 0.6 : 1} filter={ghost ? undefined : "url(#hx-shadow)"}>
    <path d="M-24 14 V-2 L-12 -13 L0 -2 V-16 L9 -27 L18 -16 V14 Z" fill={fill} stroke={dark} strokeWidth="2.5" strokeLinejoin="round" />
    <path d="M9 -27 L18 -16 V14 H9 Z" fill="#000" opacity=".13" />
    <rect x="-16" y="3" width="7" height="11" fill={dark} opacity=".75" />
    <rect x="5" y="-10" width="6" height="7" fill={dark} opacity=".6" />
    <rect x="5" y="2" width="6" height="7" fill={dark} opacity=".6" />
  </g>
)

// ---------- resource icons (24 x 24) ----------

export const ResIcon = ({ r, x = 0, y = 0, size = 24 }) => {
  const s = size / 24
  const body = {
    timber: (
      <>
        <rect x="2" y="12" width="20" height="7" rx="3.5" fill="#8a5a2b" stroke="#4e3014" />
        <rect x="4" y="5" width="18" height="7" rx="3.5" fill="#9d6a35" stroke="#4e3014" />
        <circle cx="5.5" cy="15.5" r="3" fill="#e5c48d" stroke="#4e3014" />
        <circle cx="7.5" cy="8.5" r="3" fill="#e5c48d" stroke="#4e3014" />
        <circle cx="5.5" cy="15.5" r="1.2" fill="none" stroke="#9d6a35" strokeWidth=".8" />
        <circle cx="7.5" cy="8.5" r="1.2" fill="none" stroke="#9d6a35" strokeWidth=".8" />
      </>
    ),
    clay: (
      <g stroke="#6e2412">
        <rect x="2" y="13" width="9.5" height="6" rx="1" fill="#c4512b" />
        <rect x="12.5" y="13" width="9.5" height="6" rx="1" fill="#c4512b" />
        <rect x="7" y="6" width="10" height="6" rx="1" fill="#d8673b" />
      </g>
    ),
    wool: (
      <g fill="#fbfbf3" stroke="#8d8b7c" strokeWidth=".9">
        <circle cx="8" cy="13" r="5" />
        <circle cx="13" cy="9" r="5.5" />
        <circle cx="17" cy="14" r="4.5" />
        <circle cx="12" cy="16" r="4.5" />
      </g>
    ),
    grain: (
      <g>
        <path d="M12 22 V6 M12 14 L7 9 M12 14 L17 9 M12 19 L8 15 M12 19 L16 15" stroke="#9c6e14" strokeWidth="1.6" strokeLinecap="round" />
        <g fill="#f2cf4a" stroke="#9c6e14" strokeWidth=".8">
          <ellipse cx="12" cy="5" rx="2.4" ry="3.6" />
          <ellipse cx="6.5" cy="8.5" rx="2.2" ry="3.3" transform="rotate(-40 6.5 8.5)" />
          <ellipse cx="17.5" cy="8.5" rx="2.2" ry="3.3" transform="rotate(40 17.5 8.5)" />
          <ellipse cx="7.5" cy="14.5" rx="2" ry="3" transform="rotate(-40 7.5 14.5)" />
          <ellipse cx="16.5" cy="14.5" rx="2" ry="3" transform="rotate(40 16.5 14.5)" />
        </g>
      </g>
    ),
    ore: (
      <g stroke="#3e4450" strokeWidth="1">
        <path d="M3 18 L7 8 L14 5 L21 11 L19 19 L10 21 Z" fill="#8b93a0" />
        <path d="M7 8 L14 5 L13 13 Z" fill="#b6bdc8" />
        <path d="M13 13 L21 11 L19 19 Z" fill="#6c7380" />
        <path d="M9 15 l2 -2 l2 2 l-2 2 Z" fill="#5d8fd0" stroke="none" />
      </g>
    ),
  }[r]
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} strokeWidth="1">
      {body}
    </g>
  )
}

// a resource icon as its own <svg> (for HTML)
export const ResSvg = ({ r, size = 22, className }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <ResIcon r={r} />
  </svg>
)

// ---------- development card art (48 x 48) ----------

export const DevArt = ({ t, size = 44 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
    {t === "ranger" && (
      <>
        <path d="M24 4 L40 10 V24 C40 34 32 41 24 44 C16 41 8 34 8 24 V10 Z" fill="#3f6fb5" stroke="#1b335c" strokeWidth="2" />
        <path d="M24 12 L27 20 L35 20 L29 25 L31 33 L24 28 L17 33 L19 25 L13 20 L21 20 Z" fill="#f4d35e" stroke="#8a6a12" />
      </>
    )}
    {t === "roads" && (
      <>
        <path d="M6 40 L20 8 H28 L42 40 Z" fill="#8f7a5a" />
        <path d="M24 10 V16 M24 21 V27 M24 32 V38" stroke="#f4e9c8" strokeWidth="3" strokeLinecap="round" />
        <path d="M6 40 L20 8 M42 40 L28 8" stroke="#4e3c22" strokeWidth="2" />
        <circle cx="38" cy="10" r="5" fill="#f4d35e" />
      </>
    )}
    {t === "plenty" && (
      <>
        <path d="M8 26 H40 L36 42 H12 Z" fill="#b07a3a" stroke="#5e3c16" strokeWidth="2" />
        <path d="M8 26 H40" stroke="#5e3c16" strokeWidth="3" />
        <g transform="translate(9 6) scale(.8)">
          <ResIcon r="grain" />
        </g>
        <g transform="translate(20 8) scale(.75)">
          <ResIcon r="ore" />
        </g>
        <g transform="translate(29 9) scale(.7)">
          <ResIcon r="wool" />
        </g>
      </>
    )}
    {t === "monopoly" && (
      <>
        <path d="M6 18 L24 6 L42 18 Z" fill="#c0392b" stroke="#6b1b13" strokeWidth="2" />
        <path d="M10 18 H38 V40 H10 Z" fill="#f2e3c0" stroke="#6b5a3a" strokeWidth="2" />
        <path d="M10 18 l4 5 l4 -5 l4 5 l4 -5 l4 5 l4 -5 l4 5" fill="#fff" stroke="#c0392b" strokeWidth="2" />
        <circle cx="24" cy="32" r="6" fill="#f4d35e" stroke="#8a6a12" strokeWidth="1.5" />
        <text x="24" y="35.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="#8a6a12">$</text>
      </>
    )}
    {t === "monument" && (
      <>
        <path d="M18 42 L20 12 L24 6 L28 12 L30 42 Z" fill="#d9d2bf" stroke="#6b6450" strokeWidth="2" />
        <path d="M12 42 H36 V46 H12 Z" fill="#a89f88" stroke="#6b6450" strokeWidth="1.5" />
        <path d="M24 16 L25.6 20 L30 20 L26.4 22.6 L27.8 27 L24 24.4 L20.2 27 L21.6 22.6 L18 20 L22.4 20 Z" fill="#f4d35e" />
      </>
    )}
    {t === "back" && (
      <>
        <rect x="4" y="4" width="40" height="40" rx="6" fill="#5b3c8c" stroke="#2e1d4d" strokeWidth="2" />
        <polygon points="24,10 36,17 36,31 24,38 12,31 12,17" fill="none" stroke="#f4d35e" strokeWidth="2.5" />
        <circle cx="24" cy="24" r="4" fill="#f4d35e" />
      </>
    )}
  </svg>
)

// The game's logo: three hexes and the word
export const LogoMark = ({ size = 64 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <BoardDefs />
    {[
      [20, 22, "forest"],
      [44, 22, "fields"],
      [32, 43, "hills"],
    ].map(([x, y, t]) => (
      <g key={t} transform={`translate(${x} ${y}) scale(.13)`}>
        <Tile t={t} x={0} y={0} seed={t.length} />
      </g>
    ))}
    <g transform="translate(32 33) scale(.5)">
      <SettlementPiece x={0} y={0} fill="#d23b2f" dark="#7c1a14" />
    </g>
  </svg>
)

// dice faces (HTML)
const FACES = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }
export const Die = ({ n, rolling = false, red = false }) => (
  <span className={`hxDie${rolling ? " is-rolling" : ""}${red ? " is-red" : ""}`} data-die={n}>
    {Array.from({ length: 9 }, (_, i) => (
      <i key={i} className={FACES[n]?.includes(i) ? "on" : ""} />
    ))}
  </span>
)
