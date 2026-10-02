import React from "react"
import "./art.css"

// Original artwork for the couple apps, all drawn here in SVG: envelopes with a heart wax
// seal, five kinds of flowers, vases, ribbons, a watering can and mood stickers.

export const HEART = "M0,-3 C0,-9 -9,-10 -9,-3 C-9,2 -3,6 0,9 C3,6 9,2 9,-3 C9,-10 0,-9 0,-3 Z"

export const ENVELOPE_COLORS = {
  rose: { body: "#f28fa7", flap: "#e3728f", fold: "#f7aabd", label: "Rose" },
  blush: { body: "#fbd3dc", flap: "#f3b6c5", fold: "#fde4ea", label: "Blush" },
  lavender: { body: "#cdb9ef", flap: "#b39be2", fold: "#ddd0f5", label: "Lavender" },
  sky: { body: "#a9d5f2", flap: "#88c0e6", fold: "#c4e3f7", label: "Sky" },
  mint: { body: "#b4e6cf", flap: "#93d4b6", fold: "#cdeee0", label: "Mint" },
  cream: { body: "#f6ead0", flap: "#e8d6ae", fold: "#fbf3e1", label: "Cream" },
}

export const STATIONERY = [
  { id: "parchment", label: "Parchment" },
  { id: "hearts", label: "Pastel hearts" },
  { id: "floral", label: "Floral" },
  { id: "notepad", label: "98 Notepad" },
]

export const FONTS = [
  { id: "script", label: "Handwritten" },
  { id: "print", label: "Neat print" },
  { id: "typewriter", label: "Typewriter" },
  { id: "pixel", label: "Pixel" },
]

// A heart the size of `size`, centered at x, y
export const Heart = ({ x = 0, y = 0, size = 18, fill = "#e8405f", ...rest }) => (
  <path d={HEART} transform={`translate(${x} ${y}) scale(${size / 18})`} fill={fill} {...rest} />
)

// The wax seal: a heart pressed into a round blob of wax
export const Seal = ({ x, y, r = 11 }) => (
  <g transform={`translate(${x} ${y})`}>
    <path d={`M${-r},0 a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0`} fill="#b3203d" />
    <circle r={r * 0.78} fill="#c92c4b" />
    <path d={HEART} transform={`scale(${r / 16})`} fill="#8e1530" />
    <path d={HEART} transform={`translate(-1 -1) scale(${r / 17})`} fill="#e04a68" />
    <ellipse cx={-r * 0.35} cy={-r * 0.45} rx={r * 0.22} ry={r * 0.12} fill="#fff" opacity="0.45" transform="rotate(-30)" />
  </g>
)

// An envelope, 120 x 80. sealed: flap down with the wax heart; open: flap up
export const Envelope = ({ color = "rose", sealed = true, opened = false, className, title }) => {
  const c = ENVELOPE_COLORS[color] || ENVELOPE_COLORS.rose
  return (
    <svg viewBox="0 0 120 84" className={className} role="img" aria-label={title || "An envelope"}>
      <ellipse cx="60" cy="80" rx="50" ry="3.5" fill="#000" opacity="0.12" />
      <rect x="2" y="4" width="116" height="72" rx="5" fill={c.body} stroke="#00000022" />
      {opened && <path d="M2,8 L60,-26 L118,8 Z" fill={c.flap} stroke="#00000022" />}
      {opened && <rect x="12" y="-6" width="96" height="44" rx="2" fill="#fffdf6" stroke="#0000001a" />}
      {opened && <path d="M24,6 h56 M24,14 h66 M24,22 h48" stroke="#d9a0b0" strokeWidth="2.5" strokeLinecap="round" />}
      <path d="M2,76 L52,40 Q60,35 68,40 L118,76 Z" fill={c.fold} stroke="#00000014" />
      <path d="M2,8 L46,44 M118,8 L74,44" stroke="#00000014" strokeWidth="1.5" />
      {!opened && <path d="M2,6 Q2,4 5,4 L115,4 Q118,4 118,6 L64,47 Q60,50 56,47 Z" fill={c.flap} stroke="#00000020" />}
      {sealed && !opened && <Seal x={60} y={45} r={10} />}
    </svg>
  )
}

// ---- flowers ----

export const FLOWERS = [
  { id: "rose", label: "Roses" },
  { id: "tulip", label: "Tulips" },
  { id: "daisy", label: "Daisies" },
  { id: "sunflower", label: "Sunflowers" },
  { id: "lily", label: "Lilies" },
]

export const VASES = [
  { id: "glass", label: "Glass" },
  { id: "pink", label: "Pink jar" },
  { id: "blue", label: "Blue vase" },
  { id: "basket", label: "Basket" },
]

export const RIBBONS = { red: "#d42a48", pink: "#f27ca0", lavender: "#a98bdc", gold: "#e0ac2b", white: "#f7f2ea" }

const TULIP_COLORS = ["#f25c7a", "#f7a531", "#c86ee0"]

const Rose = () => (
  <g>
    <circle r="11" fill="#c81d3e" />
    <path d="M-10,2 Q-12,-9 0,-11 Q12,-10 10,2 Q6,10 0,10 Q-7,10 -10,2 Z" fill="#df3354" />
    <path d="M-6,1 Q-7,-6 0,-7 Q7,-6 6,1 Q3,6 0,6 Q-4,6 -6,1 Z" fill="#b8183a" />
    <path d="M-3,-1 Q-2,-4 1,-4 Q4,-3 3,0 Q1,3 -1,2" fill="none" stroke="#f26b84" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M-9,-3 Q-4,-12 6,-9" fill="none" stroke="#f26b84" strokeWidth="1.2" opacity="0.8" />
  </g>
)

const Tulip = ({ tint = 0 }) => {
  const color = TULIP_COLORS[tint % TULIP_COLORS.length]
  return (
    <g>
      <path d="M-9,-4 Q-10,8 0,10 Q10,8 9,-4 L5,-12 L2,-4 L0,-13 L-2,-4 L-5,-12 Z" fill={color} />
      <path d="M-3,-4 Q-4,6 0,10 Q-8,8 -9,-4 L-5,-12 Z" fill="#000" opacity="0.12" />
      <path d="M2,-6 Q4,2 1,8" fill="none" stroke="#fff" strokeWidth="1.2" opacity="0.5" />
    </g>
  )
}

const Daisy = () => (
  <g>
    {Array.from({ length: 12 }, (_, i) => (
      <ellipse key={i} cx="0" cy="-8" rx="2.8" ry="7" fill="#fff" stroke="#e6e0d6" strokeWidth="0.6" transform={`rotate(${i * 30})`} />
    ))}
    <circle r="4.6" fill="#f6c431" />
    <circle r="4.6" fill="none" stroke="#dc9f17" strokeWidth="1" />
    <circle cx="-1.4" cy="-1.4" r="1.2" fill="#fde58c" />
  </g>
)

const Sunflower = () => (
  <g>
    {Array.from({ length: 16 }, (_, i) => (
      <path key={i} d="M0,-6 Q-3.4,-12 0,-17 Q3.4,-12 0,-6 Z" fill={i % 2 ? "#f6b416" : "#fbc934"} transform={`rotate(${i * 22.5})`} />
    ))}
    <circle r="7.5" fill="#6b3a17" />
    {[[-3, -2], [2, -3], [3, 2], [-2, 3], [0, 0], [-4, 1], [4, -1], [1, 4.5]].map(([x, y], i) => (
      <circle key={i} cx={x} cy={y} r="0.9" fill="#a8652a" />
    ))}
  </g>
)

const Lily = () => (
  <g>
    {Array.from({ length: 6 }, (_, i) => (
      <g key={i} transform={`rotate(${i * 60})`}>
        <path d="M0,0 Q-5,-7 0,-16 Q5,-7 0,0 Z" fill={i % 2 ? "#fde9ef" : "#fff7f9"} stroke="#f1b6c7" strokeWidth="0.7" />
        <path d="M0,-2 L0,-12" stroke="#f08aa8" strokeWidth="1.1" strokeLinecap="round" opacity="0.8" />
      </g>
    ))}
    {[-20, 0, 20].map((a) => (
      <g key={a} transform={`rotate(${a})`}>
        <path d="M0,0 L0,-9" stroke="#8bb24a" strokeWidth="0.8" />
        <ellipse cx="0" cy="-9.6" rx="1.1" ry="1.6" fill="#c76b1e" />
      </g>
    ))}
  </g>
)

const HEADS = { rose: Rose, tulip: Tulip, daisy: Daisy, sunflower: Sunflower, lily: Lily }
export const FlowerHead = ({ kind, tint }) => {
  const Head = HEADS[kind] || Rose
  return <Head tint={tint} />
}

// One flower on its own, for the flower shop's buttons
export const FlowerIcon = ({ kind, size = 40 }) => (
  <svg viewBox="-20 -20 40 50" width={size} height={size * 1.25} aria-hidden="true">
    <path d="M0,4 Q2,16 0,30" stroke="#4c9a3c" strokeWidth="2.2" fill="none" />
    <path d="M0,18 Q7,12 10,15 Q6,20 0,20" fill="#5fb04b" />
    <FlowerHead kind={kind} />
  </svg>
)

const Vase = ({ kind }) => {
  if (kind === "pink")
    return (
      <g>
        <path d="M74,150 Q62,170 66,196 Q70,212 100,212 Q130,212 134,196 Q138,170 126,150 Z" fill="#f4a3bc" stroke="#d97e9b" strokeWidth="1.5" />
        <rect x="70" y="144" width="60" height="9" rx="4" fill="#f7b9cc" stroke="#d97e9b" strokeWidth="1.5" />
        <path d={HEART} transform="translate(100 183) scale(0.9)" fill="#fff" opacity="0.85" />
        <path d="M76,162 Q72,180 78,198" stroke="#fff" strokeWidth="3" fill="none" opacity="0.4" strokeLinecap="round" />
      </g>
    )
  if (kind === "blue")
    return (
      <g>
        <path d="M80,146 L76,206 Q76,212 84,212 L116,212 Q124,212 124,206 L120,146 Z" fill="#7fa9e0" stroke="#5a86c2" strokeWidth="1.5" />
        <path d="M78,166 H122 M77,180 H123 M77,194 H123" stroke="#fff" strokeWidth="2.5" opacity="0.55" />
        <path d="M78,146 H122" stroke="#5a86c2" strokeWidth="3" strokeLinecap="round" />
        <path d="M84,152 L82,204" stroke="#fff" strokeWidth="3" opacity="0.35" strokeLinecap="round" />
      </g>
    )
  if (kind === "basket")
    return (
      <g>
        <path d="M64,150 Q100,90 136,150" fill="none" stroke="#a86b35" strokeWidth="5" strokeLinecap="round" />
        <path d="M60,150 L70,206 Q72,212 80,212 L120,212 Q128,212 130,206 L140,150 Z" fill="#c98a4b" stroke="#8c5626" strokeWidth="1.5" />
        {[160, 172, 184, 196].map((y) => (
          <path key={y} d={`M${62 + (y - 150) / 6},${y} H${138 - (y - 150) / 6}`} stroke="#8c5626" strokeWidth="1.2" opacity="0.7" />
        ))}
        {[74, 86, 98, 110, 122].map((x) => (
          <path key={x} d={`M${x + 2},151 L${x + 4},210`} stroke="#e3b07a" strokeWidth="2" opacity="0.6" />
        ))}
        <rect x="58" y="146" width="84" height="8" rx="4" fill="#b67a3f" stroke="#8c5626" strokeWidth="1.2" />
      </g>
    )
  // glass: you can see the stems in the water
  return (
    <g>
      <path d="M72,146 Q66,176 74,204 Q76,212 86,212 L114,212 Q124,212 126,204 Q134,176 128,146 Z" fill="#cfeaf7" opacity="0.55" stroke="#8fc3dc" strokeWidth="1.5" />
      <path d="M70,166 Q100,172 130,166 Q133,186 126,204 Q124,212 114,212 L86,212 Q76,212 74,204 Q67,186 70,166 Z" fill="#9fd2ec" opacity="0.45" />
      <path d="M78,152 Q74,178 80,204" stroke="#fff" strokeWidth="3" fill="none" opacity="0.6" strokeLinecap="round" />
      <ellipse cx="100" cy="146" rx="28" ry="4" fill="none" stroke="#8fc3dc" strokeWidth="1.5" />
    </g>
  )
}

const Bow = ({ color }) => (
  <g transform="translate(100 156)">
    <path d="M0,0 Q-16,-12 -20,-2 Q-18,8 0,0 Z" fill={color} stroke="#00000030" />
    <path d="M0,0 Q16,-12 20,-2 Q18,8 0,0 Z" fill={color} stroke="#00000030" />
    <path d="M-2,1 L-10,18 L-6,16 L-4,20 Z M2,1 L10,18 L6,16 L4,20 Z" fill={color} stroke="#00000030" />
    <circle r="3.4" fill={color} stroke="#00000040" />
  </g>
)

// Where each stem's flower sits (up to 12), fanned out above the vase mouth at (100, 150)
const SPOTS = [
  [100, 48], [76, 60], [124, 60], [88, 34], [112, 36], [58, 82], [142, 82], [66, 46], [134, 46], [100, 72], [82, 84], [118, 84],
]

// A bouquet in its vase. wilt: 0 fresh .. 1 gone (heads droop, colors fade, petals fall)
export const Bouquet = ({ stems = [], vase = "glass", ribbon = "red", wilt = 0, className, idPrefix = "bq" }) => {
  const w = Math.max(0, Math.min(1, wilt))
  const filterId = `${idPrefix}-fade`
  const placed = stems.slice(0, 12).map((kind, i) => {
    const [x, y] = SPOTS[i]
    const side = x === 100 ? (i % 2 ? 1 : -1) : Math.sign(x - 100)
    // a wilting flower droops away from the middle and sinks
    const droop = w * (40 + (i % 3) * 12) * side
    const sink = w * w * 26
    return { kind, i, x: x + side * w * 10, y: y + sink, droop, side }
  })
  return (
    <svg viewBox="0 0 200 220" className={className} role="img" aria-label="A bouquet of flowers">
      <defs>
        <filter id={filterId}>
          <feColorMatrix type="saturate" values={String(1 - w * 0.75)} />
          <feComponentTransfer>
            <feFuncR type="linear" slope={1 - w * 0.12} intercept={w * 0.06} />
            <feFuncG type="linear" slope={1 - w * 0.25} intercept={w * 0.04} />
            <feFuncB type="linear" slope={1 - w * 0.4} />
          </feComponentTransfer>
        </filter>
      </defs>
      <ellipse cx="100" cy="213" rx="56" ry="5" fill="#000" opacity="0.15" />
      <g filter={w > 0.02 ? `url(#${filterId})` : undefined}>
        {placed.map((f) => (
          <g key={`stem${f.i}`}>
            <path d={`M${100 + (f.i % 5) * 3 - 6},170 Q${(100 + f.x) / 2 - f.side * (6 + w * 18)},${(150 + f.y) / 2 + w * 14} ${f.x},${f.y + 12}`} stroke="#4c9a3c" strokeWidth="2.4" fill="none" strokeLinecap="round" />
            {f.i % 3 === 0 && <path d={`M${(100 + f.x) / 2},${(150 + f.y) / 2 + 8} q${f.side * 10},${-8 + w * 10} ${f.side * 15},${-2 + w * 12} q${-f.side * 6},5 ${-f.side * 15},2`} fill="#5fb04b" />}
          </g>
        ))}
        <Vase kind={vase} />
        {placed.map((f) => (
          <g key={`head${f.i}`} transform={`translate(${f.x} ${f.y + 10}) rotate(${f.droop}) translate(0 -10)`}>
            <g className="bqHead" style={{ animationDelay: `${(f.i % 4) * 0.6}s` }}>
              <FlowerHead kind={f.kind} tint={f.i} />
            </g>
          </g>
        ))}
        <Bow color={RIBBONS[ribbon] || RIBBONS.red} />
      </g>
      {w >= 0.55 &&
        placed.slice(0, 6).map((f) => (
          <ellipse
            key={`petal${f.i}`}
            className="bqPetal"
            cx={f.x}
            cy={f.y + 6}
            rx="3.4"
            ry="2"
            fill={f.kind === "sunflower" ? "#d9a63a" : f.kind === "daisy" || f.kind === "lily" ? "#efe6dc" : "#b9576b"}
            style={{ animationDelay: `${f.i * 1.3}s`, "--fall": `${210 - f.y}px`, "--drift": `${f.side * 14}px` }}
          />
        ))}
    </svg>
  )
}

export const WateringCan = ({ size = 34 }) => (
  <svg viewBox="0 0 48 40" width={size} height={(size * 40) / 48} aria-hidden="true">
    <path d="M12,14 H34 L32,36 Q32,38 30,38 H16 Q14,38 14,36 Z" fill="#7cc3e8" stroke="#3f88b5" strokeWidth="1.5" />
    <path d="M34,20 L44,10" stroke="#3f88b5" strokeWidth="3.5" strokeLinecap="round" />
    <ellipse cx="45" cy="9" rx="3" ry="2" fill="#3f88b5" transform="rotate(-45 45 9)" />
    <path d="M14,14 Q10,4 22,4 Q30,4 30,12" fill="none" stroke="#3f88b5" strokeWidth="2.5" />
    <path d={HEART} transform="translate(23 26) scale(0.5)" fill="#fff" />
  </svg>
)

// Mood stickers for Our Story moments, drawn on a little round sticker
export const MOODS = [
  { id: "love", label: "Love", bg: "#ffd6e0" },
  { id: "happy", label: "Happy", bg: "#fff1b8" },
  { id: "laugh", label: "Laughing", bg: "#ffe4c2" },
  { id: "wow", label: "Wow", bg: "#d9ecff" },
  { id: "cozy", label: "Cozy", bg: "#f0e0d0" },
  { id: "sad", label: "Bittersweet", bg: "#dfe6f5" },
  { id: "party", label: "Party", bg: "#f1dcff" },
  { id: "travel", label: "Adventure", bg: "#d4f3ea" },
  { id: "food", label: "Food", bg: "#ffe0cc" },
  { id: "star", label: "Special", bg: "#fff5c7" },
]
export const moodOf = (id) => MOODS.find((m) => m.id === id) || MOODS[0]

const FACE = "#ffd34d"
const INK = "#5a3a1a"
const Face = ({ children }) => (
  <g>
    <circle r="8.5" fill={FACE} stroke="#e0a91c" strokeWidth="0.8" />
    <circle cx="-4.6" cy="2.4" r="1.6" fill="#f7a1b8" opacity="0.8" />
    <circle cx="4.6" cy="2.4" r="1.6" fill="#f7a1b8" opacity="0.8" />
    {children}
  </g>
)

const STICKER_ART = {
  love: () => (
    <g>
      <path d={HEART} transform="translate(0 0.5) scale(0.95)" fill="#e8405f" stroke="#a82244" strokeWidth="0.8" />
      <ellipse cx="-4" cy="-3.5" rx="1.8" ry="1" fill="#fff" opacity="0.7" transform="rotate(-30 -4 -3.5)" />
    </g>
  ),
  happy: () => (
    <Face>
      <path d="M-4,-2.5 q1,-1.5 2,0 M2,-2.5 q1,-1.5 2,0" stroke={INK} strokeWidth="1.1" fill="none" strokeLinecap="round" />
      <path d="M-3.5,2 q3.5,3.5 7,0" stroke={INK} strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </Face>
  ),
  laugh: () => (
    <Face>
      <path d="M-5,-3 l2,1 -2,1 M5,-3 l-2,1 2,1" stroke={INK} strokeWidth="1.1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M-4,1 h8 q0,5 -4,5 q-4,0 -4,-5 z" fill="#8a2d2d" />
      <path d="M-2.4,4.6 q2.4,-1.6 4.8,0 q-1,1.2 -2.4,1.2 q-1.4,0 -2.4,-1.2 z" fill="#f27c9b" />
      <path d="M-8,-1 q-1.5,2.5 0,3.6 q1.5,-1.1 0,-3.6 z M8,-1 q1.5,2.5 0,3.6 q-1.5,-1.1 0,-3.6 z" fill="#7cc3e8" />
    </Face>
  ),
  wow: () => (
    <Face>
      <circle cx="-3" cy="-2.5" r="1.3" fill={INK} />
      <circle cx="3" cy="-2.5" r="1.3" fill={INK} />
      <ellipse cx="0" cy="3" rx="1.8" ry="2.4" fill="#8a2d2d" />
    </Face>
  ),
  cozy: () => (
    <g>
      <path d="M-3,-9 q-2,2 0,4 q2,2 0,4 M1.5,-9 q-2,2 0,4 q2,2 0,4" stroke="#fff" strokeWidth="1.2" fill="none" strokeLinecap="round" opacity="0.9" />
      <path d="M-7,-2 h11 v5 q0,5 -5.5,5 q-5.5,0 -5.5,-5 z" fill="#f27c9b" stroke="#b3415f" strokeWidth="0.8" />
      <path d="M4,0 q4.5,0 4.5,3 q0,3 -4.5,3" stroke="#b3415f" strokeWidth="1.6" fill="none" />
      <path d={HEART} transform="translate(-1.5 3) scale(0.28)" fill="#fff" />
      <ellipse cx="-1.5" cy="-2" rx="5.5" ry="1.2" fill="#8a5a3a" />
    </g>
  ),
  sad: () => (
    <Face>
      <path d="M-4.5,-2 q1.2,1.2 2.4,0 M2.1,-2 q1.2,1.2 2.4,0" stroke={INK} strokeWidth="1.1" fill="none" strokeLinecap="round" />
      <path d="M-3,3.5 q3,2 6,0" stroke={INK} strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <path d="M4.2,-0.5 q1.4,2.6 0,3.6 q-1.4,-1 0,-3.6 z" fill="#7cc3e8" />
    </Face>
  ),
  party: () => (
    <g>
      <path d="M-7,8 L-2,-6 L5,3 Z" fill="#f7a531" stroke="#c77a12" strokeWidth="0.8" />
      <path d="M-5.6,4 L1.2,-1.6 M-4,-0.6 L3.2,1.2" stroke="#f25c7a" strokeWidth="1.4" />
      <circle cx="4" cy="-7" r="1.2" fill="#f25c7a" />
      <circle cx="7.5" cy="-3" r="1" fill="#5fb3e8" />
      <rect x="0" y="-9.5" width="2" height="2" fill="#5fb04b" transform="rotate(25 1 -8.5)" />
      <rect x="6.5" y="1" width="2" height="2" fill="#c86ee0" transform="rotate(-20 7.5 2)" />
      <path d="M8,-8 q-2,1 -1,3" stroke="#c86ee0" strokeWidth="1" fill="none" />
    </g>
  ),
  travel: () => (
    <g transform="rotate(-30)">
      <path d="M-9,0 q0,-1.6 2,-1.6 h12 q4,0 4,1.6 q0,1.6 -4,1.6 h-12 q-2,0 -2,-1.6 z" fill="#fff" stroke="#3f88b5" strokeWidth="0.8" />
      <path d="M-1,-1.4 l-4,-6 h2.4 l6,6 z M-1,1.4 l-4,6 h2.4 l6,-6 z" fill="#5fb3e8" stroke="#3f88b5" strokeWidth="0.6" />
      <path d="M-8.4,-1.2 l-1.6,-3 h1.6 l2.4,3 z" fill="#5fb3e8" />
      <path d="M6,-0.6 h1.4 M3,-0.6 h1.4 M0,-0.6 h1.4" stroke="#3f88b5" strokeWidth="0.9" />
    </g>
  ),
  food: () => (
    <g>
      <path d="M0,9 L-8,-6 q8,-4 16,0 Z" fill="#f6c95a" stroke="#c98a2a" strokeWidth="0.8" />
      <path d="M-8,-6 q8,-4 16,0 l-1,2 q-7,-3.4 -14,0 z" fill="#d98a3a" />
      <circle cx="-2" cy="-1" r="1.7" fill="#d9363e" />
      <circle cx="2.6" cy="1" r="1.5" fill="#d9363e" />
      <circle cx="0" cy="4.6" r="1.2" fill="#d9363e" />
      <circle cx="2.4" cy="-3" r="0.8" fill="#4c9a3c" />
    </g>
  ),
  star: () => (
    <g>
      <path d="M0,-9 L2.6,-3 L9,-2.6 L4,1.6 L5.6,8 L0,4.6 L-5.6,8 L-4,1.6 L-9,-2.6 L-2.6,-3 Z" fill="#ffd34d" stroke="#e0a91c" strokeWidth="0.9" strokeLinejoin="round" />
      <path d="M-2,-1 q0.5,-2 2.5,-2.4" stroke="#fff" strokeWidth="1.1" fill="none" strokeLinecap="round" opacity="0.8" />
    </g>
  ),
}

export const Sticker = ({ mood, size = 34 }) => {
  const m = moodOf(mood)
  const Art = STICKER_ART[m.id]
  return (
    <span className="usSticker" style={{ width: size, height: size, background: m.bg }} title={m.label} aria-label={m.label} role="img">
      <svg viewBox="-11 -11 22 22" width={size * 0.78} height={size * 0.78} aria-hidden="true">
        <Art />
      </svg>
    </span>
  )
}

// Two little hearts, overlapping: the couple's mark
export const TwoHearts = ({ size = 40 }) => (
  <svg viewBox="-14 -14 40 30" width={size} height={size * 0.75} aria-hidden="true">
    <path d={HEART} transform="translate(-2 0) rotate(-12)" fill="#f27c9b" stroke="#c84a6c" strokeWidth="0.8" />
    <path d={HEART} transform="translate(10 3) rotate(10) scale(0.85)" fill="#e8405f" stroke="#a82244" strokeWidth="0.8" />
    <ellipse cx="-6" cy="-5" rx="2.2" ry="1.2" fill="#fff" opacity="0.6" transform="rotate(-30 -6 -5)" />
  </svg>
)
