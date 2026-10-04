import React from "react"
import { speedCurve } from "./typing"
import { COLORS, ordinal } from "./Track"

// A tiny line chart: values -> an SVG polyline (WPM over a race, or a trend of races)
export const Sparkline = ({ values, width = 120, height = 28, color = "#000080", label, max: fixedMax, min: fixedMin }) => {
  if (!values || values.length < 2) return <span className="stSparkNone">-</span>
  const max = fixedMax ?? Math.max(...values, 1)
  const min = fixedMin ?? Math.min(0, ...values)
  const span = max - min || 1
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`)
  return (
    <svg className="stSpark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label || "chart"}>
      <polyline points={`2,${height - 2} ${pts.join(" ")} ${width - 2},${height - 2}`} fill={color} opacity=".12" />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

// WPM, second by second, from [[ms, characters], ...]
export const curveOf = (samples) => speedCurve(samples).map(([, w]) => w)

const fmtTime = (ms) => (ms == null ? "-" : `${(ms / 1000).toFixed(1)}s`)

// table: the rules' standings for one race; you: your seat; mine: your own detailed samples
const Results = ({ table, you, mine, title, note }) => (
  <div className="stResults" data-results>
    {title && <h3>{title}</h3>}
    {note && <p className="stNote">{note}</p>}
    <div className="stTableWrap">
      <table className="stTable">
        <thead>
          <tr>
            <th>Place</th>
            <th>Racer</th>
            <th>WPM</th>
            <th>Accuracy</th>
            <th className="stHideNarrow">Mistakes</th>
            <th className="stHideNarrow">Time</th>
            <th>Speed</th>
          </tr>
        </thead>
        <tbody>
          {table.map((row) => (
            <tr key={row.seat} className={row.seat === you ? "is-you" : ""} data-row-seat={row.seat}>
              <td>{row.finished ? <b className={`stPlace is-${row.place}`}>{ordinal(row.place)}</b> : row.left ? "left" : row.out ? "out" : "DNF"}</td>
              <td className="stRacerName">
                <span className="stLaneDot" style={{ background: row.ghost ? "#8090a8" : COLORS[row.seat % COLORS.length] }} />
                {row.name}
                {row.seat === you && row.name !== "You" && <i> (you)</i>}
              </td>
              <td data-cell="wpm">
                <b>{Math.round(row.wpm)}</b>
              </td>
              <td data-cell="acc">{Math.round(row.acc)}%</td>
              <td className="stHideNarrow">{row.mistakes}</td>
              <td className="stHideNarrow">{fmtTime(row.time)}</td>
              <td>
                <Sparkline values={curveOf(row.seat === you && mine?.length > 1 ? mine : row.samples)} width={90} height={22} color={row.ghost ? "#8090a8" : COLORS[row.seat % COLORS.length]} label={`${row.name}'s speed`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
)

// What Share Result... sends: your place, speed and accuracy, and everyone's speeds
export const resultText = (table, you) => {
  const me = table.find((row) => row.seat === you)
  const head = me
    ? `Speed Typist 98: ${me.finished ? `${ordinal(me.place)} place, ` : ""}${Math.round(me.wpm)} WPM at ${Math.round(me.acc)}% accuracy`
    : "Speed Typist 98 race results"
  const lines = table.length > 1 ? table.map((row) => `${row.finished ? ordinal(row.place) : "DNF"}  ${row.name}${row.seat === you ? " (me)" : ""}: ${Math.round(row.wpm)} WPM`) : []
  return [head, ...lines].join("\n")
}

export default Results
