import React, { useState } from "react"
import { LOCALES, dateOrder, formatHour, formatNumber, formatShortDate, formatTime, localeOf, tempUnit, uses24h, weekStart } from "../../../utils/region"
import { WEEKDAYS } from "../calendar/recur"
import MoreOptions from "../../shared/MoreOptions"
import { summarize } from "../../../utils/disclosure"
import { Choice, PropSheet, sheetButtons, useDraft } from "./Sheet"

const TABS = [
  { id: "regional", label: "Regional Settings" },
  { id: "time", label: "Time" },
  { id: "date", label: "Date" },
]

const ORDER_NAMES = { mdy: "Month/Day/Year", dmy: "Day/Month/Year", ymd: "Year-Month-Day" }

// Regional Settings: the locale, 12/24-hour time, the date order and the first day of the
// week. The taskbar clock, Calendar and Clock follow them (utils/region.js).
const Regional = ({ onClose }) => {
  const [tab, setTab] = useState("regional")
  const d = useDraft(["region"])
  const region = d.draft.region
  const set = (patch) => d.update({ region: { ...region, ...patch } })
  const now = new Date()
  const auto = { ...region, locale: region.locale }

  // the samples: one line while closed (it is the sample), the whole table open (docs/simplicity.md)
  const sampleLine = summarize(formatTime(now.getHours(), now.getMinutes(), region), formatShortDate(now.getFullYear(), now.getMonth() + 1, now.getDate(), region), `Week starts ${WEEKDAYS[weekStart(region)]}`)
  const samples = (
    <MoreOptions id="regional.samples" label="Samples" lessLabel="Hide samples" summary={sampleLine}>
      <fieldset>
        <legend>Appearance samples</legend>
        <table className="cplTable">
          <tbody>
            <tr>
              <th scope="row">Time:</th>
              <td data-sample="time">{formatTime(now.getHours(), now.getMinutes(), region)}</td>
            </tr>
            <tr>
              <th scope="row">Short date:</th>
              <td data-sample="date">{formatShortDate(now.getFullYear(), now.getMonth() + 1, now.getDate(), region)}</td>
            </tr>
            <tr>
              <th scope="row">Number:</th>
              <td data-sample="number">{formatNumber(123456789.25, region)}</td>
            </tr>
            <tr>
              <th scope="row">Week starts:</th>
              <td data-sample="week">{WEEKDAYS[weekStart(region)]}</td>
            </tr>
          </tbody>
        </table>
      </fieldset>
    </MoreOptions>
  )

  return (
    <PropSheet name="Regional Settings Properties" tabs={TABS} tab={tab} onTab={setTab} {...sheetButtons(d, onClose)}>
      {tab === "regional" && (
        <>
          <div className="cplHead">
            <img src="/assets/program_icons/cpl/regional.svg" alt="" />
            <p>Times, dates and numbers show the way your region writes them. Change any part on the Time and Date tabs.</p>
          </div>
          <Choice label="Region:" value={region.locale} options={LOCALES.map((l) => (l.id === "auto" ? { ...l, label: `Same as this device (${localeOf({ locale: "auto" })})` } : l))} onChange={(locale) => set({ locale })} />
          <Choice
            label="Temperature:"
            value={region.temp || "auto"}
            options={[
              { id: "auto", label: `As the region does (${tempUnit({ ...auto, temp: "auto" }) === "F" ? "°F" : "°C"})` },
              { id: "F", label: "Fahrenheit (°F)" },
              { id: "C", label: "Celsius (°C)" },
            ]}
            onChange={(temp) => set({ temp })}
          />
          {samples}
        </>
      )}

      {tab === "time" && (
        <>
          <fieldset>
            <legend>Time style</legend>
            <Choice
              label="Clock:"
              value={region.time}
              options={[
                { id: "auto", label: `As the region does (${uses24h({ ...auto, time: "auto" }) ? "24-hour" : "12-hour"})` },
                { id: "12", label: "12-hour (7:05 PM)" },
                { id: "24", label: "24-hour (19:05)" },
              ]}
              onChange={(time) => set({ time })}
            />
            <p className="cplHint">The taskbar clock, Calendar and Clock use this. Right now: {formatTime(now.getHours(), now.getMinutes(), region)}; a day view's hours: {formatHour(9, region)}, {formatHour(15, region)}.</p>
          </fieldset>
          {samples}
        </>
      )}

      {tab === "date" && (
        <>
          <fieldset>
            <legend>Calendar</legend>
            <Choice
              label="First day of week:"
              value={region.firstDay}
              options={[
                { id: "auto", label: `As the region does (${WEEKDAYS[weekStart({ ...auto, firstDay: "auto" })]})` },
                { id: "0", label: "Sunday" },
                { id: "1", label: "Monday" },
                { id: "6", label: "Saturday" },
              ]}
              onChange={(firstDay) => set({ firstDay })}
            />
            <Choice
              label="Short date order:"
              value={region.dateOrder}
              options={[
                { id: "auto", label: `As the region does (${ORDER_NAMES[dateOrder({ ...auto, dateOrder: "auto" })]})` },
                { id: "mdy", label: "Month/Day/Year (10/3/2026)" },
                { id: "dmy", label: "Day/Month/Year (3/10/2026)" },
                { id: "ymd", label: "Year-Month-Day (2026-10-03)" },
              ]}
              onChange={(dateOrder) => set({ dateOrder })}
            />
          </fieldset>
          {samples}
        </>
      )}
    </PropSheet>
  )
}

export default Regional
