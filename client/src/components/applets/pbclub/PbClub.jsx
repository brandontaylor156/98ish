import React, { useEffect, useMemo, useState } from "react"
import { Select } from "../../shared/select/Combo"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import { helpItem } from "../../../utils/help"
import { keyOf, useAim } from "../aim/AimContext"
import * as core from "./clubCore"
import * as club from "../../../utils/pbclub"
import Scorekeeper from "./Scorekeeper"
import Matches from "./Matches"
import Ladder from "./Ladder"
import { SessionEditor, SessionList, SessionView } from "./Sessions"
import "./PbClub.css"

// Real Games, inside Pickleball 98 (Pickleball.jsx renders it with `embedded`): real-life pickleball with your group. Play (sessions: who's in, the
// courts' rotation, the real courts you play at), Score (the courtside scorekeeper), Matches
// (confirm and log), Ladder (the friends' ratings and your stats). The server is
// server/pbclub; the rules are clubCore.js, scoring.js and rotation.js.

const ICON = "/assets/program_icons/pickleball.svg"
const TABS = [
  ["play", "Play"],
  ["score", "Score"],
  ["matches", "Matches"],
  ["ladder", "Ladder"],
]

const MeetDialog = ({ venue, buddies, onClose, send }) => {
  const [who, setWho] = useState(buddies[0]?.name || "")
  const [when, setWhen] = useState("now")
  const [msg, setMsg] = useState(null)
  const links = core.mapsLinks({ id: venue.id })
  const text = `Meet me at ${venue.name}${when === "now" ? " now" : when === "soon" ? " in 30 minutes" : " later today"}? 🏓 ${venue.address} ${links.apple}`
  return (
    <Dialog
      title={`Meet Me at ${venue.short}`}
      okLabel="Send IM"
      okDisabled={!who}
      onCancel={onClose}
      onOk={async () => {
        const r = await send(who, text)
        if (r?.ok === false) setMsg(r.error || "Couldn't send.")
        else onClose()
      }}
    >
      <div className="pbEditor">
        <label>
          To
          <Select value={who} onChange={(e) => setWho(e.target.value)} data-meet-to>
            {buddies.map((b) => (
              <option key={b.k} value={b.name}>
                {b.name}
              </option>
            ))}
          </Select>
        </label>
        <label>
          When
          <Select value={when} onChange={(e) => setWhen(e.target.value)}>
            <option value="now">Now</option>
            <option value="soon">In 30 minutes</option>
            <option value="later">Later today</option>
          </Select>
        </label>
        <p className="pbNote" data-selectable>
          {text}
        </p>
        {msg && <p className="pbError">{msg}</p>}
      </div>
    </Dialog>
  )
}

// Apple devices open Apple Maps, everything else Google Maps
const appleDevice = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)

const CourtsList = ({ onPlan, onMeet, canMeet, canPlan }) => (
  <ul className="pbList pbVenues" data-venues>
    {core.VENUES.map((v) => {
      const links = core.mapsLinks({ id: v.id })
      const directions = appleDevice() ? links.apple : links.google
      return (
        <li key={v.id} className="pbVenue" data-venue-row={v.id}>
          <div className="pbVenueName">
            <b>{v.name}</b>
            <span className="pbMuted">
              {v.indoor ? "Indoor" : "Outdoor"} · {v.access}
            </span>
          </div>
          <div className="pbMuted" data-selectable>
            {v.address}
          </div>
          <div className="pbButtons">
            <a className="pbLinkBtn" href={directions} target="_blank" rel="noreferrer">
              Directions
            </a>
            {canPlan && (
              <button type="button" onClick={() => onPlan(v.id)}>
                Plan
              </button>
            )}
            {canMeet && (
              <button type="button" onClick={() => onMeet(v)} data-meet={v.id}>
                Meet Me Here
              </button>
            )}
          </div>
        </li>
      )
    })}
  </ul>
)

const PbClub = ({ mobile, handoff, onClose, embedded = false }) => {
  const aim = useAim()
  const state = club.useClub()
  const [tab, setTab] = useState("play")
  const [open, setOpen] = useState(null) // session id
  const [editing, setEditing] = useState(null) // { session } | { venueId }
  const [prefill, setPrefill] = useState(null)
  const [focusMatch, setFocusMatch] = useState(null)
  const [meet, setMeet] = useState(null)
  const [about, setAbout] = useState(false)

  const online = aim?.status === "online"
  const myName = aim?.me?.screenName || ""
  const meKey = state.me || (online ? keyOf(myName) : null)
  const buddies = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const g of aim?.me?.groups || []) for (const b of g.buddies || []) if (!seen.has(keyOf(b)) && keyOf(b) !== meKey && keyOf(b) !== "smarterchild") seen.add(keyOf(b)), out.push({ k: keyOf(b), name: b })
    // and people you've played with who aren't buddies
    for (const [k, name] of Object.entries(state.names || {})) if (!seen.has(k) && k !== meKey && !(/^x[0-9a-f]{12}$/.test(k) && name === "Deleted player")) seen.add(k), out.push({ k, name })
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }, [aim?.me?.groups, state.names, meKey])
  const people = useMemo(() => (meKey ? [{ k: meKey, name: `${myName || meKey} (you)` }, ...buddies] : buddies), [meKey, myName, buddies])

  // a deep link or notification: a session or a match to show
  useEffect(() => {
    if (!handoff?.id) return
    if (handoff.session) {
      setTab("play")
      setOpen(handoff.session)
    } else if (handoff.match) {
      setTab("matches")
      setFocusMatch(handoff.match)
    } else if (handoff.venue) {
      setTab("play")
      setEditing({ venueId: handoff.venue })
    }
    club.refresh()
  }, [handoff?.id])

  useEffect(() => {
    if (state.status === "ready") club.refresh()
  }, [])

  const waiting = state.matches.filter((m) => core.canConfirm(m, state.me) || core.canAgreeRemove(m, state.me)).length
  const session = open ? state.sessions.find((s) => s.id === open) : null

  const menus = [
    {
      label: "Club",
      items: [
        { label: "New Session...", disabled: !online, onClick: () => setEditing({}) },
        { label: "Score a Game", onClick: () => setTab("score") },
        "-",
        { label: "Refresh", disabled: !online, onClick: () => club.refresh() },
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    { label: "Help", items: [helpItem("pickleball-club"), "-", { label: "About Real Games...", onClick: () => setAbout(true) }] },
  ]

  const signedOff = !online && (
    <p className="pbBannerInfo" data-signed-off>
      Sign on to 98 Messenger to plan sessions and share matches with your group. The scorekeeper works without it (matches wait on this phone).
    </p>
  )

  let body
  if (tab === "score") {
    body = (
      <Scorekeeper
        me={meKey ? { k: meKey, name: myName || meKey } : null}
        people={people}
        prefill={prefill}
        onSaved={() => {
          setPrefill(null)
        }}
      />
    )
  } else if (tab === "matches") {
    body = (
      <>
        {signedOff}
        <Matches state={state} people={people} focus={focusMatch} />
      </>
    )
  } else if (tab === "ladder") {
    body = (
      <>
        {signedOff}
        <Ladder state={state} />
      </>
    )
  } else if (session) {
    body = <SessionView session={session} state={state} buddies={buddies} onBack={() => setOpen(null)} onEdit={() => setEditing({ session })} onScore={(p) => (setPrefill({ ...p, id: Date.now() }), setTab("score"))} />
  } else {
    body = (
      <>
        {signedOff}
        {online && <SessionList state={state} onOpen={setOpen} onNew={() => setEditing({})} />}
        {state.error && <p className="pbError">{state.error}</p>}
        <h4 className="pbH">Your courts</h4>
        <CourtsList onPlan={(venueId) => setEditing({ venueId })} onMeet={setMeet} canPlan={online} canMeet={online && buddies.length > 0} />
        <p className="pbMuted pbCredit">Directions open in Apple Maps on Apple devices, Google Maps elsewhere.</p>
      </>
    )
  }

  return (
    <div className={`pbRoot${mobile ? " is-mobile" : ""}${embedded ? " is-embedded" : ""}`} data-tab={tab}>
      {!embedded && <MenuBar menus={menus} />}
      {embedded && (
        <div className="pbTopBar">
          <button type="button" onClick={onClose} data-club-back>
            « Back
          </button>
          <b>Real Games</b>
          <button type="button" onClick={() => setEditing({})} disabled={!online} data-club-new>
            New Session...
          </button>
        </div>
      )}
      <menu role="tablist" className="pbTabs">
        {TABS.map(([id, label]) => (
          <li key={id} role="tab" aria-selected={tab === id}>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                setTab(id)
                if (id === "play") setOpen(null)
              }}
              data-tab-btn={id}
            >
              {label}
              {id === "matches" && waiting > 0 ? ` (${waiting})` : ""}
            </a>
          </li>
        ))}
      </menu>
      <div className="window pbPanel" role="tabpanel">
        <div className="pbBody">{body}</div>
      </div>
      {editing && <SessionEditor session={editing.session || null} venueId={editing.venueId} buddies={buddies} onClose={() => setEditing(null)} onSaved={(s) => s && setOpen(s.id)} />}
      {meet && <MeetDialog venue={meet} buddies={buddies} onClose={() => setMeet(null)} send={(name, text) => aim.sendIm(name, text)} />}
      {about && (
        <Dialog title="About Real Games" onOk={() => setAbout(false)} onCancel={() => setAbout(false)}>
          <div className="pbAbout">
            <img src={ICON} alt="" width="32" height="32" />
            <p>
              <b>Real Games</b> (in Pickleball 98): score your real games, plan open play with your group, and keep a friendly ladder. The score is spoken by your phone's own voice; nothing about you is shared outside your group.
            </p>
          </div>
        </Dialog>
      )}
    </div>
  )
}

export default PbClub
