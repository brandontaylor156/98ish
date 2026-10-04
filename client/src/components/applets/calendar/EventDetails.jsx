import React, { useEffect, useRef, useState } from "react"
import { describeReminder, describeRepeat, anchorOf, whenLabel } from "./recur"
import { LIVE_EVENT, LOCAL_ID, addComment, colorOf, comments as loadComments, deleteComment } from "./store"
import { colorFor, downloadEvent, eventFile } from "./util"
import { filePayload, shareOut } from "../../../utils/share"
import Sheet from "./Sheet"
import CheckBox from "./CheckBox"
import { openCouples } from "../../../utils/couple"

// An event (or memo) up close: when, where, who added it, its checklist and reminders, and
// the conversation about it (shared calendars). Edit, Delete, and Add to my phone's calendar.

const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

const Comments = ({ calendarId, eventId, me, focus }) => {
  const [list, setList] = useState(null)
  const [text, setText] = useState("")
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const end = useRef(null)
  const input = useRef(null)
  const load = () =>
    loadComments(calendarId, eventId).then((r) => {
      if (r.ok) setList(r.comments)
      else setError(r.error)
    })
  useEffect(() => {
    load()
    const live = (e) => e.detail?.type === "cal:comment" && e.detail.eventId === eventId && load()
    window.addEventListener(LIVE_EVENT, live)
    return () => window.removeEventListener(LIVE_EVENT, live)
  }, [eventId])
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "nearest" })
  }, [list?.length])
  useEffect(() => {
    if (focus) setTimeout(() => input.current?.focus({ preventScroll: true }), 200)
  }, [])
  const send = async (e) => {
    e.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    const r = await addComment(calendarId, eventId, text.trim())
    setBusy(false)
    if (!r.ok) return setError(r.error)
    setText("")
    setError(null)
    setList((l) => [...(l || []), r.comment])
  }
  return (
    <section className="calComments" aria-label="Comments">
      <h4>Comments</h4>
      {list === null && !error && <p className="calNote">Loading...</p>}
      {list?.length === 0 && <p className="calNote">No comments yet. Ask a question, say you're in, add a detail.</p>}
      <ul>
        {(list || []).map((c) => (
          <li key={c.id} className={c.by === me ? "calMine" : ""}>
            <div className="calCommentHead">
              <b>{c.byName}</b> <span>{ago(c.at)}</span>
              {c.by === me && (
                <button type="button" className="calLink" onClick={async () => (await deleteComment(calendarId, eventId, c.id)).ok && setList((l) => l.filter((x) => x.id !== c.id))}>
                  Delete
                </button>
              )}
            </div>
            <div className="calCommentText">{c.text}</div>
          </li>
        ))}
      </ul>
      <div ref={end} />
      <form className="calCommentForm" onSubmit={send}>
        <input ref={input} type="text" aria-label="Write a comment" value={text} maxLength={1000} placeholder="Write a comment..." onChange={(e) => setText(e.target.value)} />
        <button type="submit" disabled={busy || !text.trim()}>
          Send
        </button>
      </form>
      {error && <p className="calError">{error}</p>}
    </section>
  )
}

const EventDetails = ({ occ, calendar, zone, mobile, me, focusComments, onEdit, onDelete, onDone, onChecklist, onClose }) => {
  const event = occ.event
  const memo = event.kind === "memo"
  const author = calendar?.members?.find((m) => m.key === event.createdBy)
  const shared = calendar && calendar.id !== LOCAL_ID && calendar.members.length > 1
  const people = (occ.attendees || []).map((k) => calendar?.members.find((m) => m.key === k)).filter(Boolean)
  return (
    <Sheet
      title={memo ? "Memo" : "Event"}
      mobile={mobile}
      onClose={onClose}
      dismissable
      className="calDetails"
      footer={
        <>
          {calendar?.readOnly ? (
            // a birthday or anniversary: it's changed in the Address Book
            event.contactId && (
              <button type="button" onClick={() => (onClose(), openCouples("Address Book", { handoff: { id: Date.now(), contactId: event.contactId } }))}>
                Open in Address Book
              </button>
            )
          ) : (
            <>
              <button type="button" onClick={onEdit}>
                Edit...
              </button>
              <button type="button" onClick={onDelete}>
                Delete...
              </button>
            </>
          )}
          {!memo && (
            <button type="button" onClick={() => downloadEvent({ ...event, title: occ.title })} title="Download an .ics file your phone's calendar can add">
              Add to my phone
            </button>
          )}
          {!memo && (
            <button
              type="button"
              // the share sheet with the .ics (Messages, Mail...: tapping it adds the event)
              onClick={() => shareOut(filePayload(occ.title, eventFile({ ...event, title: occ.title }), { text: `${occ.title}\n${whenLabel(occ, zone)}${event.location ? `\n${event.location}` : ""}` }), "apps", { title: "Share Event" })}
              title="Send this event to someone (an .ics file any calendar can add)"
            >
              Share...
            </button>
          )}
          <button type="button" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="calDetailHead" style={{ "--chip": colorFor(occ, calendar) }}>
        <h3>
          {event.todo && (
            <CheckBox className="calDoneBox" label="Done" checked={occ.done} onChange={onDone} />
          )}
          <span className={occ.done ? "calRowDone" : ""}>{occ.title}</span>
        </h3>
        {!memo && <p className="calDetailWhen">{whenLabel(occ, zone)}</p>}
        {event.repeat && <p className="calDetailLine">⟳ {describeRepeat(event.repeat, anchorOf(event).date)}{occ.changed ? " (this one changed)" : ""}</p>}
        {!memo && !event.allDay && event.tz && event.tz !== zone && <p className="calNote">Planned in {event.tz.replace(/_/g, " ")}; shown in your time.</p>}
        {occ.location && <p className="calDetailLine">📍 {occ.location}</p>}
      </div>
      {occ.notes && <p className="calDetailNotes">{occ.notes}</p>}
      {occ.checklist?.length > 0 && (
        <ul className="calDetailChecklist">
          {occ.checklist.map((c, i) => (
            <li key={i}>
              <CheckBox className={c.done ? "calRowDone" : ""} checked={c.done} onChange={(done) => onChecklist(i, done)}>
                {c.text}
              </CheckBox>
            </li>
          ))}
        </ul>
      )}
      {!memo && occ.reminders?.length > 0 && <p className="calDetailLine">🔔 {occ.reminders.map((m) => describeReminder(m, occ.allDay)).join(", ")}</p>}
      {people.length > 0 && (
        <p className="calDetailLine">
          👥{" "}
          {people.map((m) => (
            <span key={m.key} className="calPersonTag" style={{ "--chip": colorOf(m.color) }}>
              {m.name}
            </span>
          ))}
        </p>
      )}
      <p className="calDetailMeta">
        <span className="calSwatchMini" style={{ background: colorOf(calendar?.color) }} /> {calendar?.name}
        {shared && (
          <>
            {" · "}Added by <b style={{ color: author ? colorOf(author.color) : undefined }}>{event.createdByName}</b>
            {event.updatedByName && event.updatedAt !== event.createdAt && event.updatedByName !== event.createdByName ? `, changed by ${event.updatedByName}` : ""}
          </>
        )}
      </p>
      {shared && <Comments calendarId={calendar.id} eventId={event.id} me={me} focus={focusComments} />}
    </Sheet>
  )
}

export default EventDetails
