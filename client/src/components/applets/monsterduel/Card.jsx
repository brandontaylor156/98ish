import React, { memo } from "react"
import CardArt, { ATTR_COLORS } from "./CardArt"
import { CARD } from "./engine/cards"

// Monster Duel's cards. <Card> is the full card (name, attribute, level stars, art, type,
// text, ATK/DEF); <MiniCard> is the board and hand version (art and big numbers);
// <CardBack> is the back. Sizes come from the element's width (container units), so a
// card is drawn the same at any size.

export const frameOf = (c) => (!c ? "back" : c.kind === "spell" ? "spell" : c.kind === "trap" ? "trap" : c.sub === "fusion" ? "fusion" : c.sub === "token" ? "token" : c.sub === "normal" ? "normal" : "effect")

const ATTR_GLYPH = {
  FIRE: "M12,3 C16,8 18,11 17,15 C16,19 13,21 12,21 C9,21 6,19 6,15 C6,12 8,10 10,8 C10,11 11,12 12,12 C13,10 13,6 12,3Z",
  WATER: "M12,3 C16,9 18,12 18,15 C18,19 15,21 12,21 C9,21 6,19 6,15 C6,12 8,9 12,3Z",
  EARTH: "M3,19 L9,8 L12,13 L15,6 L21,19Z",
  WIND: "M4,9 Q12,5 16,9 Q18,12 14,13 M4,14 Q14,11 18,15 Q19,19 15,19 M5,19 Q9,17 11,19",
  LIGHT: "M12,4 L13.6,10 L20,12 L13.6,14 L12,20 L10.4,14 L4,12 L10.4,10Z",
  DARK: "M15,4 A8,8 0 1,0 20,15 A7,7 0 0,1 15,4Z",
}

export const AttrOrb = ({ attr, kind }) => {
  const color = kind === "spell" ? "#1f9e86" : kind === "trap" ? "#b0306a" : ATTR_COLORS[attr] || "#777"
  const glyph = kind === "spell" ? "M7,17 L17,7 M12,5 L13,8 M16,11 L19,12 M5,16 L8,15" : kind === "trap" ? "M5,18 L12,5 L19,18Z M12,10 V14 M12,16 V16.5" : ATTR_GLYPH[attr]
  const stroked = kind === "spell" || kind === "trap" || attr === "WIND"
  return (
    <span className="mdOrb" style={{ "--orb": color }} title={kind === "monster" ? attr : kind === "spell" ? "Spell" : "Trap"}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={glyph} fill={stroked ? "none" : "#fff"} stroke={stroked ? "#fff" : "none"} strokeWidth={stroked ? 2.2 : 0} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

const SUB_ICON = {
  quick: "M13,3 L6,13 H11 L10,21 L18,10 H13Z",
  continuous: "M6,12 C6,8 10,8 12,12 C14,16 18,16 18,12 C18,8 14,8 12,12 C10,16 6,16 6,12Z",
  equip: "M12,4 V20 M4,12 H20",
  field: "M3,18 L9,9 L13,14 L16,10 L21,18Z",
  counter: "M7,8 A7,7 0 1,1 6,15 M7,8 L4,6 M7,8 L9,5",
}
const SUB_NAME = { quick: "Quick-Play", continuous: "Continuous", equip: "Equip", field: "Field", counter: "Counter", normal: "" }

export const subLabel = (c) => {
  if (!c) return ""
  if (c.kind === "monster") return `${c.race} / ${c.sub === "fusion" ? "Fusion" : c.sub === "token" ? "Token" : c.sub === "normal" ? "Normal" : "Effect"}`
  return `${SUB_NAME[c.sub] ? `${SUB_NAME[c.sub]} ` : ""}${c.kind === "spell" ? "Spell" : "Trap"}`
}

const Stars = ({ n }) => (
  <span className="mdStars" aria-label={`Level ${n}`}>
    {Array.from({ length: n }, (_, i) => (
      <svg key={i} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="11" fill="#c8301a" stroke="#5a0e04" strokeWidth="1.4" />
        <path d="M12,4 L14.2,9.6 L20,10 L15.4,13.6 L17,19.4 L12,16 L7,19.4 L8.6,13.6 L4,10 L9.8,9.6Z" fill="#ffd34d" />
      </svg>
    ))}
  </span>
)

const RARITY_CLASS = { C: "", R: " is-rare", SR: " is-super", UR: " is-ultra" }

// the full card. id: a card id; stats: { atk, def } now (on the field), shown as changed
const CardImpl = ({ id, stats, className = "", foil = true }) => {
  const c = CARD[id]
  if (!c) return <CardBack className={className} />
  const frame = frameOf(c)
  const atk = stats?.atk ?? c.atk
  const def = stats?.def ?? c.def
  return (
    <div className={`mdCard is-${frame}${foil ? RARITY_CLASS[c.rarity] || "" : ""} ${className}`} data-card={c.id}>
      <div className="mdCardIn">
        <div className="mdCardName">
          <span className="mdCardTitle">{c.name}</span>
          <AttrOrb attr={c.attr} kind={c.kind} />
        </div>
        {c.kind === "monster" ? (
          <div className="mdCardLevel">
            <Stars n={c.level} />
          </div>
        ) : (
          <div className="mdCardLevel is-st">
            <span>
              [{c.kind === "spell" ? "Spell Card" : "Trap Card"}
              {SUB_ICON[c.sub] && (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d={SUB_ICON[c.sub]} fill={c.sub === "quick" || c.sub === "field" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              ]
            </span>
          </div>
        )}
        <div className="mdCardArt">
          <CardArt card={c} />
        </div>
        <div className="mdCardBox">
          <div className="mdCardType">[{subLabel(c)}]</div>
          <div className={`mdCardText${c.sub === "normal" && c.kind === "monster" ? " is-flavor" : ""}${c.text.length > 150 ? " is-long" : ""}`}>{c.text}</div>
          {c.kind === "monster" && (
            <div className="mdCardStats">
              <span className={atk > c.atk ? "is-up" : atk < c.atk ? "is-down" : ""}>ATK/{atk}</span>
              <span className={def > c.def ? "is-up" : def < c.def ? "is-down" : ""}>DEF/{def}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
export const Card = memo(CardImpl)

// the board version: art, a sliver of name, and big ATK / DEF (DEF in front when defending)
const MiniImpl = ({ id, stats, pos, className = "" }) => {
  const c = CARD[id]
  if (!c) return <CardBack className={className} />
  const frame = frameOf(c)
  const atk = stats?.atk ?? c.atk
  const def = stats?.def ?? c.def
  return (
    <div className={`mdMini is-${frame} ${className}`} data-card={c.id}>
      <div className="mdMiniIn">
      <div className="mdMiniArt">
        <CardArt card={c} />
      </div>
      <div className="mdMiniName">{c.name}</div>
      {c.kind === "monster" ? (
        <div className={`mdMiniStats${pos === "def" ? " is-def" : ""}`}>
          <b className={atk > c.atk ? "is-up" : atk < c.atk ? "is-down" : ""}>{atk}</b>
          <i className={def > c.def ? "is-up" : def < c.def ? "is-down" : ""}>{def}</i>
        </div>
      ) : (
        <div className="mdMiniKind">
          <AttrOrb kind={c.kind} />
          <span>{SUB_NAME[c.sub] || (c.kind === "spell" ? "Spell" : "Trap")}</span>
        </div>
      )}
      {c.kind === "monster" && <div className="mdMiniLevel">{"★".repeat(Math.min(c.level, 8))}</div>}
      </div>
    </div>
  )
}
export const MiniCard = memo(MiniImpl)

export const CardBack = ({ className = "" }) => (
  <div className={`mdBack ${className}`}>
    <svg viewBox="0 0 59 86" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <radialGradient id="mdBackG" cx="50%" cy="50%" r="65%">
          <stop offset="0" stopColor="#5b3aa8" />
          <stop offset=".55" stopColor="#24124d" />
          <stop offset="1" stopColor="#0d0620" />
        </radialGradient>
        <linearGradient id="mdBackGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff1b0" />
          <stop offset=".5" stopColor="#d9a520" />
          <stop offset="1" stopColor="#7a5200" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="59" height="86" rx="2.5" fill="#1a0d33" />
      <rect x="2.5" y="2.5" width="54" height="81" rx="1.5" fill="url(#mdBackG)" stroke="url(#mdBackGold)" strokeWidth="1" />
      <g fill="none" stroke="#8f6be0" strokeOpacity=".35" strokeWidth=".5">
        {Array.from({ length: 8 }, (_, i) => (
          <ellipse key={i} cx="29.5" cy="43" rx={6 + i * 3.2} ry={9 + i * 4.4} />
        ))}
      </g>
      <ellipse cx="29.5" cy="43" rx="15" ry="20" fill="#120828" stroke="url(#mdBackGold)" strokeWidth="1.2" />
      <path d="M29.5,27 L33,39 L45,43 L33,47 L29.5,59 L26,47 L14,43 L26,39Z" fill="url(#mdBackGold)" />
      <circle cx="29.5" cy="43" r="4.2" fill="#2a0f55" stroke="#fff1b0" strokeWidth=".6" />
      <circle cx="29.5" cy="43" r="1.8" fill="#ff5ad1" />
      <path d="M6,8 L12,8 M6,8 L6,14 M53,8 L47,8 M53,8 L53,14 M6,78 L12,78 M6,78 L6,72 M53,78 L47,78 M53,78 L53,72" stroke="url(#mdBackGold)" strokeWidth="1" />
    </svg>
  </div>
)

export default Card
