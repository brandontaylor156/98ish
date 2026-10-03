import React, { useState } from "react"
import Dialog from "../../shared/Dialog"
import { Sparkline } from "./Results"
import { LENGTHS } from "./prompts/index.js"
import { load, resetStats, summary } from "./storage"

const KIND = { race: "vs. computer", online: "online", ghost: "vs. ghost", daily: "daily", drill: "drill", practice: "practice" }

// Statistics: averages, your best per prompt length, WPM and accuracy trends, recent races
const StatsDialog = ({ onClose }) => {
  const [data, setData] = useState(load)
  const s = summary(data)
  const recent = [...data.history].reverse().slice(0, 8)
  return (
    <Dialog title="Speed Typist Statistics" onOk={onClose} onCancel={onClose} okLabel="Close">
      <div className="stStats" data-stats>
        <div className="stStatNums">
          <div>
            <b data-stat="races">{s.races}</b>
            <small>Races</small>
          </div>
          <div>
            <b data-stat="avg">{Math.round(s.avgWpm)}</b>
            <small>Avg WPM</small>
          </div>
          <div>
            <b data-stat="top">{Math.round(s.topWpm)}</b>
            <small>Top WPM</small>
          </div>
          <div>
            <b>{Math.round(s.avgAcc)}%</b>
            <small>Accuracy</small>
          </div>
          <div>
            <b>{s.wins}</b>
            <small>Wins</small>
          </div>
        </div>
        <fieldset>
          <legend>Best by length</legend>
          <div className="stBests">
            {LENGTHS.map((l) => (
              <div key={l.id} data-best={l.id}>
                <small>{l.label}</small>
                <b>{data.best[l.id] ? `${Math.round(data.best[l.id].wpm)} WPM` : "-"}</b>
              </div>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Last {s.wpmTrend.length} races</legend>
          <div className="stTrend">
            <span>WPM</span>
            <Sparkline values={s.wpmTrend} width={190} height={30} label="WPM trend" />
          </div>
          <div className="stTrend">
            <span>Accuracy</span>
            <Sparkline values={s.accTrend} width={190} height={30} color="#008000" min={Math.min(80, ...s.accTrend)} max={100} label="Accuracy trend" />
          </div>
        </fieldset>
        {recent.length > 0 && (
          <fieldset>
            <legend>Recent</legend>
            <ul className="stRecent">
              {recent.map((h) => (
                <li key={h.at}>
                  <b>{Math.round(h.wpm)} WPM</b> {Math.round(h.acc)}% · {KIND[h.kind] || h.kind}
                  {h.place && h.racers > 1 ? ` · ${h.place} of ${h.racers}` : ""}
                  {!h.finished && " · unfinished"}
                </li>
              ))}
            </ul>
          </fieldset>
        )}
        <button type="button" className="stLinkBtn" onClick={() => setData(resetStats())}>
          Reset statistics
        </button>
      </div>
    </Dialog>
  )
}

export default StatsDialog
