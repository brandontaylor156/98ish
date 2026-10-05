import React, { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { SHELL_EVENT } from "../../utils/shell"
import { appInfo, clearAll, dismiss, markAllRead, openNotification, timeAgo, unreadCount, useNotifications } from "../../utils/notifications"
import { pushState } from "../../utils/push"
import { useDnd } from "../../utils/dnd"
import ContextMenu from "../shared/ContextMenu"
import { MoonIcon, dndMenu, dndUntilText } from "./DndTray"
import { shellAction } from "../../utils/shell"
import "./Notify.css"

// The taskbar's bell: how many notifications are unread, and the Notification Center
// panel above it (grouped by app, newest first; click one to go there). Settings (push
// notifications, what to be told about, quiet hours) load the first time they're opened.

const NotifySettings = React.lazy(() => import("./NotifySettings"))

// the bell, with a little moon on it while Do Not Disturb is on
export const BellIcon = ({ ringing = false, dnd = false }) =>
  dnd ? (
    <span className="bellWrap bellDnd" aria-hidden="true">
      <BellPicture />
      <span className="bellMoon">
        <MoonIcon on size={11} />
      </span>
    </span>
  ) : (
    <BellPicture ringing={ringing} />
  )
const BellPicture = ({ ringing = false }) => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className={ringing ? "bellIcon is-ringing" : "bellIcon"}>
    <path d="M8 1.5c-.6 0-1 .4-1 1v.4C5 3.4 4 5 4 7v3l-1.5 2h11L12 10V7c0-2-1-3.6-3-4.1v-.4c0-.6-.4-1-1-1z" fill="#ffd700" stroke="#000" strokeWidth="1" strokeLinejoin="round" />
    <path d="M5.5 6.5q.3-1.8 2-2.3" fill="none" stroke="#fff" strokeWidth="1" />
    <path d="M6.3 13a1.7 1.7 0 0 0 3.4 0z" fill="#806000" stroke="#000" strokeWidth=".8" />
  </svg>
)

// one row: the app's icon, what happened, when, and an X
const Row = ({ item, onOpen }) => {
  const info = appInfo(item.app)
  return (
    <li className={item.read ? "ncItem" : "ncItem is-unread"} data-key={item.key || ""}>
      <button type="button" className="ncItemMain" onClick={() => onOpen(item)} title={item.text || item.title}>
        <img src={item.icon || info.icon} alt="" width="16" height="16" draggable="false" />
        <span className="ncItemText">
          <span className="ncItemTitle">
            {item.title}
            {item.count > 1 && <span className="ncCount"> ({item.count})</span>}
          </span>
          {item.text && <span className="ncItemBody">{item.text}</span>}
        </span>
        <span className="ncTime">{timeAgo(item.time)}</span>
      </button>
      <button type="button" className="ncDismiss" aria-label={`Dismiss ${item.title}`} title="Dismiss" onClick={() => dismiss(item.id)}>
        ×
      </button>
    </li>
  )
}

const Panel = ({ list, onClose, onSettings }) => {
  const ref = useRef(null)
  const dnd = useDnd()
  const [dndMenuAt, setDndMenuAt] = useState(null)
  // a press anywhere else (but the bell) or Escape closes it
  useEffect(() => {
    const onDown = (e) => {
      if (!ref.current?.contains(e.target) && !e.target.closest?.(".notifyBell, .contextMenu, .ctxMenu, [role=menu]")) onClose()
    }
    const onKey = (e) => e.key === "Escape" && onClose()
    document.addEventListener("pointerdown", onDown, true)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown, true)
      document.removeEventListener("keydown", onKey)
    }
  }, [])

  // grouped by app, the group with the newest item first
  const groups = useMemo(() => {
    const by = new Map()
    for (const item of list) {
      if (!by.has(item.app)) by.set(item.app, [])
      by.get(item.app).push(item)
    }
    return [...by.entries()].map(([app, items]) => ({ app, items, unread: unreadCount(items) }))
  }, [list])

  const state = pushState()
  const open = (item) => {
    openNotification(item)
    onClose()
  }

  return (
    <div className="window notifyPanel" ref={ref} role="dialog" aria-label="Notifications">
      <div className="title-bar">
        <div className="title-bar-text">Notifications</div>
        <div className="title-bar-controls">
          <button type="button" aria-label="Close" onClick={onClose} />
        </div>
      </div>
      <div className="ncToolbar">
        <button type="button" onClick={markAllRead} disabled={!unreadCount(list)}>
          Mark all read
        </button>
        <button type="button" onClick={clearAll} disabled={!list.length}>
          Clear all
        </button>
        <button type="button" className="ncSettingsBtn" onClick={onSettings}>
          Settings...
        </button>
      </div>
      {/* Do Not Disturb: the switch, with how long */}
      <button
        type="button"
        className={`ncDnd${dnd.active ? " is-on" : ""}`}
        aria-pressed={dnd.active}
        aria-haspopup="menu"
        data-dnd={dnd.active ? "on" : "off"}
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect()
          setDndMenuAt({ x: box.left + 8, y: box.bottom })
        }}
      >
        <MoonIcon on={dnd.active} />
        <span>
          Do Not Disturb: <b>{dnd.active ? dndUntilText(dnd).replace(/^On until you turn it off$/, "On") : "Off"}</b>
        </span>
        <span className="ncDndArrow" aria-hidden="true">
          ▾
        </span>
      </button>
      {dndMenuAt && <ContextMenu x={dndMenuAt.x} y={dndMenuAt.y} items={dndMenu(dnd, () => (onClose(), shellAction("dnd-settings")))} onClose={() => setDndMenuAt(null)} />}
      <div className="ncList" role="list">
        {!list.length && (
          <div className="ncEmpty">
            <span className="ncEmptyIcon">
              <BellIcon />
            </span>
            No notifications. IMs, missed calls, invitations, reminders and more show up here.
          </div>
        )}
        {groups.map((g) => (
          <section key={g.app} className="ncGroup" aria-label={appInfo(g.app).name}>
            <h3 className="ncGroupHead">
              <img src={appInfo(g.app).icon} alt="" width="16" height="16" draggable="false" />
              {appInfo(g.app).name}
              {g.unread > 0 && <span className="ncGroupUnread">{g.unread} new</span>}
            </h3>
            <ul>
              {g.items.map((item) => (
                <Row key={item.id} item={item} onOpen={open} />
              ))}
            </ul>
          </section>
        ))}
      </div>
      {(state === "ios-install" || state === "ready") && (
        <button type="button" className="ncHint" onClick={onSettings}>
          {state === "ios-install" ? "Get notifications on this iPhone, even with 98ish closed: see how..." : "Get notifications even when 98ish is closed: turn them on..."}
        </button>
      )}
    </div>
  )
}

const NotifyTray = () => {
  const list = useNotifications()
  const dnd = useDnd()
  const [open, setOpen] = useState(false)
  const [settings, setSettingsOpen] = useState(false)
  const unread = unreadCount(list)

  // Start > Settings > Notifications, deep links and other apps ask for these
  useEffect(() => {
    const onShell = (e) => {
      const action = e.detail?.action
      if (action === "notifications") setOpen(true)
      if (action === "notification-settings") {
        setOpen(false)
        setSettingsOpen(true)
      }
    }
    window.addEventListener(SHELL_EVENT, onShell)
    return () => window.removeEventListener(SHELL_EVENT, onShell)
  }, [])

  return (
    <>
      <button
        type="button"
        className="trayIcon notifyBell"
        title={`${unread ? `${unread} new notification${unread === 1 ? "" : "s"}` : "Notifications"}${dnd.active ? " (Do Not Disturb is on)" : ""}`}
        aria-label={`${unread ? `Notifications, ${unread} new` : "Notifications"}${dnd.active ? ", Do Not Disturb on" : ""}`}
        data-dnd={dnd.active ? "on" : "off"}
        aria-expanded={open}
        data-unread={unread}
        onClick={() => setOpen(!open)}
      >
        <BellIcon ringing={unread > 0 && !dnd.active} dnd={dnd.active} />
        {unread > 0 && <span className="notifyCount">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <Panel
          list={list}
          onClose={() => setOpen(false)}
          onSettings={() => {
            setOpen(false)
            setSettingsOpen(true)
          }}
        />
      )}
      {settings && (
        <div className="shellLayer">
          <Suspense fallback={null}>
            <NotifySettings onClose={() => setSettingsOpen(false)} />
          </Suspense>
        </div>
      )}
    </>
  )
}

export default NotifyTray
