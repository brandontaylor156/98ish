import React, { useEffect, useRef, useState } from "react"
import Dialog from "../../shared/Dialog"
import { PAL32 } from "../pinball/pixel.js"
import { AREAS, CRITTERS, TYPES, dexCounts } from "./critters.js"
import { FAMILIES, critterSprite, silhouette } from "./sprites.js"

// The Critter Dex: every critter you've seen or caught, on both tables. Caught ones show in
// color with their Dex line; seen ones as a shadow; the rest as "???". Tap one for its page.

// a sprite on a small canvas, blown up with nearest-neighbour pixels
export const SpriteCanvas = ({ sprite, scale = 2, className = "", label }) => {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    canvas.width = sprite.w
    canvas.height = sprite.h
    const ctx = canvas.getContext("2d")
    const img = ctx.createImageData(sprite.w, sprite.h)
    const buf = new Uint32Array(img.data.buffer)
    sprite.data.forEach((c, i) => (buf[i] = c < 0 ? 0 : PAL32[c]))
    ctx.putImageData(img, 0, 0)
  }, [sprite])
  return <canvas ref={ref} className={`cpSprite ${className}`} style={{ width: sprite.w * scale, height: sprite.h * scale }} role="img" aria-label={label} />
}

const where = (c) => {
  if (c.table === "bonus") return "Bonus stage boss"
  const names = Object.keys(c.areas).map((id) => (AREAS[c.table] || []).find((a) => a.id === id)?.name).filter(Boolean)
  const table = c.table === "ember" ? "Ember Table" : "Tide Table"
  return names.length ? `${table}: ${names.join(", ")}` : `${table}: evolve one to get it`
}

const typeColor = (t) => {
  const fam = FAMILIES[TYPES[t]]
  if (!fam) return undefined
  const v = PAL32[fam[1]]
  return `rgb(${v & 255}, ${(v >>> 8) & 255}, ${(v >>> 16) & 255})`
}

const FILTERS = [
  ["all", "All"],
  ["ember", "Ember"],
  ["tide", "Tide"],
  ["bonus", "Bosses"],
]

const Dex = ({ dex, onClose }) => {
  const [filter, setFilter] = useState("all")
  const [open, setOpen] = useState(null)
  const counts = dexCounts(dex)
  const list = CRITTERS.filter((c) => filter === "all" || c.table === filter)
  const pick = open && CRITTERS.find((c) => c.id === open)
  const pickCaught = pick && dex.caught[pick.id]
  const pickSeen = pick && (dex.seen[pick.id] || pickCaught)
  return (
    <Dialog title="Critter Dex" onOk={onClose} okLabel="Close">
      <div className="cpDex">
        <div className="cpDexTop">
          <span>
            Caught <b data-testid="cp-dex-caught">{counts.caught}</b> of {counts.total} · seen {counts.seen}
          </span>
          <span className="cpDexFilters" role="group" aria-label="Show">
            {FILTERS.map(([id, label]) => (
              <button key={id} type="button" className="cpDexFilter" aria-pressed={filter === id} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </span>
        </div>
        {pick && (
          <div className="cpDexPage" data-testid="cp-dex-page">
            <SpriteCanvas sprite={pickCaught ? critterSprite(pick) : silhouette(critterSprite(pick))} scale={3} label={pickSeen ? pick.name : "Unknown critter"} />
            <div className="cpDexInfo">
              <div className="cpDexName">
                No. {String(pick.no).padStart(3, "0")} {pickSeen ? pick.name : "???"}
              </div>
              {pickSeen && (
                <div className="cpDexTypes">
                  {pick.types.map((t) => (
                    <span key={t} className="cpType" style={{ background: typeColor(t) }}>
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <div className="cpDexWhere">{pickSeen ? where(pick) : "Not seen yet"}</div>
              {pickCaught ? <p className="cpDexDesc">{pick.desc}</p> : pickSeen ? <p className="cpDexDesc">Seen, not caught yet. Catch one to read about it.</p> : null}
              {pickCaught ? <div className="cpDexCount">Caught {pickCaught} time{pickCaught === 1 ? "" : "s"}</div> : null}
              {pick.from && pickSeen && <div className="cpDexEvo">Evolves from {dex.seen[pick.from] || dex.caught[pick.from] ? CRITTERS.find((c) => c.id === pick.from).name : "???"}</div>}
            </div>
          </div>
        )}
        <div className="cpDexGrid">
          {list.map((c) => {
            const caught = dex.caught[c.id]
            const seen = dex.seen[c.id] || caught
            return (
              <button key={c.id} type="button" className={`cpDexCell${caught ? " is-caught" : seen ? " is-seen" : ""}${open === c.id ? " is-open" : ""}`} onClick={() => setOpen(c.id)} aria-label={seen ? c.name : `Number ${c.no}, unknown`}>
                <span className="cpDexNo">{String(c.no).padStart(3, "0")}</span>
                {seen ? <SpriteCanvas sprite={caught ? critterSprite(c) : silhouette(critterSprite(c))} scale={1.5} /> : <span className="cpDexUnknown">?</span>}
                <span className="cpDexCellName">{seen ? c.name : "???"}</span>
              </button>
            )
          })}
        </div>
      </div>
    </Dialog>
  )
}

export default Dex
