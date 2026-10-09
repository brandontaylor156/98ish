// Roam life's on-screen pieces (phone first; the town's grey bevels from roam.css): the 👋 and 💞
// buttons in the top bar (RoamHud's `extra`), the emote tray, the Together sheet, the ask card
// ("Ava wants a hug · Yes / Not now"), the stop chips, and the sheets for shopping, the register,
// your desk's work game, giving a gift and inviting someone in.

import React, { useEffect, useMemo, useState } from "react"
import { EMOTES, TOGETHER_HERE } from "../life/social.js"
import { STORES, cartTotal, itemOf, itemsFor, useVerb } from "../life/catalog.js"
import "./life.css"

// ---------- the top bar's buttons ----------
export function SocialButtons({ state, onEmotes, onTogether }) {
  const who = state?.pal?.name || state?.link?.name || ""
  return (
    <>
      <button type="button" className="roamBtn rlfEmoteBtn" onPointerDown={(e) => e.stopPropagation()} onClick={onEmotes} aria-label="Wave and more" data-life="emotes">
        👋
      </button>
      {who && (
        <button type="button" className="roamBtn rlfTgBtn" onPointerDown={(e) => e.stopPropagation()} onClick={onTogether} aria-label={`Together with ${who}`} data-life="together">
          💞 <small>{who}</small>
        </button>
      )}
    </>
  )
}

// ---------- the overlays: emotes, together, asks, chips, notes ----------
export function SocialLayer({ social, state, rules, open, setOpen }) {
  const kinds = useMemo(() => TOGETHER_HERE.map((id) => rules?.togetherById?.(id)).filter(Boolean), [rules])
  const ask = state?.asks?.[0] || null
  const who = state?.pal?.name || state?.link?.name || ""
  const chips = []
  if (state?.link) chips.push({ kind: state.link.kind, label: state.link.kind === "hand" ? "🤝 Let go" : "👣 Stop", sub: state.link.name })
  if (state?.emote === "dance") chips.push({ kind: "dance", label: "🕺 Stop dancing" })
  if (state?.sitting) chips.push({ kind: "sit", label: "Stand up" })
  return (
    <>
      {open === "emotes" && (
        <div className="rlfTray" data-life="tray" onPointerDown={(e) => e.stopPropagation()}>
          {EMOTES.map((e) => (
            <button key={e.id} type="button" className={`roamBtn rlfEmote${e.id === "wave" ? " is-first" : ""}`} onClick={() => (social.emote(e.id), setOpen(null))} data-life={`emote-${e.id}`}>
              <span aria-hidden="true">{e.icon}</span>
              <small>{e.label}</small>
            </button>
          ))}
        </div>
      )}
      {open === "together" && (
        <div className="roamSheet" onPointerDown={(e) => e.target === e.currentTarget && setOpen(null)} data-life="tg-sheet">
          <div className="roamPanel">
            <div className="roamPanelHead">
              <b>Together with {who}</b>
              <button type="button" className="roamBtn" onClick={() => setOpen(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="roamPanelBody rlfTgGrid">
              {kinds.map((t) => (
                <button key={t.id} type="button" className={`roamBtn rlfTgItem${t.id === "hug" ? " is-big" : ""}`} disabled={!!state?.pending} onClick={() => (social.ask(t.id), setOpen(null))} data-life={`do-${t.id}`}>
                  <span aria-hidden="true">{t.icon}</span> {t.id === "follow" ? `Follow ${who}` : t.label}
                </button>
              ))}
              <small>{who} gets asked first. Either of you can stop any time: just walk away.</small>
            </div>
          </div>
        </div>
      )}
      {ask && (
        <div className="roamPanel rlfAsk" role="alertdialog" data-life="ask" data-kind={ask.kind} onPointerDown={(e) => e.stopPropagation()}>
          <p>
            <span aria-hidden="true">{rules?.togetherById?.(ask.kind)?.icon || "💞"} </span>
            {rules?.togetherById?.(ask.kind)?.ask?.(ask.name) || `${ask.name} asks you`}
          </p>
          <div className="rlfRow">
            <button type="button" className="roamBtn rlfYes" onClick={() => social.answer(ask.id, true)} data-life="yes">
              Yes
            </button>
            <button type="button" className="roamBtn" onClick={() => social.answer(ask.id, false)} data-life="no">
              Not now
            </button>
          </div>
        </div>
      )}
      {chips.length > 0 && (
        <div className="rlfChips" onPointerDown={(e) => e.stopPropagation()}>
          {chips.map((c) => (
            <button key={c.kind} type="button" className="roamBtn" onClick={() => social.stop(c.kind)} data-life={`stop-${c.kind}`}>
              {c.label}
              {c.sub ? <small> {c.sub}</small> : null}
            </button>
          ))}
        </div>
      )}
      {state?.note && !ask && (
        <div className="rlfNote" role="status" data-life="note">
          {state.note}
        </div>
      )}
    </>
  )
}

// ---------- a store's shelf ----------
export function ShopSheet({ store, aisle = null, balance, onAdd, onBuy, onClose, cartCount = 0 }) {
  const s = STORES[store]
  const items = itemsFor(store, aisle)
  const club = store === "club"
  return (
    <div className="roamSheet" onPointerDown={(e) => e.target === e.currentTarget && onClose()} data-life="shop">
      <div className="roamPanel rlfShop">
        <div className="roamPanelHead">
          <b>
            {s?.icon} {s?.name}
            {aisle ? ` · ${aisle}` : ""}
          </b>
          <button type="button" className="roamBtn" onClick={onClose} aria-label="Close" data-life="shop-close">
            ×
          </button>
        </div>
        <div className="roamPanelBody">
          <small>
            {balance} chips · {club ? `${cartCount} in your cart: pay at a register` : "Pay at the counter"}
          </small>
          <ul className="rlfList">
            {items.map((it) => (
              <li key={it.id}>
                <span className="rlfIcon" aria-hidden="true">
                  {it.icon}
                </span>
                <span className="rlfName">
                  <b>{it.name}</b>
                  <small>
                    {it.price} chips{it.pack > 1 ? ` · ${it.pack} in a pack` : ""}
                    {it.note ? ` · ${it.note}` : ""}
                  </small>
                </span>
                <button type="button" className="roamBtn" onClick={() => (club ? onAdd(it.id) : onBuy(it.id))} data-life={`buy-${it.id}`}>
                  {club ? "Add" : "Buy"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

// ---------- the register ----------
export function CheckoutSheet({ cart, me, balance, onRemove, onPay, onClose, msg }) {
  const total = cartTotal(cart)
  return (
    <div className="roamSheet" onPointerDown={(e) => e.target === e.currentTarget && onClose()} data-life="checkout">
      <div className="roamPanel rlfShop">
        <div className="roamPanelHead">
          <b>🧾 Register</b>
          <button type="button" className="roamBtn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="roamPanelBody">
          {cart.length ? (
            <ul className="rlfList">
              {cart.map((x) => {
                const it = itemOf(x.id)
                return (
                  <li key={x.uid}>
                    <span className="rlfIcon">{it?.icon}</span>
                    <span className="rlfName">
                      <b>{it?.name}</b>
                      <small>
                        {it?.price} chips{x.by && x.by !== me ? ` · ${x.by}'s pick` : ""}
                      </small>
                    </span>
                    <button type="button" className="roamBtn" onClick={() => onRemove(x.uid)} aria-label="Put it back">
                      ✕
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p>Your cart is empty. Browse the aisles and tap Add.</p>
          )}
          <p className="rlfTotal">
            Total <b data-life="total">{total}</b> chips · you have {balance}
          </p>
          {cart.some((x) => x.by && x.by !== me) ? <small>You pay for the whole cart; your friend's picks go to them as gifts.</small> : null}
          <button type="button" className="roamBtn roamWide rlfYes" disabled={!cart.length} onClick={onPay} data-life="pay">
            Pay {total} chips
          </button>
          {msg && <p className="rlfMsg" data-life="checkout-msg">{msg}</p>}
        </div>
      </div>
    </div>
  )
}

// ---------- your desk: Inbox Zero (an original little work game) ----------
const MAIL = [
  { from: "Dana", subject: "Stand-up moved to 9:30", kind: "archive" },
  { from: "Prize Desk", subject: "U WON a cruise!!! click here", kind: "spam" },
  { from: "Marcus", subject: "Can you review my change before lunch?", kind: "reply" },
  { from: "Facilities", subject: "Fridge clean-out on Friday", kind: "archive" },
  { from: "Priya", subject: "Quick question about the launch date", kind: "reply" },
  { from: "Royal Treasurer", subject: "Urgent: claim your inheritance", kind: "spam" },
  { from: "June", subject: "Plant duty swap this week?", kind: "reply" },
  { from: "Payroll", subject: "Your timesheet was approved", kind: "archive" },
  { from: "Cheap Watchez", subject: "Luxury watches 90% off", kind: "spam" },
  { from: "Theo", subject: "Who has the conference room remote?", kind: "reply" },
]
export function DeskGame({ onClose, onDone, worked = 0 }) {
  const [list] = useState(() => [...MAIL].sort(() => Math.random() - 0.5).slice(0, 8))
  const [i, setI] = useState(0)
  const [right, setRight] = useState(0)
  const [t0] = useState(() => Date.now())
  const [flash, setFlash] = useState(null)
  const done = i >= list.length
  const secs = Math.round((Date.now() - t0) / 1000)
  useEffect(() => {
    if (done) onDone?.({ right, of: list.length, secs })
  }, [done])
  const sort = (kind) => {
    const ok = list[i].kind === kind
    setRight((r) => r + (ok ? 1 : 0))
    setFlash(ok ? "✓" : "✗")
    setTimeout(() => setFlash(null), 350)
    setI((n) => n + 1)
  }
  return (
    <div className="roamSheet" data-life="desk">
      <div className="roamPanel rlfDesk">
        <div className="roamPanelHead">
          <b>📥 Inbox Zero 98</b>
          <button type="button" className="roamBtn" onClick={onClose} aria-label="Stand up" data-life="desk-close">
            ×
          </button>
        </div>
        <div className="roamPanelBody">
          {done ? (
            <>
              <h4 data-life="desk-done">Inbox zero!</h4>
              <p>
                {right} of {list.length} sorted right in {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}.
              </p>
              <small>Time worked today: {Math.floor(worked / 60)} min. Clock out at the time clock by the door.</small>
              <button type="button" className="roamBtn roamWide" onClick={onClose}>
                Back to the office
              </button>
            </>
          ) : (
            <>
              <small>
                {list.length - i} left · {right} right {flash ? <b className="rlfFlash">{flash}</b> : null}
              </small>
              <div className="rlfMail" data-life="mail">
                <small>From: {list[i].from}</small>
                <b>{list[i].subject}</b>
              </div>
              <div className="rlfRow">
                <button type="button" className="roamBtn" onClick={() => sort("reply")} data-life="mail-reply">
                  ↩ Reply
                </button>
                <button type="button" className="roamBtn" onClick={() => sort("archive")} data-life="mail-archive">
                  🗄 Archive
                </button>
                <button type="button" className="roamBtn" onClick={() => sort("spam")} data-life="mail-spam">
                  🚫 Spam
                </button>
              </div>
              <small>Reply to people who asked you something, archive news, junk the spam.</small>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------- give one of your things ----------
export function GiftSheet({ item, buddies = [], onGive, onClose, msg }) {
  const it = itemOf(item)
  const [to, setTo] = useState(buddies.find((b) => b.online)?.name || buddies[0]?.name || "")
  const [note, setNote] = useState("")
  return (
    <div className="roamSheet" onPointerDown={(e) => e.target === e.currentTarget && onClose()} data-life="gift">
      <div className="roamPanel">
        <div className="roamPanelHead">
          <b>
            🎁 Give {it?.icon} {it?.name}
          </b>
          <button type="button" className="roamBtn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="roamPanelBody">
          {buddies.length ? (
            <>
              <div className="rlfTo">
                {buddies.slice(0, 8).map((b) => (
                  <button key={b.name} type="button" className={`roamBtn${b.name === to ? " is-on" : ""}`} onClick={() => setTo(b.name)} data-life={`gift-to-${b.name}`}>
                    {b.online ? "● " : ""}
                    {b.name}
                  </button>
                ))}
              </div>
              <input className="rlfInput" value={note} onChange={(e) => setNote(e.target.value.slice(0, 140))} placeholder="A note (optional)" data-life="gift-note" />
              <button type="button" className="roamBtn roamWide rlfYes" disabled={!to} onClick={() => onGive(to, note)} data-life="gift-give">
                Give it to {to || "..."}
              </button>
            </>
          ) : (
            <p>Sign on to 98 Messenger and add a buddy to give gifts.</p>
          )}
          {msg && <p className="rlfMsg" data-life="gift-msg">{msg}</p>}
        </div>
      </div>
    </div>
  )
}

// ---------- invite someone into your home or office ----------
export function InviteSheet({ people = [], onInvite, onClose, place }) {
  return (
    <div className="roamSheet" onPointerDown={(e) => e.target === e.currentTarget && onClose()} data-life="invite">
      <div className="roamPanel">
        <div className="roamPanelHead">
          <b>Invite someone to {place}</b>
          <button type="button" className="roamBtn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="roamPanelBody">
          {people.length ? (
            people.map((p) => (
              <button key={p.num} type="button" className="roamBtn roamWide" onClick={() => onInvite(p)} data-life={`invite-${p.name}`}>
                Invite {p.name}
              </button>
            ))
          ) : (
            <p>Nobody else is in town right now. Your friend joins Explore in the same town, then you invite them.</p>
          )}
          <small>Only the people you invite can come in. Your place stays private on everyone else's map.</small>
        </div>
      </div>
    </div>
  )
}

// a little card: what the Bag can do with a thing
export const verbOf = (id) => useVerb(itemOf(id))
