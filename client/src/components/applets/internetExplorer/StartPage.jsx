import React, { useState } from "react"
import MoreOptions from "../../shared/MoreOptions"
import { DIRECTORY, YEAR_PRESETS } from "./sites"
import { formatIso } from "./wayback"

// the handful of sites most people want first (the rest wait under "More sites »")
const POPULAR = ["http://www.yahoo.com/", "http://www.google.com/", "http://www.spacejam.com/", "http://www.geocities.com/", "http://www.cnn.com/", "http://www.98ish.com/guestbook"]
const ALL_SITES = DIRECTORY.flatMap((section) => section.sites)

// The home page: a late-90s portal that sets the date you're browsing and lists famous
// sites of the early web. The baseline (docs/simplicity.md): a year, an address and six
// popular sites; the year buttons, the whole directory and its search are under "More sites »".
const StartPage = ({ date, query, onQuery, onDate, onOpen, onAddress }) => {
  const [address, setAddress] = useState("")
  const year = Number(date.slice(0, 4))
  const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
  const years = YEAR_PRESETS.includes(year) ? YEAR_PRESETS : [...YEAR_PRESETS, year].sort((a, b) => a - b)
  const popular = POPULAR.map((url) => ALL_SITES.find((s) => s.url === url)).filter(Boolean)

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
        <form
          className="ieStartGo"
          onSubmit={(e) => {
            e.preventDefault()
            if (address.trim()) onAddress(address)
          }}
        >
          <select className="ieStartYear" value={year} aria-label="Year" onChange={(e) => onDate(`${e.target.value}${date.slice(4)}`)}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
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

      {!q && (
        <section className="ieStartPopular" aria-label="Popular sites">
          <h2>Popular in {year}</h2>
          <ul>
            {popular.map((s) => (
              <li key={s.url} className={s.since > year ? "is-later" : ""}>
                <button type="button" onClick={() => onOpen(s.url)}>
                  {s.name}
                </button>
                <span className="ieAbout">{s.since > year ? `from ${s.since}` : s.about}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <MoreOptions
        id="ie.directory"
        className="ieStartMore"
        label={`More sites (${ALL_SITES.length})`}
        lessLabel="Fewer sites"
        summary={`${DIRECTORY.map((d) => d.category).join(" · ")} · Search · Jump to a year`}
        forceOpen={!!q}
      >
        <section className="ieStartYears">
          <h2>Jump to a year</h2>
          <div className="ieYears">
            {YEAR_PRESETS.map((y) => (
              <button key={y} type="button" className={y === year ? "is-active" : ""} onClick={() => onDate(`${y}${date.slice(4)}`)}>
                {y}
              </button>
            ))}
          </div>
        </section>
        <section className="ieStartDirectory">
          <div className="ieStartDirHead">
            <h2>{q ? `Sites matching "${query.trim()}"` : `Where to go in ${year}`}</h2>
            <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search this directory" aria-label="Search this directory" enterKeyHint="search" />
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
      </MoreOptions>

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
