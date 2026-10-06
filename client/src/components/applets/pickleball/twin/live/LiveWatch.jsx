// Live Broadcast, watching: a friend's real game, live, played by Pickleball 98's athletes at
// the same venue and court. The stream (tracked positions + hits) is buffered DELAY seconds
// (stream.js) and turned into frames the engine plays as they come (engine.twinAppend).
// Cameras, the live score, reactions, the viewer count, and "10 s back" from what's kept.

import React, { useEffect, useRef, useState } from "react"
import { useNet } from "../../../network/NetContext"
import { CHARACTERS } from "../../looks.js"
import { courtsOf, twinVenue, venueChoices } from "../venues.js"
import { newId, putGame } from "../store.js"
import { createCursor, createStream } from "./stream.js"
import { splitTicks } from "./packet.js"
import "../TwinReplay.css"
import "./Live.css"

const CAMS = [
  ["broadcast", "Broadcast"],
  ["side", "Side"],
  ["top", "Top"],
  ["follow", "Follow"],
]
const REACTIONS = ["👏", "🔥", "😮", "🎉", "😂", "💪"]
const looks = CHARACTERS.filter((c) => !c.boss)
const rosterFor = (players) => players.map((p, k) => ({ id: `p${p.id}`, team: p.team, ctrl: "cpu", level: "pro", name: p.name, character: looks[(k * 3 + 1) % looks.length].id }))

export default function LiveWatch({ getEngine, id, code = null, onExit }) {
  const net = useNet()
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(null)
  const [viewers, setViewers] = useState(0)
  const [st, setSt] = useState(null)
  const [score, setScore] = useState(null)
  const [ended, setEnded] = useState(false)
  const [waiting, setWaiting] = useState(true)
  const [reactions, setReactions] = useState([])
  const [saved, setSaved] = useState(null)
  const streamRef = useRef(null)
  const cursorRef = useRef(createCursor())
  const startedRef = useRef(false)
  const rewoundRef = useRef(false) // the viewer chose to watch from behind (10 s back)
  const socket = net?.socket

  // join: the last minute comes with it (late joiners see the game right away)
  useEffect(() => {
    if (!socket || net?.status !== "online") {
      setError("Watching needs the network. Check you're online and try again.")
      return
    }
    let live = true
    const onTick = (bytes) => {
      const t = streamRef.current?.addTick(bytes)
      if (import.meta.env?.DEV && t !== null && t !== undefined) (window.__liveArrivals ||= []).push([Date.now(), t, bytes.byteLength ?? bytes.length ?? 0])
    }
    const onEv = (e) => {
      const r = streamRef.current?.addEvent(e)
      if (r?.k === "score") setScore(streamRef.current.score)
    }
    const onInfo = (d) => d?.id === id && setViewers(d.viewers || 0)
    const onReact = (d) => {
      const rid = Math.random()
      setReactions((r) => [...r.slice(-8), { id: rid, e: d.e, name: d.name }])
      setTimeout(() => setReactions((r) => r.filter((x) => x.id !== rid)), 2600)
    }
    const onEnd = (d) => d?.id === id && setEnded(d.reason || "ended")
    socket.on("bc:t", onTick)
    socket.on("bc:ev", onEv)
    socket.on("bc:info", onInfo)
    socket.on("bc:react", onReact)
    socket.on("bc:end", onEnd)
    net.request("bc:watch", id ? { id, code } : { code }).then((r) => {
      if (!live) return
      if (!r?.ok) return setError(r?.error || "That game isn't live anymore.")
      const s = createStream({ players: r.info.players })
      for (const e of r.events || []) s.addEvent(e)
      for (const b of r.ring ? splitTicks(r.ring) : []) s.addTick(b)
      streamRef.current = s
      setScore(s.score || r.info.score || null)
      setViewers(r.viewers || 1)
      setInfo(r.info)
    })
    return () => {
      live = false
      socket.off("bc:t", onTick)
      socket.off("bc:ev", onEv)
      socket.off("bc:info", onInfo)
      socket.off("bc:react", onReact)
      socket.off("bc:end", onEnd)
      if (socket.connected) socket.emit("bc:unwatch", {}, () => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, id, code])

  // the engine: started on the first frames, then fed as the buffer fills
  useEffect(() => {
    if (!info) return
    let alive = true
    let venue = null
    ;(async () => {
      let courtId = info.court
      if (info.venue && venueChoices().find((v) => v.id === info.venue)?.real) {
        const cs = await courtsOf(info.venue)
        courtId = cs.find((c) => String(c.id) === String(info.court))?.id ?? cs[0]?.id ?? null
      }
      venue = await twinVenue(info.venue || "stadium", courtId)
    })()
    const id_ = setInterval(() => {
      const s = streamRef.current
      const e = getEngine()
      if (!s || !e || !alive || venue === null) return
      const frames = cursorRef.current.step(s)
      if (!startedRef.current) {
        if (frames.length < 2) return
        startedRef.current = true
        e.playTwin({ frames, venue, roster: rosterFor(s.players), live: true })
        setWaiting(false)
      } else if (frames.length) e.twinAppend(frames)
      const now = e.twinState()
      // live means live: a slow phone (or a tab that slept) that fell behind catches up,
      // unless the viewer went back on purpose
      if (now && !rewoundRef.current && now.behind > 2.5) e.twinSeek(now.duration - 0.3)
      if (now && rewoundRef.current && now.behind < 1) rewoundRef.current = false
      setSt(now)
    }, 150)
    if (typeof window !== "undefined" && import.meta.env?.DEV) window.__liveWatch = { stream: () => streamRef.current, cursor: cursorRef.current, state: () => getEngine()?.twinState() }
    return () => {
      alive = false
      clearInterval(id_)
    }
  }, [info, getEngine])
  // leaving: the engine back to its title
  useEffect(
    () => () => {
      const e = getEngine()
      e?.stopTwin()
      e?.quit()
    },
    [getEngine]
  )

  const ctl = (patch) => getEngine()?.twinControl(patch)
  const rewind = () => {
    const s = getEngine()?.twinState()
    if (!s) return
    rewoundRef.current = true
    getEngine().twinSeek(Math.max(0, s.t - 10))
  }
  const goLive = () => {
    const s = getEngine()?.twinState()
    if (!s) return
    rewoundRef.current = false
    getEngine().twinSeek(s.duration)
  }
  const react = (e) => net.request("bc:react", { e })
  const save = async () => {
    const s = streamRef.current
    if (!s) return
    const analysis = s.toAnalysis()
    const g = { id: newId(), title: info?.title || "Live game", created: Date.now(), duration: analysis.duration, venue: info?.venue && venueChoices().find((v) => v.id === info.venue)?.real ? info.venue : null, court: info?.court ?? null, analysis, live: true, shared: true, thumb: null }
    try {
      await putGame(g)
      setSaved(g)
    } catch (e) {
      setError(e.message)
    }
  }
  const behind = st ? Math.max(0, st.behind) : 0
  const atLive = behind < 1.5
  const names = streamRef.current?.players || info?.players || []
  const venueName = venueChoices().find((v) => v.id === info?.venue)?.short || ""

  return (
    <div className="pkTwin pkLive pkLiveWatch" data-view={ended ? "ended" : "watch"}>
      <div className="pkTwinTop pkLiveTop">
        <button type="button" onClick={onExit} aria-label="Stop watching">
          ‹ Back
        </button>
        <span className={`pkLiveBadge${ended ? " is-over" : ""}`} data-live-badge>
          {ended ? "ENDED" : "● LIVE"}
        </span>
        <b className="pkTwinTitle">
          {info ? `${info.host}${venueName ? ` · ${venueName}` : ""}${info.courtName ? ` · ${info.courtName}` : ""}` : "Joining..."}
        </b>
        <span className="pkLiveViewers" data-viewers={viewers}>
          👁 {viewers}
        </span>
      </div>
      {score && (
        <div className="pkLiveBug" data-score>
          <span>{names.filter((p) => p.team === 0).map((p) => p.name).join(" / ") || "Near"}</span>
          <b>{score.call || `${score.a}-${score.b}`}</b>
          <span>{names.filter((p) => p.team === 1).map((p) => p.name).join(" / ") || "Far"}</span>
        </div>
      )}
      <div className="pkLiveReacts pkLiveReactsWatch" aria-live="polite">
        {reactions.map((r) => (
          <span key={r.id} className="pkLiveReact" title={r.name}>
            {r.e}
          </span>
        ))}
      </div>
      {error && (
        <div className="pkCenter">
          <div className="pkPanel window">
            <p>{error}</p>
            <button type="button" onClick={onExit}>
              Back
            </button>
          </div>
        </div>
      )}
      {!error && waiting && !ended && (
        <div className="pkCenter pkDim">
          <div className="pkPanel window">{info ? "Waiting for the game to start..." : "Joining..."}</div>
        </div>
      )}
      {ended && (
        <div className="pkCenter">
          <div className="pkPanel window pkLiveEnded">
            <b data-end-reason={ended}>{ended === "left" ? "The filming phone lost its connection." : ended === "time" ? "The broadcast reached its 3-hour limit." : "The broadcast is over."}</b>
            {saved ? <p>Kept in Twin Replay as "{saved.title}".</p> : <p>Keep this game? It goes to your Twin Replay games (just where everyone moved, no video).</p>}
            <div className="pkTwinButtons">
              {!saved && streamRef.current?.newest > 5 && (
                <button type="button" className="pkPrimary" onClick={save} data-action="live-save">
                  Save to Twin Replay
                </button>
              )}
              <button type="button" onClick={onExit}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
      {!error && !waiting && (
        <div className="pkTwinBar pkLiveWatchBar">
          <div className="pkTwinBarRow">
            {CAMS.map(([c, label]) => (
              <button key={c} type="button" className={st?.cam === c ? "is-on" : ""} onClick={() => ctl({ cam: c })} data-cam={c}>
                {label}
              </button>
            ))}
          </div>
          <div className="pkTwinBarRow">
            <button type="button" onClick={rewind} data-action="live-rewind">
              ⟲ 10 s
            </button>
            {atLive ? (
              <span className="pkLiveNow" data-live-now>
                Live
              </span>
            ) : (
              <button type="button" className="pkPrimary" onClick={goLive} data-action="live-now">
                {Math.round(behind)} s behind · Go live
              </button>
            )}
            <span className="pkLiveReactRow">
              {REACTIONS.slice(0, 4).map((e) => (
                <button key={e} type="button" onClick={() => react(e)} aria-label={`React ${e}`} data-react={e}>
                  {e}
                </button>
              ))}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
