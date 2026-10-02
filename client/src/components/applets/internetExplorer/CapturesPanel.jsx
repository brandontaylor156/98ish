import React, { useEffect, useState } from "react"
import { getCaptures, stampToDate } from "./wayback"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

// Captures explorer bar: how often the Wayback Machine saved this site each year, and a
// calendar of the days it saved this page in one year. Click a day to see that copy.
const CapturesPanel = ({ url, site, sparkline, sparkError, shownTs, date, pageKey, onPick }) => {
  const initialYear = Number((shownTs || date.replace(/-/g, "")).slice(0, 4))
  const [year, setYear] = useState(initialYear)
  const [state, setState] = useState({ key: null, days: null, error: null })

  // follow the page when it changes years
  useEffect(() => setYear(initialYear), [initialYear, pageKey])

  useEffect(() => {
    if (!pageKey) return
    let live = true
    const key = `${pageKey}|${year}`
    setState({ key, days: null, error: null })
    getCaptures(pageKey, year).then(
      ({ timestamps }) => {
        if (!live) return
        // first capture of each day, keyed "MMDD"
        const days = new Map()
        for (const ts of timestamps) if (!days.has(ts.slice(4, 8))) days.set(ts.slice(4, 8), { ts, count: 0 })
        for (const ts of timestamps) days.get(ts.slice(4, 8)).count++
        setState({ key, days, error: null })
      },
      (error) => live && setState({ key, days: null, error })
    )
    return () => {
      live = false
    }
  }, [pageKey, year])

  if (!url) return <p className="ieBarEmpty">Open a page to see when the Wayback Machine saved it.</p>

  const years = sparkline ? Object.entries(sparkline.years).map(([y, months]) => ({ year: Number(y), total: months.reduce((a, b) => a + b, 0) })) : []
  const maxTotal = Math.max(1, ...years.map((y) => y.total))
  const shownDay = shownTs && shownTs.slice(0, 4) === String(year) ? shownTs.slice(4, 8) : null

  return (
    <div className="ieCaptures">
      <div className="ieCapSite">{site}</div>
      {sparkError && <p className="ieBarEmpty">Couldn't reach the Wayback Machine's calendar. Try again in a moment.</p>}
      {years.length > 0 && (
        <div className="ieYearBars" role="listbox" aria-label="Years">
          {years.map((y) => (
            <button
              key={y.year}
              type="button"
              role="option"
              aria-selected={y.year === year}
              className={y.year === year ? "is-active" : ""}
              disabled={!y.total}
              title={`${y.year}: ${y.total.toLocaleString()} captures`}
              onClick={() => setYear(y.year)}
            >
              <span className="ieYearBar" style={{ height: `${Math.max(y.total ? 8 : 0, Math.sqrt(y.total / maxTotal) * 100)}%` }} />
              {/* 30 years don't fit labeled: just the decades and the selected year */}
              <span className="ieYearLabel">{y.year % 10 === 0 || y.year === year ? `'${String(y.year).slice(2)}` : " "}</span>
            </button>
          ))}
        </div>
      )}

      <div className="ieCapYearNav">
        <button type="button" onClick={() => setYear(year - 1)} disabled={year <= 1996} aria-label="Previous year">
          &#9664;
        </button>
        <b>{year}</b>
        <button type="button" onClick={() => setYear(year + 1)} disabled={year >= new Date().getFullYear()} aria-label="Next year">
          &#9654;
        </button>
      </div>

      {state.error ? (
        <p className="ieBarEmpty">Couldn't load {year}'s captures. {state.error.message}</p>
      ) : !state.days ? (
        <p className="ieBarEmpty">Loading captures...</p>
      ) : state.days.size === 0 ? (
        <p className="ieBarEmpty">No copies of this page from {year}.</p>
      ) : (
        <>
          <p className="ieCapCount">
            Saved on {state.days.size} {state.days.size === 1 ? "day" : "days"} in {year}
          </p>
          <div className="ieMonths">
            {MONTHS.map((name, m) => {
              const first = new Date(Date.UTC(year, m, 1)).getUTCDay()
              const days = new Date(Date.UTC(year, m + 1, 0)).getUTCDate()
              return (
                <div key={name} className="ieMonth">
                  <div className="ieMonthName">{name}</div>
                  <div className="ieMonthGrid">
                    {Array.from({ length: first }, (_, i) => (
                      <span key={`b${i}`} />
                    ))}
                    {Array.from({ length: days }, (_, d) => {
                      const key = `${String(m + 1).padStart(2, "0")}${String(d + 1).padStart(2, "0")}`
                      const capture = state.days.get(key)
                      if (!capture) return <span key={key} className="ieDay">{d + 1}</span>
                      const label = `${stampToDate(capture.ts).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}: ${capture.count} ${capture.count === 1 ? "capture" : "captures"}`
                      return (
                        <button
                          key={key}
                          type="button"
                          className={key === shownDay ? "ieDay has-capture is-shown" : capture.count > 3 ? "ieDay has-capture is-many" : "ieDay has-capture"}
                          title={label}
                          aria-label={label}
                          onClick={() => onPick(capture.ts)}
                        >
                          {d + 1}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

export default CapturesPanel
