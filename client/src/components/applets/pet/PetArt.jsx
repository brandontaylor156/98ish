import React from "react"
import { PALETTE } from "./catalog"

// Everything drawn for Our Pet, as inline SVG: four original creatures (in three sizes as
// they grow), their faces, the wardrobe, the food and little icons. All of it is drawn
// here; CSS in Pet.css makes it breathe, blink and bounce.

const INK = "#3b2a35"
const BLUSH = "#ff8fab"

// ---------- faces ----------

const Eyes = ({ cx, y, gap, r, look }) => {
  const xs = [cx - gap, cx + gap]
  if (look === "happy")
    return xs.map((x) => <path key={x} d={`M${x - 6.5} ${y + 2} Q${x} ${y - 7} ${x + 6.5} ${y + 2}`} stroke={INK} strokeWidth="3.6" fill="none" strokeLinecap="round" />)
  if (look === "closed")
    return xs.map((x) => <path key={x} d={`M${x - 6.5} ${y} Q${x} ${y + 5.5} ${x + 6.5} ${y}`} stroke={INK} strokeWidth="3.2" fill="none" strokeLinecap="round" />)
  if (look === "sleepy")
    return xs.map((x) => (
      <g key={x}>
        <ellipse cx={x} cy={y + 1.5} rx={r * 0.8} ry={r * 0.55} fill={INK} />
        <path d={`M${x - r - 1} ${y - 0.5} L${x + r + 1} ${y - 0.5}`} stroke={INK} strokeWidth="3" strokeLinecap="round" />
      </g>
    ))
  const sad = look === "sad"
  return (
    <>
      {xs.map((x, i) => (
        <g key={x} className="petEye">
          <ellipse cx={x} cy={y} rx={r * 0.86} ry={r} fill={INK} />
          <circle cx={x - r * 0.3} cy={y - r * 0.38} r={r * 0.36} fill="#fff" />
          <circle cx={x + r * 0.32} cy={y + r * 0.35} r={r * 0.16} fill="#fff" />
          {sad && <path d={i === 0 ? `M${x - 8} ${y - r - 5} L${x + 5} ${y - r - 8}` : `M${x - 5} ${y - r - 8} L${x + 8} ${y - r - 5}`} stroke={INK} strokeWidth="2.6" strokeLinecap="round" />}
        </g>
      ))}
      {sad && <path d={`M${xs[1] + 3} ${y + r + 2} q 3 5 0 8 q -3 -3 0 -8 Z`} fill="#8fd0ff" stroke="#4a8fc2" strokeWidth="1" />}
    </>
  )
}

const Mouth = ({ cx, y, kind }) => {
  if (kind === "cat") return <path d={`M${cx - 8} ${y} q 4 5 8 0 q 4 5 8 0`} stroke={INK} strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  if (kind === "open")
    return (
      <g>
        <path d={`M${cx - 7} ${y - 1} Q${cx} ${y + 13} ${cx + 7} ${y - 1} Z`} fill="#c2405e" stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
        <ellipse cx={cx} cy={y + 6} rx="3.6" ry="2.4" fill="#ff8da6" />
      </g>
    )
  if (kind === "chomp")
    return (
      <g className="petChomp">
        <ellipse cx={cx} cy={y + 3} rx="6" ry="6" fill="#c2405e" stroke={INK} strokeWidth="2.2" />
      </g>
    )
  if (kind === "o") return <ellipse cx={cx} cy={y + 2} rx="3" ry="3.4" fill="#c2405e" stroke={INK} strokeWidth="1.8" />
  if (kind === "frown") return <path d={`M${cx - 6} ${y + 5} Q${cx} ${y - 2} ${cx + 6} ${y + 5}`} stroke={INK} strokeWidth="2.6" fill="none" strokeLinecap="round" />
  return <path d={`M${cx - 6} ${y} Q${cx} ${y + 7} ${cx + 6} ${y}`} stroke={INK} strokeWidth="2.6" fill="none" strokeLinecap="round" />
}

// expression -> eyes and mouth
const FACES = {
  okay: ["open", "smile"],
  happy: ["happy", "open"],
  loved: ["happy", "open"],
  eating: ["happy", "chomp"],
  sleeping: ["closed", "o"],
  sleepy: ["sleepy", "smile"],
  sad: ["sad", "frown"],
  wow: ["open", "o"],
}

const Face = ({ cx, ey, gap, my, r, expression, catMouth }) => {
  const [eyes, mouth] = FACES[expression] || FACES.okay
  return (
    <g className="petFace">
      <ellipse cx={cx - gap - 11} cy={ey + 11} rx="8.5" ry="5" fill={BLUSH} opacity="0.55" />
      <ellipse cx={cx + gap + 11} cy={ey + 11} rx="8.5" ry="5" fill={BLUSH} opacity="0.55" />
      <Eyes cx={cx} y={ey} gap={gap} r={r} look={eyes} />
      <Mouth cx={cx} y={my} kind={mouth === "smile" && catMouth ? "cat" : mouth} />
    </g>
  )
}

// ---------- the four creatures ----------
// Each draws itself on a 200 x 200 canvas standing on y = 182, and says where its face
// and its head, eyes and neck (for the wardrobe) are.

const outlined = (d, color, line, width) => (
  <>
    <path d={d} stroke={line} strokeWidth={width + 5} fill="none" strokeLinecap="round" />
    <path d={d} stroke={color} strokeWidth={width} fill="none" strokeLinecap="round" />
  </>
)

const Bunnycat = ({ c, a, stage, droop }) => {
  const ear = stage === "baby" ? 27 : stage === "kid" ? 33 : 38
  const tilt = droop ? 34 : 14
  return {
    back: (
      <>
        {outlined("M150 162 q 30 -2 26 -32 q -2 -12 -12 -7", c.fill, c.line, 9)}
        <g className="petEarL">
          <ellipse cx="76" cy={92 - ear * 0.8} rx="14" ry={ear} transform={`rotate(${-tilt} 76 92)`} fill={c.fill} stroke={c.line} strokeWidth="3" />
          <ellipse cx="76" cy={92 - ear * 0.78} rx="6.5" ry={ear * 0.7} transform={`rotate(${-tilt} 76 92)`} fill={a.shade} />
        </g>
        <g className="petEarR">
          <ellipse cx="124" cy={92 - ear * 0.8} rx="14" ry={ear} transform={`rotate(${tilt} 124 92)`} fill={c.fill} stroke={c.line} strokeWidth="3" />
          <ellipse cx="124" cy={92 - ear * 0.78} rx="6.5" ry={ear * 0.7} transform={`rotate(${tilt} 124 92)`} fill={a.shade} />
        </g>
      </>
    ),
    body: (
      <>
        <ellipse cx="78" cy="177" rx="15" ry="8" fill={c.fill} stroke={c.line} strokeWidth="3" />
        <ellipse cx="122" cy="177" rx="15" ry="8" fill={c.fill} stroke={c.line} strokeWidth="3" />
        <ellipse cx="100" cy="133" rx="58" ry="47" fill={c.fill} stroke={c.line} strokeWidth="3" />
        <ellipse cx="100" cy="153" rx="31" ry="21" fill="#fff" opacity="0.55" />
        <path d="M100 98 l-5 -7 M100 98 l0 -9 M100 98 l5 -7" stroke={c.shade} strokeWidth="3" strokeLinecap="round" />
        <path d="M58 132 l-16 -3 M58 139 l-16 2 M142 132 l16 -3 M142 139 l16 2" stroke={c.line} strokeWidth="1.8" strokeLinecap="round" opacity="0.7" />
        <path d="M96 135 l4 3.5 l4 -3.5 Z" fill="#ff8da6" stroke={INK} strokeWidth="1.2" strokeLinejoin="round" />
      </>
    ),
    face: { cx: 100, ey: 124, gap: 22, my: 139, r: 7.5, catMouth: true },
    anchors: { head: [100, 90, 64], eyes: [100, 124, 22], neck: [100, 164, 92] },
  }
}

const Dragon = ({ c, a, stage }) => {
  const wing = stage === "baby" ? 0.8 : stage === "kid" ? 1 : 1.25
  const horn = stage === "baby" ? 8 : stage === "kid" ? 14 : 21
  const wingPath = "M0 0 Q -34 -26 -30 -52 Q -20 -38 -10 -40 Q -16 -26 -2 -22 Q -8 -12 0 0 Z"
  return {
    back: (
      <>
        {outlined("M140 166 q 26 4 34 -20", c.fill, c.line, 12)}
        <path d="M168 150 l14 -10 l-2 16 Z" fill={a.fill} stroke={c.line} strokeWidth="2.6" strokeLinejoin="round" transform="rotate(-10 174 148)" />
        <g transform={`translate(58 118) scale(${wing})`}>
          <g className="petWingL">
            <path d={wingPath} fill={a.fill} stroke={c.line} strokeWidth={2.8 / wing} strokeLinejoin="round" />
          </g>
        </g>
        <g transform={`translate(142 118) scale(${-wing} ${wing})`}>
          <g className="petWingL">
            <path d={wingPath} fill={a.fill} stroke={c.line} strokeWidth={2.8 / wing} strokeLinejoin="round" />
          </g>
        </g>
        <path d={`M80 92 Q 72 ${86 - horn} 76 ${84 - horn} Q 86 ${88 - horn * 0.6} 90 88 Z`} fill="#fff1c9" stroke={c.line} strokeWidth="2.6" strokeLinejoin="round" />
        <path d={`M120 92 Q 128 ${86 - horn} 124 ${84 - horn} Q 114 ${88 - horn * 0.6} 110 88 Z`} fill="#fff1c9" stroke={c.line} strokeWidth="2.6" strokeLinejoin="round" />
      </>
    ),
    body: (
      <>
        <ellipse cx="80" cy="177" rx="14" ry="8" fill={c.fill} stroke={c.line} strokeWidth="3" />
        <ellipse cx="120" cy="177" rx="14" ry="8" fill={c.fill} stroke={c.line} strokeWidth="3" />
        <path d="M100 82 C 146 82 154 120 152 140 C 150 170 128 180 100 180 C 72 180 50 170 48 140 C 46 120 54 82 100 82 Z" fill={c.fill} stroke={c.line} strokeWidth="3" />
        <path d="M92 84 l8 -12 l8 12 Z" fill={a.fill} stroke={c.line} strokeWidth="2.4" strokeLinejoin="round" />
        <ellipse cx="100" cy="155" rx="30" ry="22" fill="#fff6e2" stroke={c.shade} strokeWidth="2" />
        <path d="M78 150 q 22 6 44 0 M80 160 q 20 5 40 0" stroke={c.shade} strokeWidth="2" fill="none" strokeLinecap="round" />
        <circle cx="94" cy="134" r="1.6" fill={c.line} />
        <circle cx="106" cy="134" r="1.6" fill={c.line} />
      </>
    ),
    face: { cx: 100, ey: 120, gap: 22, my: 139, r: 7.5 },
    anchors: { head: [100, 86, 62], eyes: [100, 120, 22], neck: [100, 166, 84] },
  }
}

const WOOL = Array.from({ length: 12 }, (_, i) => {
  const t = (i / 12) * Math.PI * 2
  return [100 + 52 * Math.cos(t), 132 + 40 * Math.sin(t)]
})

const Sheep = ({ c, a, stage }) => {
  const curls = stage !== "baby"
  const big = stage === "grown"
  return {
    back: (
      <>
        <rect x="74" y="160" width="14" height="22" rx="6" fill={a.shade} stroke={a.line} strokeWidth="2.6" />
        <rect x="112" y="160" width="14" height="22" rx="6" fill={a.shade} stroke={a.line} strokeWidth="2.6" />
      </>
    ),
    body: (
      <>
        {WOOL.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="21" fill={c.fill} stroke={c.line} strokeWidth="3" />
        ))}
        <ellipse cx="100" cy="132" rx="56" ry="43" fill={c.fill} />
        <ellipse cx="62" cy="122" rx="15" ry="8" transform="rotate(-24 62 122)" fill={a.fill} stroke={a.line} strokeWidth="2.6" />
        <ellipse cx="138" cy="122" rx="15" ry="8" transform="rotate(24 138 122)" fill={a.fill} stroke={a.line} strokeWidth="2.6" />
        {curls && (
          <>
            <path d={big ? "M70 108 c -16 -6 -22 12 -10 18 c 8 4 12 -6 6 -8" : "M72 110 c -10 -4 -14 8 -6 11"} stroke="#f2dcb3" strokeWidth={big ? 7 : 6} fill="none" strokeLinecap="round" />
            <path d={big ? "M130 108 c 16 -6 22 12 10 18 c -8 4 -12 -6 -6 -8" : "M128 110 c 10 -4 14 8 6 11"} stroke="#f2dcb3" strokeWidth={big ? 7 : 6} fill="none" strokeLinecap="round" />
          </>
        )}
        <ellipse cx="100" cy="134" rx="31" ry="27" fill="#fff9f1" stroke={c.line} strokeWidth="2.6" />
        <circle cx="88" cy="108" r="10" fill={c.fill} stroke={c.line} strokeWidth="2.4" />
        <circle cx="112" cy="108" r="10" fill={c.fill} stroke={c.line} strokeWidth="2.4" />
        <circle cx="100" cy="104" r="12" fill={c.fill} stroke={c.line} strokeWidth="2.4" />
        <ellipse cx="100" cy="112" rx="18" ry="6" fill={c.fill} />
      </>
    ),
    face: { cx: 100, ey: 132, gap: 13, my: 146, r: 6 },
    anchors: { head: [100, 94, 62], eyes: [100, 132, 13], neck: [100, 168, 86] },
  }
}

const Mochi = ({ c, a, stage }) => {
  const leaf = (x, flip) => (
    <path d={`M100 66 q ${flip * 10} -16 ${flip * 26} -12 q ${flip * -6} 16 ${flip * -26} 12 Z`} fill={a.fill} stroke={a.line} strokeWidth="2.4" strokeLinejoin="round" />
  )
  return {
    back: (
      <>
        <path d="M100 86 q -2 -12 0 -22" stroke="#6aa86a" strokeWidth="3.4" fill="none" strokeLinecap="round" />
        <g className="petSprout">
          {leaf(100, 1)}
          {stage !== "baby" && leaf(100, -1)}
          {stage === "grown" && (
            <g transform="translate(100 60)">
              {[0, 72, 144, 216, 288].map((t) => (
                <ellipse key={t} cx="0" cy="-7" rx="4.6" ry="6.5" transform={`rotate(${t})`} fill="#ffb3c9" stroke="#c4587a" strokeWidth="1.4" />
              ))}
              <circle r="3.6" fill="#ffd65a" stroke="#b58a1d" strokeWidth="1.2" />
            </g>
          )}
        </g>
      </>
    ),
    body: (
      <>
        <ellipse cx="50" cy="152" rx="10" ry="7" transform="rotate(-30 50 152)" fill={c.fill} stroke={c.line} strokeWidth="2.6" />
        <ellipse cx="150" cy="152" rx="10" ry="7" transform="rotate(30 150 152)" fill={c.fill} stroke={c.line} strokeWidth="2.6" />
        <path d="M44 172 C 36 118 62 84 100 84 C 138 84 164 118 156 172 C 152 184 48 184 44 172 Z" fill={c.fill} stroke={c.line} strokeWidth="3" />
        <ellipse cx="72" cy="110" rx="11" ry="6" transform="rotate(-35 72 110)" fill="#fff" opacity="0.75" />
        <path d="M60 172 q 40 8 80 0" stroke={c.shade} strokeWidth="3" fill="none" strokeLinecap="round" />
      </>
    ),
    face: { cx: 100, ey: 130, gap: 23, my: 144, r: 7.8 },
    anchors: { head: [100, 88, 60], eyes: [100, 130, 23], neck: [100, 160, 104] },
  }
}

const DRAW = { bunnycat: Bunnycat, dragon: Dragon, sheep: Sheep, mochi: Mochi }

// ---------- the wardrobe ----------

const Flower = ({ x, y, color }) => (
  <g transform={`translate(${x} ${y})`}>
    {[0, 72, 144, 216, 288].map((t) => (
      <circle key={t} cx="0" cy="-4.4" r="3.6" transform={`rotate(${t})`} fill={color} stroke="#a3446a" strokeWidth="0.9" />
    ))}
    <circle r="2.6" fill="#ffd65a" />
  </g>
)

export const Accessory = ({ id, anchors }) => {
  const [hx, hy, hw] = anchors.head
  const [ex, ey, gap] = anchors.eyes
  const [nx, ny, nw] = anchors.neck
  switch (id) {
    case "bow":
      return (
        <g transform={`translate(${hx - hw * 0.34} ${hy + 4}) rotate(-18)`}>
          <path d="M0 0 C -14 -14 -24 -2 -18 6 C -12 12 -4 6 0 0 Z" fill="#ff6b8e" stroke="#9b2948" strokeWidth="2" />
          <path d="M0 0 C 14 -14 24 -2 18 6 C 12 12 4 6 0 0 Z" fill="#ff6b8e" stroke="#9b2948" strokeWidth="2" />
          <path d="M-12 -2 q 4 2 8 2 M12 -2 q -4 2 -8 2" stroke="#ffc2d1" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <circle r="4.6" fill="#ff8aa6" stroke="#9b2948" strokeWidth="2" />
        </g>
      )
    case "beanie":
      return (
        <g transform={`translate(${hx} ${hy})`}>
          <path d={`M${-hw * 0.5} 8 C ${-hw * 0.5} -26 ${hw * 0.5} -26 ${hw * 0.5} 8 Z`} fill="#8cc2ff" stroke="#3e6995" strokeWidth="2.6" />
          <path d={`M${-hw * 0.3} -12 l0 16 M0 -16 l0 20 M${hw * 0.3} -12 l0 16`} stroke="#6aa5ec" strokeWidth="2" strokeLinecap="round" />
          <rect x={-hw * 0.54} y="2" width={hw * 1.08} height="11" rx="5" fill="#5a8fe0" stroke="#3e6995" strokeWidth="2.4" />
          <circle cx="0" cy="-22" r="7" fill="#fff" stroke="#3e6995" strokeWidth="2.2" />
        </g>
      )
    case "flowers":
      return (
        <g>
          <path d={`M${hx - hw * 0.5} ${hy + 6} Q ${hx} ${hy - 6} ${hx + hw * 0.5} ${hy + 6}`} stroke="#6aa86a" strokeWidth="3" fill="none" strokeLinecap="round" />
          {[-0.46, -0.23, 0, 0.23, 0.46].map((t, i) => (
            <Flower key={t} x={hx + hw * t} y={hy + 3 - (1 - Math.abs(t) * 2) * 5} color={["#ffb3c9", "#fff2a8", "#c9b6ff", "#ffb3c9", "#bfe7ff"][i]} />
          ))}
        </g>
      )
    case "tophat":
      return (
        <g transform={`translate(${hx + 6} ${hy + 2}) rotate(10)`}>
          <ellipse cx="0" cy="4" rx={hw * 0.42} ry="6" fill="#3a2f3f" stroke="#1d161f" strokeWidth="2" />
          <path d={`M${-hw * 0.26} 4 L${-hw * 0.24} -30 Q 0 -34 ${hw * 0.24} -30 L${hw * 0.26} 4 Z`} fill="#3a2f3f" stroke="#1d161f" strokeWidth="2" />
          <rect x={-hw * 0.255} y="-8" width={hw * 0.51} height="7" fill="#e8405f" />
          <path d={`M${-hw * 0.16} -26 l0 14`} stroke="#5d4d63" strokeWidth="3" strokeLinecap="round" />
        </g>
      )
    case "crown":
      return (
        <g transform={`translate(${hx} ${hy + 2})`}>
          <path d="M-22 4 L-24 -18 L-12 -6 L0 -24 L12 -6 L24 -18 L22 4 Z" fill="#ffd65a" stroke="#a87b10" strokeWidth="2.4" strokeLinejoin="round" />
          <circle cx="0" cy="-24" r="3" fill="#ff8fab" stroke="#a87b10" strokeWidth="1.4" />
          <circle cx="-24" cy="-18" r="2.4" fill="#8fd0ff" stroke="#a87b10" strokeWidth="1.2" />
          <circle cx="24" cy="-18" r="2.4" fill="#8fd0ff" stroke="#a87b10" strokeWidth="1.2" />
          <circle cx="0" cy="-4" r="3.6" fill="#ff5c8a" stroke="#a87b10" strokeWidth="1.4" />
        </g>
      )
    case "glasses":
      return (
        <g fill="rgba(255,255,255,0.28)" stroke="#5a3a26" strokeWidth="2.8">
          <circle cx={ex - gap} cy={ey} r="11.5" />
          <circle cx={ex + gap} cy={ey} r="11.5" />
          <path d={`M${ex - gap + 11.5} ${ey - 2} Q ${ex} ${ey - 7} ${ex + gap - 11.5} ${ey - 2}`} fill="none" />
        </g>
      )
    case "shades": {
      const heart = (x) => `M${x} ${ey + 9} C ${x - 18} ${ey - 2} ${x - 12} ${ey - 15} ${x} ${ey - 6} C ${x + 12} ${ey - 15} ${x + 18} ${ey - 2} ${x} ${ey + 9} Z`
      return (
        <g>
          <path d={heart(ex - gap)} fill="#ff5c8a" stroke={INK} strokeWidth="2.2" opacity="0.92" />
          <path d={heart(ex + gap)} fill="#ff5c8a" stroke={INK} strokeWidth="2.2" opacity="0.92" />
          <path d={`M${ex - gap + 9} ${ey - 4} Q ${ex} ${ey - 9} ${ex + gap - 9} ${ey - 4}`} stroke={INK} strokeWidth="2.2" fill="none" />
          <path d={`M${ex - gap - 6} ${ey - 5} l4 -3`} stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          <path d={`M${ex + gap - 6} ${ey - 5} l4 -3`} stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        </g>
      )
    }
    case "scarf":
      return (
        <g>
          <path d={`M${nx - nw / 2} ${ny - 4} Q ${nx} ${ny + 12} ${nx + nw / 2} ${ny - 4}`} stroke="#9b2948" strokeWidth="17" fill="none" strokeLinecap="round" />
          <path d={`M${nx - nw / 2} ${ny - 4} Q ${nx} ${ny + 12} ${nx + nw / 2} ${ny - 4}`} stroke="#ff6b8e" strokeWidth="12" fill="none" strokeLinecap="round" />
          <path d={`M${nx - nw / 2} ${ny - 4} Q ${nx} ${ny + 12} ${nx + nw / 2} ${ny - 4}`} stroke="#fff3f6" strokeWidth="12" fill="none" strokeDasharray="5 9" />
          <path d={`M${nx + nw * 0.24} ${ny + 2} l6 20 l10 -3 l-4 -19 Z`} fill="#ff6b8e" stroke="#9b2948" strokeWidth="2.2" strokeLinejoin="round" />
          <path d={`M${nx + nw * 0.24 + 5} ${ny + 22} l2 4 M${nx + nw * 0.24 + 10} ${ny + 21} l2 4`} stroke="#9b2948" strokeWidth="2" strokeLinecap="round" />
        </g>
      )
    default:
      return null
  }
}

// ---------- the creature ----------

// expression: okay | happy | loved | eating | sleeping | sleepy | sad | wow
export const Creature = ({ species = "mochi", body = "cream", accent = "pink", stage = "grown", expression = "okay", worn = [], dirty = 0, size = 160, className = "", title }) => {
  const c = PALETTE[body] || PALETTE.cream
  const a = PALETTE[accent] || PALETTE.pink
  const draw = (DRAW[species] || Mochi)({ c, a, stage, droop: expression === "sad" })
  const scale = stage === "baby" ? 0.74 : stage === "kid" ? 0.87 : 1
  const order = ["neck", "eyes", "head"]
  const items = [...worn].sort((x, y) => order.indexOf(slotOf(x)) - order.indexOf(slotOf(y)))
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} className={`petCreature ${className}`} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : "true"}>
      <ellipse className="petShadow" cx="100" cy="184" rx={58 * scale} ry={7 * scale} fill="rgba(60,30,50,0.16)" />
      <g transform={`translate(100 182) scale(${scale}) translate(-100 -182)`}>
        <g className="petBreath">
          {draw.back}
          {draw.body}
          {dirty > 0 && (
            <g className="petDirt" opacity={Math.min(1, dirty)}>
              <ellipse cx="72" cy="150" rx="9" ry="6" fill="#a07a58" opacity="0.55" />
              <ellipse cx="130" cy="160" rx="7" ry="5" fill="#a07a58" opacity="0.5" />
              <ellipse cx="118" cy="110" rx="5" ry="4" fill="#a07a58" opacity="0.45" />
              <circle cx="84" cy="168" r="3" fill="#a07a58" opacity="0.5" />
            </g>
          )}
          <Face {...draw.face} expression={expression} />
          {items.map((id) => (
            <Accessory key={id} id={id} anchors={draw.anchors} />
          ))}
        </g>
      </g>
    </svg>
  )
}

const SLOTS = { bow: "head", beanie: "head", flowers: "head", tophat: "head", crown: "head", glasses: "eyes", shades: "eyes", scarf: "neck" }
const slotOf = (id) => SLOTS[id] || "head"

// An accessory on its own (the wardrobe's swatches), framed to fit
const ICON_BOX = {
  bow: "2 38 56 44",
  beanie: "16 26 68 50",
  flowers: "16 38 68 34",
  tophat: "26 22 62 52",
  crown: "20 32 60 38",
  glasses: "16 20 68 40",
  shades: "12 18 76 40",
  scarf: "12 12 78 48",
}
export const AccessoryIcon = ({ id, size = 44 }) => {
  const anchors = { head: [50, 60, 60], eyes: [50, 40, 18], neck: [50, 30, 64] }
  return (
    <svg viewBox={ICON_BOX[id] || "0 0 100 80"} width={size} height={size * 0.8} aria-hidden="true">
      <Accessory id={id} anchors={anchors} />
    </svg>
  )
}

// ---------- food ----------

export const Food = ({ id, size = 36 }) => (
  <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true" className="petFood">
    {id === "strawberry" && (
      <>
        <path d="M20 36 C 8 30 6 16 12 12 C 16 10 24 10 28 12 C 34 16 32 30 20 36 Z" fill="#ff4f6d" stroke="#9b2340" strokeWidth="1.8" />
        <path d="M12 12 l4 -5 l4 4 l4 -4 l4 5 l-6 2 h-4 Z" fill="#5dbb63" stroke="#2f7a3a" strokeWidth="1.4" strokeLinejoin="round" />
        {[[16, 18], [24, 18], [20, 24], [15, 26], [25, 26], [20, 31]].map(([x, y]) => (
          <ellipse key={`${x}${y}`} cx={x} cy={y} rx="0.9" ry="1.4" fill="#ffe28a" />
        ))}
      </>
    )}
    {id === "carrot" && (
      <>
        <path d="M14 12 L30 14 L12 36 Z" fill="#ff9b3d" stroke="#a5521a" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M17 18 l4 1 M15 24 l4 1 M14 29 l3 1" stroke="#c96a24" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M22 13 q -4 -8 -1 -10 q 3 4 2 9 q 3 -7 7 -7 q -1 6 -6 9" fill="#5dbb63" stroke="#2f7a3a" strokeWidth="1.4" />
      </>
    )}
    {id === "cookie" && (
      <>
        <path d="M20 35 C 6 26 3 16 9 10 C 14 6 19 9 20 12 C 21 9 26 6 31 10 C 37 16 34 26 20 35 Z" fill="#e6b073" stroke="#8a5a2b" strokeWidth="1.8" />
        <path d="M20 30 C 10 24 8 17 12 14 C 15 12 18 14 20 16 C 22 14 25 12 28 14 C 32 17 30 24 20 30 Z" fill="#ffb3c9" />
        <circle cx="15" cy="18" r="1" fill="#fff" />
        <circle cx="25" cy="20" r="1" fill="#fff" />
        <circle cx="20" cy="24" r="1" fill="#fff" />
      </>
    )}
    {id === "fish" && (
      <>
        <path d="M6 20 C 12 10 26 10 31 20 C 26 30 12 30 6 20 Z" fill="#8fd0ff" stroke="#3e6995" strokeWidth="1.8" />
        <path d="M30 20 L38 13 L37 27 Z" fill="#8fd0ff" stroke="#3e6995" strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx="13" cy="18.5" r="1.8" fill={INK} />
        <path d="M18 15 q 3 5 0 10 M23 15 q 3 5 0 10" stroke="#5c9bd6" strokeWidth="1.3" fill="none" />
      </>
    )}
    {id === "riceball" && (
      <>
        <path d="M20 5 C 26 5 36 24 34 30 C 32 35 8 35 6 30 C 4 24 14 5 20 5 Z" fill="#fff" stroke="#8b7f86" strokeWidth="1.8" />
        <rect x="12" y="24" width="16" height="11" rx="1.5" fill="#2f4a3a" />
        <circle cx="16" cy="19" r="1.2" fill={INK} />
        <circle cx="24" cy="19" r="1.2" fill={INK} />
        <path d="M18 21.5 q 2 2 4 0" stroke={INK} strokeWidth="1.1" fill="none" strokeLinecap="round" />
      </>
    )}
    {id === "milk" && (
      <>
        <rect x="14" y="4" width="12" height="6" rx="3" fill="#ff8fab" stroke="#9b4762" strokeWidth="1.6" />
        <rect x="12" y="9" width="16" height="4" rx="1.5" fill="#ffd3df" stroke="#9b4762" strokeWidth="1.4" />
        <path d="M12 13 h16 v18 q 0 5 -5 5 h-6 q -5 0 -5 -5 Z" fill="#fff" stroke="#8b7f86" strokeWidth="1.8" />
        <path d="M14 22 h12 v9 q 0 3 -3 3 h-6 q -3 0 -3 -3 Z" fill="#f4f7ff" />
        <path d="M17 18 h6 M17 22 h4" stroke="#b9c7e6" strokeWidth="1.3" strokeLinecap="round" />
      </>
    )}
  </svg>
)

// ---------- little icons ----------

export const Dice = ({ size = 18 }) => (
  <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden="true">
    <rect x="2" y="2" width="16" height="16" rx="4" fill="#fff" stroke="#9b4762" strokeWidth="1.6" />
    {[[6.5, 6.5], [13.5, 13.5], [10, 10], [13.5, 6.5], [6.5, 13.5]].map(([x, y]) => (
      <circle key={`${x}${y}`} cx={x} cy={y} r="1.6" fill="#e8405f" />
    ))}
  </svg>
)

export const Heart = ({ size = 16, fill = "#ff5c8a", stroke = "#9b2948", className }) => (
  <svg viewBox="-10 -10 20 20" width={size} height={size} className={className} aria-hidden="true">
    <path d="M0,-3 C0,-9 -9,-10 -9,-3 C-9,2 -3,6 0,9 C3,6 9,2 9,-3 C9,-10 0,-9 0,-3 Z" fill={fill} stroke={stroke} strokeWidth="1.4" />
    <path d="M-5,-5 Q-6,-2 -4,0" stroke="#fff" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.7" />
  </svg>
)

export const StatIcon = ({ id, size = 18 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    {id === "fullness" && (
      <>
        <path d="M4 12 h16 q 0 8 -8 8 q -8 0 -8 -8 Z" fill="#ffd3df" stroke="#9b4762" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M7 12 q 0 -4 5 -4 q 5 0 5 4" fill="#fff" stroke="#9b4762" strokeWidth="1.4" />
        <path d="M14 5 q 2 -2 4 -1" stroke="#9b4762" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </>
    )}
    {id === "happiness" && <path d="M12,8 C12,2 3,1 3,8 C3,13 9,17 12,20 C15,17 21,13 21,8 C21,1 12,2 12,8 Z" fill="#ff6b8e" stroke="#9b2948" strokeWidth="1.6" />}
    {id === "cleanliness" && (
      <>
        <circle cx="10" cy="13" r="6.5" fill="#d2ecff" stroke="#3e6995" strokeWidth="1.6" />
        <circle cx="17" cy="7" r="3.5" fill="#d2ecff" stroke="#3e6995" strokeWidth="1.4" />
        <circle cx="18" cy="17" r="2.4" fill="#d2ecff" stroke="#3e6995" strokeWidth="1.2" />
        <path d="M7 11 q 1 -2 3 -2" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </>
    )}
    {id === "energy" && <path d="M13 2 L5 14 h6 l-2 8 l9 -13 h-6 Z" fill="#ffd65a" stroke="#a87b10" strokeWidth="1.6" strokeLinejoin="round" />}
  </svg>
)

export const ActionIcon = ({ id, size = 30 }) => (
  <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
    {id === "feed" && (
      <>
        <path d="M3 15 h26 q -1 11 -13 11 q -12 0 -13 -11 Z" fill="#ffb3c9" stroke="#9b4762" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M8 15 q 2 -6 8 -6 q 6 0 8 6" fill="#fff4dc" stroke="#9b4762" strokeWidth="1.6" />
        <circle cx="12" cy="12" r="2" fill="#ff4f6d" />
        <circle cx="19" cy="11" r="2" fill="#ff9b3d" />
        <path d="M9 20 q 7 3 14 0" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </>
    )}
    {id === "play" && (
      <>
        <circle cx="16" cy="16" r="11" fill="#8fd0ff" stroke="#3e6995" strokeWidth="1.8" />
        <path d="M6 12 q 10 6 20 0 M6 20 q 10 -6 20 0" stroke="#fff" strokeWidth="2.6" fill="none" />
        <path d="M10 9 q 2 -2 5 -2" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </>
    )}
    {id === "pet" && (
      <>
        <path d="M16,11 C16,4 5,3 5,11 C5,17 12,22 16,26 C20,22 27,17 27,11 C27,3 16,4 16,11 Z" fill="#ff6b8e" stroke="#9b2948" strokeWidth="1.8" />
        <path d="M9 9 q -1 3 1 5" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" opacity="0.8" />
      </>
    )}
    {id === "bathe" && (
      <>
        <path d="M3 15 h26 v3 q 0 8 -9 8 h-8 q -9 0 -9 -8 Z" fill="#fff" stroke="#3e6995" strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx="9" cy="12" r="4" fill="#d2ecff" stroke="#3e6995" strokeWidth="1.4" />
        <circle cx="16" cy="10" r="5" fill="#d2ecff" stroke="#3e6995" strokeWidth="1.4" />
        <circle cx="23" cy="12" r="3.5" fill="#d2ecff" stroke="#3e6995" strokeWidth="1.4" />
        <path d="M8 28 v2 M24 28 v2" stroke="#3e6995" strokeWidth="2" strokeLinecap="round" />
      </>
    )}
    {id === "sleep" && (
      <>
        <path d="M20 4 a 12 12 0 1 0 8 18 a 10 10 0 1 1 -8 -18 Z" fill="#ffe58a" stroke="#a87b10" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M22 9 h4 l-4 4 h4" stroke="#6a4f9a" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>
    )}
    {id === "wake" && (
      <>
        <circle cx="16" cy="16" r="6.5" fill="#ffd65a" stroke="#a87b10" strokeWidth="1.8" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((t) => (
          <path key={t} d="M16 3.5 v4" stroke="#f0a020" strokeWidth="2.2" strokeLinecap="round" transform={`rotate(${t} 16 16)`} />
        ))}
      </>
    )}
    {id === "dress" && (
      <g transform="translate(16 16)">
        <path d="M0 0 C -10 -11 -15 -1 -12 5 C -8 10 -3 5 0 0 Z" fill="#c9b6ff" stroke="#66509a" strokeWidth="1.8" />
        <path d="M0 0 C 10 -11 15 -1 12 5 C 8 10 3 5 0 0 Z" fill="#c9b6ff" stroke="#66509a" strokeWidth="1.8" />
        <path d="M-2 2 l-5 10 M2 2 l5 10" stroke="#66509a" strokeWidth="2.2" strokeLinecap="round" />
        <circle r="3.6" fill="#e6d8ff" stroke="#66509a" strokeWidth="1.8" />
      </g>
    )}
  </svg>
)

// Grandma's house, for the postcard
export const GrandmaHouse = ({ size = 140 }) => (
  <svg viewBox="0 0 140 110" width={size} height={size * 0.79} aria-hidden="true">
    <rect x="0" y="80" width="140" height="30" fill="#b6e3a8" />
    <path d="M0 82 q 35 -8 70 0 q 35 8 70 0" stroke="#8ccf7a" strokeWidth="3" fill="none" />
    <rect x="30" y="44" width="80" height="42" fill="#fff2dc" stroke="#8b6a46" strokeWidth="2.4" />
    <path d="M22 48 L70 14 L118 48 Z" fill="#ff8fab" stroke="#9b4762" strokeWidth="2.4" strokeLinejoin="round" />
    <rect x="92" y="18" width="10" height="18" fill="#c98b6a" stroke="#8b6a46" strokeWidth="2" />
    <circle cx="99" cy="11" r="4" fill="#fff" opacity="0.8" />
    <circle cx="106" cy="5" r="3" fill="#fff" opacity="0.6" />
    <rect x="62" y="60" width="16" height="26" rx="2" fill="#c98b6a" stroke="#8b6a46" strokeWidth="2" />
    <rect x="38" y="54" width="16" height="14" fill="#bfe7ff" stroke="#8b6a46" strokeWidth="2" />
    <rect x="86" y="54" width="16" height="14" fill="#bfe7ff" stroke="#8b6a46" strokeWidth="2" />
    <path d="M70 34 C 70 30 64 29 64 34 C 64 37 68 39 70 41 C 72 39 76 37 76 34 C 76 29 70 30 70 34 Z" fill="#ff5c8a" />
    {[16, 124].map((x) => (
      <g key={x}>
        <circle cx={x} cy="82" r="5" fill="#ffb3c9" />
        <circle cx={x} cy="82" r="2" fill="#ffd65a" />
      </g>
    ))}
  </svg>
)
