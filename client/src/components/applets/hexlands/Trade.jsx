import React, { useEffect, useState } from "react"
import { RES, RES_INFO, cardsText, hasAll, ratios } from "./logic.js"
import { ResSvg } from "./art.jsx"
import { Avatar, colorOf } from "./Panels.jsx"

// Trading: with other players (offer, see who accepts or counters, complete it) and with
// the bank (4:1, or your harbors' 3:1 and 2:1). IncomingOffer is someone else's offer to
// you: accept, decline or counter.

const clean = (cards) => Object.fromEntries(Object.entries(cards).filter(([, n]) => n > 0))
const count = (cards) => Object.values(cards).reduce((a, b) => a + b, 0)

// five resource steppers. max: { res: n } or a number for all
export const CardPicker = ({ value, onChange, max = 9, label, dataKey, disabledRes = [] }) => (
  <div className="hxPicker" data-picker={dataKey}>
    {label && <div className="hxPickerLabel">{label}</div>}
    <div className="hxPickerRow">
      {RES.map((r) => {
        const cap = typeof max === "number" ? max : max[r] || 0
        const n = value[r] || 0
        const off = disabledRes.includes(r)
        return (
          <div key={r} className={`hxPick hx-${r}${n ? " is-on" : ""}${off ? " is-off" : ""}`} data-res={r}>
            <button type="button" className="hxPickUp" aria-label={`More ${r}`} disabled={off || n >= cap} onClick={() => onChange({ ...value, [r]: n + 1 })}>
              <ResSvg r={r} size={24} />
              <b>{n}</b>
            </button>
            <button type="button" className="hxPickDown" aria-label={`Less ${r}`} disabled={n <= 0} onClick={() => onChange({ ...value, [r]: n - 1 })}>
              −
            </button>
            {typeof max !== "number" && <small>of {cap}</small>}
          </div>
        )
      })}
    </div>
  </div>
)

const Terms = ({ give, get }) => (
  <span className="hxTerms">
    <span className="hxTermsSide">
      {Object.entries(give).map(([r, n]) => (
        <span key={r} className="hxTermChip">
          {n}
          <ResSvg r={r} size={16} />
        </span>
      ))}
    </span>
    <span className="hxTermsArrow">⇄</span>
    <span className="hxTermsSide">
      {Object.entries(get).map(([r, n]) => (
        <span key={r} className="hxTermChip">
          {n}
          <ResSvg r={r} size={16} />
        </span>
      ))}
    </span>
  </span>
)

// ---------- the trade panel (your turn) ----------

export const TradePanel = ({ view, names, act, canTrade, onClose, initialTab = "players" }) => {
  const me = view.you
  const hand = view.players[me].hand
  const [tab, setTab] = useState(initialTab)
  const [give, setGive] = useState({})
  const [get, setGet] = useState({})
  const others = view.players.map((_, i) => i).filter((i) => i !== me)
  const [to, setTo] = useState(others)
  const [err, setErr] = useState(null)
  const offer = view.trade && view.trade.from === me ? view.trade : null
  const send = async (a) => {
    setErr(null)
    const r = await act(a)
    if (!r?.ok) setErr(r?.error || "That didn't work.")
    return r
  }
  const overlap = Object.keys(clean(give)).some((r) => clean(get)[r])
  const ready = canTrade && count(clean(give)) > 0 && count(clean(get)) > 0 && !overlap && to.length > 0

  return (
    <div className="hxTrade">
      <div className="hxTabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "players"} className={tab === "players" ? "is-on" : ""} onClick={() => setTab("players")} data-tab="players">
          With players
        </button>
        <button type="button" role="tab" aria-selected={tab === "bank"} className={tab === "bank" ? "is-on" : ""} onClick={() => setTab("bank")} data-tab="bank">
          With the bank
        </button>
        {onClose && (
          <button type="button" className="hxClose" onClick={onClose} aria-label="Close trading">
            ✕
          </button>
        )}
      </div>
      {!canTrade && <p className="hxMuted">{view.phase === "roll" && view.turn === me ? "Roll the dice first, then trade." : "You can trade on your own turn, after rolling."}</p>}
      {tab === "players" && offer && (
        <div className="hxOffer" data-my-offer={offer.id}>
          <div className="hxOfferHead">
            Your offer: <Terms give={offer.give} get={offer.get} />
          </div>
          <div className="hxReplies">
            {offer.to.map((p) => {
              const r = offer.replies[p]
              const c = view.players[p]
              return (
                <div key={p} className={`hxReply is-${r?.a || "wait"}`} data-reply={p}>
                  <Avatar color={c.color} size={24} />
                  <span className="hxReplyName">{names[p] || c.name}</span>
                  {!r && <span className="hxMuted">thinking...</span>}
                  {r?.a === "decline" && <span className="hxMuted">no thanks</span>}
                  {r?.a === "accept" && (
                    <button type="button" className="hxGo" onClick={() => send({ type: "confirm", id: offer.id, with: p })} disabled={!hasAll(hand, offer.give)} data-confirm={p}>
                      Trade!
                    </button>
                  )}
                  {r?.a === "counter" && (
                    <>
                      <Terms give={r.give} get={r.get} />
                      <button type="button" className="hxGo" onClick={() => send({ type: "confirm", id: offer.id, with: p })} disabled={!hasAll(hand, r.give)} data-confirm={p}>
                        Accept
                      </button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
          <div className="hxRow">
            <button type="button" onClick={() => send({ type: "cancel", id: offer.id })} data-cancel-offer>
              Cancel offer
            </button>
          </div>
        </div>
      )}
      {tab === "players" && !offer && (
        <form
          className="hxTradeForm"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!ready) return
            const r = await send({ type: "offer", give: clean(give), get: clean(get), to })
            if (r?.ok) {
              setGive({})
              setGet({})
            }
          }}
        >
          <CardPicker label="You give" value={give} onChange={setGive} max={hand} dataKey="give" />
          <CardPicker label="You want" value={get} onChange={setGet} max={9} dataKey="get" disabledRes={Object.keys(clean(give))} />
          <div className="hxTo">
            <span>Offer to</span>
            {others.map((p) => (
              <label key={p} className={`hxToChip${to.includes(p) ? " is-on" : ""}`} style={{ "--c": colorOf(view.players[p].color).fill }}>
                <input type="checkbox" checked={to.includes(p)} onChange={(e) => setTo(e.target.checked ? [...to, p] : to.filter((x) => x !== p))} />
                {names[p] || view.players[p].name}
                <small>{view.players[p].cards} cards</small>
              </label>
            ))}
          </div>
          {overlap && <p className="hxWarn">You can't give and get the same resource.</p>}
          <div className="hxRow">
            <button type="submit" className="hxGo" disabled={!ready} data-make-offer>
              Make offer
            </button>
          </div>
        </form>
      )}
      {tab === "bank" && <BankTrade view={view} send={send} canTrade={canTrade} />}
      {err && <p className="hxWarn">{err}</p>}
    </div>
  )
}

const BankTrade = ({ view, send, canTrade }) => {
  const me = view.you
  const hand = view.players[me].hand
  const rate = ratios(view, me)
  const [give, setGive] = useState(null)
  const [get, setGet] = useState(null)
  const can = give && get && give !== get && hand[give] >= rate[give] && view.bank[get] > 0
  return (
    <div className="hxBank">
      <div className="hxBankCol">
        <div className="hxPickerLabel">Give</div>
        {RES.map((r) => (
          <button key={r} type="button" className={`hxBankRes hx-${r}${give === r ? " is-on" : ""}`} disabled={hand[r] < rate[r]} onClick={() => setGive(r)} data-bank-give={r}>
            <ResSvg r={r} size={22} />
            <b>{rate[r]}:1</b>
            <small>you have {hand[r]}</small>
          </button>
        ))}
      </div>
      <div className="hxBankArrow">→</div>
      <div className="hxBankCol">
        <div className="hxPickerLabel">Get 1</div>
        {RES.map((r) => (
          <button key={r} type="button" className={`hxBankRes hx-${r}${get === r ? " is-on" : ""}`} disabled={r === give || view.bank[r] < 1} onClick={() => setGet(r)} data-bank-get={r}>
            <ResSvg r={r} size={22} />
            <b>{RES_INFO[r].label}</b>
            <small>bank has {view.bank[r]}</small>
          </button>
        ))}
      </div>
      <div className="hxRow hxBankGo">
        <button type="button" className="hxGo" disabled={!canTrade || !can} onClick={async () => (await send({ type: "bank", give, get }))?.ok && setGet(null)} data-bank-trade>
          {can ? `Trade ${rate[give]} ${give} for 1 ${get}` : "Pick what to give and get"}
        </button>
      </div>
      <p className="hxMuted">Settle on a harbor's corner for better rates: 3:1 for any resource, or 2:1 for its own.</p>
    </div>
  )
}

// ---------- someone else's offer to you ----------

export const IncomingOffer = ({ view, names, act }) => {
  const t = view.trade
  const me = view.you
  const [counter, setCounter] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    setCounter(null)
    setErr(null)
  }, [t?.id])
  if (!t || t.from === me || !t.to.includes(me) || view.phase !== "main") return null
  const mine = t.replies[me]
  const hand = view.players[me].hand
  const from = names[t.from] || view.players[t.from].name
  const send = async (a) => {
    setErr(null)
    const r = await act(a)
    if (!r?.ok) setErr(r?.error || "That didn't work.")
    else setCounter(null)
  }
  if (mine)
    return (
      <div className="hxIncoming is-slim" data-incoming={t.id} style={{ "--c": colorOf(view.players[t.from].color).fill }}>
        <Avatar color={view.players[t.from].color} size={20} />
        <span data-replied={mine.a}>{mine.a === "accept" ? `You accepted. Waiting for ${from}...` : mine.a === "counter" ? `You countered. Waiting for ${from}...` : `You said no to ${from}.`}</span>
      </div>
    )
  return (
    <div className="hxIncoming" data-incoming={t.id} style={{ "--c": colorOf(view.players[t.from].color).fill }}>
      <div className="hxIncomingHead">
        <Avatar color={view.players[t.from].color} size={26} />
        <span>
          <b>{from}</b> offers
        </span>
      </div>
      <div className="hxIncomingTerms">
        <span>
          You get <b>{cardsText(t.give)}</b>
        </span>
        <span>
          You give <b>{cardsText(t.get)}</b>
        </span>
      </div>
      {counter ? (
        <div className="hxCounter">
          <CardPicker label={`${from} gives you`} value={counter.give} onChange={(give) => setCounter({ ...counter, give })} max={9} dataKey="counter-give" />
          <CardPicker label="You give" value={counter.get} onChange={(get) => setCounter({ ...counter, get })} max={hand} dataKey="counter-get" />
          <div className="hxRow">
            <button type="button" className="hxGo" disabled={!count(clean(counter.give)) || !count(clean(counter.get))} onClick={() => send({ type: "reply", id: t.id, answer: "counter", give: clean(counter.give), get: clean(counter.get) })} data-send-counter>
              Send counter
            </button>
            <button type="button" onClick={() => setCounter(null)}>
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="hxRow">
          <button type="button" className="hxGo" disabled={!hasAll(hand, t.get)} onClick={() => send({ type: "reply", id: t.id, answer: "accept" })} data-accept title={hasAll(hand, t.get) ? "" : "You don't have those cards"}>
            Accept
          </button>
          <button type="button" onClick={() => send({ type: "reply", id: t.id, answer: "decline" })} data-decline>
            Decline
          </button>
          <button type="button" onClick={() => setCounter({ give: { ...t.give }, get: { ...t.get } })} data-counter>
            Counter...
          </button>
        </div>
      )}
      {err && <p className="hxWarn">{err}</p>}
    </div>
  )
}

