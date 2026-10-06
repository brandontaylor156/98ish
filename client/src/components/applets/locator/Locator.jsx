import React, { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { keyOf, useAim } from "../aim/AimContext"
import MoreOptions from "../../shared/MoreOptions"
import { launch } from "../../../utils/programs"
import { placeCall } from "../aim/call/CallButtons"
import * as loc from "../../../utils/locate"
import { agoText, directionsUrl, distanceM, distanceText, untilText } from "./locateCore"
import { ArrowIcon } from "./LocatorTray"
import { VENUES } from "../pbclub/clubCore"
import "./Locator.css"

// Buddy Locator: a map of the buddies who share their location with you, and sharing yours
// with the buddies you pick, for an hour, until the end of the day, or until you stop.
// Baseline: the map, the people list, and Share My Location. Who you share with, asking to
// see someone, places and approximate location are under More options.

const LocatorMap = React.lazy(() => import("./LocatorMap"))

const COLORS = ["#c00000", "#008000", "#800080", "#c06000", "#008080", "#0000c0", "#806000", "#c00080"]
const colorFor = (key) => {
  let h = 0
  for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return COLORS[h % COLORS.length]
}
const CHOICES = [
  ["hour", "For 1 hour"],
  ["today", "Until the end of the day"],
  ["forever", "Indefinitely"],
]
const RADII = [
  [100, "100 m (a house)"],
  [150, "150 m (a park, a court)"],
  [300, "300 m (a campus)"],
  [1000, "1 km (a neighborhood)"],
]
const apple = () => typeof navigator !== "undefined" && /iPhone|iPad|Macintosh/.test(navigator.userAgent)

// ---- small dialogs (98 windows over the app) ----

const Popup = ({ title, onClose, children }) => (
  <div className="locLayer" onClick={onClose}>
    <div className="window locPopup" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
      <div className="title-bar">
        <div className="title-bar-text">{title}</div>
        <div className="title-bar-controls">
          <button type="button" aria-label="Close" onClick={onClose} />
        </div>
      </div>
      <div className="window-body locPopupBody">{children}</div>
    </div>
  </div>
)

const DurationPicker = ({ value, onChange, name }) => (
  <fieldset className="locChoices">
    <legend>How long</legend>
    {CHOICES.map(([id, label]) => (
      <div className="field-row" key={id}>
        <input type="radio" id={`${name}-${id}`} name={name} checked={value === id} onChange={() => onChange(id)} />
        <label htmlFor={`${name}-${id}`}>{label}</label>
      </div>
    ))}
  </fieldset>
)

const ShareDialog = ({ buddies, preset, onClose }) => {
  const [who, setWho] = useState(preset || buddies[0]?.screenName || "")
  const [choice, setChoice] = useState("hour")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const go = async () => {
    if (!who) return
    setBusy(true)
    const result = await loc.shareWith(who, choice)
    setBusy(false)
    if (result.ok) onClose()
    else setError(result.error)
  }
  return (
    <Popup title="Share My Location" onClose={onClose}>
      {buddies.length ? (
        <>
          <div className="field-row-stacked">
            <label htmlFor="loc-share-who">Share with</label>
            <select id="loc-share-who" value={who} onChange={(e) => setWho(e.target.value)}>
              {buddies.map((b) => (
                <option key={b.key} value={b.screenName}>
                  {b.screenName}
                  {b.online ? "" : " (offline)"}
                </option>
              ))}
            </select>
          </div>
          <DurationPicker value={choice} onChange={setChoice} name="loc-share" />
          <p className="locHint">They'll see where you are on their map. Updates while 98ish is open on your device.</p>
          {error && <p className="locError">{error}</p>}
          <div className="locButtons">
            <button type="button" className="locPrimary" disabled={busy || !who} onClick={go}>
              Share
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p>Add buddies to your Buddy List in 98 Messenger first. You can share only with your buddies.</p>
          <div className="locButtons">
            <button type="button" onClick={onClose}>
              OK
            </button>
          </div>
        </>
      )}
    </Popup>
  )
}

const AlertDialog = ({ friend, places, watches, onClose, onAddPlace }) => {
  const [place, setPlace] = useState(places[0]?.id || "")
  const existing = watches.find((w) => w.who === friend.key && w.place === place)
  const [on, setOn] = useState(existing?.on || "arrive")
  const [error, setError] = useState(null)
  useEffect(() => setOn(watches.find((w) => w.who === friend.key && w.place === place)?.on || "arrive"), [place])
  const save = async (value) => {
    const result = await loc.setWatch(friend.key, place, value)
    if (result.ok) onClose()
    else setError(result.error)
  }
  return (
    <Popup title={`Notify Me: ${friend.name}`} onClose={onClose}>
      {places.length ? (
        <>
          <div className="field-row-stacked">
            <label htmlFor="loc-alert-place">Place</label>
            <select id="loc-alert-place" value={place} onChange={(e) => setPlace(e.target.value)}>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="locChoices">
            <legend>Tell me when {friend.name}</legend>
            {[
              ["arrive", "arrives"],
              ["leave", "leaves"],
              ["both", "arrives or leaves"],
            ].map(([id, label]) => (
              <div className="field-row" key={id}>
                <input type="radio" id={`loc-on-${id}`} name="loc-on" checked={on === id} onChange={() => setOn(id)} />
                <label htmlFor={`loc-on-${id}`}>{label}</label>
              </div>
            ))}
          </fieldset>
          {friend.pos?.coarse && <p className="locHint">{friend.name} shares an approximate location, so arriving and leaving can't be told.</p>}
          {error && <p className="locError">{error}</p>}
          <div className="locButtons">
            <button type="button" className="locPrimary" onClick={() => save(on)}>
              OK
            </button>
            {existing && (
              <button type="button" onClick={() => save("off")}>
                Turn Off
              </button>
            )}
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p>Name a place first (Home, Work, the courts), then pick it here.</p>
          <div className="locButtons">
            <button type="button" className="locPrimary" onClick={onAddPlace}>
              Add a Place...
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}
    </Popup>
  )
}

const PlaceDialog = ({ mapCenter, onClose }) => {
  const [name, setName] = useState("")
  const [r, setR] = useState(150)
  const [spot, setSpot] = useState(null) // { lat, lon, from }
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const here = async () => {
    setBusy(true)
    const result = await loc.locateMe()
    setBusy(false)
    if (result.ok) setSpot({ lat: result.pos.lat, lon: result.pos.lon, from: "Where I am now" })
    else setError(result.error)
  }
  const middle = () => {
    const c = mapCenter()
    if (c) setSpot({ ...c, from: "The middle of the map" })
  }
  const save = async () => {
    if (!name.trim()) return setError("Give the place a name.")
    if (!spot) return setError("Pick where it is.")
    const places = [...(loc.getLocate().me?.places || []), { name: name.trim(), lat: spot.lat, lon: spot.lon, r }]
    const result = await loc.savePlaces(places)
    if (result.ok) onClose()
    else setError(result.error)
  }
  return (
    <Popup title="Add a Place" onClose={onClose}>
      <div className="field-row-stacked">
        <label htmlFor="loc-place-name">Name</label>
        <input id="loc-place-name" type="text" maxLength={40} value={name} placeholder="Home, Work, Los Cab..." onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field-row-stacked">
        <span>Where</span>
        <div className="locButtons">
          <button type="button" disabled={busy} onClick={here}>
            Where I Am
          </button>
          <button type="button" onClick={middle}>
            Middle of Map
          </button>
        </div>
        <select
          aria-label="Or a pickleball court"
          value=""
          onChange={(e) => {
            const v = VENUES.find((x) => x.id === e.target.value)
            if (!v) return
            setSpot({ lat: v.lat, lon: v.lon, from: v.name })
            if (!name.trim()) setName(v.short)
            setR(v.indoor ? 100 : 300)
          }}
          data-place-venue
        >
          <option value="">Or a pickleball court...</option>
          {VENUES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.short}
            </option>
          ))}
        </select>
        <span className="locHint">{spot ? `${spot.from} (${spot.lat.toFixed(4)}, ${spot.lon.toFixed(4)})` : "Move the map so the place is in the middle, or use where you are."}</span>
      </div>
      <div className="field-row-stacked">
        <label htmlFor="loc-place-r">Size</label>
        <select id="loc-place-r" value={r} onChange={(e) => setR(Number(e.target.value))}>
          {RADII.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="locError">{error}</p>}
      <div className="locButtons">
        <button type="button" className="locPrimary" onClick={save}>
          Save
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Popup>
  )
}

// ---- the window ----

const Locator = ({ mobile, dispatch }) => {
  const aim = useAim()
  const state = loc.useLocate()
  const mapApi = useRef(null)
  const [selected, setSelected] = useState(null)
  const [dialog, setDialog] = useState(null) // { kind: "share" | "alert" | "place", ... }
  const [note, setNote] = useState(null)
  const [askWho, setAskWho] = useState("")
  const online = aim?.status === "online"
  const now = Date.now()

  const buddies = useMemo(() => {
    const seen = new Map()
    for (const group of aim?.me?.groups || [])
      for (const name of group.buddies) {
        const key = keyOf(name)
        if (!seen.has(key)) seen.set(key, { key, screenName: aim.presence?.[key]?.screenName || name, online: !!aim.presence?.[key]?.online })
      }
    return [...seen.values()].sort((a, b) => Number(b.online) - Number(a.online) || a.screenName.localeCompare(b.screenName))
  }, [aim?.me, aim?.presence])

  const me = state.me
  const shares = loc.activeShares(me, now)
  const sharing = shares.length > 0
  const paused = !!me?.paused
  const people = useMemo(() => {
    const list = state.friends.map((f) => ({ ...f, color: colorFor(f.key), stale: f.pos && now - f.pos.at > 3600_000 }))
    if (state.here) list.push({ key: "__me", me: true, name: "You", color: "#1a6dff", pos: state.here })
    return list
  }, [state.friends, state.here, state.tick])

  useEffect(() => {
    if (!state.here && online) loc.locateMe() // "you are here" on the map (stays on this device)
  }, [online])

  if (!aim) return null
  if (!online) {
    return (
      <div className="loc locSignedOff">
        <div className="locHero">
          <img src="/assets/program_icons/locator.svg" alt="" width="40" height="40" />
          <div>
            <b>Buddy Locator</b>
            <div className="locHint">See where your buddies are, and share where you are, only with the buddies you pick. Sign on to 98 Messenger first.</div>
          </div>
        </div>
        <button type="button" className="locPrimary" onClick={() => dispatch?.({ type: "open_window", payload: launch("98 Messenger") })}>
          Open 98 Messenger
        </button>
      </div>
    )
  }

  const friend = state.friends.find((f) => f.key === selected)
  const pick = (key) => {
    setSelected(key)
    const f = people.find((p) => p.key === key)
    if (f?.pos) mapApi.current?.focus(f.pos)
  }
  const asks = me?.asks || []
  const watches = me?.watches || []
  const places = me?.places || []
  const flash = (text) => {
    setNote(text)
    setTimeout(() => setNote(null), 4000)
  }

  const shareLine = paused ? "Sharing is paused" : sharing ? `Sharing with ${shares.map((s) => s.name || s.to).join(", ")}` : "Not sharing your location"
  const geoProblem = sharing && !paused && (state.geo.state === "needs-tap" || state.geo.state === "denied" || state.geo.state === "unavailable" || state.geo.state === "error")

  return (
    <div className={`loc${mobile ? " is-mobile" : ""}`} data-loc>
      <div className="locBar">
        <button type="button" className="locPrimary locShareBtn" onClick={() => setDialog({ kind: "share" })}>
          <ArrowIcon size={14} /> Share My Location...
        </button>
        <span className={`locStatus${sharing && !paused ? " is-on" : ""}`} data-sharing={sharing ? (paused ? "paused" : "on") : "off"}>
          {shareLine}
        </span>
      </div>

      {sharing && !paused && <div className="locHint locUpdates">Updates while 98ish is open{state.sentAt ? `. Last sent ${agoText(state.sentAt, now).toLowerCase()}.` : "."}</div>}
      {geoProblem && (
        <div className="locBanner" role="alert">
          <span>{state.geo.error || "Location updates stopped. Tap to start them again."}</span>
          {state.geo.state !== "unavailable" && (
            <button type="button" onClick={() => loc.startWatching()}>
              Resume
            </button>
          )}
        </div>
      )}
      {asks.map((a) => (
        <div className="locBanner locAsk" key={a.from} data-ask={a.from}>
          <span>
            <b>{a.name}</b> would like to see your location.
          </span>
          <span className="locButtons">
            <button type="button" className="locPrimary" onClick={() => loc.answerAsk(a.from, true, "hour")}>
              Share 1 Hour
            </button>
            <button type="button" onClick={() => loc.answerAsk(a.from, true, "forever")}>
              Always
            </button>
            <button type="button" onClick={() => loc.answerAsk(a.from, false)}>
              Not Now
            </button>
          </span>
        </div>
      ))}
      {state.error && <div className="locError">{state.error}</div>}
      {note && <div className="locNote" role="status">{note}</div>}

      <div className="locMain">
        <div className="locMapPane">
          <Suspense fallback={<div className="locMapWrap"><div className="locMapNote">Loading the map...</div></div>}>
            <LocatorMap ref={mapApi} people={people} places={places} selected={selected} onSelect={pick} />
          </Suspense>
          <div className="locMapTools">
            <button type="button" title="Show everyone" onClick={() => mapApi.current?.fit()}>
              Everyone
            </button>
            <button
              type="button"
              title="Where I am"
              onClick={async () => {
                const r = await loc.locateMe()
                if (r.ok) mapApi.current?.focus(r.pos)
                else flash(r.error)
              }}
            >
              Me
            </button>
          </div>
        </div>

        <div className="locSide">
          <div className="locListHead">People sharing with you</div>
          <ul className="locList" role="listbox" aria-label="People sharing with you">
            {state.status === "loading" && <li className="locEmpty">Loading...</li>}
            {state.status !== "loading" && !state.friends.length && <li className="locEmpty">Nobody is sharing with you yet. Ask a buddy under More options.</li>}
            {state.friends.map((f) => {
              const away = f.pos && state.here ? distanceText(distanceM(state.here, f.pos)) : ""
              return (
                <li key={f.key} role="option" aria-selected={selected === f.key} className={`locRow${selected === f.key ? " is-selected" : ""}`} data-friend={f.key} onClick={() => pick(f.key)}>
                  <span className="locFace" style={{ background: colorFor(f.key) }}>
                    {String(f.name || "?")[0].toUpperCase()}
                  </span>
                  <span className="locRowText">
                    <b>{f.name}</b>
                    <span className="locHint">{f.paused ? "Paused" : f.pos ? [agoText(f.pos.at, now), away, f.pos.coarse ? "approximate" : ""].filter(Boolean).join(" · ") : "No location yet"}</span>
                  </span>
                </li>
              )
            })}
          </ul>

          {friend && (
            <div className="locCard" data-card={friend.key}>
              <div className="locCardHead">
                <b>{friend.name}</b>
                <span className="locHint">{untilText(friend.until, now)}</span>
              </div>
              <div className="locCardButtons">
                <button type="button" onClick={() => aim.openIm(friend.name)}>
                  Message
                </button>
                <button type="button" onClick={() => placeCall(friend.name, false, flash)}>
                  Call
                </button>
                <button type="button" disabled={!friend.pos} onClick={() => friend.pos && window.open(directionsUrl(friend.pos, apple()), "_blank", "noopener")}>
                  Directions
                </button>
                <button type="button" onClick={() => setDialog({ kind: "alert", friend })}>
                  Notify Me...
                </button>
              </div>
              {watches
                .filter((w) => w.who === friend.key)
                .map((w) => (
                  <div className="locHint" key={w.id}>
                    🔔 When {friend.name} {w.on === "both" ? "arrives at or leaves" : w.on === "arrive" ? "arrives at" : "leaves"} {places.find((p) => p.id === w.place)?.name || "a place"}
                  </div>
                ))}
            </div>
          )}

          <MoreOptions id="locator.more" summary={`${shares.length ? `Sharing with ${shares.length}` : "Not sharing"} · ${places.length} place${places.length === 1 ? "" : "s"}${me?.coarse ? " · Approximate" : ""}`}>
            <fieldset className="locSection">
              <legend>Sharing my location</legend>
              {!shares.length && <div className="locHint">You aren't sharing with anyone.</div>}
              {shares.map((s) => (
                <div className="locShareRow" key={s.to} data-share={s.to}>
                  <span>
                    <b>{s.name || s.to}</b> <span className="locHint">{untilText(s.until, now)}</span>
                  </span>
                  <button type="button" onClick={() => loc.stopSharing(s.to)}>
                    Stop
                  </button>
                </div>
              ))}
              {shares.length > 0 && (
                <>
                  <div className="field-row">
                    <input type="checkbox" id="loc-paused" checked={paused} onChange={(e) => loc.setPaused(e.target.checked)} />
                    <label htmlFor="loc-paused">Pause sharing</label>
                  </div>
                  <button type="button" className="locStopAll" onClick={() => loc.stopAll()}>
                    Stop Sharing Everywhere
                  </button>
                </>
              )}
              <div className="field-row">
                <input type="checkbox" id="loc-coarse" checked={!!me?.coarse} onChange={(e) => loc.setCoarse(e.target.checked)} />
                <label htmlFor="loc-coarse">Approximate location (about 1 km, rounded on this device)</label>
              </div>
            </fieldset>

            <fieldset className="locSection">
              <legend>Ask to see a buddy</legend>
              <div className="locButtons">
                <select aria-label="Buddy to ask" value={askWho} onChange={(e) => setAskWho(e.target.value)}>
                  <option value="">Pick a buddy...</option>
                  {buddies
                    .filter((b) => !state.friends.some((f) => f.key === b.key))
                    .map((b) => (
                      <option key={b.key} value={b.screenName}>
                        {b.screenName}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  disabled={!askWho}
                  onClick={async () => {
                    const r = await loc.askToSee(askWho)
                    flash(r.ok ? (r.already ? `${askWho} already shares with you.` : `Asked ${askWho}.`) : r.error)
                    setAskWho("")
                  }}
                >
                  Ask
                </button>
              </div>
            </fieldset>

            <fieldset className="locSection">
              <legend>Places</legend>
              {places.map((p) => (
                <div className="locShareRow" key={p.id} data-place={p.name}>
                  <span>
                    <b>{p.name}</b> <span className="locHint">{p.r >= 1000 ? `${p.r / 1000} km` : `${p.r} m`}</span>
                  </span>
                  <span className="locButtons">
                    <button type="button" onClick={() => mapApi.current?.focus(p, 15)}>
                      Show
                    </button>
                    <button type="button" onClick={() => loc.savePlaces(places.filter((x) => x.id !== p.id))}>
                      Delete
                    </button>
                  </span>
                </div>
              ))}
              <button type="button" onClick={() => setDialog({ kind: "place" })}>
                Add a Place...
              </button>
              <div className="locHint">Name a place, then pick a buddy and press Notify Me... to hear when they arrive or leave.</div>
            </fieldset>
            <div className="locHint">
              Only the buddies you pick see you, and only your latest position is kept (no history). iPhone web apps can't send your location from the background: it updates while 98ish is open. Map © OpenFreeMap, OpenMapTiles, OpenStreetMap contributors.
            </div>
          </MoreOptions>
        </div>
      </div>

      {dialog?.kind === "share" && <ShareDialog buddies={buddies} preset={dialog.preset} onClose={() => setDialog(null)} />}
      {dialog?.kind === "alert" && <AlertDialog friend={dialog.friend} places={places} watches={watches} onClose={() => setDialog(null)} onAddPlace={() => setDialog({ kind: "place" })} />}
      {dialog?.kind === "place" && <PlaceDialog mapCenter={() => mapApi.current?.center()} onClose={() => setDialog(null)} />}
    </div>
  )
}

export default Locator
