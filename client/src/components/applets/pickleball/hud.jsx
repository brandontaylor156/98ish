import React, { forwardRef } from "react"
import { bindingsFor, keyName } from "./input.js"

// Pickleball 98's in-game overlays, drawn like a TV broadcast: the score bug, the umpire's
// score call, line calls and faults, how your shot was timed, the timing and serve meter,
// the replay bug, practice and tutorial panels, and the end-of-match stats.

const MPH = 2.23694

export const ScoreBug = ({ hud, online }) => {
  if (!hud) return null
  return (
    <div className="pkBug" aria-live="polite" data-testid="scorebug">
      <div className="pkBugHead">
        <span>{hud.venue}</span>
        <span>
          {hud.scoring === "rally" ? "Rally" : "Side-out"} &middot; to {hud.target}
        </span>
      </div>
      {[0, 1].map((team) => (
        <div key={team} className={`pkBugRow pkBugRow--${team}${hud.serving === team ? " is-serving" : ""}${team === hud.yourTeam && hud.humans < 2 ? " is-you" : ""}`}>
          <span className="pkBugServe" aria-label={hud.serving === team ? "serving" : undefined}>
            {hud.serving === team ? (hud.doubles && hud.scoring === "sideout" ? hud.serverNumber : "") : ""}
          </span>
          <span className="pkBugName">{hud.names?.[team]}</span>
          <span className="pkBugPts">{hud.score[team]}</span>
        </div>
      ))}
      <div className="pkBugCall" data-testid="score-call">
        {hud.call}
        {online && <span className="pkBugOnline">{online}</span>}
      </div>
    </div>
  )
}

// The one banner slot (banner.js): whatever the broadcast says right now, one thing at a
// time: the score call ("Side out" / "GUS TO SERVE" / 0-1-1), a fault or a point's outcome, a
// line call, or your last shot ("Unattackable dink · good · 22 mph"). Its lifetime is kept by
// the game, so it goes away even with animations off.
export const Banner = ({ banner }) => {
  if (!banner) return null
  return (
    <div key={banner.id} className={`pkBanner pkBanner--${banner.kind} pkTone--${banner.tone || "ok"}${banner.p2 ? " is-p2" : ""}${banner.perfect ? " is-perfect" : ""}`} role="status" aria-live="polite" data-testid="banner" data-kind={banner.kind} data-id={banner.id}>
      {banner.over && <small>{banner.over}</small>}
      <b>{banner.text}</b>
      {banner.sub && <span>{banner.sub}</span>}
    </div>
  )
}

// a shot's banner: what it gave them, then how it was timed and how fast
export const shotBanner = (shot) => {
  const g = shot.grade || ""
  const word = { perfect: "perfect", good: "good", early: "early", late: "late", "very early": "way early", "very late": "way late", soft: "soft" }[g] || ""
  const sub = [word, shot.speed ? `${Math.round(shot.speed * MPH)} mph` : ""].filter(Boolean).join(" · ")
  return { kind: "shot", text: shot.label, sub, tone: shot.tone || "ok", p2: shot.slot === 1, perfect: g === "perfect" }
}

// The one hint line: what to do right now, in a few words; it goes away for good after
// your first few points (Settings: Show controls on screen brings it back)
export const HintLine = ({ text }) =>
  text ? (
    <div className="pkHint" aria-hidden="true">
      {text}
    </div>
  ) : null

// the umpire's call before each serve, lower third
export const CallCard = ({ call }) =>
  call ? (
    <div key={call.id} className="pkCallCard">
      <small>{call.server} to serve</small>
      <b>{call.text}</b>
    </div>
  ) : null

export const Callouts = ({ list }) => (
  <div className="pkCallouts2" aria-live="assertive">
    {list.map((c) => (
      <div key={c.id} className={`pkCallout2 pkCallout2--${c.kind}`}>
        {c.text}
      </div>
    ))}
  </div>
)

// how your last shot went: what it gave them (the label: "Unattackable dink", "Popped up!",
// "Speed-up!"...) and how it was timed
export const GradePop = ({ shot }) => {
  if (!shot) return null
  const g = shot.grade || ""
  const word = { perfect: "perfect", good: "good", early: "early", late: "late", "very early": "way early", "very late": "way late", soft: "soft" }[g] || ""
  return (
    <div key={shot.id} className={`pkGrade pkGrade--${g.replace(" ", "-")} pkTone--${shot.tone || "ok"}${shot.slot === 1 ? " is-p2" : ""}`}>
      <b>{shot.label}</b>
      <span>
        {word}
        {shot.speed ? ` · ${Math.round(shot.speed * MPH)} mph` : ""}
      </span>
    </div>
  )
}

// The timing meter: the engine moves its parts (CSS variables and data attributes)
export const Meter = forwardRef(({ slot = 0 }, ref) => (
  <div ref={ref} className={`pkMeter pkMeter--${slot}`} data-mode="" aria-hidden="true">
    <div className="pkMeterRally">
      <div className="pkMeterTrack">
        <i className="pkMeterGood" />
        <i className="pkMeterPerfect" />
        <i className="pkMeterRel" />
        <i className="pkMeterBall" />
      </div>
      <div className="pkMeterPower">
        <i />
        <em className="pkPaceMarks">
          <span>soft</span>
          <span>firm</span>
          <span>hard</span>
        </em>
      </div>
      <div className="pkMeterLabels">
        <span>early</span>
        <span className="pkMeterHeight" />
        <span>late</span>
      </div>
    </div>
    <div className="pkMeterServe">
      <div className="pkMeterServeTrack">
        <i className="pkMeterServeZone" />
        <i className="pkMeterServeFill" />
      </div>
      <span>Serve: hold... let go in the green</span>
    </div>
  </div>
))

export const ControlsStrip = ({ keys, humans, touch, serve }) => {
  if (touch) return null
  const b = bindingsFor(keys)
  const row = (set, who, aim) => (
    <span className="pkStripSet" key={set}>
      {who && <b>{who}</b>}
      <kbd>{keyName(b[set].hit[0])}</kbd>
      {set === "solo" ? " or click" : ""} hit: tap = soft, hold = hard &middot; {aim}
    </span>
  )
  return (
    <div className="pkStrip">
      {humans >= 2 ? [row("p1", "P1", "aim: move keys while holding"), row("p2", "P2", "aim: arrows while holding")] : row("solo", null, "aim: point at their court")}
      <span className="pkStripSet">
        {serve ? "Hold hit to serve, let go in the green" : "Let go just before the ball arrives"} &middot; <kbd>C</kbd> camera &middot; <kbd>P</kbd> pause
      </span>
    </div>
  )
}

export const ReplayBug = ({ touch }) => (
  <div className="pkReplayBug">
    <b>REPLAY</b>
    <span>{touch ? "Tap to skip" : "Press hit to skip"}</span>
  </div>
)

export const DrillPanel = ({ drill, progress, onQuit, onRetry }) => {
  const p = progress || { made: 0, attempts: 0, total: drill.total }
  return (
    <div className="pkDrillPanel">
      <b>{drill.name}</b>
      <small>{drill.goal}</small>
      <div className="pkDrillDots">
        {Array.from({ length: drill.total }, (_, i) => (
          <i key={i} className={i < (p.results?.length || 0) ? (p.results[i] ? "is-made" : "is-miss") : ""} />
        ))}
      </div>
      <span className="pkDrillScore">
        {p.made} / {drill.total}
      </span>
      {p.done && (
        <div className="pkDrillDone">
          <b>{p.made >= drill.pass ? (p.made === drill.total ? "Gold!" : p.made >= drill.pass + 1 ? "Silver!" : "Passed!") : "Keep at it"}</b>
          <div className="pkRow">
            <button type="button" className="pkPrimary" onClick={onRetry}>
              Again
            </button>
            <button type="button" onClick={onQuit}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export const TutorialPanel = ({ step, index, total, text, progress, onNext, onQuit }) => (
  <div className={`pkTutorial${step.card ? " is-card" : ""}`} data-step={step.id}>
    <small>
      Tutorial {index + 1} / {total}
    </small>
    <b>{step.title}</b>
    <p>{text}</p>
    {!step.card && step.need && (
      <span className="pkDrillScore">
        {Math.min(progress?.made || 0, step.need)} / {step.need}
      </span>
    )}
    {!step.card && step.moved && <span className="pkDrillScore">{progress?.done ? "Nice!" : "Move around..."}</span>}
    <div className="pkRow">
      {(step.card || progress?.done) && (
        <button type="button" className="pkPrimary" onClick={onNext} data-action="tutorial-next" autoFocus>
          {index + 1 >= total ? "Finish" : "Next"}
        </button>
      )}
      {!step.card && !progress?.done && (
        <button type="button" onClick={onNext}>
          Skip
        </button>
      )}
      <button type="button" onClick={onQuit}>
        Quit Tutorial
      </button>
    </div>
  </div>
)

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "-")

export const OverScreen = ({ result, session, onAgain, onMenu, onNext, reward, children }) => {
  const s = result.stats
  const t = s.teams
  const names = result.names || ["You", "Them"]
  const title = session?.kind === "versus" ? `${names[result.winner]} win${names[result.winner]?.includes(" / ") ? "" : "s"}!` : result.youWon ? "You win!" : "They win this one"
  return (
    <div className="pkCenter pkDim">
      <div className="pkOver2 window">
        <div className="title-bar">
          <div className="title-bar-text">{session?.tour ? session.tour.title : "Match over"}</div>
        </div>
        <div className="window-body">
          <b className={`pkOverTitle ${result.youWon || session?.kind === "versus" ? "pkWin" : "pkLose"}`}>{title}</b>
          <p className="pkFinal2">
            {result.score[0]} - {result.score[1]}
          </p>
          <table className="pkStats">
            <thead>
              <tr>
                <th />
                <th>{names[0]}</th>
                <th>{names[1]}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>Winners</th>
                <td>{t[0].winners}</td>
                <td>{t[1].winners}</td>
              </tr>
              <tr>
                <th>Errors</th>
                <td>{t[0].errors}</td>
                <td>{t[1].errors}</td>
              </tr>
              <tr>
                <th>Aces</th>
                <td>{t[0].aces}</td>
                <td>{t[1].aces}</td>
              </tr>
              <tr>
                <th>Perfect timing</th>
                <td>{pct(t[0].perfect, t[0].shots)}</td>
                <td>{pct(t[1].perfect, t[1].shots)}</td>
              </tr>
              <tr>
                <th>Unattackable dinks</th>
                <td>{pct(t[0].goodDinks || 0, t[0].dinks || 0)}</td>
                <td>{pct(t[1].goodDinks || 0, t[1].dinks || 0)}</td>
              </tr>
              <tr>
                <th>Pop-ups</th>
                <td>{t[0].popups || 0}</td>
                <td>{t[1].popups || 0}</td>
              </tr>
              <tr>
                <th>Speed-ups / counters</th>
                <td>
                  {t[0].speedups || 0} / {t[0].counters || 0}
                </td>
                <td>
                  {t[1].speedups || 0} / {t[1].counters || 0}
                </td>
              </tr>
              <tr>
                <th>Fastest shot</th>
                <td>{Math.round(t[0].fastest * MPH)} mph</td>
                <td>{Math.round(t[1].fastest * MPH)} mph</td>
              </tr>
            </tbody>
          </table>
          <p className="pkMuted">
            {s.rallies} rallies &middot; longest {s.longest} shots
          </p>
          {reward && <p className="pkRewardLine">{reward}</p>}
          {children}
          {!children && (
            <div className="pkRow pkRowCenter">
              {onNext && (
                <button type="button" className="pkPrimary" onClick={onNext} autoFocus data-action="next">
                  Next Round
                </button>
              )}
              {onAgain && (
                <button type="button" className={onNext ? "" : "pkPrimary"} onClick={onAgain} autoFocus={!onNext} data-action="again">
                  {session?.tour && !result.youWon ? "Try Again" : "Play Again"}
                </button>
              )}
              <button type="button" onClick={onMenu} data-action="menu">
                Main Menu
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
