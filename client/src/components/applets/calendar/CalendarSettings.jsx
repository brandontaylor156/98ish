import React, { useEffect, useState } from "react"
import { COLOR_NAMES, LOCAL_ID, activity as loadActivity, colorOf, createCalendar, deleteCalendar, feedUrl, invite, join, leaveCalendar, newCode, removeMember, setMyColor, toggleMuted, updateCalendar, useCalendar } from "./store"
import { downloadCalendar } from "./util"
import Sheet from "./Sheet"
import CheckBox from "./CheckBox"

// Calendar Properties (people, invite code and link, labels, phone subscription, leave),
// the Activity feed, New Calendar and Join a Calendar.

const SITE = typeof window !== "undefined" ? window.location.origin : "https://98ish.vercel.app"

const ColorPicker = ({ value, onPick, label }) => (
  <div className="calSwatches" role="radiogroup" aria-label={label}>
    {COLOR_NAMES.map((c) => (
      <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} title={c} className={`calSwatch${value === c ? " calOn" : ""}`} style={{ background: colorOf(c) }} onClick={() => onPick(c)} />
    ))}
  </div>
)

const copy = async (text, setCopied, what) => {
  try {
    await navigator.clipboard.writeText(text)
    setCopied(what)
  } catch {
    setCopied(null)
    window.prompt("Copy this:", text)
  }
  setTimeout(() => setCopied(null), 2000)
}

const ACTION_WORDS = { added: "added", changed: "changed", deleted: "deleted", skipped: "skipped a day of", completed: "checked off", reopened: "reopened", commented: "commented on", joined: "joined the calendar", left: "left", removed: "removed", created: "made the calendar", imported: "uploaded" }

export const ActivityList = ({ calendarId }) => {
  const [list, setList] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    loadActivity(calendarId).then((r) => (r.ok ? setList(r.activity) : setError(r.error)))
  }, [calendarId])
  if (error) return <p className="calError">{error}</p>
  if (!list) return <p className="calNote">Loading...</p>
  if (!list.length) return <p className="calNote">Nothing yet. When anyone adds or changes something, it shows up here.</p>
  return (
    <ul className="calActivity">
      {list.map((a) => (
        <li key={a.id}>
          <b>{a.byName}</b> {ACTION_WORDS[a.action] || a.action}
          {a.action === "removed" ? ` ${a.title}` : ["joined", "created", "left"].includes(a.action) ? "" : ` "${a.title}"`}
          {a.when && a.action !== "deleted" && a.action !== "commented" ? <span className="calNote"> · {a.when}</span> : null}
          {a.text ? <span className="calActivityText">: {a.text}</span> : null}
          <span className="calActivityAt">{new Date(a.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
        </li>
      ))}
    </ul>
  )
}

export const CalendarSettings = ({ calendarId, mobile, onClose, tab: firstTab = "people" }) => {
  const s = useCalendar()
  const calendar = s.calendars.find((c) => c.id === calendarId)
  const [tab, setTab] = useState(firstTab)
  const [name, setName] = useState(calendar?.name || "")
  const [to, setTo] = useState("")
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState(false)
  const [feed, setFeed] = useState(null)
  const [copied, setCopied] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [labels, setLabels] = useState(() => (calendar?.labels || []).map((l) => ({ ...l })))
  if (!calendar) return null
  const local = calendar.id === LOCAL_ID
  const owner = calendar.role === "owner"
  const group = calendar.kind === "group"
  const meKey = s.me?.key
  const mine = calendar.members.find((m) => m.key === meKey)
  const link = calendar.code ? `${SITE}/?calendar=${calendar.code}` : null

  const run = async (fn, done) => {
    setBusy(true)
    setError(null)
    setNote(null)
    const r = await fn()
    setBusy(false)
    if (!r.ok) setError(r.error)
    else done?.(r)
    return r
  }

  const tabs = local ? ["general", "labels", "phone"] : ["people", "general", "labels", "phone", "activity"]
  const TAB_NAMES = { people: "People", general: "General", labels: "Labels", phone: "Phone", activity: "Activity" }
  const current = tabs.includes(tab) ? tab : tabs[0]

  return (
    <Sheet title={`${calendar.name} Properties`} mobile={mobile} onClose={onClose} dismissable className="calSettings" footer={<button type="button" onClick={onClose}>Close</button>}>
      <menu role="tablist" className="calTabs">
        {tabs.map((t) => (
          <li key={t} role="tab" aria-selected={current === t}>
            <a href="#" onClick={(e) => (e.preventDefault(), setTab(t))}>
              {TAB_NAMES[t]}
            </a>
          </li>
        ))}
      </menu>
      <div className="window calTabPanel" role="tabpanel">
        <div className="window-body">
          {current === "people" && (
            <>
              <ul className="calMembers">
                {calendar.members.map((m) => (
                  <li key={m.key}>
                    <span className="calSwatchMini" style={{ background: colorOf(m.color) }} />
                    <b>{m.name}</b>
                    {m.key === meKey && " (you)"}
                    <span className="calRole">{calendar.kind === "couple" ? "" : m.role === "owner" ? "Owner" : "Member"}</span>
                    {owner && group && m.key !== meKey && (
                      <button type="button" className="calLink" onClick={() => setConfirm({ text: `Remove ${m.name} from ${calendar.name}?`, run: () => run(() => removeMember(calendar.id, m.key)) })}>
                        Remove
                      </button>
                    )}
                  </li>
                ))}
                {calendar.invites.map((i) => (
                  <li key={i.key} className="calInvited">
                    <span className="calSwatchMini" />
                    {i.name} <span className="calRole">Invited by {i.by}</span>
                    {owner && (
                      <button type="button" className="calLink" onClick={() => run(() => removeMember(calendar.id, i.key))}>
                        Take back
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {mine && (
                <div className="calFieldRow">
                  <span>My color here:</span>
                  <ColorPicker value={mine.color} label="My color" onPick={(c) => run(() => setMyColor(calendar.id, c))} />
                </div>
              )}
              {group ? (
                <>
                  <form
                    className="calInviteForm"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (to.trim()) run(() => invite(calendar.id, to.trim()), () => (setNote(`Invited ${to.trim()}. They'll see it next time they're on 98ish.`), setTo("")))
                    }}
                  >
                    <label htmlFor="calInviteName">Invite by 98 Messenger screen name:</label>
                    <div className="calRowInline">
                      <input id="calInviteName" type="text" value={to} maxLength={24} onChange={(e) => setTo(e.target.value)} placeholder="Screen name" />
                      <button type="submit" disabled={busy || !to.trim()}>
                        Invite
                      </button>
                    </div>
                  </form>
                  {calendar.code ? (
                    <div className="calCodeBox">
                      <span>Or share the invite code:</span>
                      <div className="calCode" aria-label="Invite code">
                        {calendar.code.slice(0, 4)}-{calendar.code.slice(4)}
                      </div>
                      <div className="calRowInline">
                        <button type="button" onClick={() => copy(link, setCopied, "link")}>
                          {copied === "link" ? "Copied!" : "Copy invite link"}
                        </button>
                        {navigator.share && (
                          <button type="button" onClick={() => navigator.share({ title: `Join ${calendar.name} on 98ish`, text: `Join my calendar "${calendar.name}" on 98ish (code ${calendar.code})`, url: link }).catch(() => {})}>
                            Share...
                          </button>
                        )}
                        {owner && (
                          <button type="button" onClick={() => run(() => newCode(calendar.id), () => setNote("A new code. The old one doesn't work any more."))}>
                            New code
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    owner && (
                      <button type="button" onClick={() => run(() => newCode(calendar.id))}>
                        Make an invite code
                      </button>
                    )
                  )}
                </>
              ) : (
                <p className="calNote">{calendar.kind === "couple" ? "The Us calendar is just for the two of you. To share with family or friends, make a group calendar (File > New Calendar)." : "This is your own calendar. To share, make a group calendar (File > New Calendar)."}</p>
              )}
            </>
          )}

          {current === "general" && (
            <>
              <label className="calField">
                <span>Name</span>
                <div className="calRowInline">
                  <input type="text" value={name} maxLength={40} disabled={!local && group && !owner} onChange={(e) => setName(e.target.value)} />
                  <button type="button" disabled={busy || !name.trim() || name === calendar.name || (!local && group && !owner)} onClick={() => run(() => updateCalendar(calendar.id, { name: name.trim() }), () => setNote("Renamed."))}>
                    Rename
                  </button>
                </div>
              </label>
              <div className="calFieldRow">
                <span>Calendar color:</span>
                <ColorPicker value={calendar.color} label="Calendar color" onPick={(c) => (local || !group || owner) && run(() => updateCalendar(calendar.id, { color: c }))} />
              </div>
              <CheckBox checked={!s.muted.includes(calendar.id)} onChange={() => toggleMuted(calendar.id)}>
                Reminders and notices from this calendar on this device
              </CheckBox>
              {typeof Notification !== "undefined" && Notification.permission === "default" && (
                <p className="calNote">
                  <button type="button" onClick={() => Notification.requestPermission().then((p) => setNote(p === "granted" ? "Reminders now pop up even when 98ish is in the background." : "Notifications stay off."))}>
                    Allow notifications...
                  </button>{" "}
                  so reminders pop up while 98ish is in the background.
                </p>
              )}
              <div className="calRowInline calDanger">
                <button type="button" onClick={() => downloadCalendar(calendar.id)}>
                  Download as .ics
                </button>
                {group && (
                  <button type="button" onClick={() => setConfirm({ text: `Leave ${calendar.name}? You'll need a new invitation to come back.`, run: () => run(() => leaveCalendar(calendar.id), onClose) })}>
                    Leave calendar
                  </button>
                )}
                {group && owner && (
                  <button type="button" onClick={() => setConfirm({ text: `Delete ${calendar.name} and all its events for everyone? This can't be undone.`, run: () => run(() => deleteCalendar(calendar.id), onClose) })}>
                    Delete calendar
                  </button>
                )}
              </div>
            </>
          )}

          {current === "labels" && (
            <>
              <p className="calNote">Name the colors so everyone knows what they mean (Work, Kids, Date night...).</p>
              <div className="calLabels">
                {labels.map((l, i) => (
                  <label key={l.id} className="calLabelRow">
                    <span className="calSwatch" style={{ background: colorOf(l.color) }} />
                    <input type="text" aria-label={`Name for ${l.color}`} value={l.name} maxLength={24} placeholder={l.color} onChange={(e) => setLabels(labels.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  </label>
                ))}
              </div>
              <button type="button" disabled={busy} onClick={() => run(() => updateCalendar(calendar.id, { labels: labels.map((l) => ({ id: l.id, name: l.name.trim() })) }), () => setNote("Saved."))}>
                Save labels
              </button>
            </>
          )}

          {current === "phone" && (
            <>
              <p>Get this calendar's events, with their reminders, in your phone's own calendar app. Then your phone reminds you even when 98ish is closed.</p>
              {local ? (
                <>
                  <p className="calNote">This calendar only lives in this browser. Download it as a file and open it on your phone to add the events once, or sign on to 98 Messenger and upload it to keep your phone in sync.</p>
                  <button type="button" onClick={() => downloadCalendar(calendar.id)}>
                    Download .ics
                  </button>
                </>
              ) : feed ? (
                <>
                  <ol className="calSteps">
                    <li>
                      On your iPhone, tap <a href={feed.webcal}>Subscribe on this phone</a> (or copy the link below).
                    </li>
                    <li>iPhone: Settings &gt; Apps &gt; Calendar &gt; Calendar Accounts &gt; Add Account &gt; Other &gt; Add Subscribed Calendar, and paste the link.</li>
                    <li>
                      For reminders on your phone, turn <b>off</b> "Remove Alerts" for this subscription.
                    </li>
                    <li>Google Calendar: Other calendars &gt; From URL.</li>
                  </ol>
                  <input type="text" readOnly aria-label="Subscription link" value={feed.https} onFocus={(e) => e.target.select()} />
                  <div className="calRowInline">
                    <button type="button" onClick={() => copy(feed.https, setCopied, "feed")}>
                      {copied === "feed" ? "Copied!" : "Copy link"}
                    </button>
                    <button type="button" onClick={() => run(() => feedUrl(calendar.id, true), (r) => (setFeed(r), setNote("A new link. The old one stops working.")))}>
                      New link
                    </button>
                  </div>
                  <p className="calNote">The link is private to you: anyone with it can see this calendar. Phones check it every hour or so (the server may take a minute to wake up). Changes made on the phone don't come back to 98ish.</p>
                </>
              ) : (
                <button type="button" disabled={busy} onClick={() => run(() => feedUrl(calendar.id), setFeed)}>
                  Get my subscription link
                </button>
              )}
            </>
          )}

          {current === "activity" && <ActivityList calendarId={calendar.id} />}
          {note && <p className="calNote" role="status">{note}</p>}
          {error && <p className="calError" role="alert">{error}</p>}
        </div>
      </div>
      {confirm && (
        <Sheet title="98ish Calendar" mobile={mobile} onClose={() => setConfirm(null)} className="calConfirm" footer={<><button type="button" className="calPrimary" onClick={() => (setConfirm(null), confirm.run())}>Yes</button><button type="button" onClick={() => setConfirm(null)}>No</button></>}>
          <p>{confirm.text}</p>
        </Sheet>
      )}
    </Sheet>
  )
}

export const NewCalendar = ({ mobile, onClose, onMade }) => {
  const [name, setName] = useState("")
  const [color, setColor] = useState("green")
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const make = async (e) => {
    e?.preventDefault()
    if (!name.trim()) return setError("Give it a name.")
    setBusy(true)
    const r = await createCalendar(name.trim(), color)
    setBusy(false)
    if (!r.ok) return setError(r.error)
    onMade(r.calendar)
  }
  return (
    <Sheet title="New Calendar" mobile={mobile} onClose={onClose} footer={<><button type="submit" form="calNewForm" className="calPrimary" disabled={busy}>Create</button><button type="button" onClick={onClose}>Cancel</button></>}>
      <form id="calNewForm" className="calForm" onSubmit={make}>
        <p>A calendar to share with family, friends, a team or a club. Invite people by screen name or send them a link.</p>
        <label className="calField">
          <span>Name</span>
          <input type="text" value={name} maxLength={40} placeholder="Family, Roommates, Book Club..." onChange={(e) => setName(e.target.value)} autoFocus={!mobile} />
        </label>
        <div className="calFieldRow">
          <span>Color:</span>
          <ColorPicker value={color} label="Color" onPick={setColor} />
        </div>
        {error && <p className="calError">{error}</p>}
      </form>
    </Sheet>
  )
}

export const JoinCalendar = ({ mobile, code: initial = "", onClose, onJoined }) => {
  const [code, setCode] = useState(initial)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const signedOn = useCalendar().status !== "signed-out"
  const go = async (e) => {
    e?.preventDefault()
    setBusy(true)
    const r = await join(code)
    setBusy(false)
    if (!r.ok) return setError(r.error)
    onJoined(r.calendar)
  }
  return (
    <Sheet title="Join a Calendar" mobile={mobile} onClose={onClose} footer={<><button type="submit" form="calJoinForm" className="calPrimary" disabled={busy || !signedOn || code.replace(/[^a-z0-9]/gi, "").length !== 8}>Join</button><button type="button" onClick={onClose}>Cancel</button></>}>
      <form id="calJoinForm" className="calForm" onSubmit={go}>
        <p>Got an invite code like K7QX-M2PA? Type it here.</p>
        {!signedOn && <p className="calError">Sign on to 98 Messenger first: shared calendars belong to your screen name.</p>}
        <label className="calField">
          <span>Code</span>
          <input type="text" value={code} maxLength={12} autoCapitalize="characters" onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX" />
        </label>
        {error && <p className="calError">{error}</p>}
      </form>
    </Sheet>
  )
}
