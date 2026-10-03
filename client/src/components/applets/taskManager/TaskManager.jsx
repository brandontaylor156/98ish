import React, { useEffect, useMemo, useRef, useState } from "react"
import { programs, windowFor } from "../../../utils/programs"
import {
  APP_PROFILES,
  COMMIT_LIMIT,
  PHYSICAL_TOTAL,
  buildProcessList,
  formatCpuTime,
  formatK,
  stepSim,
} from "./processes"
import { HistoryGraph, Meter } from "./Graphs"
import {
  CheckGlyph,
  ErrorIcon,
  InfoIcon,
  RadioGlyph,
  SubmenuArrow,
  WarningIcon,
} from "./Icons"
import { flashOnBackdrop, useFloating } from "../../../hooks/useFloating"
import "./TaskManager.css"

const TABS = [
  { id: "applications", label: "Applications", key: "A" },
  { id: "processes", label: "Processes", key: "P" },
  { id: "performance", label: "Performance", key: "e" },
]

const SPEEDS = [
  { label: "High", ms: 500 },
  { label: "Normal", ms: 1000 },
  { label: "Low", ms: 4000 },
  { label: "Paused", ms: 0 },
]

const PROC_COLUMNS = [
  { id: "image", label: "Image Name" },
  { id: "pid", label: "PID", width: 46, align: "right" },
  { id: "cpu", label: "CPU", width: 36, align: "right" },
  { id: "cpuTime", label: "CPU Time", width: 66, align: "right" },
  { id: "mem", label: "Mem Usage", width: 80, align: "right" },
]

const TERMINATE_WARNING =
  "WARNING: Terminating a process can cause undesired results including loss of data and system instability. The process will not be given the chance to save its state or data before it is terminated. Are you sure you want to terminate the process?"

const stop = (e) => e.stopPropagation()

// "Tetris" / "tetris.exe" / "winmine" -> a launchable program
const resolveProgram = (text) => {
  const query = text.trim().replace(/^"|"$/g, "").toLowerCase()
  if (!query) return null
  const bare = query.replace(/\.(exe|com)$/, "")
  return (
    programs.find((p) => p.name.toLowerCase() === query) ||
    programs.find((p) => {
      const profile = APP_PROFILES[p.name]
      return profile && profile.image.replace(/\.(exe|com)$/, "") === bare
    }) ||
    programs.find((p) => p.name.toLowerCase().replace(/[^a-z0-9]/g, "") === bare.replace(/[^a-z0-9]/g, ""))
  )
}

// Underlines the accelerator letter, like "&File" in a resource file.
const Accel = ({ text, letter }) => {
  const i = letter ? text.indexOf(letter) : -1
  if (i < 0) return text
  return (
    <>
      {text.slice(0, i)}
      <u>{text[i]}</u>
      {text.slice(i + 1)}
    </>
  )
}

// modal to Task Manager; drags anywhere like any dialog (hooks/useFloating.js)
const Dialog = ({ title, onClose, children, width = 300 }) => {
  const floating = useFloating({ center: true })
  return (
    <div className="tm-modal" onMouseDown={stop} onPointerDown={flashOnBackdrop}>
      <div ref={floating} className="window tm-dialog" style={{ width }} role="dialog" aria-label={title}>
        <div className="title-bar">
          <div className="title-bar-text">{title}</div>
          <div className="title-bar-controls">
            <button aria-label="Close" onClick={onClose}></button>
          </div>
        </div>
        <div className="window-body tm-dialog-body">{children}</div>
      </div>
    </div>
  )
}

const MessageBox = ({ title, icon, text, buttons, width }) => (
  <Dialog title={title} onClose={buttons[buttons.length - 1].onClick} width={width || (buttons.length > 1 ? 340 : 300)}>
    <div className="tm-msg">
      {icon}
      <div className="tm-msg-text">
        {text.split("\n").map((line, i) => (
          <div key={i}>{line || " "}</div>
        ))}
      </div>
    </div>
    <div className="tm-dialog-buttons tm-dialog-buttons-center">
      {buttons.map((b, i) => (
        <button key={b.label} className={i === 0 ? "default" : ""} onClick={b.onClick} autoFocus={i === 0}>
          <Accel text={b.label} letter={b.accel} />
        </button>
      ))}
    </div>
  </Dialog>
)

const NewTaskDialog = ({ onRun, onClose }) => {
  const [text, setText] = useState("")
  const inputRef = useRef(null)
  useEffect(() => {
    if (inputRef.current) inputRef.current.focus({ preventScroll: true })
  }, [])
  return (
    <Dialog title="Create New Task" onClose={onClose} width={340}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) onRun(text)
        }}
      >
        <div className="tm-msg">
          <img src="/assets/executable.png" alt="" className="tm-msg-icon" width="32" height="32" draggable="false" />
          <div className="tm-msg-text">
            Type the name of a program, folder, document, or Internet resource, and Windows will open it for you.
          </div>
        </div>
        <div className="tm-newtask-row">
          <label htmlFor="tm-newtask-input">
            <u>O</u>pen:
          </label>
          <input
            id="tm-newtask-input"
            ref={inputRef}
            type="text"
            list="tm-newtask-programs"
            autoComplete="off"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
          />
          <datalist id="tm-newtask-programs">
            {programs.map((p) => (
              <option key={p.name} value={p.name} />
            ))}
          </datalist>
        </div>
        <div className="tm-dialog-buttons">
          <button type="submit" className="default" onClick={stop} disabled={!text.trim()}>
            OK
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled>
            <u>B</u>rowse...
          </button>
        </div>
      </form>
    </Dialog>
  )
}

// selfIndex: this Task Manager's own position in `windows`
const TaskManager = ({ dispatch, windows, selfIndex }) => {

  const [tab, setTab] = useState("applications")
  const [selectedApp, setSelectedApp] = useState(null)
  const [selectedProc, setSelectedProc] = useState(null)
  const [sort, setSort] = useState({ col: null, dir: 1 })
  const [speed, setSpeed] = useState(1000)
  const [menu, setMenu] = useState(null)
  const [options, setOptions] = useState({ onTop: true, minimizeOnUse: false, hideWhenMinimized: false })
  const [dialog, setDialog] = useState(null)
  const menuRef = useRef(null)

  const procs = useMemo(() => buildProcessList(windows), [windows])
  const procsRef = useRef(procs)
  procsRef.current = procs

  const [sim, setSim] = useState(() => stepSim(null, procs, 0))

  useEffect(() => {
    if (!speed) return
    const id = setInterval(() => {
      setSim((prev) => stepSim(prev, procsRef.current, speed / 1000))
    }, speed)
    return () => clearInterval(id)
  }, [speed])

  // close menus on any outside press (capture so stopPropagation elsewhere can't hide it)
  useEffect(() => {
    if (!menu) return
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(null)
    }
    document.addEventListener("mousedown", onDown, true)
    return () => document.removeEventListener("mousedown", onDown, true)
  }, [menu])

  const apps = useMemo(
    () =>
      (windows || [])
        .map((w, index) => ({ w, index }))
        .filter(({ w }) => !w.closed && w.name !== "Task Manager"),
    [windows]
  )

  // drop selections that no longer exist
  const appSel = apps.some((a) => a.index === selectedApp) ? selectedApp : null
  const procSel = procs.some((p) => p.key === selectedProc) ? selectedProc : null

  const rows = useMemo(() => {
    const list = procs.map((p) => ({
      ...p,
      cpuNow: sim.cpu[p.key] || 0,
      memNow: sim.mem[p.key] !== undefined ? sim.mem[p.key] : p.mem,
      cpuTimeNow: sim.cpuTime[p.key] || 0,
    }))
    if (!sort.col) return list
    const field = { image: "image", pid: "pid", cpu: "cpuNow", cpuTime: "cpuTimeNow", mem: "memNow" }[sort.col]
    return [...list].sort((a, b) => {
      const x = a[field]
      const y = b[field]
      const c = typeof x === "string" ? x.localeCompare(y, "en", { sensitivity: "base" }) : x - y
      return (c || a.pid - b.pid) * sort.dir
    })
  }, [procs, sim, sort])

  const totals = useMemo(
    () =>
      procs.reduce(
        (t, p) => ({ handles: t.handles + p.handles, threads: t.threads + p.threads }),
        { handles: 0, threads: 0 }
      ),
    [procs]
  )

  // ---- actions --------------------------------------------------------------

  const closeSelf = () => {
    if (selfIndex >= 0) dispatch({ type: "close_window", payload: { name: "Task Manager", index: selfIndex } })
  }

  const switchTo = (index) => {
    const w = windows[index]
    if (!w || w.closed) return
    if (options.minimizeOnUse && selfIndex >= 0) {
      dispatch({ type: "toggle_minimize", payload: { name: "Task Manager", index: selfIndex } })
    }
    if (w.minimized) {
      dispatch({ type: "toggle_minimize_tab", payload: { name: w.name, index, minimized: true, active: w.active } })
    } else {
      dispatch({ type: "select_active", payload: { name: w.name, index } })
    }
  }

  const endTask = (index) => {
    const w = windows[index]
    if (!w) return
    const pos = apps.findIndex((a) => a.index === index)
    const next = apps[pos + 1] || apps[pos - 1]
    setSelectedApp(next ? next.index : null)
    dispatch({ type: "close_window", payload: { name: w.name, index } })
  }

  const terminate = (proc) => {
    setDialog(null)
    if (!proc.system) {
      dispatch({ type: "close_window", payload: { name: windows[proc.windowIndex].name, index: proc.windowIndex } })
      return
    }
    // ending the shell takes the whole system down (BlueScreen in Power.jsx)
    if (proc.image === "explorer.exe") {
      window.dispatchEvent(new CustomEvent("98ish:crash", { detail: { process: proc.image } }))
      return
    }
    let text ="The operation could not be completed.\n\nAccess is denied."
    if (proc.pid === 0) text = "The operation could not be completed.\n\nThe parameter is incorrect."
    else if (proc.critical) text = "This is a critical system process. Task Manager cannot end this process."
    setDialog({ type: "error", title: "Unable to Terminate Process", text })
  }

  const askEndProcess = (key) => {
    const proc = procs.find((p) => p.key === key)
    if (proc) setDialog({ type: "confirmEnd", proc })
  }

  const runTask = (text) => {
    const program = resolveProgram(text)
    if (!program) {
      setDialog({
        type: "error",
        title: text.trim(),
        text: `Cannot find the file '${text.trim()}' (or one of its components). Make sure the path and filename are correct and that all required libraries are available.`,
      })
      return
    }
    setDialog(null)
    dispatch({ type: "open_window", payload: windowFor(program) })
  }

  const refreshNow = () => setSim((prev) => stepSim(prev, procsRef.current, 0.5))

  const listKeys = (e, items, current, setCurrent, onEnter, onDelete) => {
    if (!items.length) return
    const pos = items.indexOf(current)
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const next = e.key === "ArrowDown" ? Math.min(items.length - 1, pos + 1) : Math.max(0, pos - 1)
      setCurrent(items[pos < 0 ? 0 : next])
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault()
      setCurrent(items[e.key === "Home" ? 0 : items.length - 1])
    } else if (e.key === "Delete" && current !== null && onDelete) {
      onDelete(current)
    } else if (e.key === "Enter" && current !== null && onEnter) {
      e.stopPropagation()
      onEnter(current)
    }
  }

  // ---- menus ----------------------------------------------------------------

  const toggleOption = (name) => setOptions((o) => ({ ...o, [name]: !o[name] }))

  const menus = [
    {
      id: "file",
      label: "File",
      accel: "F",
      items: [
        { label: "New Task (Run...)", accel: "N", onClick: () => setDialog({ type: "newTask" }) },
        { separator: true },
        { label: "Exit Task Manager", accel: "x", onClick: closeSelf },
      ],
    },
    {
      id: "options",
      label: "Options",
      accel: "O",
      items: [
        { label: "Always On Top", accel: "A", checked: options.onTop, onClick: () => toggleOption("onTop") },
        {
          label: "Minimize On Use",
          accel: "M",
          checked: options.minimizeOnUse,
          onClick: () => toggleOption("minimizeOnUse"),
        },
        {
          label: "Hide When Minimized",
          accel: "H",
          checked: options.hideWhenMinimized,
          onClick: () => toggleOption("hideWhenMinimized"),
        },
      ],
    },
    {
      id: "view",
      label: "View",
      accel: "V",
      items: [
        { label: "Refresh Now", accel: "R", shortcut: "F5", onClick: refreshNow },
        {
          label: "Update Speed",
          accel: "U",
          submenu: SPEEDS.map((s) => ({
            label: s.label,
            accel: s.label[0],
            radio: speed === s.ms,
            onClick: () => setSpeed(s.ms),
          })),
        },
        { separator: true },
        { label: "Select Columns...", accel: "S", disabled: tab !== "processes" },
      ],
    },
    {
      id: "help",
      label: "Help",
      accel: "H",
      items: [
        { label: "Task Manager Help Topics", accel: "H", disabled: true },
        { separator: true },
        { label: "About Task Manager", accel: "A", onClick: () => setDialog({ type: "about" }) },
      ],
    },
  ]

  const renderItems = (items) =>
    items.map((item, i) =>
      item.separator ? (
        <li key={"sep" + i} className="tm-menu-sep" role="separator" />
      ) : (
        <li
          key={item.label}
          role="menuitem"
          aria-disabled={item.disabled ? "true" : undefined}
          className={"tm-menu-item" + (item.disabled ? " tm-disabled" : "") + (item.submenu ? " tm-has-sub" : "")}
          onClick={(e) => {
            e.stopPropagation()
            if (item.disabled || item.submenu) return
            setMenu(null)
            item.onClick && item.onClick()
          }}
        >
          <span className="tm-menu-mark">{item.checked ? <CheckGlyph /> : item.radio ? <RadioGlyph /> : null}</span>
          <span className="tm-menu-label">
            <Accel text={item.label} letter={item.accel} />
          </span>
          <span className="tm-menu-shortcut">{item.shortcut}</span>
          <span className="tm-menu-arrow">{item.submenu ? <SubmenuArrow /> : null}</span>
          {item.submenu && <ul className="tm-menu tm-submenu">{renderItems(item.submenu)}</ul>}
        </li>
      )
    )

  // ---- render ---------------------------------------------------------------

  const appIndexes = apps.map((a) => a.index)
  const procKeys = rows.map((p) => p.key)
  const usage = sim.usage

  const renderApplications = () => (
    <>
      <div
        className="sunken-panel tm-list"
        tabIndex={0}
        onMouseDown={stop}
        onKeyDown={(e) => listKeys(e, appIndexes, appSel, setSelectedApp, switchTo, endTask)}
      >
        <table className="interactive tm-table">
          <colgroup>
            <col />
            <col style={{ width: 92 }} />
          </colgroup>
          <thead>
            <tr>
              <th>Task</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {apps.map(({ w, index }) => (
              <tr
                key={index}
                className={appSel === index ? "highlighted" : ""}
                onMouseDown={() => setSelectedApp(index)}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  switchTo(index)
                }}
              >
                <td className="tm-task-cell">
                  <img src={w.icon_url} alt="" className="tm-task-icon" draggable="false" />
                  <span>{w.name}</span>
                </td>
                <td>Running</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="tm-buttons">
        <button disabled={appSel === null} onClick={() => endTask(appSel)}>
          <u>E</u>nd Task
        </button>
        <button
          disabled={appSel === null}
          onClick={(e) => {
            e.stopPropagation()
            switchTo(appSel)
          }}
        >
          <u>S</u>witch To
        </button>
        <button onClick={() => setDialog({ type: "newTask" })}>
          <u>N</u>ew Task...
        </button>
      </div>
    </>
  )

  const renderProcesses = () => (
    <>
      <div
        className="sunken-panel tm-list"
        tabIndex={0}
        onMouseDown={stop}
        onKeyDown={(e) => listKeys(e, procKeys, procSel, setSelectedProc, null, askEndProcess)}
      >
        <table className="interactive tm-table tm-proc-table">
          <colgroup>
            {PROC_COLUMNS.map((c) => (
              <col key={c.id} style={{ width: c.width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {PROC_COLUMNS.map((c) => (
                <th
                  key={c.id}
                  className={"tm-sortable" + (c.align ? " tm-right" : "")}
                  onClick={() =>
                    setSort((s) => ({
                      col: c.id,
                      dir: s.col === c.id ? -s.dir : c.id === "image" ? 1 : -1,
                    }))
                  }
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr
                key={p.key}
                className={procSel === p.key ? "highlighted" : ""}
                onMouseDown={() => setSelectedProc(p.key)}
              >
                <td>{p.image}</td>
                <td className="tm-right">{p.pid}</td>
                <td className="tm-right">{String(Math.min(99, p.cpuNow)).padStart(2, "0")}</td>
                <td className="tm-right">{formatCpuTime(p.cpuTimeNow)}</td>
                <td className="tm-right">{formatK(p.memNow)} K</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="tm-buttons">
        <button disabled={procSel === null} onClick={() => askEndProcess(procSel)}>
          <u>E</u>nd Process
        </button>
      </div>
    </>
  )

  const renderPerformance = () => (
    <div className="tm-perf">
      <fieldset className="tm-group tm-meter-group">
        <legend>CPU Usage</legend>
        <div className="tm-screen">
          <Meter value={usage} label={`${usage} %`} />
        </div>
      </fieldset>
      <fieldset className="tm-group">
        <legend>CPU Usage History</legend>
        <div className="tm-screen">
          <HistoryGraph data={sim.cpuHistory} max={100} tick={sim.tick} />
        </div>
      </fieldset>
      <fieldset className="tm-group tm-meter-group">
        <legend>MEM Usage</legend>
        <div className="tm-screen">
          <Meter value={(sim.commit / COMMIT_LIMIT) * 100} label={`${sim.commit}K`} />
        </div>
      </fieldset>
      <fieldset className="tm-group">
        <legend>Memory Usage History</legend>
        <div className="tm-screen">
          <HistoryGraph data={sim.memHistory} max={COMMIT_LIMIT} tick={sim.tick} color="#ffff00" />
        </div>
      </fieldset>

      <div className="tm-stats">
        <fieldset className="tm-group">
          <legend>Totals</legend>
          <dl className="tm-dl">
            <dt>Handles</dt>
            <dd>{totals.handles}</dd>
            <dt>Threads</dt>
            <dd>{totals.threads}</dd>
            <dt>Processes</dt>
            <dd>{procs.length}</dd>
          </dl>
        </fieldset>
        <fieldset className="tm-group">
          <legend>Physical Memory (K)</legend>
          <dl className="tm-dl">
            <dt>Total</dt>
            <dd>{PHYSICAL_TOTAL}</dd>
            <dt>Available</dt>
            <dd>{sim.available}</dd>
            <dt>File Cache</dt>
            <dd>{sim.cache}</dd>
          </dl>
        </fieldset>
        <fieldset className="tm-group">
          <legend>Commit Charge (K)</legend>
          <dl className="tm-dl">
            <dt>Total</dt>
            <dd>{sim.commit}</dd>
            <dt>Limit</dt>
            <dd>{COMMIT_LIMIT}</dd>
            <dt>Peak</dt>
            <dd>{sim.peak}</dd>
          </dl>
        </fieldset>
        <fieldset className="tm-group">
          <legend>Kernel Memory (K)</legend>
          <dl className="tm-dl">
            <dt>Total</dt>
            <dd>{sim.paged + sim.nonpaged}</dd>
            <dt>Paged</dt>
            <dd>{sim.paged}</dd>
            <dt>Nonpaged</dt>
            <dd>{sim.nonpaged}</dd>
          </dl>
        </fieldset>
      </div>
    </div>
  )

  const renderDialog = () => {
    if (!dialog) return null
    const close = () => setDialog(null)
    if (dialog.type === "newTask") return <NewTaskDialog onRun={runTask} onClose={close} />
    if (dialog.type === "confirmEnd")
      return (
        <MessageBox
          title="Task Manager Warning"
          icon={<WarningIcon />}
          text={TERMINATE_WARNING}
          buttons={[
            { label: "Yes", accel: "Y", onClick: () => terminate(dialog.proc) },
            { label: "No", accel: "N", onClick: close },
          ]}
        />
      )
    if (dialog.type === "about")
      return (
        <MessageBox
          title="About Task Manager"
          width={350}
          icon={<InfoIcon />}
          text={
            "98ish Task Manager\nVersion 4.0 (Build 1381: Service Pack 6)\n\nThis product is licensed to:\n98ish User\n\nPhysical memory available to Windows: " +
            formatK(PHYSICAL_TOTAL) +
            " KB"
          }
          buttons={[{ label: "OK", onClick: close }]}
        />
      )
    return (
      <MessageBox title={dialog.title} icon={<ErrorIcon />} text={dialog.text} buttons={[{ label: "OK", onClick: close }]} />
    )
  }

  return (
    <div
      className="tm-root"
      onKeyDown={(e) => {
        if (e.key === "F5") {
          e.preventDefault()
          refreshNow()
        }
      }}
    >
      <ul className="tm-menubar" ref={menuRef} role="menubar" onMouseDown={stop}>
        {menus.map((m) => (
          <li
            key={m.id}
            role="menuitem"
            className={"tm-menubar-item" + (menu === m.id ? " tm-open" : "")}
            onMouseDown={() => setMenu(menu === m.id ? null : m.id)}
            onMouseEnter={() => menu && menu !== m.id && setMenu(m.id)}
          >
            <Accel text={m.label} letter={m.accel} />
            {menu === m.id && (
              <ul className="tm-menu" role="menu" onMouseDown={stop}>
                {renderItems(m.items)}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <div className="tm-body">
        <menu role="tablist" className="tm-tabs">
          {TABS.map((t) => (
            <li key={t.id} role="tab" aria-selected={tab === t.id ? "true" : "false"}>
              <a
                href={"#" + t.id}
                onClick={(e) => {
                  e.preventDefault()
                  setTab(t.id)
                }}
              >
                <Accel text={t.label} letter={t.key} />
              </a>
            </li>
          ))}
        </menu>
        <div className="window tm-panel" role="tabpanel">
          {tab === "applications" && renderApplications()}
          {tab === "processes" && renderProcesses()}
          {tab === "performance" && renderPerformance()}
        </div>
      </div>

      <div className="status-bar tm-status">
        <p className="status-bar-field">Processes: {procs.length}</p>
        <p className="status-bar-field">CPU Usage: {usage}%</p>
        <p className="status-bar-field tm-status-mem">
          Mem Usage: {sim.commit}K / {COMMIT_LIMIT}K
        </p>
      </div>

      {renderDialog()}
    </div>
  )
}

export default TaskManager
