import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import { unlock } from "../../../utils/achievements"
import { playSystemSound } from "../../../utils/systemSounds"
import {
  allApps, appById, categoriesOf, getRecord, launcherApps, markAllRead, markOpened, markRead, myNotifications, recordNo, recordTitle, recordsOf,
  search, setPrefs, unreadCount, updateRecord, userName,
} from "./engine.js"
import { change } from "./store.js"
import { Icon, CATEGORY_ICONS } from "./icons.jsx"
import { AwContext, ago, singular, todayIso } from "./ctx.js"
import { PickerDialog, RecordForm, RecordList } from "./Records.jsx"
import { CalendarView, FeedView, ProjectsView } from "./Planning.jsx"
import { ChatView } from "./Chat.jsx"
import { AppCreatorView, DatabaseView, InsightsView, ReportBuilderView } from "./Tools.jsx"
import { AboutDialog, TIPS, TipDialog } from "./Splash.jsx"
import { helpItem } from "../../../utils/help"

// The workspace window: menu bar, toolbar, the App Launcher on the left, open things as
// tabs on the right (each a list, a record, a view), notifications and a status bar.
// On phones the launcher is a drill-down list and whatever's open fills the screen.

const HEADLINE = ["conversations", "actions", "projects", "tickets", "leads", "calendars", "insights", "appCreator"]

const KIND_ICON = { mention: "chat", assign: "check", approval: "check", shoutout: "star", info: "bell" }

export default function Shell({ ws, rev, mobile, user, onTitle, onSignOut, onExit, firstRun }) {
  const [tabs, setTabs] = useState([{ key: "home", kind: "home" }])
  const [active, setActive] = useState("home")
  const history = useRef(["home"])
  const [open, setOpen] = useState(() => new Set(["Productivity"]))
  const [appFilter, setAppFilter] = useState("")
  const [query, setQuery] = useState("")
  const [bell, setBell] = useState(false)
  const [dialog, setDialog] = useState(() => (ws.prefs.tips || firstRun ? { kind: "tip" } : null))
  const [toastText, setToastText] = useState(null)
  const [mobileNav, setMobileNav] = useState(mobile ? { level: "root" } : null) // null = content showing
  const [launcherOn, setLauncherOn] = useState(true)
  const saves = useRef(new Map())
  const counter = useRef(0)
  const searchRef = useRef(null)
  const rootRef = useRef(null)

  const toast = useCallback((text) => {
    setToastText({ text, at: Date.now() })
  }, [])
  useEffect(() => {
    if (!toastText) return
    const t = setTimeout(() => setToastText(null), 3600)
    return () => clearTimeout(t)
  }, [toastText])

  // ---- tabs ----

  const activate = (key) => {
    setActive(key)
    history.current = [...history.current.filter((k) => k !== key), key]
    if (mobile) setMobileNav(null)
    setBell(false)
    // keep keyboard shortcuts working when the clicked thing disappears with its tab
    requestAnimationFrame(() => {
      const root = rootRef.current
      const now = document.activeElement
      if (root && (!root.contains(now) || !now.getClientRects().length)) root.focus({ preventScroll: true })
    })
  }

  const upsert = (tab, merge = false) => {
    setTabs((list) => (list.some((t) => t.key === tab.key) ? list.map((t) => (t.key === tab.key ? (merge ? { ...t, ...tab, nonce: Math.random() } : t) : t)) : [...list, tab]))
    activate(tab.key)
  }

  const openApp = (appId, extra = {}) => {
    const app = appById(ws, appId)
    if (!app) return
    upsert({ key: `app:${appId}`, kind: "app", app: appId, ...extra }, true)
    // the launcher shows where the app lives
    if (app.cat) setOpen((s) => (s.has(app.cat) ? s : new Set([...s, app.cat])))
    const count = change((w) => markOpened(w, appId))
    if (count >= 20) unlock("appward-power")
  }

  const openRecord = (appId, id, extra = {}) => {
    if (appId === "messages") {
      const m = getRecord(ws, "messages", id)
      return m && openApp("conversations", { channel: m.channel, focusMsg: id })
    }
    if (appId === "conversations") return openApp("conversations", { channel: id, focusMsg: extra.msg || null })
    if (!getRecord(ws, appId, id)) return toast("That record doesn't exist any more.")
    upsert({ key: `rec:${appId}:${id}`, kind: "record", app: appId, id })
  }

  const newRecord = (appId, preset = {}) => {
    const app = appById(ws, appId)
    if (!app || app.noRecords) return
    counter.current += 1
    upsert({ key: `new:${appId}:${counter.current}`, kind: "new", app: appId, preset })
  }

  const closeTab = (key) => {
    if (key === "home" && !mobile) return
    saves.current.delete(key)
    history.current = history.current.filter((k) => k !== key)
    setTabs((list) => {
      const next = list.filter((t) => t.key !== key)
      return next.length ? next : [{ key: "home", kind: "home" }]
    })
    const prev = history.current.at(-1) || "home"
    setActive(prev)
    if (mobile) setMobileNav(history.current.length ? null : { level: "root" })
  }

  // a new record's tab becomes that record's tab once it's saved
  const created = (tabKey, appId, id) => {
    const key = `rec:${appId}:${id}`
    saves.current.delete(tabKey)
    history.current = history.current.map((k) => (k === tabKey ? key : k))
    setTabs((list) => list.map((t) => (t.key === tabKey ? { key, kind: "record", app: appId, id } : t)))
    setActive(key)
  }

  const runSearch = (text) => {
    const q = String(text).trim()
    if (!q) return
    upsert({ key: "search", kind: "search", query: q }, true)
  }

  const registerSave = useCallback((key, fn) => {
    saves.current.set(key, fn)
    return () => saves.current.get(key) === fn && saves.current.delete(key)
  }, [])

  const activeTab = tabs.find((t) => t.key === active) || tabs[0]
  const activeApp = activeTab?.app ? appById(ws, activeTab.app) : null

  const tabTitle = (t) => {
    const app = t.app && appById(ws, t.app)
    if (t.kind === "home") return "Home"
    if (t.kind === "search") return `Search: ${t.query}`
    if (t.kind === "notifications") return "Notifications"
    if (t.kind === "new") return `New ${singular(app?.name || "")}`
    if (t.kind === "record") {
      const rec = getRecord(ws, t.app, t.id)
      return rec ? `${recordNo(app, t.id)} ${recordTitle(ws, t.app, rec)}` : recordNo(app, t.id)
    }
    return app?.name || "?"
  }

  useEffect(() => {
    onTitle?.(`Appward 98 - [${tabTitle(activeTab)}]`)
  }, [active, rev])

  // ---- dialogs ----

  const [pick, setPick] = useState(null)
  const [confirmBox, setConfirmBox] = useState(null)
  const pickRecord = (opts) => setPick(opts)
  const confirm = (opts) => setConfirmBox(opts)

  const ctx = useMemo(
    () => ({ ws, rev, mobile, openApp, openRecord, newRecord, closeTab, runSearch, toast, pickRecord, confirm, registerSave }),
    [ws, rev, mobile, tabs]
  )

  const save = () => {
    const fn = saves.current.get(active)
    if (fn) fn()
    else toast("There's nothing to save here. Records save when you click Save on them.")
  }

  const doNew = () => {
    if (activeApp && !activeApp.noRecords && !activeApp.hidden) newRecord(activeApp.id)
    else setDialog({ kind: "new", app: "actions" })
  }

  const doDelete = () => {
    if (activeTab.kind !== "record") return toast("Open a record to delete it.")
    const btn = [...(rootRef.current?.querySelectorAll(`[data-tab="${CSS.escape(active)}"] .awRecBar button`) || [])].find((b) => b.textContent.includes("Delete"))
    btn?.click()
  }

  const startSync = () => {
    setDialog({ kind: "sync", done: false })
    setTimeout(() => setDialog((d) => (d?.kind === "sync" ? { ...d, done: true } : d)), 2200)
  }

  // keyboard shortcuts
  const onKeyDown = (e) => {
    const k = e.key.toLowerCase()
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (k === "s") (e.preventDefault(), save())
      else if (k === "n") (e.preventDefault(), doNew())
      else if (k === "o") (e.preventDefault(), setDialog({ kind: "open", text: "" }))
      else if (k === "f") (e.preventDefault(), searchRef.current?.focus())
      else if (k === "w" && e.shiftKey) (e.preventDefault(), closeTab(active))
      return
    }
    if (e.key === "F5") (e.preventDefault(), startSync())
    else if (e.key === "F1") (e.preventDefault(), setDialog({ kind: "keys" }))
    else if (e.key === "F3") (e.preventDefault(), searchRef.current?.focus())
  }

  const unread = unreadCount(ws)
  const notes = myNotifications(ws)

  const followNotification = (n) => {
    change((w) => markRead(w, n.id))
    setBell(false)
    if (n.target) openRecord(n.target.app, n.target.id, { msg: n.target.msg })
  }

  // ---- menus ----

  const menus = [
    {
      label: "File",
      items: [
        { label: "New Record...\tCtrl+N", onClick: doNew },
        { label: "Open Record...\tCtrl+O", onClick: () => setDialog({ kind: "open", text: "" }) },
        { label: "Save\tCtrl+S", onClick: save },
        "-",
        { label: "Close Tab", onClick: () => closeTab(active), disabled: active === "home" },
        "-",
        { label: "Sign Out", onClick: onSignOut },
        { label: "Exit", onClick: onExit },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Delete Record", onClick: doDelete, disabled: activeTab.kind !== "record" },
        { label: "Find...\tCtrl+F", onClick: () => searchRef.current?.focus() },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Home", onClick: () => activate("home") },
        { label: "Notifications", onClick: () => upsert({ key: "notifications", kind: "notifications" }) },
        ...(!mobile ? [{ label: "App Launcher", checked: launcherOn, onClick: () => setLauncherOn((v) => !v) }] : []),
      ],
    },
    {
      label: "Tools",
      items: [
        { label: "App Creator", onClick: () => openApp("appCreator") },
        { label: "Report Builder", onClick: () => openApp("reportBuilder") },
        { label: "Insights", onClick: () => openApp("insights") },
        { label: "Database Manager", onClick: () => openApp("databaseManager") },
        "-",
        { label: "Sync Now\tF5", onClick: startSync },
      ],
    },
    {
      label: "Help",
      items: [helpItem({ program: "Appward 98" }, { f1: false }), "-",
        { label: "Tip of the Day...", onClick: () => setDialog({ kind: "tip" }) },
        { label: "Keyboard Shortcuts\tF1", onClick: () => setDialog({ kind: "keys" }) },
        "-",
        { label: "About Appward 98", onClick: () => setDialog({ kind: "about" }) },
      ],
    },
  ]

  // ---- the App Launcher ----

  const cats = categoriesOf(ws)
  const apps = launcherApps(ws)
  const filterWords = appFilter.toLowerCase().trim()
  const appsIn = (cat) => apps.filter((a) => a.cat === cat && (!filterWords || a.name.toLowerCase().includes(filterWords)))

  const appItem = (a) => (
    <li key={a.id}>
      <button type="button" className={`awTreeItem ${activeTab.app === a.id && activeTab.kind === "app" ? "is-on" : ""}`} onClick={() => openApp(a.id)} data-app={a.id}>
        <Icon name={a.icon} /> {a.name}
        {mobile && <span className="awTreeCount">{a.noRecords ? "" : recordsOf(ws, a.id).length}</span>}
      </button>
    </li>
  )

  const launcher = (
    <nav className="awLauncher" aria-label="App Launcher">
      <div className="awLauncherHead">App Launcher</div>
      <input type="search" className="awAppFind" placeholder="Find an app..." value={appFilter} onChange={(e) => setAppFilter(e.target.value)} aria-label="Find an app" />
      <ul className="awTree" role="tree">
        <li>
          <button type="button" className={`awTreeItem ${active === "home" ? "is-on" : ""}`} onClick={() => activate("home")}>
            <Icon name="home" /> Home
          </button>
        </li>
        <li>
          <button type="button" className={`awTreeItem ${active === "notifications" ? "is-on" : ""}`} onClick={() => upsert({ key: "notifications", kind: "notifications" })}>
            <Icon name="bell" /> Notifications {unread > 0 && <span className="awBadge">{unread}</span>}
          </button>
        </li>
        {cats.map((cat) => {
          const list = appsIn(cat)
          if (!list.length) return null
          const expanded = !!filterWords || open.has(cat)
          return (
            <li key={cat} role="treeitem" aria-expanded={expanded}>
              <button
                type="button"
                className="awTreeCat"
                onClick={() => setOpen((s) => {
                  const n = new Set(s)
                  n.has(cat) ? n.delete(cat) : n.add(cat)
                  return n
                })}
                data-cat={cat}
              >
                <span className="awTreeToggle">{expanded ? "−" : "+"}</span>
                <Icon name={expanded ? "folderOpen" : "folder"} /> {cat}
              </button>
              {expanded && (
                <ul className="awTreeApps">
                  {list.map(appItem)}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )

  // the phone's drill-down: categories, then a category's apps
  const mobileLauncher = mobileNav && (
    <nav className="awDrill" aria-label="App Launcher">
      {mobileNav.level === "root" ? (
        <>
          <div className="awDrillHead">{ws.company}</div>
          <ul className="awDrillList">
            <li><button type="button" onClick={() => activate("home")}><Icon name="home" size={20} /> Home <span className="awChev">›</span></button></li>
            <li><button type="button" onClick={() => upsert({ key: "notifications", kind: "notifications" })}><Icon name="bell" size={20} /> Notifications {unread > 0 && <span className="awBadge">{unread}</span>} <span className="awChev">›</span></button></li>
            {cats.map((cat) => (
              <li key={cat}>
                <button type="button" onClick={() => setMobileNav({ level: "cat", cat })} data-cat={cat}>
                  <Icon name={CATEGORY_ICONS[cat] || "folder"} size={20} /> {cat} <span className="awMuted">({appsIn(cat).length})</span> <span className="awChev">›</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <button type="button" className="awDrillBack" onClick={() => setMobileNav({ level: "root" })}>‹ All Categories</button>
          <div className="awDrillHead">{mobileNav.cat}</div>
          <ul className="awDrillList">
            {appsIn(mobileNav.cat).map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => openApp(a.id)} data-app={a.id}>
                  <Icon name={a.icon} size={20} /> {a.name} <span className="awTreeCount">{a.noRecords ? "" : recordsOf(ws, a.id).length}</span> <span className="awChev">›</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </nav>
  )

  // ---- contents ----

  const appView = (t) => {
    const app = appById(ws, t.app)
    if (!app) return <div className="awEmpty">This app was deleted.</div>
    switch (app.view) {
      case "chat":
        return <ChatView channel={t.channel} focusMsg={t.focusMsg} key={t.nonce} />
      case "feed":
        return <FeedView app={app} />
      case "calendar":
        return <CalendarView app={app} />
      case "timeline":
        return <ProjectsView app={app} />
      case "insights":
        return <InsightsView />
      case "reportBuilder":
        return <ReportBuilderView />
      case "appCreator":
        return <AppCreatorView />
      case "database":
        return <DatabaseView />
      default:
        return <RecordList app={app} />
    }
  }

  const content = (t) => {
    switch (t.kind) {
      case "home":
        return homeView()
      case "search":
        return searchView(t.query)
      case "notifications":
        return <NotificationList notes={notes} follow={followNotification} />
      case "app":
        return appView(t)
      case "record":
      case "new": {
        const app = appById(ws, t.app)
        if (!app) return <div className="awEmpty">This app was deleted.</div>
        return <RecordForm app={app} id={t.id} preset={t.preset} tabKey={t.key} onCreated={(id) => created(t.key, t.app, id)} onDeleted={() => closeTab(t.key)} />
      }
      default:
        return null
    }
  }

  const tabIcon = (t) => (t.kind === "home" ? "home" : t.kind === "search" ? "search" : t.kind === "notifications" ? "bell" : appById(ws, t.app)?.icon)

  const toolBtn = ({ icon, label, onClick, badge, pressed }) => (
    <button type="button" className={`awTool ${pressed ? "is-on" : ""}`} onClick={onClick} title={label} aria-label={label}>
      <Icon name={icon} size={mobile ? 20 : 20} />
      {!mobile && <span className="awToolLabel">{label}</span>}
      {badge > 0 && <span className="awBadge awToolBadge">{badge}</span>}
    </button>
  )

  return (
    <AwContext.Provider value={ctx}>
      <div className={`awShell ${mobile ? "is-mobile" : ""}`} ref={rootRef} onKeyDown={onKeyDown} tabIndex={-1}>
        <MenuBar menus={menus} />
        <div className="awToolbar">
          {mobile && toolBtn({ icon: "appward", label: "Apps", onClick: () => setMobileNav({ level: "root" }), pressed: !!mobileNav })}
          {toolBtn({ icon: "new", label: "New", onClick: doNew })}
          {!mobile && toolBtn({ icon: "open", label: "Open", onClick: () => setDialog({ kind: "open", text: "" }) })}
          {toolBtn({ icon: "save", label: "Save", onClick: save })}
          {!mobile && <span className="awToolSep" />}
          <form
            className="awSearch"
            role="search"
            onSubmit={(e) => {
              e.preventDefault()
              runSearch(query)
            }}
          >
            <input ref={searchRef} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={mobile ? "Search" : "Search everything..."} aria-label="Search all records" />
            <button type="submit" className="awTool awToolSmall" aria-label="Search" title="Search">
              <Icon name="search" />
            </button>
          </form>
          {!mobile && <span className="awToolSep" />}
          <span className="awBellWrap">
            {toolBtn({ icon: "bell", label: "Notifications", onClick: () => setBell((v) => !v), badge: unread, pressed: bell })}
            {bell && (
              <div className="awBellPop window" role="dialog" aria-label="Notifications">
                <div className="awBellHead">
                  <b>Notifications</b>
                  <button type="button" className="awLinkBtn" onClick={() => change((w) => markAllRead(w))} disabled={!unread}>Mark all read</button>
                </div>
                <ul className="awNoteList">
                  {notes.slice(0, 8).map((n) => (
                    <NoteItem key={n.id} n={n} onClick={() => followNotification(n)} />
                  ))}
                  {!notes.length && <li className="awMuted awPadS">You're all caught up.</li>}
                </ul>
                <button type="button" className="awLinkBtn awPadS" onClick={() => upsert({ key: "notifications", kind: "notifications" })}>Show all notifications</button>
              </div>
            )}
          </span>
          {toolBtn({ icon: "chat", label: "Messages", onClick: () => openApp("conversations") })}
          {toolBtn({ icon: "sync", label: "Sync", onClick: startSync })}
          {!mobile && (
            <>
              <span className="awGrow" />
              <span className="awBrand" aria-hidden="true">
                <Icon name="appward" size={20} /> Appward<sup>98</sup>
              </span>
            </>
          )}
        </div>

        <div className="awMain">
          {!mobile && launcherOn && launcher}
          {mobile && mobileLauncher}
          <section className="awWork" hidden={mobile && !!mobileNav}>
            {!mobile ? (
              <div className="awTabs" role="tablist">
                {tabs.map((t) => (
                  <div key={t.key} className={`awTab ${t.key === active ? "is-on" : ""}`} role="tab" aria-selected={t.key === active} data-tabkey={t.key}>
                    <button type="button" className="awTabBtn" onClick={() => activate(t.key)} title={tabTitle(t)}>
                      <Icon name={tabIcon(t)} /> <span className="awTabText">{tabTitle(t)}</span>
                    </button>
                    {t.key !== "home" && (
                      <button type="button" className="awTabX" aria-label={`Close ${tabTitle(t)}`} onClick={() => closeTab(t.key)}>
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="awPhoneHead">
                <button type="button" className="awBtn" onClick={() => (history.current.length > 1 && activeTab.kind !== "app" ? closeTab(active) : setMobileNav({ level: activeApp?.cat ? "cat" : "root", cat: activeApp?.cat }))} aria-label="Back">
                  ‹ Back
                </button>
                <span className="awPhoneTitle">
                  <Icon name={tabIcon(activeTab)} /> {tabTitle(activeTab)}
                </span>
                {activeTab.key !== "home" && (
                  <button type="button" className="awBtn" onClick={() => closeTab(activeTab.key)} aria-label="Close">×</button>
                )}
              </div>
            )}
            {tabs.map((t) => (
              <div key={t.key} className="awPane" hidden={t.key !== active} data-tab={t.key} role="tabpanel">
                {content(t)}
              </div>
            ))}
          </section>
        </div>

        <div className="status-bar awStatus">
          <p className="status-bar-field awStatusMain">
            <span className="awLed" aria-hidden="true" /> Connected to workspace — {ws.company}
          </p>
          {!mobile && <p className="status-bar-field">{userName(ws, ws.me)}</p>}
          {!mobile && <p className="status-bar-field">{allApps(ws).reduce((s, a) => s + recordsOf(ws, a.id).length, 0)} records</p>}
        </div>

        {toastText && (
          <div className="awToast" role="status" key={toastText.at}>
            <Icon name="appward" /> {toastText.text}
          </div>
        )}

        {pick && <PickerDialog {...pick} onPick={(ref) => { setPick(null); pick.onPick(ref) }} onCancel={() => setPick(null)} />}
        {confirmBox && (
          <Dialog title="Appward 98" okLabel="Yes" cancelLabel="No" sound="chord" onOk={() => { setConfirmBox(null); confirmBox.onYes() }} onCancel={() => setConfirmBox(null)}>
            <div className="awConfirm">
              <Icon name="warning" size={32} />
              <p>{confirmBox.text}</p>
            </div>
          </Dialog>
        )}
        {dialog?.kind === "tip" && (
          <TipDialog
            index={ws.prefs.tipIndex || 0}
            show={ws.prefs.tips !== false}
            onShow={(v) => change((w) => setPrefs(w, { tips: v }))}
            onNext={() => change((w) => setPrefs(w, { tipIndex: ((w.prefs.tipIndex || 0) + 1) % TIPS.length }))}
            onClose={() => {
              change((w) => setPrefs(w, { tipIndex: ((w.prefs.tipIndex || 0) + 1) % TIPS.length }))
              setDialog(null)
            }}
          />
        )}
        {dialog?.kind === "about" && <AboutDialog onClose={() => setDialog(null)} />}
        {dialog?.kind === "keys" && (
          <Dialog title="Keyboard Shortcuts" onOk={() => setDialog(null)} onCancel={() => setDialog(null)}>
            <table className="awMiniTable awKeys">
              <tbody>
                {[
                  ["Ctrl+N", "New record"],
                  ["Ctrl+O", "Open a record by number"],
                  ["Ctrl+S", "Save the record you're on"],
                  ["Ctrl+F or F3", "Search everything"],
                  ["Ctrl+Shift+W", "Close the tab"],
                  ["F5", "Sync your workspace"],
                  ["F1", "This list"],
                  ["Enter", "Open the selected record in a list"],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td><kbd>{k}</kbd></td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Dialog>
        )}
        {dialog?.kind === "sync" && (
          <Dialog title="Synchronizing" okLabel="OK" okDisabled={!dialog.done} onOk={() => setDialog(null)} onCancel={dialog.done ? () => setDialog(null) : undefined}>
            <div className="awSync">
              <div className="awSyncArt" aria-hidden="true">
                <span className="awSyncPc" />
                <span className={`awSyncDocs ${dialog.done ? "is-done" : ""}`}>
                  <i /><i /><i />
                </span>
                <span className="awSyncServer" />
              </div>
              <p>{dialog.done ? `Your workspace is up to date. ${allApps(ws).reduce((s, a) => s + recordsOf(ws, a.id).length, 0)} records checked.` : "Synchronizing your workspace with the server..."}</p>
              <div className="awProgress" aria-hidden="true">
                <span className={`awProgressFill ${dialog.done ? "is-done" : "is-run"}`} />
              </div>
            </div>
          </Dialog>
        )}
        {dialog?.kind === "open" && (
          <Dialog
            title="Open Record"
            okLabel="Open"
            onCancel={() => setDialog(null)}
            onOk={() => {
              const m = dialog.text.trim().toUpperCase().match(/^([A-Z]+)-?(\d+)$/)
              const app = m && launcherApps(ws).find((a) => a.prefix === m[1])
              if (app && getRecord(ws, app.id, m[2])) {
                setDialog(null)
                openRecord(app.id, m[2])
              } else setDialog({ ...dialog, error: "No record has that number. Try something like TK-101." })
            }}
          >
            <label className="awPickRow">
              Record number:
              <input type="text" value={dialog.text} onChange={(e) => setDialog({ ...dialog, text: e.target.value, error: "" })} placeholder="e.g. TK-101" />
            </label>
            {dialog.error && <p className="awError">{dialog.error}</p>}
          </Dialog>
        )}
        {dialog?.kind === "new" && (
          <Dialog
            title="New Record"
            okLabel="Create"
            onCancel={() => setDialog(null)}
            onOk={() => {
              setDialog(null)
              newRecord(dialog.app)
            }}
          >
            <label className="awPickRow">
              Make a new:
              <select value={dialog.app} onChange={(e) => setDialog({ ...dialog, app: e.target.value })}>
                {launcherApps(ws).filter((a) => !a.noRecords).map((a) => (
                  <option key={a.id} value={a.id}>{singular(a.name)}</option>
                ))}
              </select>
            </label>
          </Dialog>
        )}
      </div>
    </AwContext.Provider>
  )

  // ---- the views that live here ----

  function homeView() {
    const me = ws.users.find((u) => u.handle === ws.me)
    const hour = new Date().getHours()
    const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
    const mine = recordsOf(ws, "actions").filter((a) => a.assignee === ws.me && a.status !== "Done").sort((a, b) => (a.due || "9").localeCompare(b.due || "9"))
    const approvals = ["timeOff", "expenses", "purchaseRequests"].flatMap((id) => recordsOf(ws, id).filter((r) => r.status === "Pending").map((r) => ({ app: id, r })))
    const news = recordsOf(ws, "announcements").sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.posted || "").localeCompare(a.posted || "")).slice(0, 2)
    return (
      <div className="awScroll awHome">
        <div className="awHello">
          <div>
            <h2>
              {greet}, {me?.name.split(" ")[0]}!
            </h2>
            <p>
              {ws.company} · {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </p>
          </div>
          <span className="awHelloTag">Your business is special.</span>
        </div>
        <div className="awQuick">
          {HEADLINE.map((id) => {
            const a = appById(ws, id)
            return (
              <button type="button" key={id} className="awQuickBtn" onClick={() => openApp(id)} data-app={id}>
                <Icon name={a.icon} size={32} />
                <span>{a.name}</span>
              </button>
            )
          })}
        </div>
        <div className="awHomeCols">
          <fieldset className="awSection">
            <legend>My Actions ({mine.length})</legend>
            <ul className="awHomeList">
              {mine.map((a) => (
                <li key={a.id}>
                  <input
                    type="checkbox"
                    id={`awDone-${a.id}`}
                    checked={false}
                    onChange={() => {
                      change((w) => updateRecord(w, "actions", a.id, { status: "Done" }))
                      toast(`Nice work! "${a.action}" is done.`)
                      playSystemSound("ding")
                    }}
                  />
                  <label htmlFor={`awDone-${a.id}`} title="Mark done">
                    <span className="awSrOnly">Mark {a.action} done</span>
                  </label>
                  <button type="button" className="awLinkBtn" onClick={() => openRecord("actions", a.id)}>{a.action}</button>
                  {a.due && <span className={`awDue ${a.due < todayIso() ? "is-late" : ""}`}>{a.due < todayIso() ? "Overdue" : `Due ${+a.due.slice(5, 7)}/${+a.due.slice(8)}`}</span>}
                </li>
              ))}
              {!mine.length && <li className="awMuted">Nothing on your plate. Enjoy it!</li>}
            </ul>
            {approvals.length > 0 && (
              <>
                <div className="awSubhead">Waiting for Approval ({approvals.length})</div>
                <ul className="awHomeList">
                  {approvals.map(({ app, r }) => (
                    <li key={app + r.id}>
                      <Icon name={appById(ws, app).icon} />
                      <button type="button" className="awLinkBtn" onClick={() => openRecord(app, r.id)}>{recordTitle(ws, app, r)}</button>
                      <span className="awMuted">{appById(ws, app).name}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </fieldset>
          <fieldset className="awSection">
            <legend>Latest Notifications</legend>
            <ul className="awNoteList">
              {notes.slice(0, 5).map((n) => (
                <NoteItem key={n.id} n={n} onClick={() => followNotification(n)} />
              ))}
              {!notes.length && <li className="awMuted">You're all caught up.</li>}
            </ul>
            <div className="awSubhead">Announcements</div>
            {news.map((n) => (
              <button type="button" key={n.id} className="awNews" onClick={() => openApp("announcements")}>
                <b>{n.headline}</b>
                <span>{n.body}</span>
              </button>
            ))}
          </fieldset>
        </div>
      </div>
    )
  }

  function searchView(q) {
    const hits = search(ws, q)
    const groups = new Map()
    for (const h of hits) {
      if (!groups.has(h.app)) groups.set(h.app, [])
      groups.get(h.app).push(h)
    }
    return (
      <div className="awScroll awPad">
        <p>
          <b>{hits.length}</b> result{hits.length === 1 ? "" : "s"} for <b>"{q}"</b> in {groups.size} app{groups.size === 1 ? "" : "s"}
        </p>
        {[...groups].map(([appId, list]) => {
          const app = appById(ws, appId)
          return (
            <fieldset key={appId} className="awSection">
              <legend>
                <Icon name={app.icon} /> {app.name} ({list.length})
              </legend>
              <ul className="awResults">
                {list.map((h) => (
                  <li key={h.ref}>
                    <button type="button" className="awResult" onClick={() => openRecord(h.app, h.id)} data-ref={h.ref}>
                      <span className="awChipNo">{h.no}</span> {h.title}
                    </button>
                  </li>
                ))}
              </ul>
            </fieldset>
          )
        })}
        {!hits.length && <div className="awEmpty">Nothing found. Try fewer or shorter words.</div>}
      </div>
    )
  }
}

const NoteItem = ({ n, onClick }) => (
  <li>
    <button type="button" className={`awNote ${n.read ? "" : "is-unread"}`} onClick={onClick} data-note={n.id}>
      <span className="awNoteIcon">
        <Icon name={KIND_ICON[n.kind] || "bell"} />
      </span>
      <span className="awNoteText">
        {n.text}
        <span className="awMuted awNoteTime">{ago(n.time)}</span>
      </span>
    </button>
  </li>
)

const NotificationList = ({ notes, follow }) => (
  <div className="awScroll awPad">
    <p className="awMuted">Click a notification to go straight to the action.</p>
    <ul className="awNoteList awNoteList--full">
      {notes.map((n) => (
        <NoteItem key={n.id} n={n} onClick={() => follow(n)} />
      ))}
      {!notes.length && <li className="awMuted">No notifications yet.</li>}
    </ul>
  </div>
)
