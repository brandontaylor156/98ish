import React from "react"
import * as S from "./engine"

// The chart under the grid (More options > Chart, or Insert > Chart of Selection): the chosen
// cells as bars or a line. Labels come from the first column when it holds text; the numbers
// from the first column of numbers. It follows the cells as they change.

export const chartData = (rangeText, values) => {
  const [a, b] = String(rangeText || "").split(":")
  const p = S.parseAddr(a)
  const q = S.parseAddr(b || a)
  if (!p || !q) return null
  const r = S.rangeOf(p, q)
  const at = (row, col) => values.get(S.addr(row, col))
  const cols = []
  for (let c = r.c0; c <= r.c1; c++) cols.push(c)
  const isNumCol = (c) => {
    let n = 0
    for (let row = r.r0; row <= r.r1; row++) if (typeof at(row, c) === "number") n++
    return n > 0
  }
  const numCol = cols.find(isNumCol)
  if (numCol === undefined) return null
  const labelCol = cols.find((c) => c !== numCol && !isNumCol(c))
  const points = []
  let title = null
  for (let row = r.r0; row <= r.r1; row++) {
    const v = at(row, numCol)
    if (typeof v !== "number") {
      // a header row ("Month", "Sales") names the chart
      if (row === r.r0 && typeof v === "string") title = v
      continue
    }
    const label = labelCol !== undefined ? S.display(at(row, labelCol)) : String(row + 1)
    points.push({ label, value: v })
  }
  return points.length ? { title, points: points.slice(0, 60) } : null
}

const SheetChart = ({ chart, values, onType, onClose }) => {
  const data = chartData(chart.range, values)
  const W = 600
  const H = 180
  const pad = { l: 44, r: 10, t: 12, b: 30 }
  return (
    <div className="shChart" data-sheet-chart="">
      <div className="shChartHead">
        <span>
          Chart of {chart.range}
          {data?.title ? `: ${data.title}` : ""}
        </span>
        <span className="shChartBtns">
          <button type="button" aria-pressed={chart.type !== "line"} onClick={() => onType("bar")}>
            Bars
          </button>
          <button type="button" aria-pressed={chart.type === "line"} onClick={() => onType("line")}>
            Line
          </button>
          <button type="button" onClick={onClose} aria-label="Remove the chart">
            ✕
          </button>
        </span>
      </div>
      {!data ? (
        <div className="shChartEmpty">No numbers to chart in {chart.range}.</div>
      ) : (
        (() => {
          const max = Math.max(0, ...data.points.map((p) => p.value))
          const min = Math.min(0, ...data.points.map((p) => p.value))
          const span = max - min || 1
          const y = (v) => pad.t + ((max - v) / span) * (H - pad.t - pad.b)
          const step = (W - pad.l - pad.r) / data.points.length
          const x = (i) => pad.l + step * i + step / 2
          const ticks = [max, (max + min) / 2, min]
          return (
            <svg viewBox={`0 0 ${W} ${H}`} className="shChartSvg" role="img" aria-label={`Chart of ${chart.range}`}>
              <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} fill="#fff" stroke="#808080" />
              {ticks.map((t, i) => (
                <g key={i}>
                  <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#c0c0c0" strokeDasharray="2 2" />
                  <text x={pad.l - 4} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#000">
                    {S.display(Math.round(t * 100) / 100)}
                  </text>
                </g>
              ))}
              {chart.type === "line" ? (
                <polyline fill="none" stroke="#000080" strokeWidth="2" points={data.points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} />
              ) : (
                data.points.map((p, i) => <rect key={i} x={x(i) - step * 0.35} width={step * 0.7} y={Math.min(y(p.value), y(0))} height={Math.abs(y(p.value) - y(0))} fill={p.value < 0 ? "#800000" : "#000080"} stroke="#000" strokeWidth=".5" />)
              )}
              {chart.type === "line" && data.points.map((p, i) => <rect key={i} x={x(i) - 3} y={y(p.value) - 3} width="6" height="6" fill="#ff00ff" stroke="#000" strokeWidth=".5" />)}
              {data.points.map((p, i) =>
                data.points.length <= 16 || i % Math.ceil(data.points.length / 16) === 0 ? (
                  <text key={i} x={x(i)} y={H - pad.b + 14} textAnchor="middle" fontSize="10" fill="#000">
                    {p.label.length > 10 ? `${p.label.slice(0, 9)}…` : p.label}
                  </text>
                ) : null
              )}
            </svg>
          )
        })()
      )}
    </div>
  )
}

export default SheetChart
