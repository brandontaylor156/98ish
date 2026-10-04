import React, { useEffect, useMemo, useState } from "react"
import { VIEW_EVENT, coupleApi, refreshCoupleThings, serverNow, useCouple } from "../../../utils/couple"
import { unlock } from "../../../utils/achievements"
import Dialog from "../../shared/Dialog"
import MoreOptions from "../../shared/MoreOptions"
import { summarize } from "../../../utils/disclosure"
import { ENVELOPE_COLORS, Envelope, FONTS, Heart, STATIONERY, Seal } from "./art"
import { AddPhoto, NotPaired, countdown, dateLabel, nextAnniversary, playLoveChime, useCoupleEvent, useNow } from "./shared"
import { reducedMotion } from "../../../utils/settings"
import "./LoveLetters.css"

// Love Letters: write a letter on pretty stationery, seal it in an envelope and send it
// now, on a date ("open on our anniversary"), as an "Open when..." letter, or as a
// countdown (a letter a day). Sealed letters show a countdown; the server doesn't hand
// over a word of them before their time. Opening one breaks the wax seal.

const OPEN_WHEN = ["you miss me", "you're sad", "you can't sleep", "you need a laugh", "it's your birthday", "we had a fight"]

// ---- the envelope cards ----

const statusLine = (letter, now) => {
  if (letter.locked) return { text: `Opens in ${countdown(letter.unlockAt - now)}`, tone: "locked" }
  if (letter.mine) {
    if (letter.openedAt) return { text: `Opened ${dateLabel(letter.openedAt)}`, tone: "read" }
    if (letter.unlockAt > now) return { text: `Sealed until ${dateLabel(letter.unlockAt)}`, tone: "locked" }
    return { text: "Not opened yet", tone: "" }
  }
  if (letter.delivery === "openwhen" && !letter.openedAt) return { text: "Open whenever you need it", tone: "when" }
  if (!letter.openedAt) return { text: "New! ♥", tone: "new" }
  return { text: `Opened ${dateLabel(letter.openedAt, false)}`, tone: "read" }
}

const EnvelopeCard = ({ letter, now, onOpen }) => {
  const [shake, setShake] = useState(false)
  const status = statusLine(letter, now)
  const sealed = !letter.openedAt
  return (
    <button
      type="button"
      className={`llCard${shake ? " is-shaking" : ""}${letter.locked ? " is-locked" : ""}`}
      onClick={() => {
        if (letter.locked) {
          setShake(true)
          setTimeout(() => setShake(false), 600)
        } else onOpen(letter)
      }}
      aria-label={`${letter.title}. ${status.text}`}
    >
      {letter.delivery === "openwhen" && <span className="llWhen">Open when {letter.label}</span>}
      {letter.seriesTotal && <span className="llWhen">Day {letter.seriesIndex} of {letter.seriesTotal}</span>}
      <Envelope color={letter.envelope} sealed={sealed} opened={!sealed} className="llCardArt" title={letter.title} />
      <span className="llCardTitle">{letter.title}</span>
      <span className="llCardMeta">{letter.mine ? `To ${letter.to}` : `From ${letter.from}`}</span>
      <span className={`llStatus is-${status.tone}`}>
        {letter.locked && <span className="llLock" aria-hidden="true" />}
        {status.text}
      </span>
      {letter.favorite && <span className="llFav" aria-label="Favorite">♥</span>}
    </button>
  )
}

// ---- opening: the seal pops, the flap lifts, the letter slides out ----

const Opening = ({ letter, onDone }) => {
  const c = ENVELOPE_COLORS[letter.envelope] || ENVELOPE_COLORS.rose
  useEffect(() => {
    playLoveChime("open")
    const reduced = reducedMotion()
    const t = setTimeout(onDone, reduced ? 400 : 2700)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="llOpening" onClick={onDone} style={{ "--env": c.body, "--flap": c.flap, "--fold": c.fold }} role="presentation">
      <div className="llEnv">
        <div className="llEnvBack" />
        <div className={`llPaper llPaper-${letter.stationery}`}>
          <i />
          <i />
          <i />
        </div>
        <div className="llEnvFront" />
        <div className="llFlap" />
        <svg className="llSeal" viewBox="-14 -14 28 28" aria-hidden="true">
          <Seal x={0} y={0} r={12} />
        </svg>
      </div>
      <div className="llBurst" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <svg key={i} viewBox="-10 -10 20 20" style={{ "--dx": `${(i - 4.5) * 26}px`, "--delay": `${0.9 + (i % 5) * 0.12}s` }}>
            <Heart fill={i % 2 ? "#ff9fb7" : "#e8405f"} />
          </svg>
        ))}
      </div>
    </div>
  )
}

// ---- reading ----

const LetterView = ({ letter, onBack, onFavorite, onDelete }) => (
  <div className="llRead">
    <div className="llReadBar">
      <button type="button" onClick={onBack}>
        ‹ Back
      </button>
      <button type="button" className={letter.favorite ? "llHeartBtn is-on" : "llHeartBtn"} aria-pressed={letter.favorite} onClick={onFavorite} title={letter.favorite ? "Favorite" : "Add to favorites"}>
        {letter.favorite ? "♥ Favorite" : "♡ Favorite"}
      </button>
      {(letter.mine || letter.openedAt) && (
        <button type="button" onClick={onDelete}>
          Delete...
        </button>
      )}
    </div>
    <div className="llReadScroll">
      <article className={`llSheet llStationery-${letter.stationery} llFont-${letter.font}`}>
        {letter.delivery === "openwhen" && <div className="llSheetWhen">Open when {letter.label}</div>}
        {letter.seriesTotal && <div className="llSheetWhen">Day {letter.seriesIndex} of {letter.seriesTotal}</div>}
        <h2 className="llSheetTitle">{letter.title}</h2>
        <div className="llSheetDate">{dateLabel(Math.max(letter.sentAt, letter.unlockAt), false)}</div>
        <div className="llSheetText">{letter.text}</div>
        {letter.photo && <img className="llSheetPhoto" src={letter.photo} alt="" />}
        <div className="llSheetSign">With love, {letter.from}</div>
      </article>
      <div className="llReceipt">
        {letter.mine
          ? letter.openedAt
            ? `${letter.to} opened this on ${dateLabel(letter.openedAt)} ♥`
            : letter.unlockAt > serverNow()
              ? `Sealed until ${dateLabel(letter.unlockAt)}`
              : `${letter.to} hasn't opened it yet`
          : `Sent ${dateLabel(letter.sentAt)}${letter.openedAt ? ` · opened ${dateLabel(letter.openedAt)}` : ""}`}
      </div>
    </div>
  </div>
)

// ---- writing ----

const blankPage = () => ({ title: "", text: "" })

const DELIVERY = [
  ["now", "Deliver now"],
  ["date", "Open on a date"],
  ["openwhen", "Open when..."],
  ["series", "Countdown (a letter a day)"],
]

const Compose = ({ couple, onSent }) => {
  const [title, setTitle] = useState("")
  const [text, setText] = useState("")
  const [stationery, setStationery] = useState("parchment")
  const [font, setFont] = useState("script")
  const [envelope, setEnvelope] = useState("rose")
  const [photo, setPhoto] = useState(null)
  const [delivery, setDelivery] = useState("now")
  const [when, setWhen] = useState("")
  const [label, setLabel] = useState(OPEN_WHEN[0])
  const [days, setDays] = useState(7)
  const [pages, setPages] = useState(() => Array.from({ length: 14 }, blankPage))
  const [page, setPage] = useState(0)
  const [startTomorrow, setStartTomorrow] = useState(false)
  const [anniversary, setAnniversary] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [flying, setFlying] = useState(false)

  useEffect(() => {
    coupleApi("GET", "/story").then((r) => r.ok && r.story.togetherSince && setAnniversary(r.story.togetherSince))
  }, [])

  const local = (time) => {
    const d = new Date(time)
    const pad = (n) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const series = delivery === "series"
  const current = series ? pages[page] : { title, text }
  const setCurrent = (patch) => {
    if (series) setPages(pages.map((p, i) => (i === page ? { ...p, ...patch } : p)))
    else {
      if (patch.title !== undefined) setTitle(patch.title)
      if (patch.text !== undefined) setText(patch.text)
    }
  }
  const ready = series ? pages.slice(0, days).every((p) => p.text.trim()) : text.trim() && (delivery !== "date" || when) && (delivery !== "openwhen" || label.trim())

  const send = async () => {
    setBusy(true)
    setError(null)
    const style = { stationery, font, envelope }
    let body
    if (series) {
      const start = new Date(serverNow())
      if (startTomorrow) start.setHours(24 + 8, 0, 0, 0)
      body = { series: { startAt: startTomorrow ? start.getTime() : serverNow(), letters: pages.slice(0, days).map((p, i) => ({ ...style, title: p.title || `Day ${i + 1}`, text: p.text })) } }
    } else {
      body = { letter: { ...style, title, text, photo, delivery, unlockAt: delivery === "date" ? new Date(when).getTime() : undefined, label: delivery === "openwhen" ? label : undefined } }
    }
    const result = await coupleApi("POST", "/letters", body)
    setBusy(false)
    if (!result.ok) return setError(result.error)
    unlock("sealed-kiss")
    setFlying(true)
    playLoveChime("arrive")
    setTimeout(() => onSent(), 1300)
  }

  if (flying)
    return (
      <div className="llFlying">
        <Envelope color={envelope} className="llFlyingArt" />
        <p>Sealed with a kiss and on its way to {couple.partner}! ♥</p>
      </div>
    )

  return (
    <div className="llCompose">
      <div className="llComposeTo">
        To: <b>{couple.partner}</b>
      </div>
      <div className={`llSheet llEditing llStationery-${stationery} llFont-${font}`}>
        <input className="llTitleInput" value={current.title} maxLength={80} placeholder={series ? `Day ${page + 1}` : "A letter for you"} onChange={(e) => setCurrent({ title: e.target.value })} aria-label="Title" />
        <textarea className="llTextInput" value={current.text} maxLength={5000} placeholder={series ? `What should ${couple.partner} read on day ${page + 1}?` : `Dear ${couple.partner},`} onChange={(e) => setCurrent({ text: e.target.value })} aria-label="Your letter" />
        {photo && !series && (
          <div className="llPhotoWrap">
            <img className="llSheetPhoto" src={photo} alt="" />
            <button type="button" onClick={() => setPhoto(null)}>
              Remove photo
            </button>
          </div>
        )}
        <div className="llSheetSign">With love, {couple.me}</div>
      </div>

      <div className="llComposeBar">
        {!series && <AddPhoto label={photo ? "Change photo" : "Add a photo"} onPhoto={setPhoto} onError={setError} />}
        <button type="button" className="usPrimary llSend" disabled={busy || !ready} onClick={send}>
          {busy ? "Sealing..." : series ? `Seal ${days} letters ♥` : "Seal & send ♥"}
        </button>
      </div>
      {/* the baseline (docs/simplicity.md): the letter and Seal & send; delivery (a date, open
          when..., a countdown) and the paper, envelope and handwriting under More options */}
      <MoreOptions id="loveletters.compose" className="llMore" summary={summarize(DELIVERY.find(([id]) => id === delivery)?.[1], `${STATIONERY.find((x) => x.id === stationery)?.label || stationery} paper`, `${ENVELOPE_COLORS[envelope]?.label || envelope} envelope`, FONTS.find((f) => f.id === font)?.label)} forceOpen={delivery !== "now"}>
        <fieldset className="llDelivery">
          <legend>Delivery</legend>
          <div className="llDeliveryGrid">
            {DELIVERY.map(([id, text]) => (
              <div className="field-row" key={id}>
                <input id={`ll-d-${id}`} type="radio" name="ll-delivery" checked={delivery === id} onChange={() => setDelivery(id)} />
                <label htmlFor={`ll-d-${id}`}>{text}</label>
              </div>
            ))}
            {delivery === "date" && (
              <div className="llDeliveryMore">
                <input type="datetime-local" className="usInput" value={when} min={local(serverNow())} onChange={(e) => setWhen(e.target.value)} aria-label="Opens on" />
                <span className="llQuick">
                  {anniversary && (
                    <button type="button" onClick={() => setWhen(local(nextAnniversary(anniversary)))}>
                      Our anniversary ♥
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date(serverNow())
                      d.setHours(24 + 8, 0, 0, 0)
                      setWhen(local(d.getTime()))
                    }}
                  >
                    Tomorrow morning
                  </button>
                </span>
              </div>
            )}
            {delivery === "openwhen" && (
              <div className="llDeliveryMore">
                <div className="llChips">
                  {OPEN_WHEN.map((w) => (
                    <button key={w} type="button" className={label === w ? "llChip is-on" : "llChip"} onClick={() => setLabel(w)}>
                      {w}
                    </button>
                  ))}
                </div>
                <label className="llWhenLabel">
                  Open when <input className="usInput" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
                </label>
              </div>
            )}
            {delivery === "series" && (
              <div className="llDeliveryMore">
                <label>
                  Letters:{" "}
                  <select value={days} onChange={(e) => (setDays(Number(e.target.value)), setPage(Math.min(page, Number(e.target.value) - 1)))}>
                    {Array.from({ length: 13 }, (_, i) => i + 2).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="field-row">
                  <input id="ll-tomorrow" type="checkbox" checked={startTomorrow} onChange={(e) => setStartTomorrow(e.target.checked)} />
                  <label htmlFor="ll-tomorrow">First one opens tomorrow morning (otherwise today)</label>
                </div>
                <div className="llPages" role="tablist">
                  {Array.from({ length: days }, (_, i) => (
                    <button key={i} type="button" role="tab" aria-selected={page === i} className={`llPage${page === i ? " is-on" : ""}${pages[i].text.trim() ? " is-done" : ""}`} onClick={() => setPage(i)}>
                      Day {i + 1}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </fieldset>

        <div className="llLooks">
          <div className="llLook">
            <span>Paper</span>
            <div className="llPapers">
              {STATIONERY.map((s) => (
                <button key={s.id} type="button" className={`llPaperPick llStationery-${s.id}${stationery === s.id ? " is-on" : ""}`} title={s.label} aria-label={s.label} aria-pressed={stationery === s.id} onClick={() => setStationery(s.id)} />
              ))}
            </div>
          </div>
          <div className="llLook">
            <span>Envelope</span>
            <div className="llPapers">
              {Object.entries(ENVELOPE_COLORS).map(([id, c]) => (
                <button key={id} type="button" className={`llEnvPick${envelope === id ? " is-on" : ""}`} style={{ background: c.body }} title={c.label} aria-label={`${c.label} envelope`} aria-pressed={envelope === id} onClick={() => setEnvelope(id)} />
              ))}
            </div>
          </div>
          <label className="llLook">
            <span>Handwriting</span>
            <select value={font} onChange={(e) => setFont(e.target.value)}>
              {FONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>

      </MoreOptions>
      {error && <p className="usError">{error}</p>}
    </div>
  )
}

// ---- the program ----

const TABS = [
  ["inbox", "Inbox"],
  ["sent", "Sent"],
  ["favorites", "Favorites"],
  ["write", "Write"],
]

const LoveLetters = ({ view: initialView, mobile }) => {
  const couple = useCouple()
  const [tab, setTab] = useState(initialView || "inbox")
  const [lists, setLists] = useState(null)
  const [reading, setReading] = useState(null) // { letter } once loaded
  const [opening, setOpening] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [error, setError] = useState(null)
  const now = useNow(1000)

  const load = async () => {
    const r = await coupleApi("GET", "/letters")
    if (r.ok) setLists({ inbox: r.inbox, outbox: r.outbox })
    else setError(r.error)
  }

  useEffect(() => {
    if (couple.status === "paired") load()
  }, [couple.status, couple.coupleId])
  useCoupleEvent("couple:letter", load)
  useCoupleEvent("couple:letter-opened", load)

  useEffect(() => {
    const onView = (e) => e.detail?.program === "Love Letters" && e.detail.view && (setTab(e.detail.view), setReading(null))
    window.addEventListener(VIEW_EVENT, onView)
    return () => window.removeEventListener(VIEW_EVENT, onView)
  }, [])

  const inbox = useMemo(() => {
    const rank = (l) => (!l.locked && !l.openedAt && l.delivery !== "openwhen" ? 0 : l.locked ? 1 : !l.openedAt ? 2 : 3)
    return [...(lists?.inbox || [])].sort((a, b) => rank(a) - rank(b) || (rank(a) === 1 ? a.unlockAt - b.unlockAt : b.unlockAt - a.unlockAt))
  }, [lists])

  if (couple.status !== "paired") return <div className="llRoot">{<NotPaired status={couple.status} what="Love Letters" />}</div>

  const open = async (letter) => {
    setError(null)
    const r = await coupleApi("GET", `/letters/${letter.id}`)
    if (!r.ok) return setError(r.error)
    // a first look at a letter from your partner breaks the seal
    if (!letter.mine && !letter.openedAt) {
      setOpening(r.letter)
      const opened = await coupleApi("POST", `/letters/${letter.id}/open`)
      unlock("first-letter")
      setReading({ ...r.letter, openedAt: opened.letter?.openedAt || serverNow() })
      load()
      refreshCoupleThings()
    } else setReading(r.letter)
  }

  const favorite = async () => {
    const r = await coupleApi("POST", `/letters/${reading.id}/favorite`, { favorite: !reading.favorite })
    if (r.ok) {
      setReading({ ...reading, favorite: r.letter.favorite })
      load()
    }
  }

  const list = tab === "sent" ? lists?.outbox || [] : tab === "favorites" ? [...(lists?.inbox || []), ...(lists?.outbox || [])].filter((l) => l.favorite) : inbox
  const counts = { inbox: inbox.filter((l) => !l.locked && !l.openedAt && l.delivery !== "openwhen").length }

  return (
    <div className={mobile ? "llRoot is-mobile" : "llRoot"}>
      <div className="llTabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id && !reading} className={tab === id && !reading ? "llTab is-on" : "llTab"} onClick={() => (setTab(id), setReading(null), id !== "write" && load())}>
            {id === "write" ? "✎ " : ""}
            {label}
            {id === "inbox" && counts.inbox > 0 && <span className="usBadge">{counts.inbox}</span>}
          </button>
        ))}
      </div>
      <div className="llBody">
        {reading ? (
          <LetterView letter={reading} onBack={() => setReading(null)} onFavorite={favorite} onDelete={() => setConfirmDelete(reading)} />
        ) : tab === "write" ? (
          <Compose couple={couple} onSent={() => (setTab("sent"), load())} />
        ) : !lists ? (
          <div className="llEmpty">Fetching your letters...</div>
        ) : list.length === 0 ? (
          <div className="llEmpty">
            <Envelope color="blush" className="llEmptyArt" />
            <p>{tab === "inbox" ? `No letters yet. Maybe ${couple.partner} is writing one right now...` : tab === "sent" ? `You haven't sent ${couple.partner} a letter yet.` : "Open a letter and press ♡ Favorite to keep it here."}</p>
            {tab !== "write" && (
              <button type="button" onClick={() => setTab("write")}>
                Write a letter
              </button>
            )}
          </div>
        ) : (
          <div className="llGrid">
            {list.map((letter) => (
              <EnvelopeCard key={letter.id} letter={letter} now={now} onOpen={open} />
            ))}
          </div>
        )}
        {error && <p className="usError llError">{error}</p>}
      </div>
      {opening && <Opening letter={opening} onDone={() => setOpening(null)} />}
      {confirmDelete && (
        <Dialog
          title="Delete Letter"
          okLabel="Delete"
          onOk={async () => {
            const r = await coupleApi("DELETE", `/letters/${confirmDelete.id}`)
            setConfirmDelete(null)
            if (!r.ok) return setError(r.error)
            setReading(null)
            load()
          }}
          onCancel={() => setConfirmDelete(null)}
        >
          <p className="dialogText">Delete "{confirmDelete.title}" for both of you? This can't be undone.</p>
        </Dialog>
      )}
    </div>
  )
}

export default LoveLetters
