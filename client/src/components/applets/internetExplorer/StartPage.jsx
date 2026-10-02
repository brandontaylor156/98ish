import React, { useState } from "react"
import { DIRECTORY, YEAR_PRESETS } from "./sites"
import { formatIso } from "./wayback"

// The home page: a late-90s portal that sets the date you're browsing and lists famous
// sites of the early web.
const StartPage = ({ date, query, onQuery, onDate, onOpen, onAddress }) => {
  const [address, setAddress] = useState("")
  const year = Number(date.slice(0, 4))
  const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })

  const q = query.trim().toLowerCase()
  const sections = DIRECTORY.map((section) => ({
    ...section,
    sites: q ? section.sites.filter((s) => `${s.name} ${s.about} ${s.url}`.toLowerCase().includes(q)) : section.sites,
  })).filter((section) => section.sites.length)

  return (
    <div className="ieStart">
      <header className="ieStartHeader">
        <div className="ieStartLogo">
          98ish <span>Start Page</span>
        </div>
        <div className="ieStartToday">
          It's <b>{weekday}, {formatIso(date)}</b>
        </div>
      </header>

      <section className="ieStartMachine">
        <h2>Visit the Web of any year</h2>
        <div className="ieYears">
          {YEAR_PRESETS.map((y) => (
            <button key={y} type="button" className={y === year ? "is-active" : ""} onClick={() => onDate(`${y}${date.slice(4)}`)}>
              {y}
            </button>
          ))}
        </div>
        <form
          className="ieStartGo"
          onSubmit={(e) => {
            e.preventDefault()
            if (address.trim()) onAddress(address)
          }}
        >
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Type a web address, like www.yahoo.com"
            aria-label="Web address"
            spellCheck="false"
            autoCapitalize="off"
            inputMode="url"
          />
          <button type="submit">Go</button>
        </form>
      </section>

      <section className="ieStartDirectory">
        <div className="ieStartDirHead">
          <h2>{q ? `Sites matching "${query.trim()}"` : `Where to go in ${year}`}</h2>
          <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search this directory" aria-label="Search this directory" />
        </div>
        {sections.length === 0 && <p className="ieStartEmpty">Nothing in the directory matches. Try typing the site's address above instead.</p>}
        <div className="ieStartColumns">
          {sections.map((section) => (
            <div key={section.category} className="ieStartSection">
              <h3>{section.category}</h3>
              <ul>
                {section.sites.map((s) => {
                  const later = s.since > year
                  return (
                    <li key={s.url} className={later ? "is-later" : ""}>
                      <button type="button" onClick={() => onOpen(s.url)}>
                        {s.name}
                      </button>
                      {later && <span className="ieSince"> (from {s.since})</span>}
                      <div className="ieAbout">{s.about}</div>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <footer className="ieStartFooter">
        Pages are served by the{" "}
        <a href="https://web.archive.org/" target="_blank" rel="noopener noreferrer">
          Internet Archive's Wayback Machine
        </a>
        , which has been saving the Web since 1996. Some pages, images or games may be missing from old copies.
      </footer>
    </div>
  )
}

export default StartPage
