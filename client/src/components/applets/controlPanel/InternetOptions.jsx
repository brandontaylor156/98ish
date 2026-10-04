import React, { useState } from "react"
import Dialog from "../../shared/Dialog"
import MoreOptions from "../../shared/MoreOptions"
import { summarize } from "../../../utils/disclosure"
import { PropSheet, useDraft } from "./Sheet"

// Internet Explorer keeps these itself (applets/internetExplorer/InternetExplorer.jsx)
const DATE_KEY = "98ish.ie.date"
const HISTORY_KEY = "98ish.ie.history"
const HISTORY_CLEARED = "98ish:ie-history-cleared"
const START_PAGE = ""
const COMMUNITY = "http://www.98ish.com/"

const read = (key, fallback) => {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : JSON.parse(v)
  } catch {
    return fallback
  }
}
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage full or blocked
  }
}

// Internet Options: Internet Explorer's home page and time machine date, and its History
const InternetOptions = ({ onClose }) => {
  const d = useDraft(["ieHome"])
  const savedDate = read(DATE_KEY, "1998-12-25")
  const [date, setDate] = useState(savedDate)
  const [visited, setVisited] = useState(() => read(HISTORY_KEY, []).length)
  const [confirm, setConfirm] = useState(false)
  const changed = d.changed || date !== savedDate

  const apply = () => {
    if (d.changed) d.apply()
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date !== savedDate) write(DATE_KEY, date)
  }

  return (
    <PropSheet
      name="Internet Properties"
      tabs={[{ id: "general", label: "General" }]}
      tab="general"
      onTab={() => {}}
      onOk={() => {
        apply()
        onClose?.()
      }}
      onCancel={onClose}
      onApply={apply}
      changed={changed}
    >
      <fieldset>
        <legend>Home page</legend>
        <p>You can change which page to use for your home page.</p>
        <div className="cplChoice">
          <label htmlFor="cpl-ie-home">Address:</label>
          <input id="cpl-ie-home" type="text" value={d.draft.ieHome} placeholder="(the Start Page)" autoCapitalize="off" autoCorrect="off" spellCheck="false" onChange={(e) => d.update({ ieHome: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
        </div>
      </fieldset>
      <fieldset>
        <legend>Time machine</legend>
        <p>Internet Explorer shows every page as the Internet Archive saved it closest to this date.</p>
        <div className="cplChoice">
          <label htmlFor="cpl-ie-date">Visit the Web as of:</label>
          <input id="cpl-ie-date" type="date" min="1996-01-01" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </fieldset>
      {/* the home page shortcuts and History: More options (docs/simplicity.md) */}
      <MoreOptions id="ieoptions.more" summary={summarize("Use Start Page / 98ish.com", `History: ${visited} page${visited === 1 ? "" : "s"}`)}>
        <div className="cplRow">
          <button type="button" onClick={() => d.update({ ieHome: START_PAGE })}>
            Use Start Page
          </button>
          <button type="button" onClick={() => d.update({ ieHome: COMMUNITY })}>
            Use 98ish.com
          </button>
        </div>
        <fieldset>
          <legend>History</legend>
          <p>The History list has links to the {visited} page{visited === 1 ? "" : "s"} you've visited, for quick access.</p>
          <div className="cplRow">
            <button type="button" disabled={!visited} onClick={() => setConfirm(true)}>
              Clear History
            </button>
          </div>
        </fieldset>
      </MoreOptions>
      {confirm && (
        <Dialog
          title="Internet Options"
          okLabel="Yes"
          cancelLabel="No"
          onOk={() => {
            write(HISTORY_KEY, [])
            window.dispatchEvent(new CustomEvent(HISTORY_CLEARED))
            setVisited(0)
            setConfirm(false)
          }}
          onCancel={() => setConfirm(false)}
        >
          <p className="dialogText">Delete all items in your History folder?</p>
        </Dialog>
      )}
    </PropSheet>
  )
}

export default InternetOptions
