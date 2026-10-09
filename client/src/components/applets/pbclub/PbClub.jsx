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
import Tournaments from "./Tournaments"
import "./PbClub.css"
import { useNet } from "../network/NetContext"
import { openMaps } from "../../../utils/maps"

// Live Broadcast (Pickleball 98's twin/live): "Go Live" from the fence, and your buddies'
// games that are live right now (server/broadcast bc:list, refreshed and on bc:live)
const LiveCard = ({ onLive, onWatch }) => {
  const net = useNet()
  const [live, setLive] = useState([])
  const online = net?.status === "online"
  useEffect(() => {
    if (!online || !net?.socket) return
    let alive = true
    const load = () => net.request("bc:list", {}).then((r) => alive && r?.ok && setLive(r.live || []))
    load()
    const id = setInterval(load, 20000)
    const onNew = () => load()
    net.socket.on("bc:live", onNew)
    net.socket.on("bc:end", onNew)
    return () => {
      alive = false
      clearInterval(id)
      net.socket.off("bc:live", onNew)
      net.socket.off("bc:end", onNew)
    }
  }, [online, net?.socket])
  return (
    <div className="pbLiveCard" data-live-card>
      {live.map((b) => (
        <button key={b.id} type="button" onClick={() => onWatch(b.id)} data-watch={b.id}>
          <b>● {b.host} is live</b> {b.title} · {b.viewers} watching
        </button>
      ))}
      {onLive && (
        <button type="button" onClick={onLive} data-action="go-live">
          <b>Go Live</b> · your friends watch your game in 3D, live
        </button>
      )}
    </div>
  )
}

// Real Games, inside Pickleball 98 (Pickleball.jsx renders it with `embedded`): real-life pickleball with your group. Play (sessions: who's in, the
// courts' rotation, the real courts you play at), Score (the courtside scorekeeper), Matches
// (confirm and log), Ladder (the friends' ratings and your stats). The server is
// server/pbclub; the rules are clubCore.js, scoring.js and rotation.js.

const ICON = "/assets/program_icons/pickleball.svg"
const TABS = [
  ["play", "Play"],
  ["tourneys", "Tournaments"],
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

const CourtsList = ({ onPlan, onMeet, canMeet, canPlan }) => (
  <ul className="pbList pbVenues" data-venues>
    {core.VENUES.map((v) => {
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
            {/* Maps 98 (utils/maps.js): directions from where you are, inside 98ish */}
            <button type="button" onClick={() => openMaps({ name: v.name, lat: v.lat, lon: v.lon, address: v.address, directions: true })} data-directions={v.id}>
              Directions
            </button>
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

const PbClub = ({ mobile, handoff, onClose, embedded = false, onTwin = null, onLive = null, onWatch = null, onCoach = null, onTourneyPlay = null }) => {
  const aim = useAim()
  const state = club.useClub()
  const [tab, setTab] = useState("play")
  const [open, setOpen] = useState(null) // session id
  const [editing, setEditing] = useState(null) // { session } | { venueId }
  const [prefill, setPrefill] = useState(null)
  const [focusMatch, setFocusMatch] = useState(null)
  const [meet, setMeet] = useState(null)
  const [about, setAbout] = useState(false)
  const [tourneyFocus, setTourneyFocus] = useState(null)

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
    if (handoff.tourney) {
      setTab("tourneys")
      setTourneyFocus(handoff.tourney)
    } else if (handoff.session) {
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
  if (tab === "tourneys") {
    body = <Tournaments buddies={buddies} onPlay={onTourneyPlay} focus={tourneyFocus} />
  } else if (tab === "score") {
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
        {embedded && onWatch && <LiveCard onLive={onLive} onWatch={onWatch} />}
        {online && <SessionList state={state} onOpen={setOpen} onNew={() => setEditing({})} />}
        {state.error && <p className="pbError">{state.error}</p>}
        <h4 className="pbH">Your courts</h4>
        <CourtsList onPlan={(venueId) => setEditing({ venueId })} onMeet={setMeet} canPlan={online} canMeet={online && buddies.length > 0} />
        <p className="pbMuted pbCredit">Directions open in Maps 98 (with a button there to hand off to Apple Maps).</p>
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
          {onCoach && (
            <button type="button" onClick={onCoach} data-club-coach title="Your personal coach, from your filmed games">
              Coach
            </button>
          )}
          {onTwin && (
            <button type="button" onClick={onTwin} data-club-twin title="Film a real game and watch it back in 3D">
              Film a Game
            </button>
          )}
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
