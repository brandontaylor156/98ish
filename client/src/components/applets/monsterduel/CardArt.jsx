import React, { memo, useId } from "react"

// Monster Duel's card art, drawn on the fly: every card gets a scene (its attribute's sky
// and weather) and a creature built from its type, with sizes, colors, horns, wings and
// poses picked by a random generator seeded with the card's id, so each card always looks
// the same and no two look alike. Spells and Traps get an emblem for their `art` motif.
// Plain SVG shapes and gradients only (no filters): a deck's worth of cards stays fast.

// ---------- seeded randomness ----------

const hash = (s) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
const rngFor = (s) => {
  let a = hash(s)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const between = (r, a, b) => a + (b - a) * r()
const pick = (r, list) => list[Math.floor(r() * list.length)]

// ---------- colors ----------

const ATTR = {
  FIRE: { sky: ["#1e0702", "#7d220a", "#f0892a"], glow: "#ffd27a", hue: 14, sat: 70 },
  WATER: { sky: ["#021022", "#0a477a", "#5bb8e8"], glow: "#c4f4ff", hue: 205, sat: 60 },
  EARTH: { sky: ["#170f07", "#5a4022", "#cfa86a"], glow: "#ffe2a0", hue: 30, sat: 45 },
  WIND: { sky: ["#03190f", "#126447", "#a3e8bf"], glow: "#eafff2", hue: 150, sat: 50 },
  LIGHT: { sky: ["#2e2205", "#a87b0c", "#fff3c2"], glow: "#ffffff", hue: 46, sat: 75 },
  DARK: { sky: ["#05030b", "#271140", "#7a4bb0"], glow: "#e6b8ff", hue: 278, sat: 45 },
}
const hsl = (h, s, l) => `hsl(${Math.round(((h % 360) + 360) % 360)},${Math.round(s)}%,${Math.round(l)}%)`
// a body color with a highlight and a shadow
const tone = (h, s, l) => ({ base: hsl(h, s, l), hi: hsl(h, Math.min(100, s + 8), Math.min(92, l + 22)), lo: hsl(h, s, Math.max(6, l - 22)), line: hsl(h, s * 0.6, Math.max(4, l - 34)) })

// ---------- drawing helpers ----------

const LINE = { stroke: "rgba(0,0,0,.55)", strokeWidth: 0.7, strokeLinejoin: "round" }
const P = ({ d, fill, line = true, ...rest }) => <path d={d} fill={fill} {...(line ? LINE : {})} {...rest} />

// a 4-point sparkle
const sparkle = (x, y, s, fill, k) => <path key={k} d={`M${x},${y - s}Q${x + s * 0.2},${y - s * 0.2} ${x + s},${y}Q${x + s * 0.2},${y + s * 0.2} ${x},${y + s}Q${x - s * 0.2},${y + s * 0.2} ${x - s},${y}Q${x - s * 0.2},${y - s * 0.2} ${x},${y - s}Z`} fill={fill} />
// a glowing eye
const eye = (x, y, r, g, k) => (
  <g key={k}>
    <circle cx={x} cy={y} r={r * 2.6} fill={`url(#${g.id}glow)`} />
    <ellipse cx={x} cy={y} rx={r} ry={r * 0.75} fill={g.eye} />
    <circle cx={x + r * 0.25} cy={y - r * 0.2} r={r * 0.3} fill="#fff" />
  </g>
)
// a gear: teeth around a ring
const gearPath = (cx, cy, r, teeth) => {
  let d = ""
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2
    const rr = i % 2 ? r : r * 1.18
    const a2 = ((i + 1) / (teeth * 2)) * Math.PI * 2
    d += `${i ? "L" : "M"}${(cx + Math.cos(a) * rr).toFixed(2)},${(cy + Math.sin(a) * rr).toFixed(2)}L${(cx + Math.cos(a2) * rr).toFixed(2)},${(cy + Math.sin(a2) * rr).toFixed(2)}`
  }
  return d + "Z"
}
const star = (cx, cy, r1, r2, n) => {
  let d = ""
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2
    const r = i % 2 ? r2 : r1
    d += `${i ? "L" : "M"}${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`
  }
  return d + "Z"
}

// ---------- backgrounds ----------

const scene = (g, attr, r) => {
  const out = []
  if (attr === "FIRE") {
    out.push(<path key="lava" d="M0,64 Q12,58 24,63 T50,61 T76,64 T100,60 V76 H0Z" fill="#2a0a04" />)
    out.push(<path key="crack" d="M6,70 L16,66 L22,70 M40,72 L52,66 L60,71 M74,69 L84,65 L94,70" stroke="#ff7a1a" strokeWidth="0.9" fill="none" opacity=".9" />)
    for (let i = 0; i < 14; i++) out.push(<circle key={`e${i}`} cx={between(r, 2, 98)} cy={between(r, 4, 60)} r={between(r, 0.35, 1.1)} fill={pick(r, ["#ffcf6a", "#ff8a2a", "#fff1b0"])} opacity={between(r, 0.4, 0.95)} />)
  } else if (attr === "WATER") {
    for (let i = 0; i < 4; i++) {
      const x = between(r, 5, 90)
      out.push(<path key={`ray${i}`} d={`M${x},0 L${x + 8},0 L${x + 22},76 L${x + 6},76Z`} fill="#bfefff" opacity=".07" />)
    }
    out.push(<path key="bed" d="M0,66 Q20,60 38,66 T72,64 T100,67 V76 H0Z" fill="#06263f" />)
    out.push(<path key="weed" d="M8,76 Q4,66 9,60 Q12,54 8,48 M92,76 Q96,68 91,62 Q88,56 93,50" stroke="#1f7a5a" strokeWidth="1.6" fill="none" strokeLinecap="round" />)
    for (let i = 0; i < 10; i++) out.push(<circle key={`b${i}`} cx={between(r, 4, 96)} cy={between(r, 4, 64)} r={between(r, 0.6, 2)} fill="none" stroke="#d8f6ff" strokeWidth=".45" opacity={between(r, 0.4, 0.8)} />)
  } else if (attr === "EARTH") {
    out.push(<path key="mtn2" d={`M0,50 L14,${between(r, 26, 34)} L28,46 L44,${between(r, 22, 30)} L62,48 L80,${between(r, 24, 32)} L100,44 V76 H0Z`} fill="#3a2a16" opacity=".75" />)
    out.push(<path key="mtn1" d={`M0,60 L18,${between(r, 42, 48)} L34,58 L56,${between(r, 40, 46)} L76,58 L92,${between(r, 44, 50)} L100,56 V76 H0Z`} fill="#2a1d0e" />)
    out.push(<path key="ground" d="M0,66 Q30,62 60,66 T100,65 V76 H0Z" fill="#1d1408" />)
  } else if (attr === "WIND") {
    for (let i = 0; i < 3; i++) {
      const x = between(r, 0, 80)
      const y = between(r, 6, 30)
      out.push(<ellipse key={`c${i}`} cx={x} cy={y} rx={between(r, 10, 18)} ry={between(r, 3, 5)} fill="#ffffff" opacity=".18" />)
    }
    for (let i = 0; i < 4; i++) {
      const y = between(r, 10, 60)
      const x = between(r, 0, 60)
      out.push(<path key={`w${i}`} d={`M${x},${y} q10,-4 20,0 t14,-2 q4,-3 1,-5`} fill="none" stroke="#e8fff3" strokeWidth=".6" opacity=".55" strokeLinecap="round" />)
    }
    out.push(<path key="grass" d="M0,67 Q25,62 50,66 T100,64 V76 H0Z" fill="#0b3b26" />)
  } else if (attr === "LIGHT") {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2
      out.push(<path key={`r${i}`} d={`M50,36 L${50 + Math.cos(a) * 80},${36 + Math.sin(a) * 80} L${50 + Math.cos(a + 0.12) * 80},${36 + Math.sin(a + 0.12) * 80}Z`} fill="#fffbe0" opacity=".13" />)
    }
    for (let i = 0; i < 7; i++) out.push(sparkle(between(r, 4, 96), between(r, 4, 60), between(r, 0.8, 2), "#fffef0", `s${i}`))
    out.push(<path key="cloud" d="M0,68 Q14,60 28,66 Q42,58 56,66 Q72,60 86,66 Q94,62 100,64 V76 H0Z" fill="#fff6d0" opacity=".55" />)
  } else {
    for (let i = 0; i < 22; i++) out.push(<circle key={`st${i}`} cx={between(r, 1, 99)} cy={between(r, 1, 50)} r={between(r, 0.2, 0.6)} fill="#f3e8ff" opacity={between(r, 0.35, 0.9)} />)
    const mx = between(r, 10, 90)
    out.push(<circle key="moon" cx={mx} cy="12" r="6" fill="#efe3ff" opacity=".85" />)
    out.push(<circle key="moon2" cx={mx + 2.4} cy="10.6" r="5.4" fill={ATTR.DARK.sky[1]} />)
    out.push(<path key="mist" d="M0,62 Q20,56 40,62 T80,60 T100,62 V76 H0Z" fill="#160a24" />)
    out.push(<ellipse key="fog" cx="50" cy="66" rx="60" ry="5" fill="#9b7cc4" opacity=".18" />)
  }
  return out
}

// ---------- creatures ----------
// Each takes (g, r, card, col) -> SVG elements, drawn facing right around x 50, ground y 66.
// g: gradient ids and the eye color; col: { body, accent } tones.

// a head on the end of a neck: snout right, horns back
const dragonHead = (g, r, col, x, y, s, horns, k, { open = false, whiskers = false } = {}) => (
  <g key={k} transform={`translate(${x} ${y}) scale(${s})`}>
    {Array.from({ length: horns }, (_, i) => (
      <P key={`h${i}`} d={`M${-1 + i * 2.5},${-2} Q${-9 + i * 3},${-12 - i * 2} ${-13 + i * 4},${-16 - i * 2} Q${-5 + i * 3},${-8} ${2 + i * 2.5},${-3}Z`} fill={col.accent.hi} />
    ))}
    <P d={`M-3,-1 L11,-3 Q21,-1 20,3 L11,5 L5,8 Q-2,6 -3,1Z`} fill={`url(#${g.id}body)`} />
    <P d={open ? "M5,6 L19,7 L12,13Z" : "M5,6 L18,5 L12,9Z"} fill={col.body.lo} />
    {open && <path d="M9,6.6 l1,1.8 l1,-1.8 l1,1.8 l1,-1.8" stroke="#fff" strokeWidth=".5" fill="none" />}
    {whiskers && <path d="M18,3 Q26,8 30,4 M17,4 Q22,14 28,12" stroke={col.accent.hi} strokeWidth=".7" fill="none" />}
    <path d="M2,-1.6 Q6,-4 10,-2" stroke={col.body.line} strokeWidth=".8" fill="none" />
    {eye(6, 0.6, 1.3, g, "eye")}
    <circle cx="18" cy="1" r=".6" fill={col.body.line} />
  </g>
)

const wingPair = (g, col, x, y, s, lift, k) => (
  <g key={k} transform={`translate(${x} ${y}) scale(${s})`}>
    {[
      [7, -2, 0.7],
      [0, 0, 1],
    ].map(([dx, dy, op], i) => (
      <g key={i} opacity={op}>
        <P d={`M${dx},${dy} L${-28 + dx},${-32 + lift + dy} Q${-24 + dx},${-22 + dy} ${-34 + dx},${-18 + dy} Q${-24 + dx},${-14 + dy} ${-32 + dx},${-6 + dy} Q${-20 + dx},${-6 + dy} ${-22 + dx},${4 + dy} Q${-10 + dx},${2 + dy} ${-4 + dx},${8 + dy}Z`} fill={`url(#${g.id}wing)`} />
        <path d={`M${dx},${dy} L${-28 + dx},${-32 + lift + dy} M${-2 + dx},${2 + dy} L${-34 + dx},${-18 + dy} M${-3 + dx},${4 + dy} L${-32 + dx},${-6 + dy}`} stroke={col.body.line} strokeWidth=".9" fill="none" />
      </g>
    ))}
  </g>
)

const dragon = (g, r, c, col) => {
  const n = c.name
  if (/egg/i.test(n)) return dragonEgg(g, r, c, col)
  if (/whelp|hatchling|drakeling/i.test(n)) return babyDragon(g, r, c, col)
  if (/wyrm/i.test(n) && !/emberwyrm/i.test(n)) return longWyrm(g, r, c, col)
  const heads = /twin-headed|hydra/i.test(n) ? (/hydra/i.test(n) ? 3 : 2) : 1
  const wyvern = /wyvern|scout|herald/i.test(n)
  const horns = c.level >= 7 ? 3 : c.level >= 5 ? 2 : 1
  const lift = between(r, -8, 4)
  const out = []
  const by = wyvern ? -6 : 0
  if (/sovereign/i.test(n)) out.push(<circle key="halo" cx="58" cy="26" r="26" fill={`url(#${g.id}glow)`} />)
  out.push(wingPair(g, col, 48, 40 + by, /sovereign/i.test(n) ? 1.25 : wyvern ? 1.15 : 1, lift, "wings"))
  // tail
  out.push(<P key="tail" d={`M44,${52 + by} Q28,${60 + by} 16,${52 + by} Q10,${48 + by} 6,${54 + by} Q14,${56 + by} 18,${60 + by} Q32,${66 + by} 46,${58 + by}Z`} fill={`url(#${g.id}body)`} />)
  out.push(<path key="tailtip" d={`M6,${54 + by} l-4,-3 l1,6Z`} fill={col.accent.base} />)
  // legs
  if (wyvern) {
    out.push(<path key="lg" d={`M48,${58 + by} L46,64 M56,${58 + by} L57,65`} stroke={col.body.lo} strokeWidth="2.4" strokeLinecap="round" />)
    out.push(<path key="cl" d="M44,64 l2,1 l2,-1 M55,65 l2,1 l2,-1" stroke={col.accent.hi} strokeWidth=".8" fill="none" />)
  } else out.push(<P key="leg2" d="M44,56 L40,65 L46,66 L48,60Z" fill={col.body.lo} />)
  // body
  out.push(<ellipse key="body" cx="52" cy={51 + by} rx={wyvern ? 12 : 15} ry={wyvern ? 9 : 10.5} fill={`url(#${g.id}body)`} {...LINE} />)
  out.push(<path key="belly" d={`M44,${56 + by} Q53,${62 + by} 63,${55 + by} Q54,${58 + by} 44,${56 + by}Z`} fill={col.accent.hi} opacity=".9" />)
  for (let i = 0; i < 4; i++) out.push(<path key={`bs${i}`} d={`M${47 + i * 4},${57.5 + by} q2,1.4 4,0`} stroke={col.accent.lo} strokeWidth=".5" fill="none" />)
  // necks and heads
  for (let h = 0; h < heads; h++) {
    const spread = heads === 1 ? 0 : (h - (heads - 1) / 2) * 12
    const nl = between(r, -4, 3) + Math.abs(spread) * 0.4
    const hx = 64 + spread * 0.7
    const hy = 18 + nl + (heads > 1 ? Math.abs(spread) * 0.5 : 0) + by
    out.push(<P key={`neck${h}`} d={`M${56 + spread * 0.2},${44 + by} Q${60 + spread * 0.5},${34 + nl + by} ${hx},${hy + 6} L${hx + 7},${hy + 7} Q${hx + 4},${36 + nl + by} ${64 + spread * 0.2},${50 + by}Z`} fill={`url(#${g.id}body)`} />)
    for (let i = 0; i < 3; i++) out.push(<path key={`sp${h}${i}`} d={`M${57 + i * 2 + spread * 0.4},${41 - i * 5 + nl * (i / 3) + by} l-3,-2 l3,-1Z`} fill={col.accent.base} />)
    out.push(dragonHead(g, r, col, hx, hy, heads > 1 ? 0.85 : 1, horns, `head${h}`, { open: h === 0 && (c.attr === "FIRE" || r() < 0.5) }))
    if (h === 0 && (c.attr === "FIRE" || /thunder|storm/i.test(n)))
      out.push(
        /thunder|storm/i.test(n) ? (
          <path key="zap" d={`M${hx + 19},${hy + 7} l6,-4 l-1,5 l7,-3`} stroke="#fff27a" strokeWidth="1.2" fill="none" />
        ) : (
          <path key="breath" d={`M${hx + 18},${hy + 8} Q${hx + 30},${hy + 5} ${hx + 36},${hy + 16} Q${hx + 26},${hy + 14} ${hx + 18},${hy + 11}Z`} fill={`url(#${g.id}glow2)`} opacity=".9" />
        )
      )
  }
  if (!wyvern) out.push(<P key="leg1" d={`M58,56 L60,65 L66,66 L63,58Z`} fill={col.body.base} />)
  if (/sovereign/i.test(n)) for (let i = 0; i < 6; i++) out.push(sparkle(between(r, 20, 90), between(r, 4, 40), between(r, 1, 2.2), "#fff", `sv${i}`))
  return out
}

const babyDragon = (g, r, c, col) => {
  const out = []
  out.push(wingPair(g, col, 46, 46, 0.55, -6, "wings"))
  out.push(<P key="tail" d="M40,58 Q28,62 24,54 Q22,62 30,64 Q38,66 44,62Z" fill={`url(#${g.id}body)`} />)
  out.push(<ellipse key="body" cx="48" cy="54" rx="11" ry="9.5" fill={`url(#${g.id}body)`} {...LINE} />)
  out.push(<ellipse key="belly" cx="50" cy="57" rx="6" ry="5.4" fill={col.accent.hi} />)
  out.push(<path key="feet" d="M42,63 h5 M52,63 h5" stroke={col.body.lo} strokeWidth="2.4" strokeLinecap="round" />)
  out.push(<ellipse key="head" cx="57" cy="38" rx="11" ry="9.5" fill={`url(#${g.id}body)`} {...LINE} />)
  out.push(<ellipse key="snout" cx="65" cy="41" rx="6" ry="4.4" fill={col.body.base} {...LINE} />)
  out.push(<circle key="nos" cx="68" cy="40" r=".6" fill={col.body.line} />)
  out.push(<path key="smile" d="M62,44 Q66,46 69,43" stroke={col.body.line} strokeWidth=".7" fill="none" />)
  out.push(<P key="h1" d="M52,30 L49,23 L55,29Z" fill={col.accent.hi} />, <P key="h2" d="M58,29 L58,22 L61,29Z" fill={col.accent.hi} />)
  out.push(<ellipse key="eyew" cx="58" cy="36" rx="3" ry="3.4" fill="#fff" stroke="#000" strokeWidth=".4" />)
  out.push(<circle key="pupil" cx="59" cy="36.4" r="1.8" fill="#1a0e04" />, <circle key="glint" cx="59.6" cy="35.6" r=".6" fill="#fff" />)
  if (c.attr === "FIRE") out.push(<circle key="puff" cx="74" cy="40" r="2" fill="#ffcf6a" opacity=".8" />, <circle key="puff2" cx="78" cy="38" r="1.3" fill="#ffcf6a" opacity=".6" />)
  return out
}

const dragonEgg = (g, r, c, col) => [
  <ellipse key="glow" cx="50" cy="42" rx="26" ry="28" fill={`url(#${g.id}glow)`} />,
  <path key="nest" d="M28,62 Q50,72 72,62 Q66,56 50,58 Q34,56 28,62Z" fill="#3a2414" stroke="#160a04" strokeWidth=".6" />,
  <P key="egg" d="M50,16 Q66,18 68,42 Q68,62 50,62 Q32,62 32,42 Q34,18 50,16Z" fill={`url(#${g.id}body)`} />,
  <path key="spots" d="M42,28 h.1 M56,24 h.1 M60,40 h.1 M40,46 h.1 M52,52 h.1" stroke={col.accent.hi} strokeWidth="3" strokeLinecap="round" />,
  <path key="crack" d="M38,36 L44,40 L48,34 L54,40 L58,35 L64,39" stroke="#ffe08a" strokeWidth="1.2" fill="none" />,
  eye(51, 37.6, 1.2, g, "peek"),
]

const longWyrm = (g, r, c, col) => {
  const out = []
  const path = "M8,62 C20,40 34,70 48,50 C58,36 46,26 58,20 C64,17 70,18 74,20"
  out.push(<path key="body" d={path} stroke={col.body.line} strokeWidth="9.4" fill="none" strokeLinecap="round" />)
  out.push(<path key="body2" d={path} stroke={`url(#${g.id}bodyH)`} strokeWidth="8" fill="none" strokeLinecap="round" />)
  out.push(<path key="belly" d="M9,64 C21,43 35,73 50,52 C60,38 48,28 59,22" stroke={col.accent.hi} strokeWidth="2.4" fill="none" strokeLinecap="round" opacity=".85" />)
  for (let i = 0; i < 9; i++) {
    const t = i / 8
    const x = 10 + t * 56
    const y = 58 - Math.sin(t * 6) * 10 - t * 28
    out.push(<path key={`mn${i}`} d={`M${x},${y - 4} l-2,-5 l4,3Z`} fill={col.accent.base} />)
  }
  out.push(<path key="legs" d="M22,56 l-3,7 M40,58 l2,7 M50,46 l5,6" stroke={col.body.lo} strokeWidth="2" strokeLinecap="round" />)
  out.push(dragonHead(g, r, col, 70, 17, 1, c.level >= 7 ? 3 : 2, "head", { whiskers: true, open: c.attr !== "WATER" }))
  if (c.attr === "WATER") for (let i = 0; i < 8; i++) out.push(<path key={`ice${i}`} d={`M${between(r, 6, 94)},${between(r, 6, 64)} l1.4,-3 l1.4,3 l-1.4,3Z`} fill="#e4fbff" opacity=".8" />)
  if (c.attr === "WIND" || /storm/i.test(c.name)) out.push(bolt(86, 4, 0.7, "bolt"))
  if (c.attr === "DARK") out.push(<circle key="orb" cx="88" cy="30" r="8" fill={`url(#${g.id}glow)`} />)
  return out
}

const machine = (g, r, c, col) => {
  const n = c.name
  const out = []
  const metal = `url(#${g.id}body)`
  if (/hound|crawler/i.test(n)) {
    out.push(<circle key="gear" cx="26" cy="30" r="11" fill={col.body.lo} opacity=".5" />)
    out.push(<P key="tail" d="M30,40 L18,32 L20,30 L32,37Z" fill={col.body.lo} />)
    for (const [x, k] of [[34, "l1"], [40, "l2"], [58, "l3"], [64, "l4"]]) out.push(<P key={k} d={`M${x},48 L${x - 1},64 L${x + 4},65 L${x + 4},48Z`} fill={col.body.lo} />)
    out.push(<rect key="torso" x="28" y="36" width="42" height="15" rx="3" fill={metal} {...LINE} />)
    out.push(<path key="plates" d="M38,36 V51 M50,36 V51 M60,36 V51" stroke={col.body.line} strokeWidth=".6" />)
    out.push(<P key="head" d="M66,30 L82,32 L86,40 L80,44 L66,42Z" fill={metal} />)
    out.push(<rect key="visor" x="73" y="34" width="9" height="2.4" rx="1" fill={g.eye} />)
    out.push(<path key="jaw" d="M78,42 L88,44 L80,46Z" fill={col.body.lo} {...LINE} />)
    if (/crawler/i.test(n)) out.push(<path key="junk" d="M30,36 l4,-6 l5,4 l4,-7 l6,6 l5,-5 l4,8" fill={col.accent.lo} stroke={col.body.line} strokeWidth=".6" />)
    for (let i = 0; i < 6; i++) out.push(<circle key={`rv${i}`} cx={31 + i * 7} cy="49" r=".7" fill={col.body.hi} />)
    return out
  }
  if (/drone|bot|calibrator|spark/i.test(n)) {
    out.push(<ellipse key="rotor" cx="50" cy="18" rx="22" ry="2" fill={col.body.hi} opacity=".5" />)
    out.push(<path key="mast" d="M50,18 V26" stroke={col.body.line} strokeWidth="1.5" />)
    out.push(<circle key="body" cx="50" cy="38" r="13" fill={metal} {...LINE} />)
    out.push(<ellipse key="ring" cx="50" cy="38" rx="19" ry="5" fill="none" stroke={col.accent.base} strokeWidth="1.6" />)
    out.push(<circle key="lens" cx="50" cy="38" r="5" fill={col.body.line} />)
    out.push(eye(50, 38, 2.6, g, "eye"))
    out.push(<path key="legs" d="M42,49 L38,60 M58,49 L62,60 M50,51 V62" stroke={col.body.lo} strokeWidth="1.6" strokeLinecap="round" />)
    if (/calibrator/i.test(n)) out.push(<path key="dial" d="M50,38 L56,32" stroke="#fff" strokeWidth=".8" />, <path key="ticks" d="M38,24 l2,2 M62,24 l-2,2 M50,22 v3" stroke={col.accent.hi} strokeWidth=".8" />)
    if (/spark/i.test(n)) for (let i = 0; i < 3; i++) out.push(<path key={`z${i}`} d={`M${30 + i * 18},${54 - i * 3} l3,-4 l-2,0 l3,-4`} stroke="#fff27a" strokeWidth=".8" fill="none" />)
    return out
  }
  if (/gyro|interceptor/i.test(n)) {
    out.push(<ellipse key="rotor" cx="50" cy="14" rx="34" ry="2.4" fill={col.body.hi} opacity=".55" />)
    out.push(<path key="mast" d="M50,14 V24" stroke={col.body.line} strokeWidth="1.6" />)
    out.push(<P key="body" d="M26,34 Q30,24 50,24 L66,26 Q80,30 78,38 Q70,46 50,46 Q32,46 26,34Z" fill={metal} />)
    out.push(<P key="cockpit" d="M60,27 Q74,30 74,37 L60,37Z" fill={g.eye} opacity=".85" />)
    out.push(<P key="tail" d="M28,34 L8,28 L10,34 L26,38Z" fill={col.body.lo} />)
    out.push(<path key="trotor" d="M8,22 L10,40" stroke={col.body.hi} strokeWidth="1.2" opacity=".7" />)
    out.push(<path key="skid" d="M36,46 L34,54 M60,46 L62,54 M28,54 H70" stroke={col.body.line} strokeWidth="1.4" />)
    out.push(<path key="gun" d="M54,44 L80,48" stroke={col.accent.base} strokeWidth="2" strokeLinecap="round" />)
    return out
  }
  if (/assembly|arm\b/i.test(n)) {
    out.push(<rect key="base" x="20" y="58" width="26" height="8" rx="2" fill={metal} {...LINE} />)
    out.push(<path key="seg1" d="M33,58 L42,30" stroke={col.body.line} strokeWidth="7" strokeLinecap="round" />)
    out.push(<path key="seg1b" d="M33,58 L42,30" stroke={col.body.base} strokeWidth="5.6" strokeLinecap="round" />)
    out.push(<path key="seg2" d="M42,30 L66,36" stroke={col.body.line} strokeWidth="6" strokeLinecap="round" />)
    out.push(<path key="seg2b" d="M42,30 L66,36" stroke={col.body.hi} strokeWidth="4.6" strokeLinecap="round" />)
    for (const [x, y, k] of [[33, 58, "j1"], [42, 30, "j2"], [66, 36, "j3"]]) out.push(<circle key={k} cx={x} cy={y} r="3.4" fill={col.accent.base} {...LINE} />)
    out.push(<P key="claw1" d="M68,36 L78,30 L80,33 L71,38Z" fill={col.body.lo} />)
    out.push(<P key="claw2" d="M68,37 L78,44 L76,46 L67,40Z" fill={col.body.lo} />)
    out.push(<path key="beam" d="M76,40 L90,48" stroke={g.eye} strokeWidth="1.2" strokeDasharray="2 1.5" />)
    out.push(<path key="gear" d={gearPath(74, 60, 6, 8)} fill={col.body.lo} opacity=".8" />)
    return out
  }
  if (/bulwark/i.test(n)) {
    out.push(<path key="gearbg" d={gearPath(50, 24, 16, 12)} fill={col.body.lo} opacity=".5" />)
    out.push(<rect key="head" x="44" y="14" width="12" height="9" rx="2" fill={metal} {...LINE} />)
    out.push(<rect key="visor" x="45.5" y="17" width="9" height="2.2" rx="1" fill={g.eye} />)
    out.push(<P key="shield" d="M28,24 L72,24 L72,48 Q50,70 28,48Z" fill={`url(#${g.id}steel)`} />)
    out.push(<path key="rim" d="M32,28 L68,28 L68,47 Q50,64 32,47Z" fill="none" stroke={col.body.line} strokeWidth=".8" />)
    out.push(<path key="cog" d={gearPath(50, 40, 7, 10)} fill={col.accent.base} stroke={col.body.line} strokeWidth=".6" />)
    out.push(<circle key="core" cx="50" cy="40" r="2.6" fill={g.eye} />)
    for (let i = 0; i < 6; i++) out.push(<circle key={`rv${i}`} cx={i < 3 ? 33 + i * 3 : 61 + (i - 3) * 3} cy="26.5" r=".7" fill={col.body.lo} />)
    return out
  }
  // a walker: head, arms and size from the card
  const big = c.level >= 6 || /juggernaut|colossus|titan|overlord|mainframe/i.test(n)
  const s = big ? 1.15 : 1
  const head = /mainframe|overlord/i.test(n) ? "screen" : pick(r, ["box", "dome", "eye"])
  const arm = /brawler/i.test(n) ? "glove" : /recycler/i.test(n) ? "claw" : /lancer|tesla/i.test(n) ? "lance" : /juggernaut|colossus|ironclad/i.test(n) ? "cannon" : pick(r, ["fist", "claw", "cannon"])
  const treads = /juggernaut|colossus|ironclad/i.test(n)
  out.push(<path key="gearbg" d={gearPath(30, 26, big ? 15 : 12, 10)} fill={col.body.lo} opacity=".55" />)
  out.push(<circle key="gearhole" cx="30" cy="26" r="4" fill={ATTR[c.attr].sky[1]} opacity=".8" />)
  if (/recycler/i.test(n)) out.push(<path key="scrap" d="M62,66 l4,-8 l6,3 l3,-7 l7,5 l5,-3 l3,10Z" fill={col.accent.lo} stroke={col.body.line} strokeWidth=".6" />)
  const armEnd = (x, y, side, k) => {
    if (arm === "glove") return <circle key={k} cx={x} cy={y + 2} r="5" fill="#c43a2b" stroke="#3a0a04" strokeWidth=".7" />
    if (arm === "claw") return <path key={k} d={`M${x - 3},${y} l${-2 * side},6 M${x},${y} v7 M${x + 3},${y} l${2 * side},6`} stroke={col.body.line} strokeWidth="1.4" strokeLinecap="round" />
    if (arm === "cannon") return <rect key={k} x={x - 3} y={y - 1} width="6" height="9" rx="1" fill={col.body.line} />
    return <rect key={k} x={x - 3.5} y={y} width="7" height="5" rx="1.5" fill={col.body.base} {...LINE} />
  }
  out.push(
    <g key="bot" transform={`translate(50 66) scale(${s}) translate(-50 -66)`}>
      {treads ? (
        <>
          <rect x="32" y="54" width="37" height="11" rx="5" fill="#2a2d33" stroke="#000" strokeWidth=".7" />
          {[37, 44, 51, 58, 64].map((x) => (
            <circle key={x} cx={x} cy="59.5" r="2.6" fill="#5a606a" />
          ))}
        </>
      ) : (
        <>
          <P d="M42,50 L40,64 L47,65 L48,50Z" fill={col.body.lo} />
          <P d="M54,50 L55,65 L62,64 L60,50Z" fill={col.body.lo} />
        </>
      )}
      <rect x="37" y="27" width="27" height="25" rx="3" fill={metal} {...LINE} />
      <path d="M41,33 H60 M41,46 H60 M50.5,27 V52" stroke={col.body.line} strokeWidth=".5" />
      <circle cx="50.5" cy="39" r="4.2" fill={col.body.line} />
      <circle cx="50.5" cy="39" r="6" fill={`url(#${g.id}glow)`} />
      <circle cx="50.5" cy="39" r="2.4" fill={g.eye} />
      <rect x="29" y="27" width="9" height="8" rx="2" fill={metal} {...LINE} />
      <rect x="63" y="27" width="9" height="8" rx="2" fill={metal} {...LINE} />
      <P d="M30,35 L28,50 L33,51 L35,35Z" fill={col.body.lo} />
      <P d="M66,35 L70,48 L74,46 L70,35Z" fill={col.body.lo} />
      {armEnd(30.5, 50, -1, "a1")}
      {arm !== "lance" && armEnd(72, 47, 1, "a2")}
      {arm === "lance" && <path d="M72,47 L90,20" stroke={col.accent.hi} strokeWidth="2.2" strokeLinecap="round" />}
      {arm === "lance" && <path d="M90,20 l3,-4 l-5,1 l3,-5" stroke="#fffa9a" strokeWidth=".8" fill="none" />}
      {arm === "cannon" && <circle cx="75" cy="56" r="3" fill={`url(#${g.id}glow)`} />}
      {head === "box" && (
        <>
          <rect x="44" y="15" width="13" height="12" rx="2.5" fill={metal} {...LINE} />
          <rect x="45.5" y="19" width="10" height="3" rx="1.2" fill={g.eye} />
          <path d="M50.5,15 V9" stroke={col.body.line} strokeWidth=".8" />
          <circle cx="50.5" cy="8.5" r="1.3" fill={col.accent.hi} />
        </>
      )}
      {head === "dome" && (
        <>
          <path d="M43,27 Q43,13 50.5,13 Q58,13 58,27Z" fill={metal} {...LINE} />
          <path d="M45,21 H56" stroke={g.eye} strokeWidth="2.4" strokeLinecap="round" />
          <path d="M43,18 l-4,-3 M58,18 l4,-3" stroke={col.body.line} strokeWidth="1" />
        </>
      )}
      {head === "eye" && (
        <>
          <circle cx="50.5" cy="20" r="7" fill={metal} {...LINE} />
          <circle cx="50.5" cy="20" r="3.6" fill={col.body.line} />
          {eye(50.5, 20, 2.2, g, "cyc")}
        </>
      )}
      {head === "screen" && (
        <>
          <rect x="40" y="10" width="21" height="16" rx="2" fill="#1b2230" stroke="#000" strokeWidth=".7" />
          <rect x="42" y="12" width="17" height="12" rx="1" fill={g.eye} opacity=".25" />
          <path d="M45,16 h3 M53,16 h3 M46,21 q4.5,2.6 9,0" stroke={g.eye} strokeWidth="1.2" fill="none" strokeLinecap="round" />
          <path d="M40,24 Q30,30 26,40 M61,24 Q72,32 76,26" stroke={col.accent.base} strokeWidth="1" fill="none" />
        </>
      )}
      {[40, 61, 40, 61].map((x, i) => (
        <circle key={i} cx={x} cy={i < 2 ? 30 : 49} r=".8" fill={col.body.hi} />
      ))}
    </g>
  )
  if (/overclock|titan|mainframe/i.test(n)) for (let i = 0; i < 3; i++) out.push(<path key={`st${i}`} d={`M${38 + i * 12},12 q-3,-5 1,-9`} stroke="#fff" strokeOpacity=".5" strokeWidth="1.4" fill="none" strokeLinecap="round" />)
  if (/sentry/i.test(n)) out.push(<path key="beam" d="M58,18 L98,4 L98,26Z" fill="#fff8c0" opacity=".2" />)
  return out
}

const caster = (g, r, c, col) => {
  const n = c.name
  const witch = /witch|enchantress|sorceress|siren/i.test(n)
  const out = []
  // magic circle
  out.push(<ellipse key="mc" cx="50" cy="66" rx="27" ry="5" fill="none" stroke={g.eye} strokeWidth=".9" opacity=".85" />)
  out.push(<ellipse key="mc2" cx="50" cy="66" rx="21" ry="3.6" fill="none" stroke={g.eye} strokeWidth=".5" strokeDasharray="1.5 1.2" opacity=".85" />)
  out.push(<ellipse key="mcg" cx="50" cy="66" rx="27" ry="6" fill={`url(#${g.id}glow)`} opacity=".7" />)
  // robe
  out.push(<P key="robe" d="M50,26 Q42,40 33,66 L67,66 Q58,40 50,26Z" fill={`url(#${g.id}body)`} />)
  out.push(<path key="trim" d="M34,64 L66,64 L67,66 L33,66Z" fill={col.accent.hi} />)
  out.push(<path key="fold" d="M46,40 L42,64 M54,40 L58,64" stroke={col.body.lo} strokeWidth=".7" fill="none" />)
  // sleeves
  out.push(<P key="sl1" d="M45,32 Q36,38 34,46 L39,47 Q42,40 47,36Z" fill={col.body.base} />)
  out.push(<P key="sl2" d="M55,32 Q64,36 66,42 L62,45 Q58,40 53,36Z" fill={col.body.base} />)
  // head
  if (witch) {
    out.push(<ellipse key="hair" cx="50" cy="27" rx="7" ry="8" fill={col.accent.lo} {...LINE} />)
    out.push(<ellipse key="face" cx="50" cy="25" rx="4.4" ry="5.2" fill="#f1d4b8" {...LINE} />)
    out.push(<path key="eyes" d="M47.6,24.6 h1.4 M51,24.6 h1.4" stroke="#2a1530" strokeWidth=".9" />)
    out.push(<P key="hat" d="M39,20 Q50,16 61,20 Q55,22 50,22 Q45,22 39,20Z" fill={col.body.lo} />)
    out.push(<P key="hatc" d={`M44,20 L${between(r, 50, 58)},2 L56,20Z`} fill={col.body.lo} />)
    out.push(<path key="band" d="M44.6,18.6 L55.4,18.6" stroke={col.accent.hi} strokeWidth="1.3" />)
  } else {
    out.push(<P key="hood" d="M41,28 Q42,12 50,11 Q58,12 59,28 Q50,32 41,28Z" fill={col.body.lo} />)
    out.push(<ellipse key="face" cx="50" cy="23" rx="5" ry="6" fill="#0b0712" />)
    out.push(eye(48, 22.6, 0.8, g, "e1"), eye(52, 22.6, 0.8, g, "e2"))
  }
  // staff and orb (or a book)
  if (/keeper|scholar|grimoire|archmage/i.test(n)) {
    out.push(<P key="book" d="M38,42 L50,44 L62,42 L62,51 L50,53 L38,51Z" fill="#6b3a1a" />)
    out.push(<path key="pages" d="M39.5,43.4 L50,45.4 L60.5,43.4 M50,45 V52" stroke="#f3e2c0" strokeWidth=".7" fill="none" />)
    out.push(<circle key="bglow" cx="50" cy="40" r="9" fill={`url(#${g.id}glow)`} />)
  } else {
    out.push(<path key="staff" d="M66,64 L70,16" stroke="#6b4423" strokeWidth="1.8" strokeLinecap="round" />)
    out.push(<circle key="orbglow" cx="70.4" cy="13" r="9" fill={`url(#${g.id}glow)`} />)
    out.push(<circle key="orb" cx="70.4" cy="13" r="3.2" fill={g.eye} stroke="#fff" strokeWidth=".4" />)
    out.push(<path key="claw" d="M67.6,16 Q70,18 73,16 M68,14 Q66,10 68,9 M73,14 Q75,10 73,9" stroke="#6b4423" strokeWidth=".8" fill="none" />)
  }
  for (let i = 0; i < 5; i++) out.push(sparkle(between(r, 20, 82), between(r, 6, 50), between(r, 0.6, 1.5), "#fff", `sp${i}`))
  return out
}

const fish = (g, r, c, col) => {
  const out = []
  const tilt = between(r, -8, 8)
  out.push(
    <g key="fish" transform={`rotate(${tilt} 50 40)`}>
      <P d="M28,40 L12,28 L17,40 L12,52Z" fill={col.accent.base} />
      <P d="M40,29 Q48,14 58,30Z" fill={col.accent.base} />
      <P d="M44,50 Q48,60 54,50Z" fill={col.accent.base} />
      <P d="M24,40 Q40,22 66,33 Q75,40 66,47 Q40,58 24,40Z" fill={`url(#${g.id}body)`} />
      <path d="M30,44 Q46,52 64,45 Q46,48 30,44Z" fill={col.body.hi} opacity=".6" />
      {[0, 1, 2, 3].map((i) => (
        <path key={i} d={`M${34 + i * 6},33 q3,3 0,6 M${37 + i * 6},38 q3,3 0,6`} stroke={col.body.lo} strokeWidth=".45" fill="none" />
      ))}
      <path d="M56,33 Q53,40 56,46" stroke={col.body.line} strokeWidth=".7" fill="none" />
      <circle cx="62" cy="37" r="2.6" fill="#fff" stroke="#000" strokeWidth=".4" />
      <circle cx="62.6" cy="37.2" r="1.3" fill="#000" />
      <path d="M68,42 l2,1 l-1,1 l2,1" stroke="#fff" strokeWidth=".5" fill="none" />
      {/angler/i.test(c.name) && <path d="M60,32 Q70,14 80,22" stroke={col.body.lo} strokeWidth=".9" fill="none" />}
      {/angler/i.test(c.name) && <circle cx="80" cy="23" r="7" fill={`url(#${g.id}glow)`} />}
      {/angler/i.test(c.name) && <circle cx="80" cy="23" r="1.8" fill={g.eye} />}
    </g>
  )
  for (let i = 0; i < 3; i++) {
    const x = between(r, 14, 86)
    const y = between(r, 50, 64)
    out.push(<path key={`s${i}`} d={`M${x},${y} l4,-2 l0,4Z`} fill={col.accent.lo} opacity=".8" />)
  }
  return out
}

const serpent = (g, r, c, col) => {
  const out = []
  const w = c.level >= 7 ? 9 : 7
  const path = "M6,66 C24,40 38,74 56,48 C66,34 74,30 80,22"
  out.push(<path key="body" d={path} stroke={col.body.line} strokeWidth={w + 1.4} fill="none" strokeLinecap="round" />)
  out.push(<path key="body2" d={path} stroke={`url(#${g.id}bodyH)`} strokeWidth={w} fill="none" strokeLinecap="round" />)
  out.push(<path key="belly" d="M8,67 C26,43 38,77 57,50 C66,38 72,34 78,26" stroke={col.accent.hi} strokeWidth={w * 0.28} fill="none" strokeLinecap="round" opacity=".85" />)
  for (let i = 0; i < 6; i++) out.push(<path key={`fin${i}`} d={`M${16 + i * 10},${i % 2 ? 46 : 56} l-2,-6 l5,4Z`} fill={col.accent.base} {...LINE} />)
  out.push(<P key="head" d="M72,16 L86,14 Q94,16 92,22 L84,26 L74,26 Q70,22 72,16Z" fill={`url(#${g.id}body)`} />)
  out.push(<P key="frill" d="M72,16 L64,8 L70,18 L62,14 L71,22Z" fill={col.accent.base} />)
  out.push(<path key="mouth" d="M82,23 L92,21" stroke={col.body.line} strokeWidth=".7" />)
  out.push(eye(80, 18.6, 1.2, g, "eye"))
  return out
}

const tentacled = (g, r, c, col) => {
  const out = []
  const squid = /squid/i.test(c.name)
  const n = squid ? 6 : 8
  for (let i = 0; i < n; i++) {
    const x = 30 + (i / (n - 1)) * 40
    const dir = i < n / 2 ? -1 : 1
    const end = x + dir * between(r, 8, 18)
    const d = `M${x},40 Q${x + dir * 4},56 ${(x + end) / 2},60 T${end},${between(r, 50, 70)}`
    out.push(<path key={`t${i}`} d={d} stroke={col.body.line} strokeWidth="4.4" fill="none" strokeLinecap="round" />)
    out.push(<path key={`ti${i}`} d={d} stroke={col.body.base} strokeWidth="3.2" fill="none" strokeLinecap="round" />)
    out.push(<path key={`tc${i}`} d={d} stroke={col.accent.hi} strokeWidth=".9" strokeDasharray=".8 1.6" fill="none" />)
  }
  if (squid) out.push(<P key="mantle" d="M38,40 Q36,16 50,4 Q64,16 62,40Z" fill={`url(#${g.id}body)`} />)
  else out.push(<P key="mantle" d="M30,40 Q30,10 50,8 Q70,10 70,40 Q50,46 30,40Z" fill={`url(#${g.id}body)`} />)
  out.push(<path key="spots" d="M42,20 h.1 M56,16 h.1 M48,28 h.1 M60,26 h.1" stroke={col.accent.hi} strokeWidth="2" strokeLinecap="round" />)
  out.push(eye(43, 36, 1.9, g, "e1"), eye(57, 36, 1.9, g, "e2"))
  if (squid) for (let i = 0; i < 4; i++) out.push(<circle key={`ink${i}`} cx={between(r, 16, 84)} cy={between(r, 10, 60)} r={between(r, 2, 5)} fill="#05060a" opacity=".35" />)
  return out
}

const crab = (g, r, c, col) => {
  const out = []
  for (let i = 0; i < 3; i++) {
    out.push(<path key={`l${i}`} d={`M${40 - i * 2},50 L${28 - i * 4},${56 + i * 3} L${24 - i * 4},${64 + i}`} stroke={col.body.lo} strokeWidth="2" fill="none" strokeLinecap="round" />)
    out.push(<path key={`r${i}`} d={`M${60 + i * 2},50 L${72 + i * 4},${56 + i * 3} L${76 + i * 4},${64 + i}`} stroke={col.body.lo} strokeWidth="2" fill="none" strokeLinecap="round" />)
  }
  out.push(<P key="arm1" d="M36,42 L22,32 L26,28 L38,38Z" fill={col.body.base} />)
  out.push(<P key="arm2" d="M64,42 L78,32 L74,28 L62,38Z" fill={col.body.base} />)
  out.push(<P key="claw1" d="M24,30 Q12,24 14,14 Q20,22 26,20 Q22,14 28,10 Q32,22 26,30Z" fill={`url(#${g.id}body)`} />)
  out.push(<P key="claw2" d="M76,30 Q88,24 86,14 Q80,22 74,20 Q78,14 72,10 Q68,22 74,30Z" fill={`url(#${g.id}body)`} />)
  out.push(<P key="shell" d="M30,46 Q30,30 50,28 Q70,30 70,46 Q50,56 30,46Z" fill={`url(#${g.id}body)`} />)
  out.push(<path key="ridges" d="M38,36 Q50,32 62,36 M36,42 Q50,38 64,42" stroke={col.body.hi} strokeWidth=".7" fill="none" opacity=".7" />)
  out.push(<path key="stalks" d="M45,30 L44,24 M55,30 L56,24" stroke={col.body.lo} strokeWidth="1.2" />)
  out.push(<circle key="e1" cx="44" cy="23" r="1.8" fill="#111" />, <circle key="e2" cx="56" cy="23" r="1.8" fill="#111" />)
  for (let i = 0; i < 5; i++) out.push(<circle key={`b${i}`} cx={between(r, 40, 64)} cy={between(r, 10, 22)} r={between(r, 1, 2.4)} fill="none" stroke="#fff" strokeWidth=".5" opacity=".8" />)
  return out
}

const jelly = (g, r, c, col) => {
  const out = []
  out.push(<circle key="halo" cx="50" cy="28" r="26" fill={`url(#${g.id}glow)`} opacity=".7" />)
  for (let i = 0; i < 7; i++) {
    const x = 36 + i * 4.6
    out.push(<path key={`t${i}`} d={`M${x},34 q-3,8 0,14 t0,14`} stroke={col.accent.hi} strokeWidth="1.1" fill="none" opacity=".8" />)
  }
  out.push(<P key="bell" d="M30,34 Q30,12 50,12 Q70,12 70,34 Q66,32 62,35 Q58,32 54,35 Q50,32 46,35 Q42,32 38,35 Q34,32 30,34Z" fill={col.body.base} opacity=".85" />)
  out.push(<path key="inner" d="M38,30 Q40,18 50,18 Q60,18 62,30" stroke={col.body.hi} strokeWidth="1.4" fill="none" />)
  out.push(<circle key="core" cx="50" cy="25" r="3" fill={g.eye} />)
  return out
}

// an armored figure: warriors (and undead knights). Helmet, weapon, shield and armor
// color come from the card's name and its random seed.
const knight = (g, r, c, col, { undead = false } = {}) => {
  const n = c.name
  const out = []
  const ronin = /ronin|assassin|cloak/i.test(n)
  const weapon = /lancer/i.test(n) ? "lance" : /dancer|ronin|twin/i.test(n) ? "twin" : /berserker/i.test(n) ? "axe" : /duke/i.test(n) ? "mace" : /warlord|paragon|swordmaster/i.test(n) ? "great" : "sword"
  const helm = undead ? "skull" : ronin ? "hood" : /berserker/i.test(n) ? "horned" : /captain|recruit|squire|paladin/i.test(n) ? "open" : /champion|arena/i.test(n) ? "crest" : pick(r, ["bucket", "crest", "bucket"])
  const shieldy = /recruit/i.test(n) ? "tower" : weapon === "sword" || weapon === "mace" ? pick(r, ["kite", "round", "kite"]) : null
  const metalTone = c.attr === "LIGHT" ? tone(46, 70, 58) : c.attr === "FIRE" ? tone(24, 45, 52) : c.attr === "DARK" ? tone(260, 12, 30) : col.body
  const armor = `url(#${g.id}armor)`
  const big = c.level >= 7
  out.push(
    <defs key="adefs">
      <linearGradient id={`${g.id}armor`} x1="0" y1="0" x2=".8" y2="1">
        <stop offset="0" stopColor={metalTone.hi} />
        <stop offset=".55" stopColor={metalTone.base} />
        <stop offset="1" stopColor={metalTone.lo} />
      </linearGradient>
    </defs>
  )
  if (big) out.push(<circle key="aura" cx="50" cy="36" r="28" fill={`url(#${g.id}glow)`} opacity=".55" />)
  // cape
  if (!ronin) out.push(<P key="cape" d={`M42,28 Q${big ? 24 : 30},44 ${big ? 26 : 32},64 L50,60 L68,64 Q70,44 58,28Z`} fill={col.accent.lo} />)
  else out.push(<P key="cape" d="M40,26 Q28,46 30,66 L70,66 Q72,46 60,26Z" fill="#1d1622" />)
  // legs
  out.push(<P key="lg1" d="M44,48 L42,64 L48,65 L50,48Z" fill={ronin ? "#241c2a" : metalTone.lo} />)
  out.push(<P key="lg2" d="M51,48 L53,65 L59,64 L57,48Z" fill={ronin ? "#241c2a" : metalTone.lo} />)
  // torso
  out.push(<P key="torso" d="M41,29 Q50,25 59,29 L58,48 Q50,51 42,48Z" fill={ronin ? "#2b2233" : armor} />)
  if (!ronin) out.push(<path key="chest" d="M45,32 Q50,36 55,32 M50,34 V46" stroke={metalTone.hi} strokeWidth=".7" fill="none" />)
  if (/berserker/i.test(n)) out.push(<path key="fur" d="M40,30 q3,-4 6,0 q3,-4 6,0 q3,-4 6,0 q2,-3 4,0" fill="#8a6a3a" stroke="#3a2a14" strokeWidth=".5" />)
  out.push(<rect key="belt" x="42" y="44.5" width="16" height="2.6" fill={col.accent.base} {...LINE} />)
  out.push(<ellipse key="sh1" cx="41" cy="30" rx="4.4" ry="3.4" fill={ronin ? "#2b2233" : armor} {...LINE} />)
  out.push(<ellipse key="sh2" cx="59" cy="30" rx="4.4" ry="3.4" fill={ronin ? "#2b2233" : armor} {...LINE} />)
  out.push(<P key="arm1" d="M38,32 L34,44 L38,46 L41,34Z" fill={ronin ? "#241c2a" : metalTone.lo} />)
  out.push(<P key="arm2" d="M61,32 L68,40 L66,43 L59,36Z" fill={ronin ? "#241c2a" : metalTone.lo} />)
  // weapon
  if (weapon === "lance") {
    out.push(<path key="lance" d="M30,60 L82,10" stroke="#c9c9d6" strokeWidth="2" strokeLinecap="round" />)
    out.push(<P key="tip" d="M82,10 L88,2 L84,12Z" fill="#eef" />)
    out.push(<P key="pennant" d="M74,18 L84,22 L76,24Z" fill={col.accent.hi} />)
  } else if (weapon === "axe") {
    out.push(<path key="haft" d="M64,46 L80,10" stroke="#6b4423" strokeWidth="1.8" strokeLinecap="round" />)
    out.push(<P key="head" d="M76,14 Q90,10 88,24 Q82,20 74,20Z" fill={`url(#${g.id}steel)`} />)
  } else if (weapon === "mace") {
    out.push(<path key="haft" d="M64,44 L78,18" stroke="#6b4423" strokeWidth="1.8" strokeLinecap="round" />)
    out.push(<path key="ball" d={star(79, 15, 6, 3.6, 8)} fill={`url(#${g.id}steel)`} stroke="#333" strokeWidth=".5" />)
  } else {
    const len = weapon === "great" ? 1.35 : 1
    out.push(<P key="blade" d={`M66,42 L${66 + 16 * len},${42 - 34 * len} L${68 + 16 * len},${44 - 32 * len} L69,44Z`} fill={`url(#${g.id}steel)`} />)
    out.push(<path key="guard" d="M63,40 L71,46" stroke={col.accent.hi} strokeWidth="1.6" strokeLinecap="round" />)
    if (/paladin|ember/i.test(n)) out.push(<path key="fireblade" d="M68,40 Q78,24 82,8 Q86,22 74,42Z" fill={`url(#${g.id}fire)`} opacity=".55" />)
    if (weapon === "twin") {
      out.push(<P key="blade2" d="M36,44 L16,14 L19,13 L38,42Z" fill={`url(#${g.id}steel)`} />)
      out.push(<path key="guard2" d="M34,42 L40,40" stroke={col.accent.hi} strokeWidth="1.4" strokeLinecap="round" />)
    }
  }
  // shield
  if (shieldy === "tower") {
    out.push(<P key="shield" d="M24,26 L40,24 L40,58 L24,56Z" fill={col.accent.base} />)
    out.push(<path key="emblem" d="M32,32 V50 M27,38 H37" stroke={col.accent.hi} strokeWidth="1.6" />)
  } else if (shieldy === "kite") {
    out.push(<P key="shield" d="M28,34 L40,32 L40,46 Q34,54 28,46Z" fill={col.accent.base} />)
    out.push(<path key="emblem" d={star(34, 41, 3.4, 1.4, 5)} fill={col.accent.hi} />)
  } else if (shieldy === "round") {
    out.push(<circle key="shield" cx="33" cy="42" r="8" fill={col.accent.base} {...LINE} />)
    out.push(<circle key="boss" cx="33" cy="42" r="2.4" fill={`url(#${g.id}steel)`} stroke="#333" strokeWidth=".4" />)
    out.push(<circle key="rim" cx="33" cy="42" r="6.6" fill="none" stroke={col.accent.hi} strokeWidth=".6" />)
  }
  // head
  if (helm === "skull") {
    out.push(<ellipse key="skull" cx="50" cy="21" rx="5.6" ry="6" fill="#e6dfc6" {...LINE} />)
    out.push(<path key="jaw" d="M46.5,25 h7 v3 h-7z" fill="#d6ceb1" {...LINE} />)
    out.push(eye(48, 21, 1.1, g, "e1"), eye(52.4, 21, 1.1, g, "e2"))
    out.push(<P key="helm" d="M43.6,19 Q50,9 56.4,19 L55,16 Q50,12 45,16Z" fill={col.body.lo} />)
  } else if (helm === "hood") {
    out.push(<ellipse key="face" cx="50" cy="21" rx="4.6" ry="5.2" fill="#2a2030" />)
    out.push(eye(48.2, 21, 0.75, g, "e1"), eye(51.8, 21, 0.75, g, "e2"))
    out.push(<P key="hat" d={/ronin/i.test(n) ? "M36,18 L50,10 L64,18Z" : "M42,24 Q42,10 50,9 Q58,10 58,24 Q50,20 42,24Z"} fill={/ronin/i.test(n) ? "#b89a5a" : "#151019"} />)
  } else if (helm === "open") {
    out.push(<ellipse key="face" cx="50" cy="21.4" rx="4.4" ry="5" fill="#e9c8a8" {...LINE} />)
    out.push(<path key="eyes" d="M47.8,21 h1.2 M51,21 h1.2 M48.6,24.2 q1.4,.8 2.8,0" stroke="#3a2214" strokeWidth=".8" fill="none" />)
    if (/squire/i.test(n)) out.push(<P key="hair" d="M45.4,19 Q46,13 50,13 Q55,13 55,19 Q52,16 45.4,19Z" fill="#8a5a2b" />)
    else out.push(<P key="helm" d="M44.6,22 Q44,12 50,11.4 Q56,12 55.4,22 L54,17 Q50,14.6 46,17Z" fill={armor} />)
    if (/captain/i.test(n)) out.push(<path key="mous" d="M47.6,23.4 q2.4,-1 4.8,0" stroke="#5a3a1a" strokeWidth=".9" fill="none" />)
  } else {
    out.push(<P key="helm" d="M44,26 Q43,13 50,12 Q57,13 56,26 Q50,28 44,26Z" fill={armor} />)
    out.push(<path key="visor" d="M45.5,20 H54.5" stroke="#0c0c12" strokeWidth="1.6" />)
    out.push(<path key="visor2" d="M50,20 V26" stroke="#0c0c12" strokeWidth=".9" />)
    if (helm === "horned") out.push(<P key="horn1" d="M44.6,17 Q38,14 37,7 Q41,12 45.4,14Z" fill="#efe6cc" />, <P key="horn2" d="M55.4,17 Q62,14 63,7 Q59,12 54.6,14Z" fill="#efe6cc" />)
    if (helm === "crest") out.push(<P key="crest" d="M46,13 Q50,2 58,6 Q54,7 54,13Z" fill={col.accent.hi} />)
    else if (helm === "bucket" && r() < 0.6) out.push(<P key="plume" d="M50,12 Q44,4 36,6 Q44,8 49,13Z" fill={col.accent.hi} />)
  }
  if (/duke|warlord|champion|captain|paragon/i.test(n) && helm !== "open") out.push(<path key="crown" d="M45,13 L46,9 L48,12 L50,8 L52,12 L54,9 L55,13Z" fill="#ffd34d" {...LINE} />)
  return out
}

const skeleton = (g, r, c, col) => {
  const n = c.name
  if (/knight/i.test(n)) return knight(g, r, c, col, { undead: true })
  const out = []
  const ghost = /banshee|wisp|spectral/i.test(n)
  if (ghost) {
    out.push(<circle key="aura" cx="50" cy="32" r="24" fill={`url(#${g.id}glow)`} opacity=".7" />)
    out.push(<P key="wisp" d="M36,30 Q36,12 50,12 Q64,12 64,30 Q66,46 72,60 Q62,54 58,62 Q54,52 50,64 Q46,52 42,62 Q38,54 28,60 Q34,46 36,30Z" fill={col.body.hi} opacity=".75" />)
    out.push(<ellipse key="m" cx="50" cy="34" rx="2.6" ry="4" fill="#120818" />)
    out.push(eye(45, 25, 1.6, g, "e1"), eye(55, 25, 1.6, g, "e2"))
    return out
  }
  if (/rat/i.test(n)) {
    out.push(<path key="tail" d="M30,58 Q14,60 12,46 Q12,40 18,38" stroke="#b9a7a0" strokeWidth="1.4" fill="none" />)
    out.push(<P key="body" d="M28,58 Q28,40 48,38 Q64,38 66,52 Q60,62 28,58Z" fill={`url(#${g.id}body)`} />)
    out.push(<P key="head" d="M60,40 L82,46 Q84,50 78,52 L64,54Z" fill={col.body.base} />)
    out.push(<ellipse key="ear" cx="62" cy="38" rx="4" ry="5" fill="#d8a7a7" {...LINE} />)
    out.push(eye(72, 45.5, 1, g, "e"))
    out.push(<path key="crown" d="M54,36 L56,30 L59,34 L62,28 L64,34 L67,30 L67,37Z" fill="#c9a33a" {...LINE} />)
    for (let i = 0; i < 3; i++) out.push(<path key={`ft${i}`} d={`M${36 + i * 10},58 v6`} stroke="#b9a7a0" strokeWidth="1.4" />)
    return out
  }
  if (/bloom/i.test(n)) {
    out.push(<path key="stem" d="M50,66 Q46,50 50,36" stroke="#3d5a2a" strokeWidth="2.4" fill="none" />)
    out.push(<P key="leaf1" d="M48,54 Q36,50 32,40 Q44,44 48,52Z" fill="#4b6e31" />)
    out.push(<P key="leaf2" d="M50,48 Q62,44 66,34 Q54,38 50,46Z" fill="#4b6e31" />)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * 360
      out.push(<P key={`p${i}`} d="M50,30 Q44,18 50,10 Q56,18 50,30Z" fill={`url(#${g.id}body)`} transform={`rotate(${a} 50 30)`} />)
    }
    out.push(<circle key="c" cx="50" cy="30" r="5.5" fill="#e6dfc6" {...LINE} />)
    out.push(eye(48, 29.4, 0.9, g, "e1"), eye(52, 29.4, 0.9, g, "e2"))
    return out
  }
  const big = /colossus|ogre|ghoul|horde|lich|sovereign|crawler/i.test(n) || c.level >= 6
  // cloak
  out.push(<P key="cloak" d="M38,26 Q30,40 28,64 L34,60 L38,66 L44,60 L50,66 L56,60 L62,66 L66,60 L72,64 Q70,40 62,26Z" fill={`url(#${g.id}body)`} />)
  // ribs
  out.push(<path key="spine" d="M50,30 V50" stroke="#e6dfc6" strokeWidth="1.2" />)
  for (let i = 0; i < 4; i++) out.push(<path key={`rib${i}`} d={`M50,${33 + i * 4} q-6,1 -7,4 M50,${33 + i * 4} q6,1 7,4`} stroke="#e6dfc6" strokeWidth=".9" fill="none" />)
  // arms
  out.push(<path key="a1" d="M40,30 L32,44 L28,50" stroke="#ddd5bb" strokeWidth="1.6" fill="none" strokeLinecap="round" />)
  out.push(<path key="a2" d="M60,30 L68,40 L72,36" stroke="#ddd5bb" strokeWidth="1.6" fill="none" strokeLinecap="round" />)
  out.push(<path key="h1" d="M28,50 l-2,3 M28,50 l0,3.6 M28,50 l2,3" stroke="#ddd5bb" strokeWidth=".8" />)
  if (/archer/i.test(n)) {
    out.push(<path key="bow" d="M72,22 Q86,36 72,52" stroke="#7a5230" strokeWidth="1.6" fill="none" />)
    out.push(<path key="str" d="M72,22 L72,52" stroke="#ddd" strokeWidth=".4" />)
    out.push(<path key="arrow" d="M58,37 L84,37 M84,37 l-3,-2 M84,37 l-3,2" stroke="#e6dfc6" strokeWidth=".8" />)
  }
  if (/digger|warden/i.test(n)) {
    out.push(<path key="shovel" d="M72,36 L78,62" stroke="#6b4a2b" strokeWidth="1.6" />)
    out.push(<P key="blade" d="M75,60 L82,59 L83,67 L77,68Z" fill="#9aa0a8" />)
  }
  // skull
  const sk = big ? 1.15 : 1
  out.push(
    <g key="skull" transform={`translate(50 21) scale(${sk}) translate(-50 -21)`}>
      <ellipse cx="50" cy="20" rx="6.4" ry="6.6" fill="#ece5cb" {...LINE} />
      <path d="M45.5,24 h9 v4 q-4.5,2 -9,0z" fill="#ddd5b8" {...LINE} />
      <path d="M47.4,25 v2.4 M50,25 v2.6 M52.6,25 v2.4" stroke="#6b6450" strokeWidth=".5" />
      <ellipse cx="47.6" cy="20" rx="1.9" ry="2.2" fill="#1a1020" />
      <ellipse cx="52.4" cy="20" rx="1.9" ry="2.2" fill="#1a1020" />
      {eye(47.6, 20.2, 0.9, g, "e1")}
      {eye(52.4, 20.2, 0.9, g, "e2")}
      <path d="M50,22 l-.8,1.6 h1.6z" fill="#1a1020" />
    </g>
  )
  if (/lich|sovereign|emperor/i.test(n)) out.push(<path key="crown" d="M43,15 L44,8 L47,12 L50,6 L53,12 L56,8 L57,15Z" fill="#d8b23a" {...LINE} />)
  if (/horde/i.test(n)) {
    out.push(<ellipse key="h2" cx="24" cy="40" rx="4" ry="4.4" fill="#cfc8ad" opacity=".7" />)
    out.push(<ellipse key="h3" cx="78" cy="42" rx="4" ry="4.4" fill="#cfc8ad" opacity=".7" />)
  }
  return out
}

const insect = (g, r, c, col) => {
  const n = c.name
  const out = []
  const shell = `url(#${g.id}body)`
  const legs = (count, k) => {
    const res = []
    for (let i = 0; i < count; i++) {
      const x = 40 + (i % (count / 2)) * (20 / (count / 2 - 1 || 1))
      const side = i < count / 2 ? -1 : 1
      res.push(<path key={`${k}${i}`} d={`M${x},46 L${x + side * 4 - 6},${36 + (side < 0 ? 22 : -4)} L${x + side * 2 - 10},${side < 0 ? 64 : 30}`} stroke={col.body.line} strokeWidth="1.3" fill="none" strokeLinecap="round" />)
    }
    return res
  }
  if (/spider/i.test(n)) {
    for (let i = 0; i < 4; i++) {
      out.push(<path key={`ll${i}`} d={`M48,42 Q${34 - i * 3},${26 + i * 6} ${22 - i * 2},${40 + i * 7}`} stroke={col.body.line} strokeWidth="1.5" fill="none" />)
      out.push(<path key={`lr${i}`} d={`M52,42 Q${66 + i * 3},${26 + i * 6} ${78 + i * 2},${40 + i * 7}`} stroke={col.body.line} strokeWidth="1.5" fill="none" />)
    }
    out.push(<path key="web" d="M50,0 V30" stroke="#fff" strokeWidth=".4" opacity=".7" />)
    out.push(<ellipse key="abd" cx="50" cy="50" rx="11" ry="12" fill={shell} {...LINE} />)
    out.push(<path key="mark" d={star(50, 50, 4, 1.6, 4)} fill={col.accent.hi} />)
    out.push(<ellipse key="ceph" cx="50" cy="36" rx="7" ry="6" fill={col.body.base} {...LINE} />)
    for (let i = 0; i < 4; i++) out.push(<circle key={`ey${i}`} cx={46.5 + i * 2.3} cy={34.6 - (i === 1 || i === 2 ? 1 : 0)} r=".9" fill={g.eye} />)
    return out
  }
  if (/mantis/i.test(n)) {
    out.push(<path key="legs" d="M46,50 L36,64 M50,50 L48,65 M54,50 L64,64" stroke={col.body.line} strokeWidth="1.3" />)
    out.push(<P key="abd" d="M40,52 Q30,62 26,60 Q30,50 44,46Z" fill={shell} />)
    out.push(<P key="tho" d="M42,48 L58,26 L61,28 L47,50Z" fill={col.body.base} />)
    out.push(<P key="scythe1" d="M56,32 L68,40 L74,30 L70,30 L67,36 L58,30Z" fill={col.body.hi} />)
    out.push(<P key="scythe2" d="M54,36 L62,48 L70,42 L66,41 L62,45 L56,38Z" fill={col.body.base} />)
    out.push(<P key="head" d="M56,22 L68,20 L62,28Z" fill={col.body.base} />)
    out.push(eye(58.4, 22.6, 1, g, "e1"), eye(65, 21.6, 1, g, "e2"))
    out.push(<path key="ant" d="M60,21 Q58,12 52,8 M64,20 Q66,12 72,8" stroke={col.body.line} strokeWidth=".6" fill="none" />)
    out.push(<P key="wing" d="M40,48 Q24,40 22,52 Q32,54 42,50Z" fill={col.accent.hi} opacity=".45" />)
    return out
  }
  if (/larva/i.test(n)) {
    for (let i = 0; i < 6; i++) out.push(<ellipse key={`seg${i}`} cx={26 + i * 9} cy={56 - Math.sin(i / 1.6) * 10} rx="6" ry="5.4" fill={shell} {...LINE} />)
    out.push(eye(73, 46, 1.2, g, "e"))
    return out
  }
  if (/ant column/i.test(n)) {
    for (let k = 0; k < 3; k++) {
      const dx = k * 24 - 24
      const s = 0.7
      out.push(
        <g key={`ant${k}`} transform={`translate(${50 + dx} ${50 - k * 6}) scale(${s}) translate(-50 -46)`}>
          {legs(6, "l")}
          <ellipse cx="38" cy="46" rx="8" ry="6" fill={shell} {...LINE} />
          <ellipse cx="50" cy="46" rx="5" ry="4" fill={col.body.base} {...LINE} />
          <ellipse cx="60" cy="44" rx="5" ry="4.6" fill={col.body.base} {...LINE} />
          <path d="M62,40 Q66,32 70,30 M60,40 Q62,32 60,28" stroke={col.body.line} strokeWidth=".8" fill="none" />
          {eye(62, 43.6, 1, g, "e")}
        </g>
      )
    }
    return out
  }
  const winged = /moth|firefly|hornet|gnat|locust|queen|empress|leafcutter|cicada/i.test(n)
  if (winged) {
    const moth = /moth|empress/i.test(n)
    const wr = moth ? 1.5 : 1
    out.push(<ellipse key="w1" cx={40} cy={30} rx={14 * wr} ry={8 * wr} fill={moth ? `url(#${g.id}wing)` : "#e8f6ff"} opacity={moth ? 0.95 : 0.45} transform="rotate(-25 40 30)" {...LINE} />)
    out.push(<ellipse key="w2" cx={60} cy={30} rx={14 * wr} ry={8 * wr} fill={moth ? `url(#${g.id}wing)` : "#e8f6ff"} opacity={moth ? 0.95 : 0.45} transform="rotate(25 60 30)" {...LINE} />)
    if (moth) {
      out.push(<circle key="spot1" cx="34" cy="26" r="4" fill={col.accent.lo} />, <circle key="spot1b" cx="34" cy="26" r="2" fill={g.eye} />)
      out.push(<circle key="spot2" cx="66" cy="26" r="4" fill={col.accent.lo} />, <circle key="spot2b" cx="66" cy="26" r="2" fill={g.eye} />)
    } else out.push(<path key="veins" d="M40,30 L22,22 M40,30 L26,34 M60,30 L78,22 M60,30 L74,34" stroke="#fff" strokeWidth=".4" opacity=".7" />)
  }
  if (!winged) out.push(...legs(6, "lg"))
  // body: abdomen, thorax, head
  const striped = /hornet|bee|worker|wasp|gnat/i.test(n)
  out.push(<ellipse key="abd" cx="50" cy={winged ? 48 : 50} rx={winged ? 7 : 15} ry={winged ? 14 : 11} fill={shell} {...LINE} />)
  if (striped) for (let i = 0; i < 3; i++) out.push(<path key={`str${i}`} d={`M44,${44 + i * 5} q6,2 12,0`} stroke="#141414" strokeWidth="1.6" fill="none" />)
  if (!winged) out.push(<path key="split" d="M50,40 V61" stroke={col.body.line} strokeWidth=".7" />)
  if (!winged) out.push(<path key="sheen" d="M42,44 Q46,40 48,42" stroke="#fff" strokeWidth=".9" opacity=".6" fill="none" />)
  out.push(<ellipse key="tho" cx="50" cy={winged ? 32 : 38} rx={winged ? 6 : 8} ry={winged ? 5 : 4} fill={col.body.base} {...LINE} />)
  out.push(<ellipse key="head" cx="50" cy={winged ? 24 : 31} rx="5" ry="4.2" fill={col.body.base} {...LINE} />)
  out.push(eye(47.6, winged ? 23.4 : 30.4, 1.1, g, "e1"), eye(52.4, winged ? 23.4 : 30.4, 1.1, g, "e2"))
  out.push(<path key="ant" d={`M48,${winged ? 21 : 28} Q44,${winged ? 12 : 20} 38,${winged ? 10 : 18} M52,${winged ? 21 : 28} Q56,${winged ? 12 : 20} 62,${winged ? 10 : 18}`} stroke={col.body.line} strokeWidth=".7" fill="none" />)
  if (/beetle|ironback/i.test(n)) out.push(<P key="horn" d="M48,28 Q50,14 54,12 Q52,20 52,28Z" fill={col.body.hi} />)
  if (/firefly|lantern/i.test(n)) out.push(<circle key="lamp" cx="50" cy="58" r="10" fill={`url(#${g.id}glow)`} />, <circle key="lamp2" cx="50" cy="58" r="3" fill={g.eye} />)
  if (/queen|matriarch|empress/i.test(n)) out.push(<path key="crown" d="M45,20 L46,15 L48,18 L50,13 L52,18 L54,15 L55,20Z" fill="#ffd34d" {...LINE} />)
  if (winged) out.push(<path key="legs" d="M46,36 L38,46 M54,36 L62,46 M47,40 L42,52 M53,40 L58,52" stroke={col.body.line} strokeWidth=".8" />)
  return out
}

// beasts: a body plan from the name (canine, cat, bear, boar, horned grazer, hare, mole,
// bird), then horns, manes, tusks and tails
const beast = (g, r, c, col) => {
  const n = c.name
  const out = []
  const fur = `url(#${g.id}body)`
  if (/hawk|falcon/i.test(n)) {
    out.push(<P key="w1" d="M50,36 Q30,14 6,18 Q20,24 22,30 Q12,30 10,36 Q26,36 44,44Z" fill={fur} />)
    out.push(<P key="w2" d="M50,36 Q70,14 94,18 Q80,24 78,30 Q88,30 90,36 Q74,36 56,44Z" fill={fur} />)
    out.push(<path key="feath" d="M14,22 L30,30 M20,32 L36,38 M86,22 L70,30 M80,32 L64,38" stroke={col.body.line} strokeWidth=".6" />)
    out.push(<ellipse key="body" cx="50" cy="44" rx="7" ry="11" fill={col.body.base} {...LINE} />)
    out.push(<path key="chest" d="M46,42 Q50,52 54,42" fill={col.accent.hi} />)
    out.push(<P key="tail" d="M46,54 L50,64 L54,54Z" fill={col.body.lo} />)
    out.push(<ellipse key="head" cx="50" cy="30" rx="5.4" ry="5" fill={col.body.base} {...LINE} />)
    out.push(<P key="beak" d="M48.6,32 L50,38 L51.4,32Z" fill="#f2c230" />)
    out.push(eye(47.6, 29.4, 1, g, "e1"), eye(52.4, 29.4, 1, g, "e2"))
    out.push(<path key="talon" d="M47,55 l-1,4 M53,55 l1,4" stroke="#f2c230" strokeWidth="1.2" />)
    return out
  }
  if (/hare/i.test(n)) {
    out.push(<ellipse key="body" cx="46" cy="54" rx="13" ry="10" fill={fur} {...LINE} />)
    out.push(<ellipse key="leg" cx="40" cy="60" rx="8" ry="5" fill={col.body.lo} {...LINE} />)
    out.push(<circle key="puff" cx="33" cy="52" r="3.6" fill="#fff" {...LINE} />)
    out.push(<ellipse key="head" cx="58" cy="40" rx="8" ry="7" fill={fur} {...LINE} />)
    out.push(<P key="ear1" d="M53,35 Q46,14 52,10 Q57,18 57,34Z" fill={col.body.base} />)
    out.push(<P key="ear2" d="M58,34 Q60,12 66,11 Q66,22 61,35Z" fill={col.body.base} />)
    out.push(<path key="inner" d="M54,30 Q51,18 53,14 M60,30 Q62,18 64,15" stroke="#e8a0a8" strokeWidth="1.4" fill="none" />)
    out.push(eye(61, 39, 1.3, g, "e"))
    out.push(<path key="nose" d="M65.5,42 l1,1 l-1,1" stroke="#c46a78" strokeWidth="1" fill="none" />)
    out.push(<path key="paw" d="M54,62 h7" stroke={col.body.lo} strokeWidth="2.6" strokeLinecap="round" />)
    out.push(<path key="zoom" d="M14,46 h10 M10,52 h12 M16,58 h8" stroke="#fff" strokeOpacity=".6" strokeWidth="1" strokeLinecap="round" />)
    return out
  }
  if (/mole/i.test(n)) {
    out.push(<path key="dirt" d="M22,66 Q30,56 40,62 Q50,52 62,62 Q72,56 80,66Z" fill="#4a3018" />)
    out.push(<ellipse key="body" cx="50" cy="56" rx="17" ry="11" fill={fur} {...LINE} />)
    out.push(<ellipse key="snout" cx="67" cy="56" rx="6" ry="3.4" fill="#e8a0a8" {...LINE} />)
    out.push(<circle key="nose" cx="72.5" cy="55.5" r="1.4" fill="#7a2a3a" />)
    out.push(<path key="claws" d="M58,64 l2,3 M61,63 l2,3 M64,62 l2,3 M40,64 l-2,3 M43,65 l-2,3" stroke="#f4efe0" strokeWidth="1.2" strokeLinecap="round" />)
    out.push(<path key="eyes" d="M60,50 h2" stroke="#000" strokeWidth="1.2" strokeLinecap="round" />)
    for (let i = 0; i < 6; i++) out.push(<path key={`s${i}`} d={`M${38 + i * 4},${48 - (i % 2)} l1.4,-2`} stroke={col.body.line} strokeWidth=".6" />)
    return out
  }
  const kind = /wolf|fox|pack|alpha/i.test(n) ? "canine" : /lion|saber|prowler/i.test(n) ? "feline" : /mauler|bear/i.test(n) ? "bear" : /boar/i.test(n) ? "boar" : "grazer"
  const big = c.level >= 5 || kind === "bear" || kind === "grazer"
  const bx = 44
  const rx = big ? 19 : 15.5
  const ry = big ? 11.5 : 9
  const by = 64 - ry - (kind === "canine" || kind === "feline" ? 12 : 10)
  const legTop = by + ry * 0.4
  const leg = (x, k, shade) => <P key={k} d={`M${x},${legTop} L${x - 1.2},65 L${x + 4.4},65 L${x + 4.6},${legTop}Z`} fill={shade} />
  // tail
  if (kind === "canine") {
    out.push(<P key="tail" d={`M${bx - rx + 2},${by - 2} Q${bx - rx - 16},${by - 8} ${bx - rx - 10},${by - 22} Q${bx - rx - 4},${by - 10} ${bx - rx + 5},${by + 3}Z`} fill={/fox/i.test(n) ? col.accent.base : fur} />)
    if (/fox/i.test(n)) out.push(<path key="tip" d={`M${bx - rx - 10},${by - 22} q-2,4 1,7 q3,-2 -1,-7`} fill="#fff" />)
  } else if (kind === "feline") out.push(<path key="tail" d={`M${bx - rx + 2},${by} Q${bx - rx - 14},${by + 4} ${bx - rx - 10},${by - 14} q1,-4 4,-2`} stroke={col.body.lo} strokeWidth="2.4" fill="none" strokeLinecap="round" />)
  else if (kind !== "bear") out.push(<path key="tail" d={`M${bx - rx + 2},${by - 2} q-7,2 -8,10`} stroke={col.body.lo} strokeWidth="1.6" fill="none" strokeLinecap="round" />)
  out.push(leg(bx - rx * 0.62, "l1", col.body.lo), leg(bx + rx * 0.42, "l3", col.body.lo))
  // body
  if (/bison/i.test(n)) out.push(<P key="hump" d={`M${bx - 4},${by - ry + 2} Q${bx + 8},${by - ry - 12} ${bx + rx},${by - 4}Z`} fill={col.accent.lo} />)
  out.push(<ellipse key="body" cx={bx} cy={by} rx={rx} ry={ry} fill={fur} {...LINE} />)
  out.push(<path key="belly" d={`M${bx - rx * 0.6},${by + ry * 0.55} Q${bx},${by + ry * 1.05} ${bx + rx * 0.6},${by + ry * 0.55}`} stroke={col.body.hi} strokeWidth="1.4" fill="none" opacity=".7" />)
  for (let i = 0; i < 4; i++) out.push(<path key={`fur${i}`} d={`M${bx - rx * 0.5 + i * rx * 0.3},${by - ry * 0.4} l2,-2`} stroke={col.body.line} strokeWidth=".5" opacity=".7" />)
  if (kind === "boar") for (let i = 0; i < 7; i++) out.push(<path key={`th${i}`} d={`M${bx - rx * 0.6 + i * rx * 0.2},${by - ry + 1} l1.6,-6 l1.6,6`} fill={col.accent.base} stroke={col.body.line} strokeWidth=".4" />)
  if (/rhino/i.test(n)) out.push(<path key="plates" d={`M${bx - rx * 0.3},${by - ry} q2,${ry} 0,${ry * 2} M${bx + rx * 0.3},${by - ry + 1} q2,${ry} 0,${ry * 2}`} stroke={col.body.line} strokeWidth=".8" fill="none" />)
  out.push(leg(bx - rx * 0.4, "l2", col.body.base), leg(bx + rx * 0.66, "l4", col.body.base))
  // head
  const hx = bx + rx - 1
  const hy = kind === "grazer" ? by - 2 : kind === "boar" ? by : by - ry - 2
  const mane = /\blion\b|behemoth|chimera|alpha/i.test(n)
  if (mane) out.push(<path key="mane" d={star(hx + 4, hy, 12, 8, 12)} fill={col.accent.lo} {...LINE} />)
  if (kind !== "boar" && kind !== "grazer") out.push(<P key="neck" d={`M${bx + rx * 0.4},${by - ry * 0.6} L${hx},${hy - 3} L${hx + 4},${hy + 5} L${bx + rx * 0.7},${by + 2}Z`} fill={fur} line={false} />)
  if (kind === "canine") {
    out.push(<P key="ear1" d={`M${hx - 2},${hy - 4} L${hx - 1},${hy - 13} L${hx + 4},${hy - 5}Z`} fill={col.body.lo} />)
    out.push(<P key="head" d={`M${hx - 6},${hy - 3} Q${hx + 2},${hy - 8} ${hx + 8},${hy - 4} L${hx + 19},${hy + 1} Q${hx + 20},${hy + 4} ${hx + 16},${hy + 5} L${hx + 7},${hy + 6} Q${hx - 4},${hy + 8} ${hx - 7},${hy + 1}Z`} fill={fur} />)
    out.push(<P key="ear2" d={`M${hx + 2},${hy - 5} L${hx + 4},${hy - 14} L${hx + 8},${hy - 4}Z`} fill={col.body.base} />)
    out.push(<ellipse key="nose" cx={hx + 18.5} cy={hy + 1.6} rx="1.4" ry="1.1" fill="#140c08" />)
    out.push(<path key="mouth" d={`M${hx + 17},${hy + 4.6} Q${hx + 12},${hy + 6.5} ${hx + 7},${hy + 5}`} stroke={col.body.line} strokeWidth=".7" fill="none" />)
    if (/wolf|alpha/i.test(n)) out.push(<path key="fang" d={`M${hx + 13},${hy + 5.4} l.8,2.6 l.8,-2.4`} fill="#fff" stroke="#fff" strokeWidth=".3" />)
    out.push(eye(hx + 5, hy - 1.2, 1.1, g, "e"))
  } else if (kind === "feline") {
    out.push(<ellipse key="head" cx={hx + 5} cy={hy} rx="8" ry="7" fill={fur} {...LINE} />)
    out.push(<ellipse key="muzzle" cx={hx + 11} cy={hy + 2.5} rx="4.4" ry="3.2" fill={col.body.hi} {...LINE} />)
    out.push(<P key="ear1" d={`M${hx},${hy - 4} L${hx + 1},${hy - 10} L${hx + 5},${hy - 6}Z`} fill={col.body.lo} />)
    out.push(<P key="ear2" d={`M${hx + 6},${hy - 6} L${hx + 9},${hy - 11} L${hx + 11},${hy - 4}Z`} fill={col.body.lo} />)
    out.push(<path key="nose" d={`M${hx + 13.4},${hy + 1} l1.6,0 l-.8,1.2z`} fill="#3a1a14" />)
    if (/saber/i.test(n)) out.push(<P key="fangs" d={`M${hx + 10},${hy + 4.6} l.8,6 l1.2,-6 M${hx + 12.4},${hy + 4.6} l.6,5 l1,-5`} fill="#fff" />)
    out.push(eye(hx + 7.4, hy - 1.4, 1.1, g, "e"))
  } else if (kind === "bear") {
    out.push(<circle key="ear1" cx={hx + 1} cy={hy - 6} r="3" fill={col.body.lo} {...LINE} />)
    out.push(<circle key="ear2" cx={hx + 8} cy={hy - 7} r="3" fill={col.body.lo} {...LINE} />)
    out.push(<ellipse key="head" cx={hx + 5} cy={hy} rx="9" ry="8" fill={fur} {...LINE} />)
    out.push(<ellipse key="muzzle" cx={hx + 12} cy={hy + 2.6} rx="5" ry="3.6" fill={col.body.hi} {...LINE} />)
    out.push(<ellipse key="nose" cx={hx + 15.4} cy={hy + 1.6} rx="1.6" ry="1.2" fill="#140c08" />)
    out.push(<path key="scar" d={`M${hx + 1},${hy - 4} l5,5 M${hx + 3},${hy - 5} l5,5`} stroke="#d84a3a" strokeWidth=".7" />)
    out.push(eye(hx + 7.5, hy - 1.6, 1.1, g, "e"))
  } else if (kind === "boar") {
    out.push(<P key="head" d={`M${hx - 4},${hy - 7} Q${hx + 6},${hy - 9} ${hx + 12},${hy - 3} L${hx + 17},${hy - 1} L${hx + 17},${hy + 5} L${hx + 10},${hy + 7} Q${hx - 2},${hy + 8} ${hx - 5},${hy + 1}Z`} fill={fur} />)
    out.push(<ellipse key="snout" cx={hx + 17} cy={hy + 2} rx="1.8" ry="3.2" fill="#d8a0a0" {...LINE} />)
    out.push(<P key="ear" d={`M${hx},${hy - 6} L${hx - 2},${hy - 12} L${hx + 4},${hy - 7}Z`} fill={col.body.lo} />)
    out.push(<P key="tusk" d={`M${hx + 13},${hy + 5} Q${hx + 18},${hy + 3} ${hx + 18},${hy - 3} Q${hx + 15},${hy + 2} ${hx + 11},${hy + 4}Z`} fill="#f4efe0" />)
    out.push(eye(hx + 7, hy - 3, 1.1, g, "e"))
  } else {
    // a horned grazer, head low
    out.push(<P key="head" d={`M${hx - 4},${hy - 6} L${hx + 8},${hy - 6} L${hx + 17},${hy + 3} Q${hx + 18},${hy + 8} ${hx + 13},${hy + 9} L${hx + 4},${hy + 8} Q${hx - 4},${hy + 6} ${hx - 5},${hy}Z`} fill={fur} />)
    out.push(<ellipse key="nose" cx={hx + 15.6} cy={hy + 6} rx="1.6" ry="1.2" fill="#140c08" />)
    out.push(<P key="ear" d={`M${hx},${hy - 5} L${hx - 6},${hy - 8} L${hx - 1},${hy - 2}Z`} fill={col.body.lo} />)
    if (/rhino/i.test(n)) {
      out.push(<P key="horn" d={`M${hx + 12},${hy + 1} Q${hx + 16},${hy - 10} ${hx + 21},${hy - 13} Q${hx + 18},${hy - 4} ${hx + 17},${hy + 3}Z`} fill="#e9e1c8" />)
      out.push(<P key="horn2" d={`M${hx + 7},${hy - 4} L${hx + 9},${hy - 9} L${hx + 11},${hy - 3}Z`} fill="#e9e1c8" />)
    }
    if (/bison|behemoth|chimera/i.test(n)) {
      out.push(<P key="horn" d={`M${hx + 1},${hy - 6} Q${hx - 2},${hy - 16} ${hx + 8},${hy - 19} Q${hx + 3},${hy - 13} ${hx + 5},${hy - 6}Z`} fill="#e9e1c8" />)
      out.push(<P key="hornb" d={`M${hx + 6},${hy - 6} Q${hx + 6},${hy - 15} ${hx + 15},${hy - 16} Q${hx + 9},${hy - 11} ${hx + 9},${hy - 5}Z`} fill="#d9cfb2" />)
    }
    if (/stag/i.test(n))
      out.push(<path key="antler" d={`M${hx + 2},${hy - 6} L${hx - 3},${hy - 20} M${hx},${hy - 13} L${hx - 7},${hy - 16} M${hx - 1},${hy - 17} L${hx + 3},${hy - 25} M${hx + 5},${hy - 6} L${hx + 9},${hy - 19} M${hx + 8},${hy - 14} L${hx + 14},${hy - 17}`} stroke="#d9c79a" strokeWidth="1.4" strokeLinecap="round" fill="none" />)
    if (/chimera/i.test(n)) out.push(<path key="snake" d={`M${bx - rx + 2},${by - 2} q-10,-2 -12,-12 q4,-4 7,0`} stroke="#4b8a3a" strokeWidth="2.2" fill="none" strokeLinecap="round" />)
    out.push(eye(hx + 6, hy - 1.8, 1.1, g, "e"))
  }
  return out
}

const golem = (g, r, c, col) => {
  const out = []
  const rock = `url(#${g.id}body)`
  out.push(<P key="lg1" d="M38,52 L34,66 L46,66 L46,52Z" fill={col.body.lo} />)
  out.push(<P key="lg2" d="M54,52 L54,66 L66,66 L62,52Z" fill={col.body.lo} />)
  out.push(<P key="torso" d="M34,28 L44,22 L58,22 L68,30 L66,50 L52,56 L38,54Z" fill={rock} />)
  out.push(<P key="arm1" d="M34,30 L22,40 L24,54 L32,52 L32,42Z" fill={col.body.base} />)
  out.push(<P key="arm2" d="M68,30 L80,42 L78,54 L70,52 L70,40Z" fill={col.body.base} />)
  out.push(<P key="head" d="M44,22 L46,12 L56,12 L58,22Z" fill={col.body.base} />)
  out.push(<rect key="eyes" x="47" y="16" width="8" height="2" fill={g.eye} />)
  out.push(<path key="cracks" d="M42,30 L48,36 L46,42 M58,28 L54,34 L60,40" stroke={g.eye} strokeWidth=".8" fill="none" opacity=".85" />)
  if (/coral|reef/i.test(c.name)) for (let i = 0; i < 5; i++) out.push(<path key={`co${i}`} d={`M${36 + i * 7},24 q-2,-6 1,-10 m-1,5 q3,-2 4,-6`} stroke={pick(r, ["#ff7aa2", "#ffa36b", "#f75c8a"])} strokeWidth="1.6" fill="none" strokeLinecap="round" />)
  return out
}

const merfolk = (g, r, c, col) => {
  const out = []
  out.push(<P key="tail" d="M46,44 Q40,58 52,62 Q60,66 70,60 L76,52 L74,64 L84,62 Q74,70 58,68 Q36,66 40,46Z" fill={`url(#${g.id}body)`} />)
  for (let i = 0; i < 4; i++) out.push(<path key={`sc${i}`} d={`M${44 + i * 6},${56 + (i % 2)} q3,2 6,0`} stroke={col.body.hi} strokeWidth=".5" fill="none" />)
  out.push(<P key="torso" d="M44,30 Q50,27 56,30 L54,46 Q50,48 46,46Z" fill="#c9ecef" />)
  out.push(<ellipse key="hair" cx="50" cy="24" rx="7" ry="8" fill={col.accent.base} {...LINE} />)
  out.push(<P key="hairflow" d="M43,24 Q34,34 40,44 Q42,34 46,28Z" fill={col.accent.base} />)
  out.push(<ellipse key="face" cx="51" cy="23" rx="4.3" ry="5" fill="#d9f2f2" {...LINE} />)
  out.push(eye(52.6, 22.4, 0.8, g, "e"))
  out.push(<path key="arm" d="M56,32 Q64,26 66,16" stroke="#c9ecef" strokeWidth="1.8" fill="none" strokeLinecap="round" />)
  out.push(<circle key="pearl" cx="66.4" cy="14" r="6" fill={`url(#${g.id}glow)`} />, <circle key="pearl2" cx="66.4" cy="14" r="2" fill="#fff" />)
  return out
}

const token = (g, r, c, col) => (c.race === "Insect" ? insect(g, r, { ...c, name: "Larva" }, col) : machine(g, r, { ...c, name: "Drone" }, col))

const creatureFor = (c) => {
  const n = c.name
  if (c.token) return token
  switch (c.race) {
    case "Dragon":
      return dragon
    case "Machine":
      return machine
    case "Spellcaster":
      return /brine/i.test(n) ? caster : caster
    case "Fish":
      return fish
    case "Serpent":
      return serpent
    case "Aqua":
      if (/kraken|squid/i.test(n)) return tentacled
      if (/crab/i.test(n)) return crab
      if (/jelly/i.test(n)) return jelly
      if (/siren|diver/i.test(n)) return merfolk
      if (/sentinel|titan/i.test(n)) return golem
      return fish
    case "Rock":
      return golem
    case "Insect":
      return insect
    case "Warrior":
      return knight
    case "Zombie":
    case "Plant":
      return skeleton
    default:
      return beast
  }
}

// the body tones for a creature: its attribute's hue, nudged by the card
const toneFor = (c, r) => {
  const a = ATTR[c.attr] || ATTR.EARTH
  const h = a.hue + between(r, -14, 14)
  let body = tone(h, a.sat + between(r, -10, 10), between(r, 38, 50))
  let accent = tone(h + between(r, 25, 60), a.sat + 10, between(r, 45, 58))
  if (c.race === "Machine") body = tone(h, 12, between(r, 46, 58))
  if (c.race === "Warrior") {
    body = tone(220, 10, between(r, 58, 70))
    accent = tone(a.hue, a.sat + 10, 46)
  }
  if (c.race === "Zombie") body = tone(a.hue + 10, 20, 26)
  if (c.race === "Spellcaster") body = tone(h, a.sat + 10, 34)
  if (c.race === "Beast" && c.attr === "EARTH") body = tone(between(r, 22, 34), 40, between(r, 34, 46))
  return { body, accent }
}

// ---------- spell and trap emblems ----------

const flame = (x, y, s, g, k) => (
  <g key={k} transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M0,-18 Q10,-6 8,4 Q7,12 0,14 Q-7,12 -8,4 Q-9,-4 -3,-8 Q-3,-2 0,0 Q2,-8 0,-18Z" fill={`url(#${g.id}fire)`} stroke="rgba(80,10,0,.5)" strokeWidth=".6" />
    <path d="M0,-4 Q4,2 3,7 Q2,11 0,11 Q-3,10 -3,6 Q-3,2 0,-4Z" fill="#fff4b0" />
  </g>
)
const swirl = (x, y, s, color, k, w = 1.4) => (
  <path key={k} d={`M${x},${y} m${-8 * s},0 a${8 * s},${8 * s} 0 1,1 ${8 * s},${8 * s} a${5 * s},${5 * s} 0 1,1 ${-5 * s},${-5 * s} a${2.5 * s},${2.5 * s} 0 1,1 ${2.5 * s},${2.5 * s}`} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" />
)
const sword = (x, y, s, rot, g, k) => (
  <g key={k} transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
    <path d="M-1.6,-26 L0,-30 L1.6,-26 L1.6,4 L-1.6,4Z" fill={`url(#${g.id}steel)`} stroke="rgba(0,0,0,.5)" strokeWidth=".5" />
    <path d="M0,-28 V3" stroke="#fff" strokeWidth=".4" opacity=".7" />
    <path d="M-7,4 H7 V6.4 H-7Z" fill="#d8b23a" stroke="rgba(0,0,0,.5)" strokeWidth=".5" />
    <path d="M-1.2,6.4 H1.2 V14 H-1.2Z" fill="#5a3a1f" />
    <circle cx="0" cy="15.4" r="1.8" fill="#d8b23a" />
  </g>
)
const shield = (x, y, s, fill, emblem, k) => (
  <g key={k} transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M-12,-14 L12,-14 L12,0 Q12,12 0,18 Q-12,12 -12,0Z" fill={fill} stroke="rgba(0,0,0,.6)" strokeWidth=".8" />
    <path d="M-9,-11 L9,-11 L9,0 Q9,9 0,14 Q-9,9 -9,0Z" fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth=".7" />
    {emblem}
  </g>
)
const chain = (x1, y1, x2, y2, k) => {
  const links = []
  const n = 7
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const x = x1 + (x2 - x1) * t
    const y = y1 + (y2 - y1) * t
    const a = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI
    links.push(<ellipse key={i} cx={x} cy={y} rx="3.4" ry="1.8" fill="none" stroke="#c7cbd3" strokeWidth="1.2" transform={`rotate(${a + (i % 2 ? 90 : 0)} ${x} ${y})`} />)
  }
  return <g key={k}>{links}</g>
}
const bolt = (x, y, s, k) => <path key={k} d={`M${x},${y} l${-6 * s},${14 * s} l${5 * s},0 l${-4 * s},${12 * s} l${11 * s},${-17 * s} l${-5 * s},0 l${4 * s},${-9 * s}Z`} fill="#fff27a" stroke="#c48a00" strokeWidth=".6" />
const eyeEmblem = (x, y, s, g, k) => (
  <g key={k} transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M-18,0 Q0,-14 18,0 Q0,14 -18,0Z" fill="#f5f0ff" stroke="rgba(0,0,0,.5)" strokeWidth=".7" />
    <circle r="7" fill={`url(#${g.id}iris)`} />
    <circle r="3" fill="#120818" />
    <circle cx="2" cy="-2" r="1.3" fill="#fff" />
  </g>
)
const coins = (r, k) => {
  const out = []
  for (let i = 0; i < 9; i++) {
    const x = between(r, 30, 70)
    const y = between(r, 48, 62)
    out.push(<ellipse key={`${k}${i}`} cx={x} cy={y} rx="4" ry="2" fill="#f2c230" stroke="#9a6d00" strokeWidth=".5" />)
  }
  return out
}
const tree = (x, y, s, k) => (
  <g key={k} transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M-1.6,0 L-1,-12 L1,-12 L1.6,0Z" fill="#5a3a1f" />
    <circle cx="0" cy="-17" r="8" fill="#2f7a3a" stroke="rgba(0,0,0,.4)" strokeWidth=".6" />
    <circle cx="-4" cy="-13" r="5" fill="#3d9447" />
    <circle cx="4" cy="-13" r="5" fill="#2a6b33" />
  </g>
)
const portal = (x, y, rx, ry, g, k) => (
  <g key={k}>
    <ellipse cx={x} cy={y} rx={rx + 4} ry={ry + 4} fill={`url(#${g.id}glow)`} />
    <ellipse cx={x} cy={y} rx={rx} ry={ry} fill="#120a2a" stroke={g.eye} strokeWidth="1.6" />
    {swirl(x, y - 2, ry / 12, g.eye, "sw", 0.9)}
  </g>
)

const EMBLEMS = {
  hoard: (g, r) => [<path key="chest" d="M30,44 L70,44 L70,64 L30,64Z" fill="#7a4a1f" stroke="#2a1608" strokeWidth=".8" />, <path key="lid" d="M30,44 Q50,30 70,44Z" fill="#8f5a26" stroke="#2a1608" strokeWidth=".8" />, <path key="band" d="M30,50 H70 M50,44 V64" stroke="#d8b23a" strokeWidth="1.6" />, ...coins(r, "c"), hoardHead(50, 26, 0.6, "dh")],
  flame: (g) => [flame(50, 44, 1.6, g, "f1"), flame(34, 52, 0.9, g, "f2"), flame(66, 52, 0.9, g, "f3")],
  volcano: (g) => [<path key="v" d="M14,66 L40,26 L60,26 L86,66Z" fill="#3a2214" stroke="#160a04" strokeWidth=".8" />, <path key="lava" d="M40,26 Q46,40 42,52 Q50,44 52,60 Q56,40 60,26Z" fill="#ff7a1a" />, flame(50, 18, 1.1, g, "f")],
  gear: (g) => [<path key="g1" d={gearPath(42, 38, 15, 10)} fill="#8a96a3" stroke="#222" strokeWidth=".7" />, <circle key="h1" cx="42" cy="38" r="5" fill="#1d2a36" />, <path key="g2" d={gearPath(64, 54, 10, 8)} fill="#b2bcc6" stroke="#222" strokeWidth=".7" />, <circle key="h2" cx="64" cy="54" r="3.2" fill="#1d2a36" />, <circle key="spark" cx="42" cy="38" r="2" fill={g.eye} />],
  coil: (g) => [<path key="c" d="M30,20 Q50,14 70,20 Q50,26 30,20 M30,32 Q50,26 70,32 Q50,38 30,32 M30,44 Q50,38 70,44 Q50,50 30,44 M30,56 Q50,50 70,56" fill="none" stroke="#d98a2b" strokeWidth="2.2" />, <rect key="core" x="47" y="14" width="6" height="48" fill="#4a5560" />, bolt(76, 16, 0.8, "b1"), bolt(24, 30, 0.6, "b2")],
  factory: () => [<path key="f" d="M14,66 V40 L28,32 V40 L42,32 V40 L56,32 V22 H66 V40 H86 V66Z" fill="#4a4f57" stroke="#1a1d22" strokeWidth=".8" />, <path key="sm" d="M61,20 Q56,12 62,8 Q68,4 64,0" stroke="#d6d6d6" strokeWidth="3" fill="none" opacity=".6" />, ...[20, 34, 48, 70].map((x) => <rect key={x} x={x} y="48" width="6" height="6" fill="#ffd27a" />)],
  surge: (g) => [<circle key="o" cx="50" cy="38" r="20" fill={`url(#${g.id}glow)`} />, <path key="s" d={star(50, 38, 18, 5, 8)} fill="#e7d4ff" opacity=".9" />, <circle key="c" cx="50" cy="38" r="5" fill="#fff" />],
  fountain: (g) => [<path key="b" d="M28,58 H72 L66,66 H34Z" fill="#9aa3ad" stroke="#333" strokeWidth=".6" />, <path key="w" d="M50,58 V30 M50,30 Q36,30 34,46 M50,30 Q64,30 66,46" stroke="#a8e6ff" strokeWidth="2" fill="none" />, <circle key="gl" cx="50" cy="28" r="10" fill={`url(#${g.id}glow)`} />],
  atoll: () => [<ellipse key="sea" cx="50" cy="56" rx="44" ry="12" fill="#1d6fa8" />, <ellipse key="isl" cx="50" cy="54" rx="22" ry="6" fill="#e8d39a" />, tree(44, 52, 0.8, "t1"), tree(56, 52, 0.6, "t2"), <path key="wave" d="M10,62 q6,-3 12,0 t12,0 M66,64 q6,-3 12,0 t12,0" stroke="#fff" strokeWidth=".8" fill="none" opacity=".7" />],
  wave: () => [<path key="w" d="M6,60 Q20,20 50,28 Q70,32 66,46 Q60,40 52,44 Q62,50 76,46 Q90,40 94,60Z" fill="#2a8ad8" stroke="#0c3a66" strokeWidth=".8" />, <path key="foam" d="M50,28 Q70,32 66,46 Q60,40 52,44" fill="#e6f8ff" />],
  trail: (g, r) => [...Array.from({ length: 8 }, (_, i) => <ellipse key={i} cx={18 + i * 9} cy={60 - Math.sin(i / 1.4) * 16} rx="2.4" ry="1.4" fill="#ffd27a" opacity={0.4 + i * 0.07} />), sparkle(82, 30, 4, "#fff6c2", "s")],
  nest: () => [<ellipse key="n" cx="50" cy="56" rx="26" ry="9" fill="#7a5a2b" stroke="#2a1a08" strokeWidth=".8" />, <path key="tw" d="M26,54 Q50,62 74,54 M28,58 Q50,50 72,58" stroke="#a37a3c" strokeWidth=".9" fill="none" />, ...[40, 50, 60].map((x) => <ellipse key={x} cx={x} cy="50" rx="5" ry="6.4" fill="#f2ead2" stroke="#7a6a4a" strokeWidth=".5" />)],
  sword: (g) => [<circle key="gl" cx="50" cy="34" r="22" fill={`url(#${g.id}glow)`} />, sword(50, 40, 1.1, 0, g, "s")],
  banner: (g) => [<path key="pole" d="M34,66 V8" stroke="#6b4423" strokeWidth="1.8" />, <path key="flag" d="M35,10 L74,14 L64,24 L74,34 L35,30Z" fill="#c43a2b" stroke="#3a0e08" strokeWidth=".7" />, <path key="e" d={star(52, 21, 5, 2, 5)} fill="#ffd34d" />, sword(68, 54, 0.55, 35, g, "s1"), sword(78, 54, 0.55, -35, g, "s2")],
  banner2: (g) => [<path key="pole" d="M30,66 V8" stroke="#6b4423" strokeWidth="1.8" />, <path key="flag" d="M31,10 L72,12 Q66,22 72,32 L31,30Z" fill="#2b6ec4" stroke="#0a2246" strokeWidth=".7" />, <path key="hand" d="M60,46 Q70,40 78,48 L76,58 Q66,62 58,56Z" fill="#e9c8a8" stroke="#6b4a32" strokeWidth=".6" />, swirl(50, 20, 0.5, "#fff", "sw", 1)],
  crypt: (g) => [<path key="ts" d="M34,66 V30 Q50,16 66,30 V66Z" fill="#7d7a86" stroke="#24222a" strokeWidth=".8" />, <path key="cross" d="M50,30 V52 M43,38 H57" stroke="#4a4752" strokeWidth="2" />, <path key="hand" d="M24,66 Q22,54 26,50 L28,56 L29,48 L31,56 L33,50 L33,60 Q32,66 30,66Z" fill="#c9e3b8" stroke="#2a3a22" strokeWidth=".5" />, <ellipse key="fog" cx="50" cy="66" rx="40" ry="5" fill={`url(#${g.id}glow)`} />],
  harvest: () => [<circle key="moon" cx="64" cy="22" r="11" fill="#f2e6b0" />, <path key="sc" d="M30,64 L56,22" stroke="#6b4423" strokeWidth="1.8" />, <path key="bl" d="M56,22 Q36,8 22,22 Q38,16 52,28Z" fill="#c7cbd3" stroke="#333" strokeWidth=".6" />, <path key="sk" d="M66,56 m-6,0 a6,6 0 1,1 12,0 v4 h-12z" fill="#e6dfc6" stroke="#333" strokeWidth=".5" />],
  roar: () => [<path key="m" d="M24,30 Q40,16 54,30 L50,40 Q40,48 26,42Z" fill="#8a5a2b" stroke="#2a1608" strokeWidth=".7" />, <path key="j" d="M30,38 L48,36 L44,44Z" fill="#5a1a10" />, ...[0, 1, 2].map((i) => <path key={i} d={`M${58 + i * 8},${22 - i * 3} Q${66 + i * 8},36 ${58 + i * 8},${50 + i * 3}`} stroke="#ffe08a" strokeWidth="1.6" fill="none" opacity={1 - i * 0.25} />)],
  forest: () => [tree(26, 64, 1.2, "t1"), tree(50, 60, 1.6, "t2"), tree(74, 64, 1.2, "t3"), <ellipse key="ground" cx="50" cy="66" rx="48" ry="4" fill="#1d3a16" />],
  insight: (g) => [<circle key="gl" cx="50" cy="38" r="24" fill={`url(#${g.id}glow)`} />, eyeEmblem(50, 38, 1.2, g, "e"), sparkle(24, 18, 3, "#fff", "s1"), sparkle(78, 56, 3, "#fff", "s2")],
  cataclysm: (g) => [<circle key="m" cx="68" cy="20" r="9" fill="#5a3a2a" stroke="#1a0a04" strokeWidth=".7" />, <path key="tr" d="M64,26 L30,60 L40,62 L72,28Z" fill={`url(#${g.id}fire)`} opacity=".85" />, <path key="boom" d={star(30, 60, 16, 7, 10)} fill="#ffb03a" />, <path key="boom2" d={star(30, 60, 8, 4, 8)} fill="#fff4b0" />],
  gale: () => [swirl(36, 34, 1.6, "#e8fff3", "s1", 1.6), swirl(64, 46, 1.2, "#bfeedd", "s2", 1.4), ...[0, 1, 2].map((i) => <path key={i} d={`M${10},${20 + i * 18} q20,-6 40,0 t40,0`} stroke="#fff" strokeWidth=".8" fill="none" opacity=".5" />)],
  smite: () => [bolt(52, 6, 1.6, "b"), <path key="hit" d={star(46, 62, 14, 5, 9)} fill="#fff27a" opacity=".8" />],
  whirl: (g) => [swirl(50, 36, 2.2, "#bff8e8", "s1", 2), swirl(50, 36, 1.2, "#ffffff", "s2", 1), <circle key="gl" cx="50" cy="38" r="20" fill={`url(#${g.id}glow)`} opacity=".6" />],
  phoenix: (g) => [<path key="w1" d="M50,40 Q30,20 12,22 Q26,30 24,38 Q36,36 46,46Z" fill={`url(#${g.id}fire)`} />, <path key="w2" d="M50,40 Q70,20 88,22 Q74,30 76,38 Q64,36 54,46Z" fill={`url(#${g.id}fire)`} />, <ellipse key="b" cx="50" cy="44" rx="5" ry="10" fill="#ff8a2a" stroke="#6a1a00" strokeWidth=".5" />, <path key="tail" d="M46,52 Q50,70 54,52" fill="#ffcf6a" />, <circle key="h" cx="50" cy="32" r="4" fill="#ff8a2a" />],
  spring: (g) => [<path key="d" d="M50,12 Q66,36 62,48 Q58,60 50,60 Q42,60 38,48 Q34,36 50,12Z" fill="#7fd8ff" stroke="#0b4f86" strokeWidth=".8" />, <path key="hl" d="M44,40 Q44,30 50,22" stroke="#fff" strokeWidth="1.4" fill="none" />, <path key="plus" d="M50,40 V54 M43,47 H57" stroke="#fff" strokeWidth="2.4" />],
  bolt: (g) => [<circle key="ball" cx="56" cy="34" r="12" fill={`url(#${g.id}fire)`} />, <path key="tail" d="M46,42 Q30,54 14,58 Q30,48 40,36Z" fill="#ff8a2a" opacity=".8" />, <circle key="core" cx="56" cy="34" r="5" fill="#fff4b0" />],
  mail: () => [<path key="m" d="M32,20 L44,16 Q50,22 56,16 L68,20 L72,40 L64,42 L64,62 L36,62 L36,42 L28,40Z" fill="#9aa3ad" stroke="#222" strokeWidth=".8" />, <path key="r" d="M40,30 H60 M38,38 H62 M38,46 H62 M38,54 H62" stroke="#5a636d" strokeWidth=".7" strokeDasharray="1.2 1" />],
  shackles: () => [<circle key="c1" cx="32" cy="42" r="9" fill="none" stroke="#8d93a0" strokeWidth="3" />, <circle key="c2" cx="68" cy="42" r="9" fill="none" stroke="#8d93a0" strokeWidth="3" />, chain(40, 42, 60, 42, "ch"), <path key="glow" d="M32,52 Q50,66 68,52" stroke="#b03a8a" strokeWidth="1" fill="none" opacity=".8" />],
  valor: (g) => [<path key="s" d={star(50, 38, 22, 9, 8)} fill="#ffd34d" stroke="#8a5a00" strokeWidth=".7" />, <path key="s2" d={star(50, 38, 11, 5, 8)} fill="#fff6c2" />, sword(50, 46, 0.7, 0, g, "sw")],
  winds: () => [...[0, 1, 2, 3].map((i) => <path key={i} d={`M${8 + i * 4},${18 + i * 12} q22,-8 44,0 t40,-4`} stroke="#e8fff3" strokeWidth="1.4" fill="none" opacity={0.9 - i * 0.15} />), <path key="leaf" d="M70,54 Q78,46 84,52 Q78,58 70,54Z" fill="#6bbf59" />],
  fusion: (g) => [swirl(38, 38, 1.4, "#ff9ad5", "a", 1.6), swirl(62, 38, 1.4, "#9ad5ff", "b", 1.6), <circle key="c" cx="50" cy="38" r="14" fill={`url(#${g.id}glow)`} />, <path key="s" d={star(50, 38, 8, 3, 4)} fill="#fff" />],
  memory: (g) => [<path key="h" d="M38,14 H62 L52,38 L62,62 H38 L48,38Z" fill="#e8dcc0" stroke="#5a4a2a" strokeWidth=".8" />, <path key="sand" d="M42,58 H58 L50,48Z M46,20 H54 L50,28Z" fill="#d9a441" />, <circle key="gl" cx="50" cy="38" r="20" fill={`url(#${g.id}glow)`} opacity=".5" />],
  weight: () => [<path key="w" d="M30,62 L36,30 H64 L70,62Z" fill="#4a4f57" stroke="#14161a" strokeWidth=".8" />, <path key="hd" d="M42,30 Q50,16 58,30" stroke="#4a4f57" strokeWidth="3" fill="none" />, <text key="t" x="50" y="52" textAnchor="middle" fontSize="10" fontWeight="bold" fill="#c7cbd3" fontFamily="Georgia, serif">∞</text>],
  coin: () => [<ellipse key="c" cx="50" cy="38" rx="18" ry="18" fill="#f2c230" stroke="#9a6d00" strokeWidth="1" />, <ellipse key="c2" cx="50" cy="38" rx="13" ry="13" fill="none" stroke="#9a6d00" strokeWidth=".7" />, <path key="s" d={star(50, 38, 8, 3.2, 5)} fill="#fff1a8" />, <ellipse key="c3" cx="74" cy="56" rx="10" ry="3" fill="#d9a41f" stroke="#9a6d00" strokeWidth=".6" />],
  gate: (g) => [<path key="arch" d="M30,66 V28 Q50,6 70,28 V66" fill="none" stroke="#8a7d6a" strokeWidth="4" />, portal(50, 44, 13, 18, g, "p")],
  // traps
  prism: (g) => [<path key="p" d="M50,8 L74,28 L66,62 L34,62 L26,28Z" fill="#c8f0ff" opacity=".55" stroke="#fff" strokeWidth="1" />, <path key="f" d="M50,8 L50,62 M26,28 L66,62 M74,28 L34,62" stroke="#fff" strokeWidth=".6" opacity=".8" />, ...["#ff6b6b", "#ffd34d", "#6bff95", "#6bc5ff"].map((c, i) => <path key={c} d={`M50,36 L${90},${20 + i * 10}`} stroke={c} strokeWidth="1.4" opacity=".85" />)],
  pit: () => [<ellipse key="h" cx="50" cy="50" rx="34" ry="12" fill="#0a0604" stroke="#3a2a16" strokeWidth="2" />, ...[28, 38, 48, 58, 68].map((x) => <path key={x} d={`M${x},56 L${x + 3},42 L${x + 6},56Z`} fill="#b9bec7" stroke="#333" strokeWidth=".4" />), <path key="ground" d="M0,40 Q20,34 40,38 T100,36" stroke="#5a4022" strokeWidth="2" fill="none" />],
  edict: (g) => [<path key="s" d="M26,16 H70 Q76,16 76,22 V60 Q76,66 70,66 H30 Q24,66 24,60 V22" fill="#efe2bd" stroke="#5a4a2a" strokeWidth=".8" />, ...[26, 32, 38, 44].map((y) => <path key={y} d={`M32,${y} H66`} stroke="#8a7a5a" strokeWidth=".7" />), <circle key="seal" cx="62" cy="56" r="8" fill="#b02a2a" stroke="#5a0a0a" strokeWidth=".7" />, <path key="x" d="M58,52 L66,60 M66,52 L58,60" stroke="#ffd0d0" strokeWidth="1.3" />],
  halt: () => [shield(50, 38, 1.6, "#3a6ab0", <path d="M-6,-6 V6 M-2,-8 V6 M2,-8 V6 M6,-6 V6 M-8,4 Q0,12 8,4" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />, "sh")],
  spikes: () => [...[16, 30, 44, 58, 72].map((x, i) => <path key={x} d={`M${x},66 L${x + 6},${18 + (i % 2) * 10} L${x + 12},66Z`} fill="#9aa3ad" stroke="#222" strokeWidth=".6" />), <path key="blood" d="M28,30 l1,4 M60,26 l1,4" stroke="#b02a2a" strokeWidth="1.4" />],
  reflect: (g) => [<ellipse key="m" cx="50" cy="38" rx="18" ry="24" fill="#d8f2ff" stroke="#8a7d6a" strokeWidth="3" />, <path key="sh" d="M40,26 L50,20 M42,36 L56,26" stroke="#fff" strokeWidth="1.4" />, bolt(76, 12, 0.7, "b"), <path key="arrow" d="M70,30 L84,20" stroke="#ff6b6b" strokeWidth="1.6" />],
  revival: (g) => [<circle key="gl" cx="50" cy="34" r="26" fill={`url(#${g.id}glow)`} />, <path key="beam" d="M40,66 L44,10 H56 L60,66Z" fill="#fff8d0" opacity=".45" />, sparkle(50, 28, 8, "#fff", "s"), sparkle(36, 44, 3, "#fff", "s2"), sparkle(64, 50, 3, "#fff", "s3")],
  dust: () => [<path key="t" d="M40,66 Q30,50 38,40 Q26,30 34,18 Q46,10 66,14 Q58,22 64,30 Q52,36 60,46 Q50,52 54,66Z" fill="#c9b58a" opacity=".75" />, ...[0, 1, 2].map((i) => <path key={i} d={`M${36 + i * 4},${24 + i * 14} q12,-4 24,0`} stroke="#fff6dc" strokeWidth="1" fill="none" />)],
  surge2: (g) => [<path key="a" d="M50,10 L66,34 H56 V64 H44 V34 H34Z" fill="#ffd34d" stroke="#8a5a00" strokeWidth=".8" />, <circle key="gl" cx="50" cy="30" r="18" fill={`url(#${g.id}glow)`} opacity=".6" />],
  smoke: () => [...[[34, 46, 14], [56, 40, 16], [46, 28, 12], [66, 56, 12], [30, 60, 10]].map(([x, y, s], i) => <circle key={i} cx={x} cy={y} r={s} fill="#9aa0aa" opacity=".55" />)],
  rocks: () => [...[[30, 30, 9], [56, 18, 7], [68, 40, 10], [44, 50, 8]].map(([x, y, s], i) => <path key={i} d={`M${x - s},${y} L${x - s / 2},${y - s} L${x + s / 2},${y - s} L${x + s},${y} L${x + s / 2},${y + s * 0.8} L${x - s / 2},${y + s * 0.8}Z`} fill="#7a6a58" stroke="#2a2016" strokeWidth=".7" />), <path key="ground" d="M0,66 L100,66" stroke="#3a2a16" strokeWidth="3" />],
  embers: (g, r) => [flame(50, 56, 1, g, "f"), ...Array.from({ length: 14 }, (_, i) => <circle key={i} cx={between(r, 10, 90)} cy={between(r, 6, 56)} r={between(r, 0.6, 1.8)} fill="#ffb03a" />)],
  roots: () => [...[0, 1, 2, 3, 4].map((i) => <path key={i} d={`M${20 + i * 15},76 Q${14 + i * 15},50 ${30 + i * 10},${30 + (i % 2) * 8} Q${36 + i * 8},${20} ${44 + i * 3},${14}`} stroke="#6b4a2b" strokeWidth="2.6" fill="none" strokeLinecap="round" />), <path key="leaf" d="M58,14 Q66,8 70,14 Q64,18 58,14Z" fill="#6bbf59" />],
  break: (g) => [<path key="b1" d="M28,22 L48,26 L44,64 L24,60Z" fill="#6a3a8a" stroke="#22102e" strokeWidth=".7" />, <path key="b2" d="M52,26 L72,22 L76,60 L56,64Z" fill="#6a3a8a" stroke="#22102e" strokeWidth=".7" transform="rotate(8 64 42)" />, bolt(50, 10, 0.9, "b")],
  cache: (g, r) => [<path key="chest" d="M28,40 H72 V64 H28Z" fill="#5a3a1f" stroke="#1a0a04" strokeWidth=".8" />, <path key="lid" d="M28,40 L30,28 H70 L72,40Z" fill="#7a4a1f" stroke="#1a0a04" strokeWidth=".8" />, <rect key="lock" x="47" y="40" width="6" height="7" fill="#d8b23a" />, <circle key="gl" cx="50" cy="34" r="16" fill={`url(#${g.id}glow)`} opacity=".7" />],
  turn: () => [<path key="a1" d="M28,30 A24,24 0 0,1 72,30" stroke="#ffd34d" strokeWidth="3" fill="none" />, <path key="h1" d="M72,30 l-8,-2 l6,-6Z" fill="#ffd34d" />, <path key="a2" d="M72,48 A24,24 0 0,1 28,48" stroke="#6bc5ff" strokeWidth="3" fill="none" />, <path key="h2" d="M28,48 l8,2 l-6,6Z" fill="#6bc5ff" />],
  silence: (g) => [eyeEmblem(50, 38, 1.1, g, "e"), <path key="x" d="M26,16 L74,60" stroke="#c43a2b" strokeWidth="4" strokeLinecap="round" />, <circle key="ring" cx="50" cy="38" r="26" fill="none" stroke="#c43a2b" strokeWidth="3" />],
}
// a small dragon head for Dragon's Hoard
function hoardHead(x, y, s, k) {
  return (
    <g key={k} transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-14,-4 L10,-8 Q22,-4 20,4 L8,8 L-8,10 Q-16,6 -14,-4Z" fill="#b8321a" stroke="rgba(0,0,0,.5)" strokeWidth=".8" />
      <path d="M-10,-4 Q-16,-18 -22,-22 Q-14,-12 -12,-2Z" fill="#f2d48a" />
      <circle cx="2" cy="-3" r="1.8" fill="#ffd34d" />
    </g>
  )
}

// ---------- the component ----------

const ArtSvg = ({ card, className }) => {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "")
  const id = `md${uid}`
  const r = rngFor(card.id)
  const st = card.kind !== "monster"
  const attr = st ? (card.kind === "spell" ? "WIND" : "DARK") : card.attr
  const a = ATTR[attr] || ATTR.EARTH
  const col = st ? { body: tone(160, 40, 40), accent: tone(40, 60, 55) } : toneFor(card, r)
  const g = { id, eye: st ? (card.kind === "spell" ? "#c9fff0" : "#ffc2ef") : a.glow }
  const sky = st ? (card.kind === "spell" ? ["#04201c", "#0f6b5c", "#6fe0c4"] : ["#1a0414", "#6b1446", "#e05aa8"]) : a.sky
  let body
  if (st) {
    const draw = EMBLEMS[card.art] || EMBLEMS.surge
    body = (
      <>
        {card.kind === "spell" ? (
          <g opacity=".35">
            <circle cx="50" cy="38" r="32" fill="none" stroke="#bff8e8" strokeWidth=".6" />
            <circle cx="50" cy="38" r="27" fill="none" stroke="#bff8e8" strokeWidth=".4" strokeDasharray="2 2" />
            <path d={star(50, 38, 32, 12, 6)} fill="none" stroke="#bff8e8" strokeWidth=".4" />
          </g>
        ) : (
          <g opacity=".4">
            <path d="M4,4 L20,4 L4,20Z M96,4 L80,4 L96,20Z M4,72 L20,72 L4,56Z M96,72 L80,72 L96,56Z" fill="#ff9ad5" />
            <path d="M0,10 L10,0 M90,0 L100,10 M0,66 L10,76 M90,76 L100,66" stroke="#ffd3ec" strokeWidth=".6" />
          </g>
        )}
        {draw(g, r)}
      </>
    )
  } else {
    const make = creatureFor(card)
    const flip = r() < 0.25 && card.race !== "Spellcaster" && card.race !== "Warrior" && card.race !== "Zombie"
    const grow = 0.86 + Math.min(8, card.level || 1) * 0.02
    body = (
      <>
        {scene(g, attr, r)}
        <ellipse cx="50" cy="66" rx="30" ry="3.6" fill="#000" opacity=".35" />
        <g transform={`translate(50 66) scale(${flip ? -grow : grow} ${grow}) translate(-50 -66)`}>{make(g, r, card, col)}</g>
      </>
    )
  }
  return (
    <svg className={className} viewBox="0 0 100 76" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}sky`} cx="50%" cy="45%" r="75%">
          <stop offset="0" stopColor={sky[2]} />
          <stop offset=".45" stopColor={sky[1]} />
          <stop offset="1" stopColor={sky[0]} />
        </radialGradient>
        <linearGradient id={`${id}body`} x1="0" y1="0" x2=".7" y2="1">
          <stop offset="0" stopColor={col.body.hi} />
          <stop offset=".5" stopColor={col.body.base} />
          <stop offset="1" stopColor={col.body.lo} />
        </linearGradient>
        <linearGradient id={`${id}bodyH`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={col.body.lo} />
          <stop offset=".5" stopColor={col.body.hi} />
          <stop offset="1" stopColor={col.body.base} />
        </linearGradient>
        <linearGradient id={`${id}wing`} x1="1" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={col.accent.lo} />
          <stop offset="1" stopColor={col.accent.hi} />
        </linearGradient>
        <linearGradient id={`${id}steel`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8d96a3" />
          <stop offset=".5" stopColor="#f4f7fb" />
          <stop offset="1" stopColor="#7a828e" />
        </linearGradient>
        <radialGradient id={`${id}glow`}>
          <stop offset="0" stopColor={g.eye} stopOpacity=".95" />
          <stop offset=".4" stopColor={g.eye} stopOpacity=".35" />
          <stop offset="1" stopColor={g.eye} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}glow2`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff4b0" />
          <stop offset=".5" stopColor="#ff9a2a" />
          <stop offset="1" stopColor="#ff4a1a" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}fire`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#ffdf6a" />
          <stop offset=".5" stopColor="#ff7a1a" />
          <stop offset="1" stopColor="#c41a0a" />
        </linearGradient>
        <radialGradient id={`${id}iris`}>
          <stop offset="0" stopColor="#ffe9a8" />
          <stop offset="1" stopColor={st && card.kind === "trap" ? "#b0306a" : "#1f8a6b"} />
        </radialGradient>
        <radialGradient id={`${id}vig`} cx="50%" cy="45%" r="70%">
          <stop offset=".6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".55" />
        </radialGradient>
      </defs>
      <rect width="100" height="76" fill={`url(#${id}sky)`} />
      {body}
      <rect width="100" height="76" fill={`url(#${id}vig)`} />
    </svg>
  )
}

const CardArt = memo(ArtSvg, (a, b) => a.card.id === b.card.id && a.className === b.className)
export default CardArt

// the attribute's color (orbs, highlights)
export const ATTR_COLORS = { FIRE: "#e8461e", WATER: "#2a7de1", EARTH: "#8b6b3d", WIND: "#2f9e57", LIGHT: "#e0a812", DARK: "#6a3d9a" }
