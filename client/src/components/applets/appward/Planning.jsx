import React, { useMemo, useState } from "react"
import { appById, createRecord, display, fieldOf, getRecord, recordNo, recordTitle, recordsOf, updateRecord, userName } from "./engine.js"
import { change } from "./store.js"
import { Icon } from "./icons.jsx"
import { useAw, avatarColor, initials, todayIso } from "./ctx.js"
import { RecordList, pillTone } from "./Records.jsx"

// Projects (a 98-style Gantt timeline), Calendars (a month grid) and the social feeds
// (Announcements, Shoutouts).

const DAY = 86400000
const dayNum = (iso) => (iso ? Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY) : null)
const isoOf = (n) => new Date(n * DAY).toISOString().slice(0, 10)
const shortDate = (iso) => (iso ? `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}` : "")

// ---- Projects ----

export const ProjectTimeline = ({ project }) => {
  const { ws, openRecord } = useAw()
  const acts = recordsOf(ws, "actions")
    .filter((a) => a.project === project.id)
    .sort((a, b) => (a.start || a.due || "9").localeCompare(b.start || b.due || "9") || Number(a.id) - Number(b.id))
  const days = [project.start, project.end, ...acts.flatMap((a) => [a.start, a.due])].map(dayNum).filter((n) => n !== null)
  if (!days.length) return <p className="awMuted">Give the project start and end dates, and its actions due dates, to see a timeline.</p>
  const from = Math.min(...days)
  const to = Math.max(...days, from + 6)
  const span = to - from + 1
  const pct = (n) => `${((n - from) / span) * 100}%`
  const today = dayNum(todayIso())
  // a tick about every week, so the header never gets crowded
  const step = Math.max(1, Math.ceil(span / 8))
  const ticks = []
  for (let n = from; n <= to; n += step) ticks.push(n)
  return (
    <div className="awGantt" role="table" aria-label={`${project.project} timeline`}>
      <div className="awGanttRow awGanttHead" role="row">
        <div className="awGanttLabel" role="columnheader">Action</div>
        <div className="awGanttTrack" role="columnheader">
          {ticks.map((n) => (
            <span key={n} className="awGanttTick" style={{ left: pct(n) }}>{shortDate(isoOf(n))}</span>
          ))}
        </div>
      </div>
      {project.start && project.end && (
        <div className="awGanttRow" role="row">
          <div className="awGanttLabel awGanttProject" role="cell">
            <Icon name="gantt" /> {project.project}
          </div>
          <div className="awGanttTrack" role="cell">
            <span className="awGanttBar awGanttBar--project" style={{ left: pct(dayNum(project.start)), width: `${((dayNum(project.end) - dayNum(project.start) + 1) / span) * 100}%` }} />
            {today >= from && today <= to && <span className="awGanttToday" style={{ left: pct(today) }} title="Today" />}
          </div>
        </div>
      )}
      {acts.map((a) => {
        const s = dayNum(a.start || a.due)
        const e = dayNum(a.due || a.start)
        return (
          <div key={a.id} className="awGanttRow" role="row">
            <button type="button" className="awGanttLabel" role="cell" onClick={() => openRecord("actions", a.id)} title={`Open ${recordNo(appById(ws, "actions"), a.id)}`}>
              {a.milestone ? "◆ " : ""}
              {a.action}
            </button>
            <div className="awGanttTrack" role="cell">
              {s !== null &&
                (a.milestone ? (
                  <span className="awGanttMilestone" style={{ left: pct(e) }} title={`${a.action}: ${shortDate(a.due)}`} />
                ) : (
                  <span
                    className={`awGanttBar awGanttBar--${pillTone(a.status)}`}
                    style={{ left: pct(Math.min(s, e)), width: `${((Math.abs(e - s) + 1) / span) * 100}%` }}
                    title={`${a.action}: ${shortDate(a.start)} to ${shortDate(a.due)} (${a.status})`}
                  >
                    {a.assignee && <span className="awGanttWho">{initials(userName(ws, a.assignee))}</span>}
                  </span>
                ))}
              {today >= from && today <= to && <span className="awGanttToday" style={{ left: pct(today) }} />}
            </div>
          </div>
        )
      })}
      {!acts.length && <p className="awMuted">No actions in this project yet.</p>}
    </div>
  )
}

export const ProjectsView = ({ app }) => {
  const { ws, openRecord, newRecord } = useAw()
  const [mode, setMode] = useState("timeline")
  if (mode === "list") return <ViewSwitch mode={mode} setMode={setMode} modes={["timeline", "list"]}><RecordList app={app} /></ViewSwitch>
  const projects = recordsOf(ws, "projects").sort((a, b) => (a.start || "").localeCompare(b.start || ""))
  return (
    <ViewSwitch mode={mode} setMode={setMode} modes={["timeline", "list"]}>
      <div className="awScroll awPad">
        <div className="awBtnRow">
          <button type="button" className="awBtn" onClick={() => newRecord("projects")}>
            <Icon name="new" /> New Project
          </button>
        </div>
        {projects.map((p) => (
          <section key={p.id} className="awProject">
            <header className="awProjectHead">
              <button type="button" className="awLinkBtn" onClick={() => openRecord("projects", p.id)}>
                {recordNo(app, p.id)} {p.project}
              </button>
              <span className={`awPill awPill--${pillTone(p.status)}`}>{p.status}</span>
              <span className="awMuted">
                {userName(ws, p.manager)} · {display(ws, fieldOf(app, "start"), p.start)} to {display(ws, fieldOf(app, "end"), p.end)}
              </span>
            </header>
            <ProjectTimeline project={p} />
          </section>
        ))}
        {!projects.length && <div className="awEmpty">No projects yet.</div>}
      </div>
    </ViewSwitch>
  )
}

// a small "Timeline | List" switch above a custom view
export const ViewSwitch = ({ mode, setMode, modes, children }) => (
  <div className="awViewWrap">
    <div className="awViewSwitch" role="group" aria-label="View">
      <span className="awSeg">
        {modes.map((m) => (
          <button key={m} type="button" className={mode === m ? "is-on" : ""} onClick={() => setMode(m)}>
            {m[0].toUpperCase() + m.slice(1)}
          </button>
        ))}
      </span>
    </div>
    <div className="awViewBody">{children}</div>
  </div>
)

// ---- Calendars ----

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

const calendarItems = (ws) => {
  const items = []
  for (const r of recordsOf(ws, "calendars")) if (r.date) items.push({ date: r.date, label: `${r.time ? r.time + " " : ""}${r.event}`, app: "calendars", id: r.id, tone: r.calendar === "Company" ? "co" : r.calendar === "Team" ? "team" : "me" })
  for (const r of recordsOf(ws, "meetings")) if (r.date) items.push({ date: r.date, label: `${r.time ? r.time + " " : ""}${r.subject}`, app: "meetings", id: r.id, tone: "mtg" })
  for (const r of recordsOf(ws, "specialEvents")) if (r.date) items.push({ date: r.date, label: r.event, app: "specialEvents", id: r.id, tone: "evt" })
  for (const r of recordsOf(ws, "actions")) if (r.due && r.status !== "Done") items.push({ date: r.due, label: `${r.milestone ? "◆" : "Due:"} ${r.action}`, app: "actions", id: r.id, tone: "due" })
  for (const r of recordsOf(ws, "timeOff")) {
    if (!r.from || r.status === "Denied") continue
    const a = dayNum(r.from)
    const b = Math.min(dayNum(r.to || r.from), a + 30)
    for (let n = a; n <= b; n++) items.push({ date: isoOf(n), label: `${userName(ws, r.employee).split(" ")[0]}: ${r.type}${r.status === "Pending" ? "?" : ""}`, app: "timeOff", id: r.id, tone: "off" })
  }
  return items
}

export const CalendarView = ({ app }) => {
  const { ws, openRecord, newRecord, mobile } = useAw()
  const now = new Date()
  const [month, setMonth] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [picked, setPicked] = useState(todayIso())
  const [mode, setMode] = useState("month")
  const items = useMemo(() => calendarItems(ws), [ws.rev])
  if (mode === "list") return <ViewSwitch mode={mode} setMode={setMode} modes={["month", "list"]}><RecordList app={app} /></ViewSwitch>
  const first = new Date(month.y, month.m, 1)
  const startPad = first.getDay()
  const daysIn = new Date(month.y, month.m + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < startPad; i++) cells.push(null)
  for (let d = 1; d <= daysIn; d++) cells.push(`${month.y}-${String(month.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`)
  while (cells.length % 7) cells.push(null)
  const byDay = new Map()
  for (const it of items) {
    if (!byDay.has(it.date)) byDay.set(it.date, [])
    byDay.get(it.date).push(it)
  }
  const shift = (n) => setMonth(({ y, m }) => ({ y: m + n < 0 ? y - 1 : m + n > 11 ? y + 1 : y, m: (m + n + 12) % 12 }))
  const today = todayIso()
  const agenda = byDay.get(picked) || []
  return (
    <ViewSwitch mode={mode} setMode={setMode} modes={["month", "list"]}>
      <div className="awCal">
        <div className="awCalBar">
          <button type="button" className="awBtn" onClick={() => shift(-1)} aria-label="Previous month">◄</button>
          <button type="button" className="awBtn" onClick={() => { setMonth({ y: now.getFullYear(), m: now.getMonth() }); setPicked(today) }}>Today</button>
          <button type="button" className="awBtn" onClick={() => shift(1)} aria-label="Next month">►</button>
          <h3 className="awCalTitle">{MONTHS[month.m]} {month.y}</h3>
          <span className="awGrow" />
          <button type="button" className="awBtn" onClick={() => newRecord("calendars", { date: picked })}>
            <Icon name="new" /> New Event
          </button>
        </div>
        <div className="awCalGrid" role="grid" aria-label={`${MONTHS[month.m]} ${month.y}`}>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="awCalDow" role="columnheader">{mobile ? d[0] : d}</div>
          ))}
          {cells.map((iso, i) =>
            iso ? (
              <div
                key={iso}
                role="gridcell"
                className={`awCalDay ${iso === today ? "is-today" : ""} ${iso === picked ? "is-picked" : ""}`}
                onClick={() => setPicked(iso)}
                onDoubleClick={() => newRecord("calendars", { date: iso })}
                data-date={iso}
              >
                <span className="awCalNum">{+iso.slice(8)}</span>
                {mobile ? (
                  (byDay.get(iso) || []).length > 0 && <span className="awCalDots">{"•".repeat(Math.min(3, byDay.get(iso).length))}</span>
                ) : (
                  <>
                    {(byDay.get(iso) || []).slice(0, 3).map((it, j) => (
                      <button
                        type="button"
                        key={j}
                        className={`awCalItem awCalItem--${it.tone}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          openRecord(it.app, it.id)
                        }}
                        title={it.label}
                      >
                        {it.label}
                      </button>
                    ))}
                    {(byDay.get(iso) || []).length > 3 && <span className="awCalMore">+{byDay.get(iso).length - 3} more</span>}
                  </>
                )}
              </div>
            ) : (
              <div key={"pad" + i} className="awCalDay is-pad" />
            )
          )}
        </div>
        <div className="awAgenda">
          <div className="awSubhead">
            {new Date(picked + "T12:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </div>
          {agenda.map((it, j) => (
            <button type="button" key={j} className={`awAgendaItem awCalItem--${it.tone}`} onClick={() => openRecord(it.app, it.id)}>
              <Icon name={appById(ws, it.app)?.icon} /> {it.label}
            </button>
          ))}
          {!agenda.length && <span className="awMuted">Nothing scheduled. Double-click a day to add an event.</span>}
        </div>
      </div>
    </ViewSwitch>
  )
}

// ---- Announcements and Shoutouts ----

export const FeedView = ({ app }) => {
  const { ws, openRecord, toast, mobile } = useAw()
  const [mode, setMode] = useState("feed")
  const shout = app.id === "shoutouts"
  const [draft, setDraft] = useState({ headline: "", body: "", message: "", to: "", value: "Teamwork" })
  if (mode === "list") return <ViewSwitch mode={mode} setMode={setMode} modes={["feed", "list"]}><RecordList app={app} /></ViewSwitch>
  const posts = recordsOf(ws, app.id).sort((a, b) => (shout ? 0 : (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) || (b.posted || "").localeCompare(a.posted || "") || b._c - a._c)
  const post = (e) => {
    e.preventDefault()
    const data = shout
      ? { message: draft.message, to: draft.to, from: ws.me, value: draft.value, posted: todayIso(), cheers: 0 }
      : { headline: draft.headline, body: draft.body, author: ws.me, posted: todayIso(), likes: 0 }
    const out = change((w) => createRecord(w, app.id, data))
    if (!out.ok) return toast(Object.values(out.errors || {})[0] || out.error)
    setDraft({ headline: "", body: "", message: "", to: "", value: "Teamwork" })
    toast(shout ? "Shoutout posted! 🎉" : "Announcement posted.")
  }
  const bump = (r) => change((w) => updateRecord(w, app.id, r.id, shout ? { cheers: (r.cheers || 0) + 1 } : { likes: (r.likes || 0) + 1 }, { quiet: true }))
  return (
    <ViewSwitch mode={mode} setMode={setMode} modes={["feed", "list"]}>
      <div className="awScroll awFeed">
        <form className="awComposer" onSubmit={post}>
          {shout ? (
            <>
              <div className="awComposerRow">
                <label>
                  Shout out to{" "}
                  <select value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} aria-label="Shout out to">
                    <option value="">(pick someone)</option>
                    {ws.users.filter((u) => u.handle !== ws.me).map((u) => (
                      <option key={u.handle} value={u.handle}>{u.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  for{" "}
                  <select value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} aria-label="Value">
                    {fieldOf(app, "value").options.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </label>
              </div>
              <textarea rows={2} placeholder="Say something nice..." value={draft.message} onChange={(e) => setDraft({ ...draft, message: e.target.value })} aria-label="Message" />
            </>
          ) : (
            <>
              <input type="text" placeholder="Headline" value={draft.headline} onChange={(e) => setDraft({ ...draft, headline: e.target.value })} aria-label="Headline" maxLength={200} />
              <textarea rows={2} placeholder="What's the news?" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} aria-label="Announcement" />
            </>
          )}
          <div className="awComposerRow">
            <span className="awGrow" />
            <button type="submit" className="awBtn awBtnGo" disabled={shout ? !draft.message.trim() || !draft.to : !draft.headline.trim()}>
              <Icon name={shout ? "star" : "megaphone"} /> Post
            </button>
          </div>
        </form>
        {posts.map((r) => {
          const who = shout ? r.from : r.author
          return (
            <article key={r.id} className={`awPost ${r.pinned ? "is-pinned" : ""} ${shout ? "awPost--shout" : ""}`} data-id={r.id}>
              <span className="awAvatar awAvatar--big" style={{ background: avatarColor(who || "x") }}>{initials(userName(ws, who) || "?")}</span>
              <div className="awPostBody">
                <div className="awPostHead">
                  <b>{userName(ws, who) || "Someone"}</b>
                  {shout && r.to && (
                    <>
                      {" "}→ <b>{userName(ws, r.to)}</b> <span className="awPill awPill--good">{r.value}</span>
                    </>
                  )}
                  {r.pinned && <span className="awPill awPill--warn">Pinned</span>}
                  <span className="awMuted"> · {display(ws, fieldOf(app, "posted"), r.posted)}</span>
                </div>
                {shout ? <p className="awPostText">{r.message}</p> : (
                  <>
                    <h4 className="awPostTitle">{r.headline}</h4>
                    <p className="awPostText">{r.body}</p>
                  </>
                )}
                <div className="awPostFoot">
                  <button type="button" className="awBtn awBtnSmall" onClick={() => bump(r)} aria-label={shout ? "Cheer" : "Like"}>
                    {shout ? "👏 Cheers" : "👍 Like"} ({(shout ? r.cheers : r.likes) || 0})
                  </button>
                  <button type="button" className="awLinkBtn" onClick={() => openRecord(app.id, r.id)}>
                    {mobile ? "Open" : `Open ${recordNo(app, r.id)}`}
                  </button>
                </div>
              </div>
            </article>
          )
        })}
        {!posts.length && <div className="awEmpty">Nothing posted yet. Be the first!</div>}
      </div>
    </ViewSwitch>
  )
}
