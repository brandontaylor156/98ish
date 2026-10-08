import React, { useEffect, useMemo, useRef, useState } from "react"
import Dialog from "../../shared/Dialog"
import { sanitizeHtml } from "../wordpad/sanitize"
import { trackUnsaved } from "../../../utils/unsaved"
import { playSystemSound } from "../../../utils/systemSounds"
import {
  appById, completeWorkOrder, createRecord, decide, deleteRecord, display, fieldOf, getRecord, getRef, issueMaterials, launcherApps, link, linksOf,
  materialsFor, onHand, parseRef, recordNo, statusFieldOf, recordTitle, recordsOf, refOf, relatedTo, unlink, updateRecord, userName,
} from "./engine.js"
import { change } from "./store.js"
import { Icon } from "./icons.jsx"
import { useAw, ago, avatarColor, initials, singular } from "./ctx.js"
import { esc, printPage } from "./print.js"
import { ProjectTimeline } from "./Planning.jsx"

// Lists, boards and forms that every app gets from its schema.

// ---- chips: a record anywhere, one click away ----

export const RecordChip = ({ refStr, onRemove }) => {
  const { ws, openRecord } = useAw()
  const p = parseRef(refStr)
  const app = p && appById(ws, p.app)
  const rec = p && getRecord(ws, p.app, p.id)
  if (!app || !rec) return null
  return (
    <span className="awChip">
      <button type="button" className="awChipLink" onClick={() => openRecord(p.app, p.id)} title={`Open ${app.name} ${recordNo(app, p.id)}`}>
        <Icon name={app.icon} />
        <span className="awChipNo">{recordNo(app, p.id)}</span>
        <span className="awChipTitle">{recordTitle(ws, p.app, rec)}</span>
      </button>
      {onRemove && (
        <button type="button" className="awChipX" aria-label="Remove link" title="Remove link" onClick={onRemove}>
          ×
        </button>
      )}
    </span>
  )
}

export const UserTag = ({ handle }) => {
  const { ws } = useAw()
  if (!handle) return null
  const name = userName(ws, handle)
  return (
    <span className="awUserTag" title={name}>
      <span className="awAvatar" style={{ background: avatarColor(handle) }}>{initials(name)}</span>
      {name}
    </span>
  )
}

// ---- the record picker (Link To..., Attach Record...) ----

export const PickerDialog = ({ title = "Link To", okLabel = "Link", exclude = null, onPick, onCancel }) => {
  const { ws } = useAw()
  const apps = launcherApps(ws).filter((a) => !a.noRecords)
  const [appId, setAppId] = useState("")
  const [text, setText] = useState("")
  const [chosen, setChosen] = useState(null)
  const rows = useMemo(() => {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean)
    const out = []
    for (const app of appId ? [appById(ws, appId)] : apps) {
      for (const rec of recordsOf(ws, app.id)) {
        const ref = refOf(app.id, rec.id)
        if (ref === exclude) continue
        const label = `${recordNo(app, rec.id)} ${recordTitle(ws, app.id, rec)}`
        const hay = words.length ? `${label} ${app.fields.slice(1, 4).map((f) => display(ws, f, rec[f.key])).join(" ")}`.toLowerCase() : ""
        if (words.every((w) => hay.includes(w))) out.push({ ref, app, rec, label })
        if (out.length >= 200) break
      }
    }
    return out
  }, [appId, text, ws.rev])
  return (
    <Dialog title={title} okLabel={okLabel} okDisabled={!chosen} onOk={() => onPick(chosen)} onCancel={onCancel}>
      <div className="awPicker">
        <label className="awPickRow">
          Look in:
          <select value={appId} onChange={(e) => setAppId(e.target.value)}>
            <option value="">All apps</option>
            {apps.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <label className="awPickRow">
          Find:
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type part of a name or number" />
        </label>
        <ul className="awPickList sunken-panel" role="listbox" aria-label="Records">
          {rows.map((r) => (
            <li key={r.ref} role="option" aria-selected={chosen === r.ref} className={chosen === r.ref ? "is-chosen" : ""} onClick={() => setChosen(r.ref)} onDoubleClick={() => onPick(r.ref)}>
              <Icon name={r.app.icon} /> {r.label}
            </li>
          ))}
          {!rows.length && <li className="awMuted">Nothing matches.</li>}
        </ul>
      </div>
    </Dialog>
  )
}

// ---- lists and boards ----

const sortValue = (ws, f, rec) => (["number", "money"].includes(f.type) ? Number(rec[f.key] ?? -Infinity) : f.type === "date" ? rec[f.key] || "" : display(ws, f, rec[f.key]).toLowerCase())

export const RecordList = ({ app, initialView }) => {
  const { ws, openRecord, newRecord, mobile, toast } = useAw()
  const boardField = app.board ? fieldOf(app, app.board) : null
  const statusField = statusFieldOf(app) || app.fields.find((f) => f.type === "select")
  const [mode, setMode] = useState(initialView || (boardField && app.view === "board" && app.id !== "workOrders" ? "board" : "list"))
  const [text, setText] = useState("")
  const [status, setStatus] = useState("")
  const [sort, setSort] = useState({ key: null, dir: 1 })
  const [selected, setSelected] = useState(null)
  const cols = app.listKeys.map((k) => fieldOf(app, k))

  const all = recordsOf(ws, app.id)
  const rows = useMemo(() => {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean)
    let list = all.filter((r) => !status || r[statusField?.key] === status)
    if (words.length) {
      list = list.filter((r) => {
        const hay = [recordNo(app, r.id), ...app.fields.map((f) => display(ws, f, r[f.key]))].join(" ").toLowerCase()
        return words.every((w) => hay.includes(w))
      })
    }
    const sf = sort.key && fieldOf(app, sort.key)
    return [...list].sort((a, b) => {
      if (!sf) return Number(b.id) - Number(a.id)
      const x = sortValue(ws, sf, a)
      const y = sortValue(ws, sf, b)
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || Number(a.id) - Number(b.id)
    })
  }, [ws.rev, text, status, sort, app.id])

  const sel = selected && getRecord(ws, app.id, selected)
  const approve = (decision) => {
    const out = change((w) => decide(w, app.id, selected, decision))
    if (out.ok) {
      toast(`${recordNo(app, selected)} ${decision.toLowerCase()}.`)
      playSystemSound("ding")
    } else toast(out.error)
  }

  return (
    <div className="awList">
      <div className="awListBar">
        <button type="button" className="awBtn" onClick={() => newRecord(app.id)}>
          <Icon name="new" /> New {singular(app.name)}
        </button>
        {boardField && (
          <span className="awSeg" role="group" aria-label="View">
            <button type="button" className={mode === "list" ? "is-on" : ""} onClick={() => setMode("list")}>List</button>
            <button type="button" className={mode === "board" ? "is-on" : ""} onClick={() => setMode("board")}>Board</button>
          </span>
        )}
        {app.approval && (
          <>
            <button type="button" className="awBtn" disabled={sel?.status !== "Pending"} onClick={() => approve("Approved")}>Approve</button>
            <button type="button" className="awBtn" disabled={sel?.status !== "Pending"} onClick={() => approve("Denied")}>Deny</button>
          </>
        )}
        <span className="awGrow" />
        <label className="awFilter">
          <span className={mobile ? "awSrOnly" : ""}>Filter:</span>
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter this list" aria-label={`Filter ${app.name}`} />
        </label>
        {statusField && (
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={`Show ${statusField.label}`}>
            <option value="">All ({statusField.label})</option>
            {statusField.options.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        )}
      </div>
      {mode === "board" && boardField ? (
        <Board app={app} field={boardField} recs={rows} />
      ) : (
        <div className="awTableWrap sunken-panel">
          <table className="awTable interactive">
            <thead>
              <tr>
                <th className="awColNo">No.</th>
                {cols.map((c) => (
                  <th key={c.key} onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? -s.dir : 1 }))} aria-sort={sort.key === c.key ? (sort.dir > 0 ? "ascending" : "descending") : undefined}>
                    {c.label}
                    {sort.key === c.key ? (sort.dir > 0 ? " ▲︎" : " ▼︎") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={selected === r.id ? "highlighted" : ""}
                  onClick={() => (mobile ? openRecord(app.id, r.id) : setSelected(r.id))}
                  onDoubleClick={() => openRecord(app.id, r.id)}
                  onKeyDown={(e) => e.key === "Enter" && openRecord(app.id, r.id)}
                  tabIndex={0}
                  data-id={r.id}
                >
                  <td className="awColNo">
                    <Icon name={app.icon} /> {recordNo(app, r.id)}
                  </td>
                  {cols.map((c) => (
                    <td key={c.key} className={`awCell awCell--${c.type}`}>
                      {c.type === "select" ? <span className={`awPill awPill--${pillTone(r[c.key])}`}>{r[c.key]}</span> : display(ws, c, r[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <div className="awEmpty">
              {all.length ? "No records match the filter." : `No ${app.name.toLowerCase()} yet. Click New ${singular(app.name)} to add one.`}
            </div>
          )}
        </div>
      )}
      <div className="awListFoot">
        {rows.length} of {all.length} record{all.length === 1 ? "" : "s"}
        {!mobile && mode === "list" && rows.length > 0 && " · Double-click a record to open it"}
        {!mobile && mode === "board" && " · Drag cards between columns"}
      </div>
    </div>
  )
}

// colors for status-like values, by what the words usually mean
export const pillTone = (v) => {
  const s = String(v || "").toLowerCase()
  if (/^(done|complete|closed|won|approved|pass|resolved|delivered|received|hired|accepted|released|published|implemented|in service|on track|shipped|active|ready|exceeds|booked)$/.test(s)) return "good"
  if (/^(denied|lost|fail|urgent|critical|serious|down|behind|rejected|major findings|declined|retired|obsolete)$/.test(s)) return "bad"
  if (/^(waiting|pending|at risk|on hold|high|containment|investigating|negotiation|proposal|offer|minor findings|recordable|needs work)$/.test(s)) return "warn"
  if (/^(in progress|open|qualified|interview|scheduled|under review|partially received|out|in production|corrective action|planning|sent|phone screen)$/.test(s)) return "info"
  return "plain"
}

const Board = ({ app, field, recs }) => {
  const { ws, openRecord, toast } = useAw()
  const [over, setOver] = useState(null)
  const userField = app.fields.find((f) => f.type === "user")
  const moneyField = app.fields.find((f) => f.type === "money")
  const dateField = app.fields.find((f) => f.type === "date" && /due|close|date/i.test(f.label))
  const drop = (e, opt) => {
    e.preventDefault()
    setOver(null)
    const id = e.dataTransfer.getData("text/x-appward-record")
    const rec = id && getRecord(ws, app.id, id)
    if (!rec || rec[field.key] === opt) return
    change((w) => updateRecord(w, app.id, id, { [field.key]: opt }))
    toast(`${recordNo(app, id)} moved to ${opt}.`)
  }
  return (
    <div className="awBoard">
      {field.options.map((opt) => {
        const cards = recs.filter((r) => r[field.key] === opt)
        const total = moneyField ? cards.reduce((s, r) => s + (Number(r[moneyField.key]) || 0), 0) : null
        return (
          <section
            key={opt}
            className={`awLane ${over === opt ? "is-over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(opt)
            }}
            onDragLeave={() => setOver((o) => (o === opt ? null : o))}
            onDrop={(e) => drop(e, opt)}
            aria-label={opt}
            data-lane={opt}
          >
            <header className="awLaneHead">
              <span>{opt}</span>
              <span className="awLaneCount">{cards.length}</span>
            </header>
            {total !== null && <div className="awLaneTotal">{display(ws, moneyField, total)}</div>}
            <div className="awLaneCards">
              {cards.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  className="awCard"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/x-appward-record", r.id)
                    e.dataTransfer.effectAllowed = "move"
                  }}
                  onClick={() => openRecord(app.id, r.id)}
                  data-id={r.id}
                >
                  <span className="awCardNo">{recordNo(app, r.id)}</span>
                  <span className="awCardTitle">{recordTitle(ws, app.id, r)}</span>
                  <span className="awCardMeta">
                    {userField && r[userField.key] && (
                      <span className="awAvatar" style={{ background: avatarColor(r[userField.key]) }} title={userName(ws, r[userField.key])}>
                        {initials(userName(ws, r[userField.key]))}
                      </span>
                    )}
                    {moneyField && r[moneyField.key] !== null && <span>{display(ws, moneyField, r[moneyField.key])}</span>}
                    {dateField && r[dateField.key] && <span>{display(ws, dateField, r[dateField.key])}</span>}
                    {app.fields.find((f) => f.key === "priority") && r.priority !== "Normal" && <span className={`awPill awPill--${pillTone(r.priority)}`}>{r.priority}</span>}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

// ---- form fields ----

const RichEditor = ({ value, onChange, label }) => {
  const ref = useRef(null)
  const last = useRef(null)
  useEffect(() => {
    if (ref.current && value !== last.current) {
      ref.current.innerHTML = sanitizeHtml(value || "")
      last.current = value
    }
  }, [value])
  const cmd = (name) => {
    ref.current?.focus()
    document.execCommand(name)
    const html = ref.current.innerHTML
    last.current = html
    onChange(html)
  }
  return (
    <div className="awRich">
      <div className="awRichBar" role="toolbar" aria-label={`${label} formatting`}>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("bold")} title="Bold"><b>B</b></button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("italic")} title="Italic"><i>I</i></button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("underline")} title="Underline"><u>U</u></button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("insertUnorderedList")} title="Bullets">• List</button>
      </div>
      <div
        ref={ref}
        className="awRichArea"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        onInput={(e) => {
          last.current = e.currentTarget.innerHTML
          onChange(e.currentTarget.innerHTML)
        }}
        onPaste={(e) => {
          e.preventDefault()
          const html = e.clipboardData.getData("text/html")
          const text = e.clipboardData.getData("text/plain")
          document.execCommand("insertHTML", false, html ? sanitizeHtml(html) : esc(text).replace(/\n/g, "<br>"))
        }}
      />
    </div>
  )
}

const BomEditor = ({ value = [], onChange, selfId }) => {
  const { ws } = useAw()
  const parts = recordsOf(ws, "parts").filter((p) => p.id !== selfId)
  const set = (i, patch) => onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  return (
    <div className="awBom">
      <table className="awMiniTable">
        <thead>
          <tr>
            <th>Component</th>
            <th>Qty each</th>
            <th>On hand</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {value.map((l, i) => (
            <tr key={i}>
              <td>
                <select value={l.part} onChange={(e) => set(i, { part: e.target.value })} aria-label={`Component ${i + 1}`}>
                  <option value="">(pick a part)</option>
                  {parts.map((p) => (
                    <option key={p.id} value={p.id}>{p.partNumber} {p.description}</option>
                  ))}
                </select>
              </td>
              <td>
                <input type="number" min="1" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} aria-label={`Quantity ${i + 1}`} />
              </td>
              <td>{l.part ? onHand(ws, l.part) : ""}</td>
              <td>
                <button type="button" className="awTiny" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove line">×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="awBtn" onClick={() => onChange([...value, { part: "", qty: 1 }])}>Add Component</button>
    </div>
  )
}

export const FieldInput = ({ field, value, onChange, selfId, id }) => {
  const { ws, openRecord } = useAw()
  switch (field.type) {
    case "long":
      return <textarea id={id} rows={4} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    case "rich":
      return <RichEditor value={value} onChange={onChange} label={field.label} />
    case "number":
    case "money":
      return <input id={id} type="number" step={field.type === "money" ? "0.01" : "any"} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    case "date":
      return <input id={id} type="date" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    case "time":
      return <input id={id} type="time" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    case "check":
      return (
        <span className="awCheck">
          <input id={id} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          <label htmlFor={id}>{field.label}</label>
        </span>
      )
    case "select":
      return (
        <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
          {field.options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      )
    case "user":
      return (
        <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">(nobody)</option>
          {ws.users.map((u) => (
            <option key={u.handle} value={u.handle}>{u.name}{u.handle === ws.me ? " (you)" : ""}</option>
          ))}
        </select>
      )
    case "ref": {
      const target = appById(ws, field.app)
      const options = recordsOf(ws, field.app)
        .map((r) => ({ id: r.id, label: recordTitle(ws, field.app, r) }))
        .sort((a, b) => a.label.localeCompare(b.label))
        .slice(0, 400)
      return (
        <span className="awRefInput">
          <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
            <option value="">(none)</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          {value && getRecord(ws, field.app, value) && (
            <button type="button" className="awTiny" title={`Open this ${singular(target?.name || "record")}`} aria-label={`Open ${field.label}`} onClick={() => openRecord(field.app, value)}>
              <Icon name={target?.icon} />
            </button>
          )}
        </span>
      )
    }
    case "bom":
      return <BomEditor value={value || []} onChange={onChange} selfId={selfId} />
    case "refs":
      return (
        <span className="awChips">
          {(value || []).map((r) => (
            <RecordChip key={r} refStr={r} />
          ))}
        </span>
      )
    default:
      return <input id={id} type="text" value={value ?? ""} onChange={(e) => onChange(e.target.value)} maxLength={200} />
  }
}

const WIDE = new Set(["long", "rich", "bom", "refs"])

// ---- a record: its form, links and everything related ----

const fromRecord = (app, rec, preset) => Object.fromEntries(app.fields.map((f) => [f.key, rec ? rec[f.key] : preset?.[f.key] ?? (f.type === "select" ? f.options[0] : f.type === "check" ? false : f.type === "bom" || f.type === "refs" ? [] : "")]))

export const RecordForm = ({ app, id, preset, tabKey, onCreated, onDeleted, focusMsg }) => {
  const { ws, openRecord, newRecord, openApp, toast, pickRecord, confirm, registerSave, mobile } = useAw()
  const rec = id ? getRecord(ws, app.id, id) : null
  const [draft, setDraft] = useState(() => fromRecord(app, rec, preset))
  const [errors, setErrors] = useState({})
  const [dirty, setDirty] = useState(false)
  const formId = useRef(`aw${Math.random().toString(36).slice(2, 8)}`).current

  // changes made elsewhere (a board drag, an approval) show up while nothing is being edited
  useEffect(() => {
    if (rec && !dirty) setDraft(fromRecord(app, rec))
  }, [rec?._u, ws.rev])

  useEffect(() => {
    if (!dirty) return
    return trackUnsaved("Appward 98")
  }, [dirty])

  const set = (key, value) => {
    setDraft((d) => ({ ...d, [key]: value }))
    setDirty(true)
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const save = () => {
    const data = { ...draft }
    for (const f of app.fields) if (f.type === "rich") data[f.key] = sanitizeHtml(data[f.key] || "")
    for (const f of app.fields) if (f.type === "refs") delete data[f.key]
    const out = id ? change((w) => updateRecord(w, app.id, id, data)) : change((w) => createRecord(w, app.id, data))
    if (!out?.ok) {
      setErrors(out?.errors || {})
      toast(out?.error || "Please fix the highlighted fields.")
      playSystemSound("chord")
      return false
    }
    setErrors({})
    setDirty(false)
    toast(`${singular(app.name)} ${recordNo(app, out.record.id)} saved.`)
    if (!id) onCreated?.(out.record.id)
    return true
  }
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => registerSave(tabKey, () => saveRef.current()), [tabKey])

  if (id && !rec) return <div className="awEmpty">This record was deleted.</div>

  const ref = id ? refOf(app.id, id) : null
  const links = ref ? linksOf(ws, ref) : []
  const related = id ? relatedTo(ws, app.id, id) : []

  const remove = () =>
    confirm({
      text: `Delete ${singular(app.name).toLowerCase()} ${recordNo(app, id)}, "${recordTitle(ws, app.id, rec)}"? Links to it are removed too.`,
      onYes: () => {
        const out = change((w) => deleteRecord(w, app.id, id))
        if (out.ok) {
          setDirty(false)
          toast(`Deleted ${recordNo(app, id)}${out.cleared ? `, and cleaned up ${out.cleared} reference${out.cleared === 1 ? "" : "s"} to it` : ""}.`)
          playSystemSound("recycle")
          onDeleted?.()
        }
      },
    })

  const addLink = () =>
    pickRecord({
      title: `Link ${recordNo(app, id)} To`,
      exclude: ref,
      onPick: (other) => {
        const out = change((w) => link(w, ref, other))
        toast(out.ok ? "Linked." : out.error)
      },
    })

  const print = () => {
    const rows = app.fields.filter((f) => f.type !== "bom" && f.type !== "refs").map((f) => `<tr><th>${esc(f.label)}</th><td>${esc(f.type === "rich" ? display(ws, f, rec[f.key]) : f.type === "long" ? rec[f.key] : display(ws, f, rec[f.key]))}</td></tr>`)
    if (!printPage({ title: `${singular(app.name)} ${recordNo(app, id)}`, subtitle: `${ws.company} · ${recordTitle(ws, app.id, rec)}`, body: `<table>${rows.join("")}</table>` })) toast("This browser can't print from here.")
  }

  const doDecide = (decision) => {
    const out = change((w) => decide(w, app.id, id, decision))
    toast(out.ok ? `${decision}.` : out.error)
    if (out.ok) playSystemSound("ding")
  }

  const wo = app.id === "workOrders" && rec
  const woAction = (fn, done) => {
    const out = change((w) => fn(w, id))
    if (out.ok) {
      toast(done)
      playSystemSound("ding")
    } else {
      toast(out.error)
      playSystemSound("chord")
    }
  }

  return (
    <div className="awRecord" data-app={app.id} data-record={id || "new"}>
      <div className="awRecHead">
        <Icon name={app.icon} size={32} className="awRecIcon" />
        <div className="awRecTitles">
          <div className="awRecKind">
            {singular(app.name)} {id ? recordNo(app, id) : "(new)"}
            {dirty && <span className="awDirty"> · unsaved changes</span>}
          </div>
          <h2 className="awRecTitle">{id ? recordTitle(ws, app.id, rec) : `New ${singular(app.name)}`}</h2>
        </div>
      </div>
      <div className="awRecBar">
        <button type="button" className="awBtn" onClick={save}>
          <Icon name="save" /> Save
        </button>
        {id && (
          <>
            <button type="button" className="awBtn" onClick={addLink}>
              <Icon name="link" /> Link To...
            </button>
            {!mobile && (
              <button type="button" className="awBtn" onClick={print}>
                <Icon name="print" /> Print
              </button>
            )}
            <button type="button" className="awBtn" onClick={remove}>
              <Icon name="delete" /> Delete
            </button>
          </>
        )}
        {id && app.approval && rec.status === "Pending" && (
          <>
            <button type="button" className="awBtn awBtnGo" onClick={() => doDecide("Approved")}>Approve</button>
            <button type="button" className="awBtn" onClick={() => doDecide("Denied")}>Deny</button>
          </>
        )}
        {app.id === "conversations" && id && (
          <button type="button" className="awBtn awBtnGo" onClick={() => openApp("conversations", { channel: id })}>
            <Icon name="chat" /> Open Conversation
          </button>
        )}
      </div>

      <div className="awRecBody">
        <fieldset className="awFields">
          <legend>General</legend>
          {app.fields.map((f) => (
            <div key={f.key} className={`awField ${WIDE.has(f.type) ? "awField--wide" : ""} ${errors[f.key] ? "has-error" : ""}`}>
              {f.type !== "check" && (
                <label htmlFor={`${formId}-${f.key}`}>
                  {f.label}
                  {f.required ? " *" : ""}
                </label>
              )}
              <FieldInput id={`${formId}-${f.key}`} field={f} value={draft[f.key]} onChange={(v) => set(f.key, v)} selfId={id} />
              {errors[f.key] && <div className="awError" role="alert">{errors[f.key]}</div>}
            </div>
          ))}
        </fieldset>

        {wo && (
          <fieldset className="awSection">
            <legend>Materials</legend>
            <WorkOrderMaterials wo={rec} />
            <div className="awBtnRow">
              <button type="button" className="awBtn awBtnGo" disabled={!!rec._issued} onClick={() => woAction(issueMaterials, "Materials issued from inventory.")}>
                Issue Materials
              </button>
              <button type="button" className="awBtn" disabled={!rec._issued || rec.status === "Complete"} onClick={() => woAction(completeWorkOrder, "Work order complete. Finished goods added to inventory.")}>
                Complete Work Order
              </button>
              <span className="awMuted">{rec._issued ? "Materials issued." : "Materials not issued yet."}</span>
            </div>
          </fieldset>
        )}

        {app.id === "parts" && id && (
          <p className="awMuted awOnHand">
            On hand: <b>{onHand(ws, id)}</b> across {recordsOf(ws, "inventory").filter((r) => r.part === id).length} inventory location(s).
          </p>
        )}

        {app.id === "projects" && id && (
          <fieldset className="awSection">
            <legend>Timeline</legend>
            <ProjectTimeline project={rec} />
            <div className="awBtnRow">
              <button type="button" className="awBtn" onClick={() => newRecord("actions", { project: id, start: rec.start, due: rec.end })}>
                <Icon name="check" /> New Action
              </button>
              <button type="button" className="awBtn" onClick={() => newRecord("actions", { project: id, milestone: true, start: rec.end, due: rec.end })}>
                ◆ New Milestone
              </button>
            </div>
          </fieldset>
        )}

        {id && (
          <fieldset className="awSection awLinks">
            <legend>Linked Records</legend>
            <div className="awChips">
              {links.map((r) => (
                <RecordChip
                  key={r}
                  refStr={r}
                  onRemove={() => {
                    change((w) => unlink(w, ref, r))
                    toast("Link removed.")
                  }}
                />
              ))}
              <button type="button" className="awChipAdd" onClick={addLink}>+ Link To...</button>
            </div>
            {related.length > 0 && (
              <>
                <div className="awSubhead">Related</div>
                <div className="awChips">
                  {related.slice(0, 40).map((r) => (
                    <RecordChip key={r.app + r.id} refStr={refOf(r.app, r.id)} />
                  ))}
                </div>
              </>
            )}
          </fieldset>
        )}

        {rec && (
          <p className="awMeta">
            Created {ago(rec._c)}
            {rec._by ? ` by ${userName(ws, rec._by)}` : ""} · Modified {ago(rec._u)}
            {rec._decidedBy ? ` · ${rec.status} by ${userName(ws, rec._decidedBy)}` : ""}
          </p>
        )}
      </div>
    </div>
  )
}

const WorkOrderMaterials = ({ wo }) => {
  const { ws } = useAw()
  const need = materialsFor(ws, wo)
  if (!need.length) return <p className="awMuted">Pick a part with a bill of materials (Parts &gt; Components) to see what this work order needs.</p>
  return (
    <table className="awMiniTable">
      <thead>
        <tr>
          <th>Component</th>
          <th>Needed</th>
          <th>On hand</th>
        </tr>
      </thead>
      <tbody>
        {need.map((n) => {
          const part = getRecord(ws, "parts", n.part)
          return (
            <tr key={n.part} className={!wo._issued && n.have < n.qty ? "is-short" : ""}>
              <td>
                <RecordChip refStr={refOf("parts", n.part)} /> {part?.description}
              </td>
              <td>{n.qty}</td>
              <td>{n.have}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
