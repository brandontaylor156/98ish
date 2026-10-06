// Twin Replay: a game, replayed. The rallies play on Pickleball 98's athletes at the venue
// (one of the owner's real venues on a chosen court, or a game venue), with the video beside
// it in sync when there is one; and the stats tab.

import React, { useEffect, useMemo, useRef, useState } from "react"
import MoreOptions from "../../../shared/MoreOptions"
import { Select } from "../../../shared/select/Combo"
import { CHARACTERS, lookFor } from "../looks.js"
import { ghostSituations } from "./coach/ghost.js"
import { withPaths } from "./core/analyze.js"
import { buildFrames } from "./core/replay.js"
import { KIND_LABEL, KINDS } from "./core/hits.js"
import { HEAT_L, HEAT_W } from "./core/stats.js"
import { courtsOf, twinVenue, venueChoices } from "./venues.js"

const CAMS = [
  ["broadcast", "Broadcast"],
  ["side", "Side"],
  ["top", "Top"],
  ["follow", "Follow"],
  ["fence", "Fence"],
]
const SPEEDS = [1, 0.5, 0.25]
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`

const rosterFor = (players) => players.map((p, k) => ({ id: `p${p.id}`, team: p.team, ctrl: "cpu", level: "pro", name: p.name, character: CHARACTERS.filter((c) => !c.boss)[(k * 3 + 1) % CHARACTERS.filter((c) => !c.boss).length].id }))

export const TwinPlayer = ({ getEngine, game, video, onBack, onChange, onShare, onDelete, onClone = null, onRematch = null, moment = null, onCoach = null, onBackToCoach = null }) => {
  const analysis = useMemo(() => withPaths(game.analysis), [game.analysis])
  const rallies = analysis.rallies
  const [tab, setTab] = useState("replay")
  // a Coach moment opens on its rally
  const momentRally = moment ? Math.max(0, rallies.findIndex((r) => moment.t >= r.start - 0.6 && moment.t <= r.end + 0.6)) : 0
  const [ri, setRi] = useState(momentRally)
  const [st, setSt] = useState(null)
  const [playAll, setPlayAll] = useState(true)
  const [showVideo, setShowVideo] = useState(!!video)
  const [courts, setCourts] = useState([])
  const [busy, setBusy] = useState(false)
  const videoRef = useRef(null)
  const url = useMemo(() => (video ? URL.createObjectURL(video) : null), [video])
  useEffect(() => () => url && URL.revokeObjectURL(url), [url])

  const rally = rallies[ri] || null
  const window_ = rally ? { from: Math.max(0, rally.start - 1.5), to: rally.end + 2 } : null

  // start (or restart) the engine on this rally at this venue
  useEffect(() => {
    if (tab !== "replay" || !rally) return
    let live = true
    setBusy(true)
    ;(async () => {
      const venue = await twinVenue(game.venue || "stadium", game.court)
      if (!live) return
      const { frames } = buildFrames(analysis, window_)
      const e = getEngine()
      const roster = rosterFor(analysis.players)
      e?.playTwin({ frames, venue, roster })
      const keep = st
      if (keep) e?.twinControl({ cam: keep.cam, speed: keep.speed, follow: keep.follow })
      // a Coach moment: slow, following the player, from just before it, with the ghost
      if (moment && ri === momentRally) {
        const idx = Math.max(0, analysis.players.findIndex((p) => p.id === moment.player))
        // (runs to the line read best from the side; positions on the court from above)
        const cam = moment.ghost === "kitchen" ? "side" : moment.ghost === "recover" || moment.ghost === "spacing" ? "top" : "broadcast"
        e?.twinControl({ cam, follow: idx, speed: 0.5 })
        e?.twinSeek(Math.max(0, moment.t - window_.from - 1.5))
        if (moment.ghost) e?.twinGhost({ situations: ghostSituations(frames, idx, analysis, moment), look: lookFor(roster[idx].character) })
      }
      setBusy(false)
    })()
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, ri, game.venue, game.court, analysis, moment?.key])
  // leaving: the engine back to its title
  useEffect(
    () => () => {
      const e = getEngine()
      e?.stopTwin()
      e?.quit()
    },
    [getEngine],
  )
  // the scrubber and the video follow the engine
  useEffect(() => {
    if (tab !== "replay") return
    const id = setInterval(() => {
      const s = getEngine()?.twinState()
      if (!s) return
      setSt(s)
      const v = videoRef.current
      if (v && window_) {
        const want = window_.from + s.t
        if (Math.abs(v.currentTime - want) > 0.3) v.currentTime = want
        v.playbackRate = s.speed
        if (s.paused && !v.paused) v.pause()
        else if (!s.paused && v.paused) v.play().catch(() => {})
      }
      if (s.ended && playAll && ri < rallies.length - 1) setRi((i) => i + 1)
    }, 120)
    return () => clearInterval(id)
  })
  useEffect(() => {
    if (game.venue && venueChoices().find((v) => v.id === game.venue)?.real) courtsOf(game.venue).then(setCourts)
    else setCourts([])
  }, [game.venue])

  const ctl = (patch) => getEngine()?.twinControl(patch)
  const hits = rally ? rally.hits : []
  const nameOf = (id) => analysis.players.find((p) => p.id === id)?.name || `Player ${id + 1}`

  return (
    <div className="pkTwinPlayer" data-tab={tab}>
      <div className="pkTwinTop">
        <button type="button" onClick={onBack} aria-label="Back to your games">
          ‹ Games
        </button>
        <b className="pkTwinTitle">{game.title}</b>
        <div className="pkTwinTabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "replay"} className={tab === "replay" ? "is-on" : ""} onClick={() => setTab("replay")}>
            Replay
          </button>
          <button type="button" role="tab" aria-selected={tab === "stats"} className={tab === "stats" ? "is-on" : ""} onClick={() => setTab("stats")}>
            Stats
          </button>
        </div>
      </div>

      {tab === "replay" && (
        <>
          {url && showVideo && <video ref={videoRef} className="pkTwinPip" src={url} muted playsInline aria-label="Your video" />}
          {moment && ri === momentRally && (
            <div className="pkTwinMoment" data-coach-moment data-ghost={st?.ghost ? "on" : "off"}>
              <b>{moment.title || "Coach"}</b>
              <span>{moment.note}</span>
              {moment.ghost && <small>The see-through player is the Pro way.</small>}
              {onBackToCoach && (
                <button type="button" onClick={onBackToCoach} data-action="back-to-coach">
                  Back to Coach
                </button>
              )}
            </div>
          )}
          {!rally && <div className="pkCenter"><div className="pkPanel window">No rallies were found in this video.</div></div>}
          {rally && (
            <div className="pkTwinBar">
              <div className="pkTwinBarRow">
                <button type="button" disabled={ri === 0} onClick={() => setRi(ri - 1)} aria-label="Previous rally">
                  ⏮
                </button>
                <button type="button" className="pkPrimary" disabled={busy} onClick={() => ctl({ paused: !st?.paused })} aria-label={st?.paused ? "Play" : "Pause"} data-action="twin-play">
                  {st?.paused ? "▶" : "❚❚"}
                </button>
                <button type="button" disabled={ri >= rallies.length - 1} onClick={() => setRi(ri + 1)} aria-label="Next rally">
                  ⏭
                </button>
                <span className="pkTwinRally">
                  Rally {ri + 1} of {rallies.length} · {hits.length} shots
                </span>
              </div>
              <div className="pkTwinScrub">
                <input type="range" min="0" max={st?.duration || 1} step="0.05" value={st?.t || 0} onChange={(e) => getEngine()?.twinSeek(Number(e.target.value))} aria-label="Rally time" />
                <div className="pkTwinTicks" aria-hidden="true">
                  {window_ &&
                    hits.map((h, i) => (
                      <span key={i} className={`pkTwinTick team${h.team}`} style={{ left: `${((h.t - window_.from) / Math.max(0.1, window_.to - window_.from)) * 100}%` }} title={`${nameOf(h.player)}: ${KIND_LABEL[h.kind]}`} />
                    ))}
                </div>
              </div>
              <div className="pkTwinBarRow">
                <button type="button" onClick={() => ctl({ cam: CAMS[(CAMS.findIndex(([k]) => k === st?.cam) + 1) % CAMS.length][0] })} data-action="twin-cam">
                  Camera: {CAMS.find(([k]) => k === st?.cam)?.[1] || "Broadcast"}
                </button>
                <button type="button" onClick={() => ctl({ speed: SPEEDS[(SPEEDS.indexOf(st?.speed ?? 1) + 1) % SPEEDS.length] })}>
                  {st?.speed === 1 || !st ? "1x" : st.speed === 0.5 ? "½x" : "¼x"}
                </button>
                {st?.cam === "follow" && (
                  <Select value={st.follow} onChange={(e) => ctl({ follow: Number(e.target.value) })} aria-label="Follow which player">
                    {analysis.players.map((p, i) => (
                      <option key={p.id} value={i}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                )}
                <span className="pkMuted">{st ? `${clock(st.t)} / ${clock(st.duration)}` : ""}</span>
              </div>
              <MoreOptions id="pickleball.twin">
                <div className="pkTwinMore">
                  {url && (
                    <label>
                      <input type="checkbox" checked={showVideo} onChange={(e) => setShowVideo(e.target.checked)} /> Show my video
                    </label>
                  )}
                  <label>
                    <input type="checkbox" checked={playAll} onChange={(e) => setPlayAll(e.target.checked)} /> Play the rallies one after another
                  </label>
                  <label>
                    Where{" "}
                    <Select value={game.venue || "stadium"} onChange={(e) => onChange({ venue: e.target.value, court: null })} aria-label="Venue">
                      {venueChoices().map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.real ? `${v.short} (real)` : v.short}
                        </option>
                      ))}
                    </Select>
                  </label>
                  {courts.length > 0 && (
                    <label>
                      Court{" "}
                      <Select value={game.court ?? courts[0].id} onChange={(e) => onChange({ court: isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value) })} aria-label="Court">
                        {courts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    </label>
                  )}
                  <div className="pkTwinButtons">
                    <button type="button" onClick={onShare}>
                      Send to a friend...
                    </button>
                    {onRematch && (
                      <button type="button" onClick={onRematch} data-action="twin-rematch">
                        Rematch against the clones
                      </button>
                    )}
                    {onDelete && (
                      <button type="button" onClick={onDelete}>
                        Delete this game
                      </button>
                    )}
                  </div>
                </div>
              </MoreOptions>
            </div>
          )}
        </>
      )}

      {tab === "stats" && <TwinStats analysis={analysis} onRally={(i) => (setRi(i), setTab("replay"))} onClone={onClone} onCoach={onCoach} />}
    </div>
  )
}

const Heat = ({ heat, team }) => {
  const ref = useRef(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const cw = 12
    c.width = HEAT_W * cw
    c.height = (HEAT_L + 1) * cw
    const g = c.getContext("2d")
    g.fillStyle = "#2f62ad"
    g.fillRect(0, 0, c.width, c.height)
    for (let z = 0; z <= HEAT_L; z++)
      for (let x = 0; x < HEAT_W; x++) {
        const v = heat[z * HEAT_W + x]
        if (!v) continue
        g.fillStyle = `rgba(255,${Math.round(220 - 180 * v)},0,${0.25 + 0.7 * v})`
        // (the net at the top for both teams: their half seen from behind them)
        const row = z
        const col = team === 0 ? x : HEAT_W - 1 - x
        g.fillRect(col * cw, row * cw, cw, cw)
      }
    g.strokeStyle = "#fff"
    g.beginPath()
    g.moveTo(0, 2)
    g.lineTo(c.width, 2)
    const k = (2.134 / 6.706) * HEAT_L * cw
    g.moveTo(0, k)
    g.lineTo(c.width, k)
    g.moveTo(0, HEAT_L * cw)
    g.lineTo(c.width, HEAT_L * cw)
    g.stroke()
  }, [heat, team])
  return <canvas ref={ref} className="pkTwinHeat" aria-label="Where they stood (the net at the top)" />
}

export const TwinStats = ({ analysis, onRally, onClone = null, onCoach = null }) => {
  const s = analysis.stats
  const name = (id) => analysis.players.find((p) => p.id === id)?.name || `Player ${id + 1}`
  const color = (id) => analysis.players.find((p) => p.id === id)?.color || "#888"
  const maxHist = Math.max(1, ...Object.values(s.histogram || {}))
  return (
    <div className="pkTwinStats">
      <div className="pkTwinCard">
        <b>The game</b>
        <p>
          {s.rallies} rallies · {s.shots} shots · longest rally {s.longest} shots
        </p>
        <div className="pkTwinHist" aria-label="Rally lengths">
          {Object.entries(s.histogram || {})
            .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
            .map(([k, v]) => (
              <div key={k} className="pkTwinHistBar">
                <span style={{ height: `${(v / maxHist) * 100}%` }} />
                <small>{k}</small>
              </div>
            ))}
        </div>
        {s.highlights?.length > 0 && (
          <>
            <b>Highlights</b>
            <ul className="pkTwinList">
              {s.highlights.map((h) => (
                <li key={h.id}>
                  <button type="button" onClick={() => onRally(analysis.rallies.findIndex((r) => r.id === h.id))}>
                    ▶ {h.reason} · {h.hits} shots
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {s.players.map((p) => {
        const total = Math.max(1, p.shots)
        return (
          <div key={p.id} className="pkTwinCard">
            <b>
              <span className="pkTwinChip" style={{ background: color(p.id) }} /> {name(p.id)} <small className="pkMuted">{p.team === 0 ? "near side" : "far side"}</small>
            </b>
            <div className="pkTwinPlayerStats">
              <Heat heat={p.heat} team={p.team} />
              <dl>
                <dt>Shots</dt>
                <dd>{p.shots}</dd>
                <dt>At the kitchen line</dt>
                <dd>{Math.round(p.kitchenPct * 100)}%</dd>
                <dt>Covered</dt>
                <dd>{Math.round(p.distance)} m</dd>
                <dt>Last shot of a rally</dt>
                <dd>{p.rallyEnding}</dd>
                {p.serveDepth !== null && (
                  <>
                    <dt>Serves: returned from</dt>
                    <dd>{p.serveDepth <= 0 ? `${Math.abs(p.serveDepth).toFixed(1)} m behind the baseline` : `${p.serveDepth.toFixed(1)} m inside`}</dd>
                  </>
                )}
              </dl>
            </div>
            <div className="pkTwinMix" aria-label="Shot mix">
              {KINDS.filter((k) => p.mix[k]).map((k) => (
                <div key={k} className="pkTwinMixRow">
                  <span>{KIND_LABEL[k]}</span>
                  <span className="pkTwinMixBar">
                    <span style={{ width: `${(p.mix[k] / total) * 100}%` }} />
                  </span>
                  <span>{p.mix[k]}</span>
                </div>
              ))}
            </div>
            {(onClone || onCoach) && (
              <div className="pkTwinButtons">
                {onCoach && (
                  <button type="button" onClick={() => onCoach(p.id)} data-action="coach-me" data-player={p.id}>
                    Coach {name(p.id)} on this game
                  </button>
                )}
                {onClone && (
                  <button type="button" onClick={() => onClone(p.id)} data-action="make-clone" data-player={p.id}>
                    Make a Clone of {name(p.id)}...
                  </button>
                )}
              </div>
            )}
            {Object.keys(p.third).length > 0 && (
              <p className="pkMuted">
                Third shots:{" "}
                {Object.entries(p.third)
                  .map(([k, v]) => `${KIND_LABEL[k]} ${v}`)
                  .join(", ")}
              </p>
            )}
          </div>
        )
      })}
      <p className="pkMuted pkTwinNote">Shots are read from the video and its sound: the kinds are a good guess, not a referee. The ball's path is rebuilt between the hits.</p>
    </div>
  )
}
