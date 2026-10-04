import React from "react"

// Boom Frenzy's bombs, drawn in SVG (original art): a round cartoon bomb with big eyes and a
// curly fuse, dressed per kind. `fuse` is how much fuse is left (0..1); `hits` how many taps
// are left (Helmet, Iron); `ring` how much of a Hold bomb's ring is filled (0..1).

const BODY = {
  black: ["#2a2a2a", "#555"],
  quick: ["#c81818", "#ff6a5a"],
  helmet: ["#2a2a2a", "#555"],
  arrow: ["#168a2c", "#4fd36a"],
  skull: ["#4a3a5a", "#7d6c90"],
  jumper: ["#d07a10", "#ffb44a"],
  iron: ["#6c7480", "#b8c0ca"],
  ice: ["#3a8fd8", "#a8dcff"],
  ghost: ["#d8d8f0", "#ffffff"],
  splitter: ["#7a3ab0", "#b884e8"],
  hold: ["#1e3a8a", "#4a74e0"],
  heart: ["#e0407a", "#ff9cc0"],
  clock: ["#2a6a6a", "#5ab0b0"],
  chain: ["#c8a000", "#ffe050"],
  gold: ["#d4a000", "#fff2a0"],
  // Sort Rush's colors
  red: ["#c81818", "#ff6a5a"],
  blue: ["#1e3ac8", "#5a8aff"],
  green: ["#168a2c", "#4fd36a"],
}

const ARROW_ROT = { up: 0, right: 90, down: 180, left: 270 }

const Eyes = ({ worried, closed }) =>
  closed ? (
    <g stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none">
      <path d="M36 52 q5 4 10 0" />
      <path d="M54 52 q5 4 10 0" />
    </g>
  ) : (
    <g>
      <ellipse cx="41" cy="52" rx="7" ry="9" fill="#fff" />
      <ellipse cx="59" cy="52" rx="7" ry="9" fill="#fff" />
      <circle cx={worried ? 42 : 43} cy={worried ? 49 : 54} r="3.5" fill="#000" />
      <circle cx={worried ? 58 : 61} cy={worried ? 49 : 54} r="3.5" fill="#000" />
      {worried && (
        <g stroke="#000" strokeWidth="3" strokeLinecap="round">
          <path d="M33 40 l12 3" />
          <path d="M67 40 l-12 3" />
        </g>
      )}
    </g>
  )

export const Bomb = ({ type = "black", fuse = 1, hits = 1, dir, ring = 0, small, scared }) => {
  const [base, hi] = BODY[type] || BODY.black
  const f = Math.max(0, Math.min(1, fuse))
  // the fuse: a curl from the cap, shorter as it burns
  const fuseLen = 46 * f
  const sparkAt = { x: 62 + Math.min(fuseLen, 20) * 0.9, y: 22 - Math.max(0, fuseLen - 20) * 0.7 }
  const id = `g-${type}`
  return (
    <svg viewBox="0 0 100 100" className={`bfBombSvg${small ? " is-small" : ""}`} aria-hidden="true">
      <defs>
        <radialGradient id={id} cx="0.35" cy="0.35" r="0.75">
          <stop offset="0" stopColor={hi} />
          <stop offset="1" stopColor={base} />
        </radialGradient>
      </defs>
      {/* fuse */}
      {type !== "skull" && type !== "gold" && (
        <>
          <path d={`M58 30 Q62 22 ${sparkAt.x} ${sparkAt.y}`} stroke="#8a5a2a" strokeWidth="4" fill="none" strokeLinecap="round" />
          {f > 0 && (
            <g className="bfSpark" transform={`translate(${sparkAt.x} ${sparkAt.y})`}>
              <circle r="6" fill="#ffd400" />
              <circle r="3" fill="#fff" />
              <path d="M-9 0 H9 M0 -9 V9 M-6 -6 L6 6 M6 -6 L-6 6" stroke="#ff8a00" strokeWidth="2" />
            </g>
          )}
        </>
      )}
      {/* cap */}
      <rect x="50" y="26" width="14" height="10" rx="2" fill="#444" transform="rotate(30 57 31)" />
      {/* body */}
      <circle cx="50" cy="60" r="34" fill={`url(#${id})`} stroke="#000" strokeWidth="2.5" opacity={type === "ghost" ? 0.85 : 1} />
      <ellipse cx="38" cy="44" rx="9" ry="5" fill="#fff" opacity="0.35" transform="rotate(-30 38 44)" />
      {/* dressing */}
      {type === "helmet" && hits > 1 && (
        <g>
          <path d="M18 52 Q50 8 82 52 Z" fill="#6a7a2a" stroke="#000" strokeWidth="2.5" />
          <rect x="14" y="50" width="72" height="7" rx="3" fill="#56641e" stroke="#000" strokeWidth="2" />
        </g>
      )}
      {type === "iron" && (
        <g fill="#3a4048">
          {[[26, 46], [74, 46], [26, 74], [74, 74], [50, 90]].map(([x, y]) => (
            <circle key={`${x},${y}`} cx={x} cy={y} r="3" />
          ))}
          {hits < 3 && <path d="M60 34 l-6 12 l7 4 l-5 10" stroke="#222" strokeWidth="2" fill="none" />}
          {hits < 2 && <path d="M34 70 l8 -6 l-2 10 l9 -4" stroke="#222" strokeWidth="2" fill="none" />}
        </g>
      )}
      {type === "arrow" && (
        <g transform={`rotate(${ARROW_ROT[dir] || 0} 50 62)`}>
          <path d="M50 36 L70 60 H58 V84 H42 V60 H30 Z" fill="#eaffea" stroke="#000" strokeWidth="2.5" strokeLinejoin="round" />
        </g>
      )}
      {type === "skull" && (
        <g>
          <path d="M34 48 q16 -18 32 0 v10 q0 6 -6 7 v6 h-20 v-6 q-6 -1 -6 -7 z" fill="#f4f0e6" stroke="#000" strokeWidth="2" />
          <circle cx="43" cy="55" r="5" fill="#000" />
          <circle cx="57" cy="55" r="5" fill="#000" />
          <path d="M47 66 h6" stroke="#000" strokeWidth="2" />
          <path d="M40 83 l20 -8 M40 75 l20 8" stroke="#f4f0e6" strokeWidth="4" strokeLinecap="round" />
        </g>
      )}
      {type === "jumper" && (
        <g stroke="#333" strokeWidth="3" fill="none">
          <path d="M34 92 l-4 4 l8 2 l-8 2" />
          <path d="M66 92 l4 4 l-8 2 l8 2" />
        </g>
      )}
      {type === "ice" && (
        <g stroke="#fff" strokeWidth="3" strokeLinecap="round">
          <path d="M50 70 v-18 M50 70 v18 M50 70 l15 -9 M50 70 l-15 9 M50 70 l15 9 M50 70 l-15 -9" />
        </g>
      )}
      {type === "splitter" && <path d="M50 26 l-5 14 l8 8 l-6 12 l7 10 l-4 24" stroke="#fff" strokeWidth="3" fill="none" />}
      {type === "hold" && (
        <g>
          <circle cx="50" cy="60" r="40" fill="none" stroke="#fff" strokeOpacity="0.4" strokeWidth="6" />
          {ring > 0 && (
            <circle cx="50" cy="60" r="40" fill="none" stroke="#ffe23a" strokeWidth="6" strokeDasharray={`${ring * 251} 251`} transform="rotate(-90 50 60)" strokeLinecap="round" />
          )}
          <text x="50" y="86" textAnchor="middle" fontSize="12" fontWeight="bold" fill="#fff" fontFamily="Arial">HOLD</text>
        </g>
      )}
      {type === "heart" && <path d="M50 88 L30 68 a11 11 0 0 1 20 -14 a11 11 0 0 1 20 14 Z" fill="#fff" opacity="0.9" />}
      {type === "clock" && (
        <g>
          <circle cx="50" cy="74" r="13" fill="#fff" stroke="#000" strokeWidth="2" />
          <path d="M50 74 v-8 M50 74 l6 3" stroke="#000" strokeWidth="2.5" strokeLinecap="round" />
        </g>
      )}
      {type === "chain" && (
        <g fill="none" stroke="#5a4a00" strokeWidth="4">
          <ellipse cx="22" cy="74" rx="8" ry="5" />
          <ellipse cx="78" cy="74" rx="8" ry="5" />
          <ellipse cx="50" cy="92" rx="5" ry="8" />
        </g>
      )}
      {type === "gold" && (
        <g fill="#fff">
          <path d="M30 34 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 z" />
          <path d="M74 80 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 z" />
          <text x="50" y="88" textAnchor="middle" fontSize="13" fontWeight="bold" fill="#7a5a00" fontFamily="Arial">100</text>
        </g>
      )}
      {!["arrow", "skull", "heart", "clock", "gold", "hold"].includes(type) && <Eyes worried={scared || f < 0.3} closed={type === "ghost"} />}
      {["heart", "clock", "hold", "gold"].includes(type) && (
        <g transform="translate(0 -6) scale(1)">
          <Eyes worried={scared || f < 0.3} />
        </g>
      )}
    </svg>
  )
}

export const Mallet = () => (
  <svg viewBox="0 0 100 100" className="bfMalletSvg" aria-hidden="true">
    <rect x="46" y="38" width="9" height="58" rx="3" fill="#b07a3a" stroke="#000" strokeWidth="2.5" />
    <rect x="14" y="10" width="72" height="34" rx="8" fill="#c8894a" stroke="#000" strokeWidth="2.5" />
    <rect x="14" y="10" width="14" height="34" rx="4" fill="#9a6230" stroke="#000" strokeWidth="2" />
    <rect x="72" y="10" width="14" height="34" rx="4" fill="#9a6230" stroke="#000" strokeWidth="2" />
  </svg>
)

export const Boom = () => (
  <svg viewBox="0 0 100 100" className="bfBoomSvg" aria-hidden="true">
    <path d="M50 2 L60 32 L92 18 L72 46 L98 62 L66 66 L74 98 L50 74 L26 98 L34 66 L2 62 L28 46 L8 18 L40 32 Z" fill="#ffd400" stroke="#d02000" strokeWidth="4" strokeLinejoin="round" />
    <path d="M50 24 L56 42 L76 36 L62 52 L78 64 L58 62 L60 80 L50 64 L40 80 L42 62 L22 64 L38 52 L24 36 L44 42 Z" fill="#ff7a00" />
    <text x="50" y="58" textAnchor="middle" fontSize="15" fontWeight="bold" fill="#fff" fontFamily="Arial" stroke="#900" strokeWidth="0.8">BOOM</text>
  </svg>
)

export const WEAPON_ICONS = {
  mallet: (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="14" y="12" width="4" height="18" fill="#b07a3a" stroke="#000" />
      <rect x="4" y="3" width="24" height="11" rx="2" fill="#c8894a" stroke="#000" />
    </svg>
  ),
  freeze: (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 3 V29 M4 9 L28 23 M4 23 L28 9" stroke="#2a7ad8" strokeWidth="3" strokeLinecap="round" />
      <circle cx="16" cy="16" r="4" fill="#bfe6ff" stroke="#2a7ad8" />
    </svg>
  ),
  snip: (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="9" cy="24" r="5" fill="none" stroke="#c00" strokeWidth="3" />
      <circle cx="23" cy="24" r="5" fill="none" stroke="#c00" strokeWidth="3" />
      <path d="M12 20 L24 4 M20 20 L8 4" stroke="#555" strokeWidth="3" strokeLinecap="round" />
    </svg>
  ),
}

export const Heart = ({ full }) => (
  <svg viewBox="0 0 20 18" className="bfHeart" aria-hidden="true">
    <path d="M10 17 L2 9 a4.5 4.5 0 0 1 8 -5 a4.5 4.5 0 0 1 8 5 Z" fill={full ? "#e01848" : "#7a7a7a"} stroke="#000" strokeWidth="1.2" />
  </svg>
)
