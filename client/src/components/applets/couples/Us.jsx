import React, { useEffect, useState } from "react"
import { VIEW_EVENT, coupleApi, openCouples, unreadLetters, useCouple } from "../../../utils/couple"
import { programs } from "../../../utils/programs"
import { unlock } from "../../../utils/achievements"
import Dialog from "../../shared/Dialog"
import { TwoHearts } from "./art"
import { TogetherLine, togetherFor, useCoupleEvent, useNow, dateLabel } from "./shared"
import FlowerShop from "./FlowerShop"

// "Us": the couple's hub. Pair up with your partner (a request they accept), then see how
// long you've been together, whether they're on 98 Messenger, and open everything you
// share: love letters, your story, flowers, and any other couple programs installed
// (Couples Quiz, Photo Puzzle, Doodle Together, a shared pet).

// other couple programs light up here when they're installed
const EXTRAS = [
  { app: "quiz", blurb: "How well do you know each other?" },
  { app: "puzzle", blurb: "Piece your photos back together" },
  { app: "doodle", blurb: "Draw on the same page" },
  { app: "pet", blurb: "Raise a little one together" },
]

const Initial = ({ name, tone }) => (
  <span className={`usAvatar is-${tone}`} aria-hidden="true">
    {String(name || "?").charAt(0).toUpperCase()}
  </span>
)

const Status = ({ couple }) => {
  const label = couple.partnerOnline ? (couple.partnerAway ? "Away" : "Online") : "Offline"
  return (
    <span className={`usStatus is-${label.toLowerCase()}`}>
      <span className="usStatusDot" /> {label}
    </span>
  )
}

const Tile = ({ icon, title, blurb, badge, onClick, art }) => (
  <button type="button" className="usTile" onClick={onClick}>
    {art || <img src={icon} alt="" draggable="false" />}
    <span className="usTileTitle">{title}</span>
    <span className="usTileBlurb">{blurb}</span>
    {badge > 0 && <span className="usBadge">{badge}</span>}
  </button>
)

// ---- pairing ----

const Pairing = ({ couple }) => {
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const run = async (action) => {
    setBusy(true)
    setError(null)
    const result = await action()
    setBusy(false)
    if (!result?.ok) setError(result?.error || "That didn't work. Try again.")
    else if (result.status === "paired") unlock("two-hearts")
    return result
  }

  if (couple.status === "pending-out")
    return (
      <div className="usPairing">
        <div className="usWaiting">
          <TwoHearts size={72} />
        </div>
        <h2>Waiting for {couple.outgoing}...</h2>
        <p>Your pair request is on its way. {couple.outgoing} will see it the next time they sign on to 98 Messenger (or right now, if they're on).</p>
        <button type="button" disabled={busy} onClick={() => run(couple.cancelPair)}>
          Cancel request
        </button>
        {error && <p className="usError">{error}</p>}
      </div>
    )

  return (
    <div className="usPairing">
      <TwoHearts size={84} />
      <h2>Pair with your partner</h2>
      <p>Pairing makes a little space just for the two of you: love letters, your story in photos and flowers. Nobody else can see any of it.</p>
      {couple.incoming.length > 0 && (
        <div className="usRequests">
          {couple.incoming.map((from) => (
            <div key={from} className="usRequest">
              <span>
                <b>{from}</b> wants to pair with you ♥
              </span>
              <span className="usRequestButtons">
                <button type="button" disabled={busy} onClick={() => run(() => couple.acceptPair(from))}>
                  Accept ♥
                </button>
                <button type="button" disabled={busy} onClick={() => run(() => couple.declinePair(from))}>
                  Decline
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      <form
        className="usPairForm"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) run(() => couple.requestPair(name.trim()))
        }}
      >
        <label htmlFor="us-partner">Your partner's screen name:</label>
        <div className="usPairRow">
          <input id="us-partner" value={name} maxLength={16} autoComplete="off" autoCapitalize="off" spellCheck="false" onChange={(e) => setName(e.target.value)} />
          <button type="submit" disabled={busy || !name.trim()}>
            Send pair request ♥
          </button>
        </div>
      </form>
      {error && <p className="usError">{error}</p>}
    </div>
  )
}

// ---- settings: unpairing ----

const Settings = ({ couple, onBack }) => {
  const [confirm, setConfirm] = useState(false)
  const [deleteNow, setDeleteNow] = useState(false)
  const [error, setError] = useState(null)
  return (
    <div className="usPanel">
      <div className="usPanelHead">
        <button type="button" onClick={onBack}>
          ‹ Back
        </button>
        <h2>Settings</h2>
      </div>
      <fieldset>
        <legend>Wallpaper</legend>
        <p className="usSmall">Display Properties has an "Our photos ♥" wallpaper: your Our Story photos, taking turns while you're signed on.</p>
      </fieldset>
      <fieldset>
        <legend>Unpair</legend>
        <p className="usSmall">Unpairing hides everything you share right away for both of you. It's kept for 30 days in case you pair up again, then deleted for good.</p>
        <button type="button" onClick={() => setConfirm(true)}>
          Unpair from {couple.partner}...
        </button>
        {error && <p className="usError">{error}</p>}
      </fieldset>
      {confirm && (
        <Dialog
          title="Unpair"
          okLabel="Unpair"
          sound="chord"
          onOk={async () => {
            setConfirm(false)
            const result = await couple.unpair(deleteNow)
            if (!result.ok) setError(result.error)
          }}
          onCancel={() => setConfirm(false)}
        >
          <p className="dialogText">Unpair from {couple.partner}? They'll see it too.</p>
          <div className="field-row">
            <input id="us-delete-now" type="checkbox" checked={deleteNow} onChange={(e) => setDeleteNow(e.target.checked)} />
            <label htmlFor="us-delete-now">Delete our letters, story and photos now</label>
          </div>
        </Dialog>
      )}
    </div>
  )
}

// ---- the hub ----

const Hub = ({ couple, onView }) => {
  const now = useNow(60_000)
  const [story, setStory] = useState(null)
  const load = () => coupleApi("GET", "/story").then((r) => r.ok && setStory(r))
  useEffect(() => {
    load()
  }, [])
  useCoupleEvent("couple:story", load)

  const start = story?.story.togetherSince || couple.since
  const together = togetherFor(start, now)
  const extras = EXTRAS.map((x) => ({ ...x, program: programs.find((p) => p.app === x.app) })).filter((x) => x.program)
  const letters = unreadLetters(couple, now)

  return (
    <div className="usHub">
      <div className="usHeader">
        <div className="usPair">
          <Initial name={couple.me} tone="me" />
          <span className="usPairHeart">♥</span>
          <Initial name={couple.partner} tone="them" />
        </div>
        <div className="usHeaderText">
          <div className="usNames">
            {couple.me} &amp; {couple.partner}
          </div>
          <Status couple={couple} />
          {together && (
            <div className="usTogether" title={story?.story.togetherSince ? "Since your anniversary (Our Story)" : `Paired on 98ish ${dateLabel(couple.since, false)}`}>
              <TogetherLine together={together} />
            </div>
          )}
        </div>
      </div>

      <div className="usTiles">
        <Tile icon="/assets/program_icons/loveletters.svg" title="Love Letters" blurb="Write, seal and schedule letters" badge={letters} onClick={() => openCouples("Love Letters")} />
        <Tile icon="/assets/program_icons/ourstory.svg" title="Our Story" blurb={story?.moments.length ? `${story.moments.length} moments so far` : "Your timeline in photos"} onClick={() => openCouples("Our Story")} />
        <Tile icon="/assets/program_icons/flowers.svg" title="Send Flowers" blurb="A bouquet for their desktop" onClick={() => onView("flowers")} />
        {extras.map((x) => (
          <Tile key={x.app} icon={x.program.icon} title={x.program.name} blurb={x.blurb} onClick={() => openCouples(x.program.name)} />
        ))}
      </div>

      <div className="usFooter">
        <button type="button" className="usLink" onClick={() => onView("settings")}>
          Settings...
        </button>
      </div>
    </div>
  )
}

const Us = ({ view: initialView, mobile }) => {
  const couple = useCouple()
  const [view, setView] = useState(initialView || "home")

  useEffect(() => {
    const onView = (e) => e.detail?.program === "Us" && setView(e.detail.view || "home")
    window.addEventListener(VIEW_EVENT, onView)
    return () => window.removeEventListener(VIEW_EVENT, onView)
  }, [])

  useEffect(() => {
    if (couple.status === "paired") unlock("two-hearts")
  }, [couple.status])

  let body
  if (couple.status === "signed-out")
    body = (
      <div className="usPairing">
        <TwoHearts size={84} />
        <h2>Welcome to Us</h2>
        <p>A little corner of 98ish for two. Sign on to 98 Messenger, then pair with your partner.</p>
        <button type="button" onClick={() => openCouples("98 Messenger")}>
          Open 98 Messenger
        </button>
      </div>
    )
  else if (couple.status !== "paired") body = <Pairing couple={couple} />
  else if (view === "flowers") body = <FlowerShop couple={couple} onBack={() => setView("home")} />
  else if (view === "settings") body = <Settings couple={couple} onBack={() => setView("home")} />
  else body = <Hub couple={couple} onView={setView} />

  return <div className={mobile ? "usRoot is-mobile" : "usRoot"}>{body}</div>
}

export default Us
