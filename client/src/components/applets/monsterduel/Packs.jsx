import React, { useEffect, useMemo, useRef, useState } from "react"
import { unlock } from "../../../utils/achievements"
import { Card, CardBack } from "./Card"
import CardArt from "./CardArt"
import { CARD, RARITY_NAMES } from "./engine/cards"
import { openPack } from "./storage"

// Monster Duel's card packs: tear one open and five cards spill out face-down; flip them
// one by one (or all at once). Rare cards glow, Super Rares shine, Ultra Rares light up
// the room. Win duels to earn packs.

const COVERS = ["D08", "M12", "S03", "A11", "I13", "W14", "U13", "B13"]
const ORDER = { C: 0, R: 1, SR: 2, UR: 3 }

const PackArt = ({ cover, shake, torn }) => (
  <div className={`mdPack${shake ? " is-shake" : ""}${torn ? " is-torn" : ""}`}>
    <div className="mdPackTop" />
    <div className="mdPackBody">
      <div className="mdPackArt">{CARD[cover] && <CardArt card={CARD[cover]} />}</div>
      <div className="mdPackLogo">
        <span>MONSTER</span>
        <span>DUEL</span>
      </div>
      <div className="mdPackLabel">5 CARDS</div>
    </div>
    <div className="mdPackShine" />
  </div>
)

const Packs = ({ data, setData, sounds, mobile, onBack, onBuilder }) => {
  const [stage, setStage] = useState("idle") // idle | shake | open
  const [cards, setCards] = useState([]) // [{ id, isNew, shown }]
  const [zoom, setZoom] = useState(null)
  const cover = useMemo(() => COVERS[Math.floor(Math.random() * COVERS.length)], [stage === "idle"])
  const timers = useRef([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms))

  const open = () => {
    if (stage !== "idle" || data.packs <= 0) return
    sounds.unlock?.()
    setStage("shake")
    later(() => {
      const res = openPack()
      if (!res) return setStage("idle")
      setData(res.data)
      sounds.rip()
      // the best card last
      const sorted = [...res.cards].sort((a, b) => ORDER[CARD[a.id].rarity] - ORDER[CARD[b.id].rarity])
      setCards(sorted.map((c) => ({ ...c, shown: false })))
      setStage("open")
      if (sorted.some((c) => CARD[c.id].rarity === "UR")) unlock("monsterduel-ultra")
    }, 650)
  }

  const reveal = (i) => {
    setCards((list) => {
      if (list[i]?.shown) return list
      sounds.reveal(CARD[list[i].id].rarity)
      return list.map((c, j) => (j === i ? { ...c, shown: true } : c))
    })
  }
  const revealAll = () => cards.forEach((c, i) => !c.shown && later(() => reveal(i), i * 220))
  const allShown = cards.length > 0 && cards.every((c) => c.shown)

  return (
    <div className={`mdPage mdPacks${mobile ? " is-mobile" : ""}`}>
      <div className="mdPageHead">
        <h2>Card Packs</h2>
        <div className="mdPageBtns">
          <span className="mdPackCount" data-packs={data.packs}>
            {data.packs} unopened
          </span>
          <button type="button" onClick={onBack}>
            Back
          </button>
        </div>
      </div>
      {stage !== "open" ? (
        <div className="mdPackStage">
          {data.packs > 0 ? (
            <>
              <button type="button" className="mdPackBtn" onClick={open} aria-label="Open a pack" data-open>
                <PackArt cover={cover} shake={stage === "shake"} />
              </button>
              <p className="mdPackHint">{stage === "shake" ? "Here it comes..." : mobile ? "Tap the pack to tear it open!" : "Click the pack to tear it open!"}</p>
            </>
          ) : (
            <div className="mdNoPacks">
              <PackArt cover={cover} />
              <p>No packs left. Beat computer opponents to earn more: Easy ones give 1 pack, Normal 2, Hard 3. Online wins give 2.</p>
            </div>
          )}
        </div>
      ) : (
        <div className="mdPackStage is-open">
          <div className="mdPulls">
            {cards.map((c, i) => {
              const card = CARD[c.id]
              return (
                <button
                  key={i}
                  type="button"
                  className={`mdPull is-${card.rarity}${c.shown ? " is-shown" : ""}`}
                  style={{ "--i": i }}
                  onClick={() => (c.shown ? setZoom(c.id) : reveal(i))}
                  data-pull={i}
                  aria-label={c.shown ? card.name : "Face-down card"}
                >
                  <div className="mdPullInner">
                    <div className="mdPullBack">
                      <CardBack />
                    </div>
                    <div className="mdPullFront">
                      <Card id={c.id} />
                    </div>
                  </div>
                  {c.shown && (
                    <span className="mdPullTag">
                      {c.isNew && <b className="mdNew">NEW</b>}
                      <span className={`mdRarity is-${card.rarity}`}>{RARITY_NAMES[card.rarity]}</span>
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <div className="mdPackBtns">
            {!allShown && (
              <button type="button" onClick={revealAll} data-reveal-all>
                Reveal All
              </button>
            )}
            {allShown && data.packs > 0 && (
              <button
                type="button"
                className="mdPrimaryBtn"
                onClick={() => {
                  setCards([])
                  setStage("idle")
                }}
                data-another
              >
                Open Another ({data.packs})
              </button>
            )}
            {allShown && (
              <button type="button" onClick={onBuilder}>
                Deck Builder
              </button>
            )}
            {allShown && data.packs === 0 && (
              <button type="button" onClick={onBack}>
                Done
              </button>
            )}
          </div>
        </div>
      )}
      {zoom && (
        <div className="mdZoomPage" onClick={() => setZoom(null)}>
          <Card id={zoom} />
          <p>Tap anywhere to close</p>
        </div>
      )}
    </div>
  )
}

export default Packs
