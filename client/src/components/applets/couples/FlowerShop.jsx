import React, { useEffect, useState } from "react"
import { coupleApi, refreshCoupleThings } from "../../../utils/couple"
import { Bouquet, FLOWERS, FlowerIcon, RIBBONS, VASES } from "./art"
import { playLoveChime, useNow, dateLabel } from "./shared"
import { wiltOf } from "./wilt"

// Send Flowers: pick up to a dozen flowers, a vase, a ribbon and a card. The bouquet
// appears on your partner's desktop and slowly wilts unless they water it each day.

const MAX = 12

const SentBouquet = ({ bouquet, now }) => {
  const wilt = wiltOf(bouquet, now)
  const watered = bouquet.waterDays.length
  return (
    <div className="usSent">
      <Bouquet stems={bouquet.stems} vase={bouquet.vase} ribbon={bouquet.ribbon} wilt={wilt.level} className="usSentArt" idPrefix={`sent${bouquet.id}`} />
      <div>
        <div>{dateLabel(bouquet.sentAt, false)}</div>
        <div className="usSmall">{wilt.label}</div>
        <div className="usSmall">{watered ? `Watered ${watered} ${watered === 1 ? "day" : "days"}` : "Not watered yet"}</div>
      </div>
    </div>
  )
}

const FlowerShop = ({ couple, onBack }) => {
  const [stems, setStems] = useState(["rose", "rose", "rose", "tulip", "daisy"])
  const [vase, setVase] = useState("glass")
  const [ribbon, setRibbon] = useState("red")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [sent, setSent] = useState(null)
  const now = useNow(60_000)

  const count = (kind) => stems.filter((s) => s === kind).length
  const add = (kind) => stems.length < MAX && setStems([...stems, kind])
  const remove = (kind) => {
    const i = stems.lastIndexOf(kind)
    if (i >= 0) setStems(stems.filter((_, j) => j !== i))
  }

  const send = async () => {
    setBusy(true)
    setMessage(null)
    const result = await coupleApi("POST", "/flowers", { bouquet: { stems, vase, ribbon, note } })
    setBusy(false)
    if (!result.ok) return setMessage({ error: true, text: result.error })
    playLoveChime("arrive")
    setMessage({ text: `Delivered to ${couple.partner}'s desktop! ♥` })
    setNote("")
    loadSent()
  }

  const loadSent = () => coupleApi("GET", "/flowers").then((r) => r.ok && setSent(r.sent))
  useEffect(() => {
    loadSent()
    refreshCoupleThings()
  }, [])

  return (
    <div className="usPanel usShop">
      <div className="usPanelHead">
        <button type="button" onClick={onBack}>
          ‹ Back
        </button>
        <h2>Send Flowers to {couple.partner}</h2>
      </div>
      <div className="usShopBody">
        <div className="usShopPreview">
          <Bouquet stems={stems} vase={vase} ribbon={ribbon} className="usShopArt" idPrefix="shop" />
          {note.trim() && <div className="usCard">{note}</div>}
        </div>
        <div className="usShopControls">
          <fieldset>
            <legend>Flowers ({stems.length}/{MAX})</legend>
            <div className="usFlowerPicks">
              {FLOWERS.map((f) => (
                <div key={f.id} className="usFlowerPick">
                  <FlowerIcon kind={f.id} size={30} />
                  <span className="usFlowerName">{f.label}</span>
                  <span className="usStepper">
                    <button type="button" aria-label={`One less ${f.label}`} disabled={!count(f.id)} onClick={() => remove(f.id)}>
                      −
                    </button>
                    <span className="usCount">{count(f.id)}</span>
                    <button type="button" aria-label={`One more ${f.label}`} disabled={stems.length >= MAX} onClick={() => add(f.id)}>
                      +
                    </button>
                  </span>
                </div>
              ))}
            </div>
            <div className="usQuick">
              <button type="button" onClick={() => setStems(Array(12).fill("rose"))}>
                A dozen roses
              </button>
              <button type="button" onClick={() => setStems(["sunflower", "daisy", "tulip", "lily", "rose", "daisy", "tulip"])}>
                Wildflower mix
              </button>
            </div>
          </fieldset>
          <fieldset>
            <legend>Vase</legend>
            <div className="usChoices">
              {VASES.map((v) => (
                <button key={v.id} type="button" className={vase === v.id ? "usChoice is-on" : "usChoice"} aria-pressed={vase === v.id} onClick={() => setVase(v.id)}>
                  {v.label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Ribbon</legend>
            <div className="usSwatches">
              {Object.entries(RIBBONS).map(([id, color]) => (
                <button key={id} type="button" className={ribbon === id ? "usSwatch is-on" : "usSwatch"} style={{ background: color }} aria-label={`${id} ribbon`} aria-pressed={ribbon === id} onClick={() => setRibbon(id)} />
              ))}
            </div>
          </fieldset>
          <label htmlFor="us-card">Card:</label>
          <textarea id="us-card" className="usInput" rows={3} maxLength={200} value={note} placeholder="Just because I love you" onChange={(e) => setNote(e.target.value)} />
          <button type="button" className="usPrimary" disabled={busy || !stems.length} onClick={send}>
            {busy ? "Sending..." : "Send bouquet ♥"}
          </button>
          {message && <p className={message.error ? "usError" : "usOk"}>{message.text}</p>}
        </div>
      </div>
      {sent?.length > 0 && (
        <fieldset className="usSentList">
          <legend>Flowers you've sent</legend>
          {sent.slice(0, 4).map((b) => (
            <SentBouquet key={b.id} bouquet={b} now={now} />
          ))}
        </fieldset>
      )}
    </div>
  )
}

export default FlowerShop
