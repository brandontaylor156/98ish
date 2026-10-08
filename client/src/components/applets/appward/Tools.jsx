import React, { useMemo, useRef, useState } from "react"
import { Win } from "./Splash.jsx"
import { unlock } from "../../../utils/achievements"
import { playSystemSound } from "../../../utils/systemSounds"
import {
  OPERATORS, allApps, appById, createCustomApp, deleteCustomApp, deleteReport, display, fieldOf, groupBy, launcherApps, load,
  recordsOf, runQuery, saveReport, serialize,
} from "./engine.js"
import { CATEGORIES, CREATOR_ICONS, CUSTOM_CATEGORY, FIELD_TYPES } from "./catalog.js"
import { change, replaceWorkspace } from "./store.js"
import { Icon } from "./icons.jsx"
import { useAw, todayIso } from "./ctx.js"
import { downloadText, printPage, tableHtml, toCsv } from "./print.js"
import { FieldInput } from "./Records.jsx"
import { newWorkspace } from "./seed.js"

// The power tools: Insights (charts), Report Builder, App Creator, Database Manager.

// ---- charts ----

// horizontal bars, one series: the bar length is the value, the label sits at its end
export const BarChart = ({ title, data, format = (v) => String(v), onBar }) => {
  const max = Math.max(1, ...data.map((d) => d.value))
  const rowH = 22
  const labelW = 120
  const width = 380
  const plotW = width - labelW - 60
  const height = data.length * rowH + 8
  return (
    <figure className="awChart">
      <figcaption className="awChartTitle">{title}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={`${title}: ${data.map((d) => `${d.label} ${format(d.value)}`).join(", ")}`}>
        <line x1={labelW} y1={2} x2={labelW} y2={height - 4} stroke="#808080" />
        {data.map((d, i) => {
          const y = 4 + i * rowH
          const w = Math.max(d.value ? 3 : 0, (d.value / max) * plotW)
          return (
            <g key={d.label} className={onBar ? "awBarHit" : ""} onClick={() => onBar?.(d)}>
              <title>{`${d.label}: ${format(d.value)}`}</title>
              <rect x={0} y={y - 2} width={width} height={rowH} fill="transparent" />
              <text x={labelW - 6} y={y + 12} textAnchor="end" className="awChartLabel">{d.label.length > 18 ? d.label.slice(0, 17) + "…" : d.label}</text>
              <rect x={labelW + 1} y={y + 2} width={w} height={rowH - 8} fill="#000080" className="awBar" />
              <rect x={labelW + 1} y={y + 2} width={Math.min(w, 2)} height={rowH - 8} fill="#7f7fff" />
              <text x={labelW + w + 5} y={y + 12} className="awChartValue">{format(d.value)}</text>
            </g>
          )
        })}
      </svg>
    </figure>
  )
}

const money = (v) => "$" + Math.round(v).toLocaleString("en-US")

export const InsightsView = () => {
  const { ws, openApp } = useAw()
  const groupable = launcherApps(ws).filter((a) => a.fields.some((f) => ["select", "user", "ref"].includes(f.type)) && recordsOf(ws, a.id).length)
  const [pick, setPick] = useState({ app: "tickets", group: "priority", measure: "" })
  const app = appById(ws, pick.app)
  const groupFields = app ? app.fields.filter((f) => ["select", "user", "ref"].includes(f.type)) : []
  const measures = app ? app.fields.filter((f) => ["number", "money"].includes(f.type)) : []
  const groupKey = groupFields.some((f) => f.key === pick.group) ? pick.group : groupFields[0]?.key
  const measure = measures.some((f) => f.key === pick.measure) ? pick.measure : ""
  const custom = app && groupKey ? groupBy(ws, app.id, groupKey, measure || null) : []
  const measureField = measure && fieldOf(app, measure)

  const openTickets = recordsOf(ws, "tickets").filter((t) => !["Resolved", "Closed"].includes(t.status)).length
  const pipeline = recordsOf(ws, "leads").filter((l) => !["Won", "Lost"].includes(l.stage)).reduce((s, l) => s + (l.value || 0), 0)
  const dueSoon = recordsOf(ws, "actions").filter((a) => a.status !== "Done" && a.due && a.due <= todayIso(7)).length
  const pending = ["timeOff", "expenses", "purchaseRequests"].reduce((s, id) => s + recordsOf(ws, id).filter((r) => r.status === "Pending").length, 0)

  return (
    <div className="awScroll awPad awInsights">
      <div className="awKpis">
        {[
          ["Open tickets", openTickets, "tickets"],
          ["Open pipeline", money(pipeline), "leads"],
          ["Actions due this week", dueSoon, "actions"],
          ["Waiting for approval", pending, "timeOff"],
        ].map(([label, value, to]) => (
          <button type="button" key={label} className="awKpi" onClick={() => openApp(to)}>
            <span className="awKpiValue">{value}</span>
            <span className="awKpiLabel">{label}</span>
          </button>
        ))}
      </div>
      <div className="awCharts">
        <BarChart title="Tickets by status" data={groupBy(ws, "tickets", "status")} onBar={() => openApp("tickets")} />
        <BarChart title="Pipeline value by stage" data={groupBy(ws, "leads", "stage", "value")} format={money} onBar={() => openApp("leads")} />
        <BarChart title="Actions by status" data={groupBy(ws, "actions", "status")} onBar={() => openApp("actions")} />
        <BarChart title="Expenses by category" data={groupBy(ws, "expenses", "category", "amount").filter((d) => d.value)} format={money} onBar={() => openApp("expenses")} />
      </div>
      <fieldset className="awSection">
        <legend>Make a Chart</legend>
        <div className="awFormRow">
          <label>
            Table{" "}
            <select value={pick.app} onChange={(e) => setPick({ app: e.target.value, group: "", measure: "" })} aria-label="Chart table">
              {groupable.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
          <label>
            Group by{" "}
            <select value={groupKey || ""} onChange={(e) => setPick({ ...pick, group: e.target.value })} aria-label="Group by">
              {groupFields.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
          </label>
          <label>
            Measure{" "}
            <select value={measure} onChange={(e) => setPick({ ...pick, measure: e.target.value })} aria-label="Measure">
              <option value="">Count of records</option>
              {measures.map((f) => (
                <option key={f.key} value={f.key}>Total {f.label}</option>
              ))}
            </select>
          </label>
        </div>
        {app && groupKey && (
          <BarChart
            title={`${app.name}: ${measureField ? `total ${measureField.label.toLowerCase()}` : "count"} by ${fieldOf(app, groupKey).label.toLowerCase()}`}
            data={custom}
            format={measureField ? (v) => display(ws, measureField, v) : String}
            onBar={() => openApp(app.id)}
          />
        )}
      </fieldset>
    </div>
  )
}

// ---- Report Builder ----

const blankReport = (ws, appId = "tickets") => ({ app: appId, columns: appById(ws, appId)?.listKeys || [], filters: [], sort: null })

export const ReportBuilderView = () => {
  const { ws, toast, openRecord, mobile } = useAw()
  const apps = launcherApps(ws).filter((a) => !a.noRecords)
  const [def, setDef] = useState(() => blankReport(ws))
  const [name, setName] = useState("")
  const [result, setResult] = useState(null)
  const app = appById(ws, def.app)
  const set = (patch) => setDef((d) => ({ ...d, ...patch }))
  const run = () => {
    const out = runQuery(ws, def)
    if (!out.ok) return toast(out.error)
    setResult({ ...out, title: name.trim() || `${app.name} Report`, at: new Date() })
    playSystemSound("ding")
  }
  const print = () => {
    if (!result) return
    const totals = result.columns.map((c, i) => (i === 0 ? "Total" : result.totals[c.key] ?? ""))
    const ok = printPage({
      title: result.title,
      subtitle: `${ws.company} · ${result.rows.length} record${result.rows.length === 1 ? "" : "s"}`,
      body: tableHtml(result.columns.map((c) => c.label), result.rows.map((r) => r.cells), Object.keys(result.totals).length ? totals : null),
    })
    if (!ok) toast("This browser can't print from here.")
  }
  const exportCsv = () => result && downloadText(`${result.title.replace(/[^\w -]/g, "")}.csv`, toCsv(result.columns.map((c) => c.label), result.rows.map((r) => r.cells)))
  const save = () => {
    const out = change((w) => saveReport(w, name || `${app.name} Report`, def))
    toast(out.ok ? `Saved "${out.report.name}".` : out.error)
  }
  return (
    <div className={`awReport ${mobile ? "is-mobile" : ""}`}>
      <aside className="awReportSide">
        <fieldset>
          <legend>1. Table</legend>
          <select value={def.app} onChange={(e) => { setDef(blankReport(ws, e.target.value)); setResult(null) }} aria-label="Report table">
            {apps.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </fieldset>
        <fieldset>
          <legend>2. Columns</legend>
          <div className="awColumns">
            {app.fields.filter((f) => !["rich", "bom", "refs"].includes(f.type)).map((f) => (
              <span key={f.key} className="awCheck">
                <input
                  type="checkbox"
                  id={`awCol-${f.key}`}
                  checked={def.columns.includes(f.key)}
                  onChange={(e) => set({ columns: e.target.checked ? app.fields.map((x) => x.key).filter((k) => k === f.key || def.columns.includes(k)) : def.columns.filter((k) => k !== f.key) })}
                />
                <label htmlFor={`awCol-${f.key}`}>{f.label}</label>
              </span>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>3. Filters</legend>
          {def.filters.map((flt, i) => {
            const f = fieldOf(app, flt.field)
            const setF = (patch) => set({ filters: def.filters.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
            return (
              <div key={i} className="awFilterRow">
                <select value={flt.field} onChange={(e) => setF({ field: e.target.value, value: "" })} aria-label={`Filter ${i + 1} field`}>
                  {app.fields.filter((x) => !["rich", "bom", "refs"].includes(x.type)).map((x) => (
                    <option key={x.key} value={x.key}>{x.label}</option>
                  ))}
                </select>
                <select value={flt.op} onChange={(e) => setF({ op: e.target.value })} aria-label={`Filter ${i + 1} test`}>
                  {OPERATORS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
                {!flt.op.includes("empty") &&
                  (f?.type === "select" ? (
                    <select value={flt.value} onChange={(e) => setF({ value: e.target.value })} aria-label={`Filter ${i + 1} value`}>
                      <option value="">(pick)</option>
                      {f.options.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <input type={f?.type === "date" ? "date" : f && ["number", "money"].includes(f.type) ? "number" : "text"} value={flt.value} onChange={(e) => setF({ value: e.target.value })} aria-label={`Filter ${i + 1} value`} />
                  ))}
                <button type="button" className="awTiny" aria-label="Remove filter" onClick={() => set({ filters: def.filters.filter((_, j) => j !== i) })}>×</button>
              </div>
            )
          })}
          <button type="button" className="awBtn" onClick={() => set({ filters: [...def.filters, { field: app.fields.find((f) => f.type === "select")?.key || app.fields[0].key, op: "is", value: "" }] })}>
            Add Filter
          </button>
        </fieldset>
        <fieldset>
          <legend>4. Sort</legend>
          <div className="awFilterRow">
            <select value={def.sort?.field || ""} onChange={(e) => set({ sort: e.target.value ? { field: e.target.value, dir: def.sort?.dir || "asc" } : null })} aria-label="Sort by">
              <option value="">(record number)</option>
              {app.fields.filter((f) => !["rich", "bom", "refs", "long"].includes(f.type)).map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
            <select value={def.sort?.dir || "asc"} disabled={!def.sort} onChange={(e) => set({ sort: { ...def.sort, dir: e.target.value } })} aria-label="Sort direction">
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </div>
        </fieldset>
        <label className="awPickRow">
          Title:
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={`${app.name} Report`} maxLength={60} />
        </label>
        <div className="awBtnRow">
          <button type="button" className="awBtn awBtnGo" onClick={run}>Run Report</button>
          <button type="button" className="awBtn" onClick={save}>Save</button>
        </div>
        {ws.reports.length > 0 && (
          <fieldset>
            <legend>Saved Reports</legend>
            {ws.reports.map((r) => (
              <div key={r.id} className="awSavedReport">
                <button type="button" className="awLinkBtn" onClick={() => { setDef(r.def); setName(r.name); setResult(null) }}>{r.name}</button>
                <button type="button" className="awTiny" aria-label={`Delete ${r.name}`} onClick={() => change((w) => deleteReport(w, r.id))}>×</button>
              </div>
            ))}
          </fieldset>
        )}
      </aside>
      <section className="awReportOut">
        {result ? (
          <>
            <div className="awBtnRow">
              <button type="button" className="awBtn" onClick={print}><Icon name="print" /> Print</button>
              <button type="button" className="awBtn" onClick={exportCsv}>Export CSV</button>
            </div>
            <div className="awPaper" data-report={result.app}>
              <h3 className="awPaperTitle">{result.title}</h3>
              <div className="awPaperSub">
                {ws.company} · Run {result.at.toLocaleString()} · {result.rows.length} record{result.rows.length === 1 ? "" : "s"}
              </div>
              <table className="awPaperTable">
                <thead>
                  <tr>
                    {result.columns.map((c) => (
                      <th key={c.key}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.id} onDoubleClick={() => openRecord(result.app, r.id)}>
                      {r.cells.map((c, i) => (
                        <td key={i}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {Object.keys(result.totals).length > 0 && (
                  <tfoot>
                    <tr>
                      {result.columns.map((c, i) => (
                        <td key={c.key}>{result.totals[c.key] ?? (i === 0 ? "Total" : "")}</td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
              {!result.rows.length && <p className="awMuted">No records match these filters.</p>}
            </div>
          </>
        ) : (
          <div className="awEmpty">
            <Icon name="report" size={32} />
            <p>Pick a table, columns and filters, then click Run Report.</p>
          </div>
        )}
      </section>
    </div>
  )
}

// ---- App Creator ----

const newField = () => ({ label: "", type: "text", options: "" })

export const AppCreatorView = () => {
  const { ws, toast, openApp, confirm, newRecord } = useAw()
  const [wizard, setWizard] = useState(null) // { step, name, category, icon, fields }
  const [error, setError] = useState("")
  const mine = ws.customApps
  const start = () => {
    setError("")
    setWizard({ step: 0, name: "", category: CUSTOM_CATEGORY, icon: "star", fields: [{ label: "Name", type: "text", options: "" }, { label: "Status", type: "select", options: "New, In Progress, Done" }] })
  }
  const setF = (i, patch) => setWizard((w) => ({ ...w, fields: w.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) }))
  const move = (i, d) =>
    setWizard((w) => {
      const fields = [...w.fields]
      const j = i + d
      if (j < 0 || j >= fields.length) return w
      ;[fields[i], fields[j]] = [fields[j], fields[i]]
      return { ...w, fields }
    })
  const finish = () => {
    const out = change((w) => createCustomApp(w, { name: wizard.name, category: wizard.category, icon: wizard.icon, fields: wizard.fields }))
    if (!out.ok) {
      setError(out.error)
      playSystemSound("chord")
      return
    }
    setWizard(null)
    unlock("appward-builder")
    playSystemSound("tada")
    toast(`${out.app.name} is ready. Find it in the App Launcher under ${out.app.cat}.`)
    openApp(out.app.id)
  }
  const next = () => {
    setError("")
    if (wizard.step === 0 && wizard.name.trim().length < 2) return setError("Give your app a name (2 to 40 characters).")
    if (wizard.step === 1 && wizard.fields.some((f) => !f.label.trim())) return setError("Every field needs a name.")
    setWizard({ ...wizard, step: wizard.step + 1 })
  }

  const preview = wizard && wizard.step === 2 ? wizard.fields.map((f, i) => ({ key: "p" + i, label: f.label, type: f.type, options: String(f.options).split(",").map((o) => o.trim()).filter(Boolean) })) : []

  return (
    <div className="awScroll awPad">
      <div className="awCreatorHero">
        <Icon name="wand" size={32} />
        <div>
          <h3>App Creator</h3>
          <p>Make your own app in three steps, no programming required. It gets a list, a form, search, links and reports, just like the built-in apps.</p>
        </div>
      </div>
      <div className="awBtnRow">
        <button type="button" className="awBtn awBtnGo" onClick={start}>
          <Icon name="new" /> Create New App...
        </button>
      </div>
      <fieldset className="awSection">
        <legend>Your Apps</legend>
        {mine.length ? (
          <table className="awMiniTable">
            <thead>
              <tr>
                <th>App</th>
                <th>Category</th>
                <th>Fields</th>
                <th>Records</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {mine.map((a) => (
                <tr key={a.id}>
                  <td>
                    <button type="button" className="awLinkBtn" onClick={() => openApp(a.id)}>
                      <Icon name={a.icon} /> {a.name}
                    </button>
                  </td>
                  <td>{a.cat}</td>
                  <td>{a.fields.length}</td>
                  <td>{recordsOf(ws, a.id).length}</td>
                  <td>
                    <button type="button" className="awBtn awBtnSmall" onClick={() => newRecord(a.id)}>New Record</button>{" "}
                    <button
                      type="button"
                      className="awBtn awBtnSmall"
                      onClick={() => confirm({ text: `Delete the ${a.name} app and all ${recordsOf(ws, a.id).length} of its records?`, onYes: () => { change((w) => deleteCustomApp(w, a.id)); toast(`${a.name} deleted.`) } })}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="awMuted">You haven't made any apps yet. Click Create New App to make one.</p>
        )}
      </fieldset>

      {wizard && (
        <Win title={`App Creator Wizard - Step ${wizard.step + 1} of 3`} onClose={() => setWizard(null)}>
          <div className="awCreatorWizard">
            {wizard.step === 0 && (
              <>
                <p>What should your app be called, and where should it live in the App Launcher?</p>
                <label className="awPickRow">
                  App name:
                  <input type="text" value={wizard.name} onChange={(e) => setWizard({ ...wizard, name: e.target.value })} maxLength={40} placeholder="e.g. Equipment Loans" aria-label="App name" />
                </label>
                <label className="awPickRow">
                  Category:
                  <select value={wizard.category} onChange={(e) => setWizard({ ...wizard, category: e.target.value })} aria-label="Category">
                    {[CUSTOM_CATEGORY, ...CATEGORIES].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <div className="awPickRow">
                  Icon:
                  <span className="awIconPick" role="radiogroup" aria-label="Icon">
                    {CREATOR_ICONS.map((ic) => (
                      <button type="button" key={ic} role="radio" aria-checked={wizard.icon === ic} className={wizard.icon === ic ? "is-on" : ""} onClick={() => setWizard({ ...wizard, icon: ic })} title={ic}>
                        <Icon name={ic} />
                      </button>
                    ))}
                  </span>
                </div>
              </>
            )}
            {wizard.step === 1 && (
              <>
                <p>What do you want to keep track of? The first field is each record's title.</p>
                <div className="awFieldDefs">
                  {wizard.fields.map((f, i) => (
                    <div key={i} className="awFieldDef">
                      <input type="text" value={f.label} onChange={(e) => setF(i, { label: e.target.value })} placeholder="Field name" aria-label={`Field ${i + 1} name`} maxLength={40} />
                      <select value={f.type} onChange={(e) => setF(i, { type: e.target.value })} aria-label={`Field ${i + 1} type`}>
                        {FIELD_TYPES.map((t) => (
                          <option key={t.id} value={t.id}>{t.label}</option>
                        ))}
                      </select>
                      {f.type === "select" && <input type="text" value={f.options} onChange={(e) => setF(i, { options: e.target.value })} placeholder="Choices, separated by commas" aria-label={`Field ${i + 1} choices`} />}
                      <span className="awFieldDefBtns">
                        <button type="button" className="awTiny" onClick={() => move(i, -1)} aria-label="Move up" disabled={!i}>▲︎</button>
                        <button type="button" className="awTiny" onClick={() => move(i, 1)} aria-label="Move down" disabled={i === wizard.fields.length - 1}>▼︎</button>
                        <button type="button" className="awTiny" onClick={() => setWizard({ ...wizard, fields: wizard.fields.filter((_, j) => j !== i) })} aria-label="Remove field" disabled={wizard.fields.length < 2}>×</button>
                      </span>
                    </div>
                  ))}
                </div>
                <button type="button" className="awBtn" onClick={() => setWizard({ ...wizard, fields: [...wizard.fields, newField()].slice(0, 20) })}>Add Field</button>
              </>
            )}
            {wizard.step === 2 && (
              <>
                <p>
                  Here's what a <b>{wizard.name}</b> record will look like. Click Finish to build it.
                </p>
                <div className="awPreview">
                  <div className="awPreviewHead">
                    <Icon name={wizard.icon} /> New {wizard.name}
                  </div>
                  {preview.map((f) => (
                    <div key={f.key} className="awField">
                      {f.type !== "check" && <label>{f.label}</label>}
                      <FieldInput field={f.type === "select" && !f.options.length ? { ...f, options: ["(no choices)"] } : f} value={f.type === "check" ? false : ""} onChange={() => {}} />
                    </div>
                  ))}
                </div>
              </>
            )}
            {error && <p className="awError" role="alert">{error}</p>}
            <div className="awWizardBtns">
              <button type="button" disabled={!wizard.step} onClick={() => setWizard({ ...wizard, step: wizard.step - 1 })}>&lt; Back</button>
              {wizard.step < 2 ? <button type="button" onClick={next}>Next &gt;</button> : <button type="button" onClick={finish}>Finish</button>}
              <button type="button" onClick={() => setWizard(null)}>Cancel</button>
            </div>
          </div>
        </Win>
      )}
    </div>
  )
}

// ---- Database Manager ----

export const DatabaseView = () => {
  const { ws, toast, confirm, openApp } = useAw()
  const fileRef = useRef(null)
  const apps = allApps(ws).filter((a) => !a.noRecords)
  const total = apps.reduce((s, a) => s + recordsOf(ws, a.id).length, 0)
  const size = useMemo(() => serialize(ws).length, [ws.rev])
  const importFile = (file) => {
    if (!file) return
    if (file.size > 4 * 1024 * 1024) return toast("That file is too big to be a workspace.")
    file.text().then((text) => {
      const next = load(text)
      if (!next) return toast("That file isn't an Appward 98 workspace.")
      confirm({
        text: `Replace this workspace with the one in ${file.name}? Everything here is replaced.`,
        onYes: () => {
          next.me = ws.me
          if (!next.users.some((u) => u.handle === ws.me)) next.users.unshift(ws.users.find((u) => u.handle === ws.me))
          replaceWorkspace(next)
          toast("Workspace imported.")
        },
      })
    })
  }
  return (
    <div className="awScroll awPad">
      <p>
        <b>{ws.company}</b> · {apps.length} tables · {total} records · {(size / 1024).toFixed(1)} KB stored in this browser
      </p>
      <div className="awBtnRow">
        <button type="button" className="awBtn" onClick={() => downloadText(`${ws.company.replace(/[^\w ]/g, "")} workspace.json`, serialize(ws), "application/json")}>Export Workspace...</button>
        <button type="button" className="awBtn" onClick={() => fileRef.current?.click()}>Import Workspace...</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { importFile(e.target.files[0]); e.target.value = "" }} />
        <button
          type="button"
          className="awBtn"
          onClick={() =>
            confirm({
              text: "Reset this workspace to the sample data? Everything you've added is erased.",
              onYes: () => {
                const me = ws.users.find((u) => u.handle === ws.me)
                const fresh = newWorkspace({ company: ws.company, me: me.name, title: me.title })
                fresh.prefs = { ...fresh.prefs, ...ws.prefs }
                replaceWorkspace(fresh)
                toast("Workspace reset to the sample data.")
              },
            })
          }
        >
          Reset to Sample Data
        </button>
      </div>
      <div className="awTableWrap sunken-panel">
        <table className="awTable interactive">
          <thead>
            <tr>
              <th>Table</th>
              <th>Category</th>
              <th>Fields</th>
              <th>Records</th>
              <th>Last changed</th>
            </tr>
          </thead>
          <tbody>
            {apps.map((a) => {
              const recs = recordsOf(ws, a.id)
              const last = recs.reduce((m, r) => Math.max(m, r._u || 0), 0)
              return (
                <tr key={a.id} onDoubleClick={() => !a.hidden && openApp(a.id)}>
                  <td>
                    <Icon name={a.icon} /> {a.name}
                  </td>
                  <td>{a.cat || "(system)"}</td>
                  <td>{a.fields.length}</td>
                  <td>{recs.length}</td>
                  <td>{last ? new Date(last).toLocaleDateString() : ""}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
