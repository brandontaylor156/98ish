import React, { useEffect, useState } from "react"
import * as living from "../../../../utils/livingpark"
import Combo from "../../../shared/select/Combo"
import { listClones } from "../twin/clone/store.js"
import { DEFAULT_PHRASES, LIMITS, PHRASE_KINDS, PHRASE_LABELS, cleanPhrases } from "./living.js"

// Living Park (living.js, server/livingpark): leave your own clone at this venue while you're
// away, edit the only lines it may say, and see who played it. Your buddies see it here
// while you're signed off; it plays the way your films say you play.

const when = (t) => {
  if (!t) return ""
  const d = new Date(t)
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
}

export const LogList = ({ entries = [], venueNames = {} }) => (
  <ul className="pkLivingLog" data-living="log">
    {entries.map((e) => (
      <li key={e.id || e.at}>
        <b className={e.cloneWon ? "pkWin" : "pkLose"}>{e.cloneWon ? "Won" : "Lost"}</b> {e.score?.[0]}-{e.score?.[1]} vs {e.by}
        <small>
          {" "}
          · {venueNames[e.venue] || e.venue} · {when(e.at)}
        </small>
      </li>
    ))}
  </ul>
)

export const ClonePanel = ({ venueId, venueName, venueNames = {}, look, onClose }) => {
  const [state, setState] = useState({ loading: true, record: null, error: null })
  const mine = listClones().filter((c) => c.origin === "self")
  const [cloneId, setCloneId] = useState(mine[0]?.id || "")
  const [phrases, setPhrases] = useState(null)
  const [busy, setBusy] = useState(false)
  const signed = living.signedOn()

  useEffect(() => {
    let live = true
    if (!signed) return setState({ loading: false, record: null, error: null })
    living.mine().then((r) => {
      if (!live) return
      setState({ loading: false, record: r.ok ? r.record : null, error: r.ok ? null : r.error })
      setPhrases(cleanPhrases(r.ok && r.record?.phrases ? r.record.phrases : DEFAULT_PHRASES))
      if (r.ok && r.record?.clone?.id && mine.some((c) => c.id === r.record.clone.id)) setCloneId(r.record.clone.id)
    })
    return () => {
      live = false
    }
  }, [])

  const total = phrases ? PHRASE_KINDS.reduce((n, k) => n + phrases[k].length, 0) : 0
  const setLine = (kind, i, text) => setPhrases((p) => ({ ...p, [kind]: p[kind].map((l, j) => (j === i ? text.slice(0, LIMITS.chars) : l)) }))
  const addLine = (kind) => setPhrases((p) => ({ ...p, [kind]: [...p[kind], ""] }))
  const dropLine = (kind, i) => setPhrases((p) => ({ ...p, [kind]: p[kind].filter((_, j) => j !== i) }))

  const leave = async () => {
    const clone = mine.find((c) => c.id === cloneId)
    if (!clone) return
    setBusy(true)
    const r = await living.leave({ venue: venueId, clone, look, phrases })
    setBusy(false)
    if (r.ok) setState({ loading: false, record: r.record, error: null })
    else setState((s) => ({ ...s, error: r.error }))
  }
  const recall = async () => {
    setBusy(true)
    const r = await living.recall()
    setBusy(false)
    if (r.ok) setState({ loading: false, record: null, error: null })
    else setState((s) => ({ ...s, error: r.error }))
  }

  const rec = state.record
  const here = rec?.venue === venueId
  return (
    <div className="pkCenter pkDim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pkPanel pkLivingPanel window" data-living="panel">
        <b>My clone in the park</b>
        {!signed ? (
          <p>Sign on to 98 Messenger to leave your clone here for your buddies.</p>
        ) : !mine.length ? (
          <p>
            Make a clone of yourself first: film a game, then Twin Replay › the game › Stats › <b>Make a Clone</b>, and check <b>This is me</b>. Only your own clone can be left in the park.
          </p>
        ) : state.loading ? (
          <p>Checking on your clone...</p>
        ) : (
          <>
            <p className="pkMuted">
              {rec
                ? here
                  ? `Your clone is here at ${venueName} while you're away. Your buddies can challenge it.`
                  : `Your clone is at ${venueNames[rec.venue] || rec.venue}. Leaving it here moves it.`
                : `Leave your clone at ${venueName}: while you're signed off, your buddies can find it here and play it. It plays the way your films say you play.`}
            </p>
            {mine.length > 1 && (
              <label className="pkLivingPick">
                Clone{" "}
                <Combo value={cloneId} options={mine.map((c) => [c.id, c.name])} onChange={setCloneId} ariaLabel="Clone" name="living-clone" />
              </label>
            )}
            <details className="pkLivingPhrases">
              <summary>
                What it may say ({total}/{LIMITS.total} lines)
              </summary>
              <p className="pkMuted">Your clone only ever says these lines, picked to fit the moment.</p>
              {phrases &&
                PHRASE_KINDS.map((kind) => (
                  <fieldset key={kind}>
                    <legend>{PHRASE_LABELS[kind]}</legend>
                    {phrases[kind].map((line, i) => (
                      <div className="pkLivingLine" key={i}>
                        <input type="text" value={line} maxLength={LIMITS.chars} onChange={(e) => setLine(kind, i, e.target.value)} aria-label={`${PHRASE_LABELS[kind]} ${i + 1}`} />
                        <button type="button" onClick={() => dropLine(kind, i)} aria-label="Remove line">
                          ×
                        </button>
                      </div>
                    ))}
                    {phrases[kind].length < LIMITS.perKind && total < LIMITS.total && (
                      <button type="button" onClick={() => addLine(kind)}>
                        Add a line
                      </button>
                    )}
                  </fieldset>
                ))}
            </details>
            {state.error && <p className="pkLivingError">{state.error}</p>}
            <div className="pkRow">
              <button type="button" className="pkPrimary" disabled={busy || !cloneId} onClick={leave} data-living="leave">
                {here ? "Save changes" : `Leave my clone at ${venueName}`}
              </button>
              {rec && (
                <button type="button" disabled={busy} onClick={recall} data-living="recall">
                  Take it back
                </button>
              )}
            </div>
            {rec?.log?.length ? (
              <>
                <p className="pkLivingHead">Who played it</p>
                <LogList entries={rec.log.slice(0, 10)} venueNames={venueNames} />
              </>
            ) : null}
          </>
        )}
        <div className="pkRow">
          <button type="button" onClick={onClose} data-living="close">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// "while you were away": shown once when you come back to My Park
export const AwayCard = ({ away, venueNames = {}, onClose }) => (
  <div className="pkCenter pkDim" onClick={(e) => e.target === e.currentTarget && onClose()}>
    <div className="pkPanel pkLivingAway window" data-living="away">
      <b>While you were away</b>
      <p>{away.headline}</p>
      <LogList entries={away.entries.slice(0, 8)} venueNames={venueNames} />
      <button type="button" className="pkPrimary" onClick={onClose} autoFocus data-living="away-ok">
        Nice
      </button>
    </div>
  </div>
)
