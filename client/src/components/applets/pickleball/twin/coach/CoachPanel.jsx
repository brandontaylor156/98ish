// Coach (inside Pickleball 98: Real Games > Coach, or a Twin Replay game's Stats > Coach me):
// what your filmed games say about your game, the three things to fix, a week of practice for
// them, and how you're doing over time. Everything is worked out and kept on this device.

import React, { useEffect, useMemo, useState } from "react"
import MoreOptions from "../../../../shared/MoreOptions"
import { Select } from "../../../../shared/select/Combo"
import { drillById } from "../../practice/drillbook.js"
import { getGame, listGames } from "../store.js"
import { diagnose, formatValue, LEVEL_IDS, LEVEL_LABEL, metricById } from "./metrics.js"
import { weekPlan } from "./plan.js"
import { loadCoach, recordGame, saveCoach, seriesOf, streakOf, subscribeCoach, trendOf } from "./progress.js"
import "./Coach.css"

const VERDICT = { good: ["On target", "good"], close: ["Close", "close"], work: ["Work on it", "work"], unknown: ["Need more film", "unknown"] }
const TARGETS = ["intermediate", "pro", "legend"]
const when = (ms) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" })

const useCoach = () => {
  const [state, setState] = useState(loadCoach)
  useEffect(() => subscribeCoach(() => setState(loadCoach())), [])
  return state
}

// a level ruler: Rookie .. Legend with your mark and the target
const Ruler = ({ pos, target }) => {
  const x = (p) => 6 + ((Math.max(-1, Math.min(3, p)) + 1) / 4) * 188
  const ti = LEVEL_IDS.indexOf(target)
  return (
    <svg className="pkCchRuler" viewBox="0 0 200 22" aria-hidden="true">
      <rect x="6" y="8" width="188" height="6" className="pkCchRulerBar" />
      {LEVEL_IDS.map((id, i) => (
        <line key={id} x1={x(i)} x2={x(i)} y1="5" y2="17" className={i === ti ? "pkCchTick is-target" : "pkCchTick"} />
      ))}
      {pos !== null && <circle cx={x(pos)} cy="11" r="4.5" className="pkCchMark" />}
    </svg>
  )
}

// a small progress chart: the metric over time with the target band line
const Spark = ({ series, band, better }) => {
  if (series.length < 2) return null
  const vs = series.map((s) => s.v).concat(band)
  const lo = Math.min(...vs)
  const hi = Math.max(...vs)
  const span = hi - lo || 1
  const X = (i) => 4 + (i / (series.length - 1)) * 112
  const Y = (v) => 34 - ((v - lo) / span) * 28
  const pts = series.map((s, i) => `${X(i).toFixed(1)},${Y(s.v).toFixed(1)}`).join(" ")
  return (
    <svg className="pkCchSpark" viewBox="0 0 120 40" aria-hidden="true">
      <line x1="4" x2="116" y1={Y(band)} y2={Y(band)} className="pkCchBand" />
      <polyline points={pts} className="pkCchLine" />
      <circle cx={X(series.length - 1)} cy={Y(series.at(-1).v)} r="2.6" className={`pkCchEnd ${trendOf(series, better) > 0 ? "is-up" : trendOf(series, better) < 0 ? "is-down" : ""}`} />
    </svg>
  )
}

const MePickers = ({ games, me, setMe }) =>
  games.map((g) => (
    <label key={g.key} className="pkCchMe">
      <span>
        {g.title} <small className="pkMuted">{when(g.created)}</small>
      </span>
      <Select value={me[g.key] ?? ""} onChange={(e) => setMe(g.key, e.target.value)} aria-label={`You in ${g.title}`}>
        <option value="">Not in this game</option>
        {g.analysis.players.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
    </label>
  ))

export default function CoachPanel({ focus = null, demo = null, onWatch, onDrill, onBack }) {
  const coach = useCoach()
  const [games, setGames] = useState(null) // [{ key, title, created, analysis }]
  const [tab, setTab] = useState("game")
  const [open, setOpen] = useState(null) // the metric row that's open
  const target = coach.target || "pro"

  // the games: your saved ones (+ the demo when you came from it), with their analyses
  useEffect(() => {
    let live = true
    ;(async () => {
      const list = await listGames().catch(() => [])
      const full = []
      for (const g of list) {
        if (!g.rallies) continue
        const one = await getGame(g.id).catch(() => null)
        if (one?.analysis) full.push({ key: g.id, title: g.title, created: g.created, analysis: one.analysis })
      }
      if (demo?.analysis) full.unshift({ key: "demo", title: demo.title, created: demo.created, analysis: demo.analysis })
      if (live) setGames(full)
    })()
    return () => {
      live = false
    }
  }, [demo])

  // "coach me on this game" names you in that game
  useEffect(() => {
    if (!focus) return
    const s = loadCoach()
    if (s.me[focus.key] !== focus.player) saveCoach({ ...s, me: { ...s.me, [focus.key]: focus.player } })
  }, [focus?.key, focus?.player])

  const mine = useMemo(() => (games || []).filter((g) => coach.me[g.key] !== undefined && coach.me[g.key] !== null && g.analysis.players.some((p) => p.id === coach.me[g.key])), [games, coach.me])
  const diag = useMemo(() => (mine.length ? diagnose(mine, coach.me, { target }) : null), [mine, coach.me, target])

  // each game you're in: its own numbers go into the history (once)
  useEffect(() => {
    if (!mine.length) return
    let s = loadCoach()
    let changed = false
    for (const g of mine) {
      if (g.key === "demo") continue
      const seen = s.history.find((h) => h.game === g.key)
      if (seen && seen.player === coach.me[g.key]) continue
      const one = diagnose([g], coach.me, { target })
      s = recordGame(s, { game: g.key, at: g.created, metrics: one.metrics, level: one.level })
      s.history = s.history.map((h) => (h.game === g.key ? { ...h, player: coach.me[g.key] } : h))
      changed = true
    }
    if (changed) saveCoach(s)
  }, [mine])

  const plan = coach.plan
  const makePlan = () => diag && saveCoach({ ...loadCoach(), plan: weekPlan(diag) })
  const setTarget = (t) => saveCoach({ ...loadCoach(), target: t })
  const setMe = (key, v) => {
    const s = loadCoach()
    const me = { ...s.me }
    if (v === "") delete me[key]
    else me[key] = Number(v)
    saveCoach({ ...s, me })
  }
  const startItem = (it) => {
    saveCoach({ ...loadCoach(), done: { ...loadCoach().done, [it.key]: Date.now() } })
    onDrill?.(it)
  }
  const streak = streakOf(coach)
  const unnamed = (games || []).filter((g) => coach.me[g.key] === undefined)

  return (
    <div className="pkCch" data-coach-tab={tab}>
      <div className="pkCchTop">
        <button type="button" onClick={onBack}>
          ‹ Back
        </button>
        <b>Coach</b>
        <div className="pkTwinTabs" role="tablist">
          {[
            ["game", "Your game"],
            ["plan", "Plan"],
            ["progress", "Progress"],
          ].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "is-on" : ""} onClick={() => setTab(id)} data-coach-tab-btn={id}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="pkCchScroll">
        {games === null && <p className="pkMuted">Looking at your games...</p>}

        {games && !games.length && (
          <div className="pkPanel window pkCchCard">
            <b>Film a game first</b>
            <p>Coach learns your game from Twin Replay: film a real game (Real Games &gt; Film a Game), then come back here. Or open Twin Replay's demo rally to see how it works.</p>
          </div>
        )}

        {games && games.length > 0 && !mine.length && tab === "game" && (
          <div className="pkPanel window pkCchCard">
            <b>Which player are you?</b>
            <p className="pkMuted">Pick yourself in a game and Coach reads your part of it.</p>
            <MePickers games={games} me={coach.me} setMe={setMe} />
          </div>
        )}

        {tab === "game" && diag && (
          <>
            <div className="pkPanel window pkCchCard pkCchLevel" data-coach-level>
              <div>
                <small className="pkMuted">From {mine.length === 1 ? "1 game" : `${mine.length} games`}</small>
                <b>{diag.level.label}</b>
                {diag.level.pos !== null && <Ruler pos={diag.level.pos} target={target} />}
              </div>
              {streak > 0 && <span className="pkCchStreak">{streak} week{streak > 1 ? "s" : ""} in a row</span>}
            </div>
            <ul className="pkCchList">
              {diag.metrics.map((m) => {
                const [label, cls] = VERDICT[m.verdict]
                const isOpen = open === m.id
                return (
                  <li key={m.id} className={`pkCchRow is-${cls}`} data-metric={m.id} data-verdict={m.verdict}>
                    <button type="button" className="pkCchRowHead" onClick={() => setOpen(isOpen ? null : m.id)} aria-expanded={isOpen}>
                      <span className={`pkCchChip is-${cls}`}>{label}</span>
                      <span className="pkCchName">{m.label}</span>
                      <span className="pkCchVal">
                        {formatValue(m)}
                        {m.pos !== null && <small className="pkMuted"> · {LEVEL_LABEL[target]}: {m.better === "high" ? "≥" : "≤"} {formatValue(m, m.band)}</small>}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="pkCchRowBody">
                        {m.pos !== null && <Ruler pos={m.pos} target={target} />}
                        <p>{m.explain}</p>
                        {m.detail && <p className="pkMuted">{m.detail}</p>}
                        <p className="pkMuted">
                          Seen {m.n} time{m.n === 1 ? "" : "s"} · {m.conf >= 0.8 ? "sure" : m.conf >= 0.5 ? "fairly sure" : "a first guess"}
                        </p>
                        {m.moments.length > 0 && (
                          <div className="pkTwinButtons">
                            {m.moments.slice(0, 2).map((mo, i) => (
                              <button key={i} type="button" onClick={() => onWatch?.(mo.game, { ...mo, title: m.label })} data-action="watch-moment">
                                ▶ Watch: {mo.note || "this moment"}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </>
        )}

        {tab === "plan" && (
          <div className="pkCchPlan">
            {!diag && <p className="pkMuted">Pick yourself in a filmed game first (Your game).</p>}
            {diag && (!plan || !plan.items.length) && (
              <div className="pkPanel window pkCchCard">
                <b>Your practice week</b>
                <p>Coach picks your three biggest fixable weaknesses and builds three short practice sessions from Pickleball 98's drills.</p>
                <div className="pkTwinButtons">
                  <button type="button" className="pkPrimary" onClick={makePlan} data-action="make-plan">
                    Make my plan
                  </button>
                </div>
                {plan && !plan.items.length && <p className="pkMuted">Nothing below your target level: try a higher target under More options.</p>}
              </div>
            )}
            {plan?.items?.length > 0 && (
              <>
                <div className="pkPanel window pkCchCard">
                  <b>This week: {plan.weaknesses.map((w) => w.label.toLowerCase()).join(", ")}</b>
                  <ol className="pkCchCues">
                    {plan.cues.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ol>
                </div>
                {[1, 2, 3].map((day) => (
                  <div key={day} className="pkPanel window pkCchCard" data-plan-day={day}>
                    <b>Session {day}</b>
                    <ul className="pkCchItems">
                      {plan.items
                        .filter((it) => it.day === day)
                        .map((it) => (
                          <li key={it.key} className={coach.done[it.key] ? "is-done" : ""}>
                            <span>
                              <b>{it.kind === "drill" ? drillById(it.drill)?.name || it.drill : it.kind === "machine" ? it.title : "On the court"}</b>
                              <small className="pkMuted">
                                {it.balls ? `${it.balls} balls · ` : ""}
                                {it.kind === "cue" ? it.cue : it.why}
                              </small>
                            </span>
                            {it.kind !== "cue" && (
                              <button type="button" onClick={() => startItem(it)} data-action="start-drill" data-drill={it.drill || it.kind}>
                                {coach.done[it.key] ? "Again" : "Start"}
                              </button>
                            )}
                          </li>
                        ))}
                    </ul>
                  </div>
                ))}
                <div className="pkTwinButtons">
                  <button type="button" onClick={makePlan}>
                    Remake the plan from my latest games
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {tab === "progress" && (
          <div className="pkCchProgress">
            {coach.history.length < 2 && <p className="pkMuted">Film another game to see how you're changing. Each game you're in adds a point to these charts.</p>}
            {coach.history.length >= 1 && (
              <ul className="pkCchList">
                {(diag?.metrics || [])
                  .map((m) => ({ m, s: seriesOf(coach.history, m.id) }))
                  .filter(({ s }) => s.length >= 1)
                  .map(({ m, s }) => {
                    const t = trendOf(s, m.better)
                    return (
                      <li key={m.id} className="pkCchRow" data-progress={m.id}>
                        <div className="pkCchRowHead is-static">
                          <span className="pkCchName">{m.label}</span>
                          <Spark series={s} band={metricById(m.id).bands[target]} better={m.better} />
                          <span className="pkCchVal">
                            {formatValue(m, s.at(-1).v)} <small className="pkMuted">{t > 0 ? "better" : t < 0 ? "worse" : s.length > 1 ? "steady" : when(s[0].at)}</small>
                          </span>
                        </div>
                      </li>
                    )
                  })}
              </ul>
            )}
          </div>
        )}

        {games && games.length > 0 && (
          <MoreOptions id="pickleball.coach" label="More options">
            <div className="pkCchMore">
              <label>
                Target level{" "}
                <Select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Target level">
                  {TARGETS.map((t) => (
                    <option key={t} value={t}>
                      {LEVEL_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </label>
              <b>You in each game</b>
              <MePickers games={games} me={coach.me} setMe={setMe} />
              {unnamed.length > 0 && <p className="pkMuted">{unnamed.length} game{unnamed.length > 1 ? "s" : ""} without you picked.</p>}
              <p className="pkMuted">Coach works on this device only; nothing about your games is sent anywhere.</p>
            </div>
          </MoreOptions>
        )}
      </div>
    </div>
  )
}
