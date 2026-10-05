import { useEffect, useRef } from "react"
import { BUDDY_LIST, keyOf, useAim } from "../applets/aim/AimContext"
import { openMail } from "../applets/mail/mailStatus"
import { openCouples } from "../../utils/couple"
import { launch } from "../../utils/programs"
import { shellAction } from "../../utils/shell"
import { OPEN_TARGET_EVENT, applySeen, fromPush, markReadWhere, notify, onSeen, openTarget, setNotifyAccount, targetFromParams } from "../../utils/notifications"
import { closeShownNotifications, getSeen, putSeen, resubscribeIfNeeded, setPushSession, takeHeld, takePushInbox } from "../../utils/push"
import { setDndFavorites, setDndSession, syncDnd, useDnd } from "../../utils/dnd"

// Connects the Notification Center and push notifications to the desktop (mounted inside
// the 98 Messenger provider, always):
//   - opens what a notification points at (an IM, Mail, a calendar event, a program, game
//     invitations), from the panel, a tapped push notification or a deep link
//     (?open=im&with=NAME, ?open=calendar&cal=ID&event=ID, ?open=program&name=Our%20Pet ...)
//   - tells the server when 98ish goes to the background, so IMs and calls also go out as
//     push notifications then (aim:visibility)
//   - brings in pushes that arrived while 98ish was closed, closes the ones still showing
//     once 98ish is in front, and keeps read state in step with the account's other devices

const CALENDAR_OPEN = "98ish:calendar-open" // applets/calendar/store.js (kept out of the main bundle)
const SIGN_ON_WAIT_MS = 20_000

const importInbox = async () => {
  for (const data of await takePushInbox()) notify(fromPush(data))
}
// pushes Do Not Disturb held back on the server: into the list, quietly
const importHeld = async (token) => {
  const r = await takeHeld(token)
  if (r.ok) for (const data of r.held || []) notify(fromPush(data))
}
export const DND_AWAY = "Do Not Disturb is on. I'll see your message later."

const NotifyBridge = ({ windows, dispatch }) => {
  const aim = useAim()
  const aimRef = useRef(aim)
  aimRef.current = aim
  const windowsRef = useRef(windows)
  windowsRef.current = windows
  const waiting = useRef(null) // an IM to open once signed on

  const online = aim?.status === "online"
  const account = online ? keyOf(aim.me?.screenName) : null

  // ---- whose notifications ----
  useEffect(() => {
    setNotifyAccount(account)
    setPushSession(account ? { token: aimRef.current.token, account, screenName: aimRef.current.me?.screenName } : null)
    if (!account) {
      onSeen(null)
      return
    }
    const token = aimRef.current.token
    onSeen((at) => putSeen(aimRef.current.token, at))
    getSeen(token).then((r) => r.ok && applySeen(r.seenAt))
    resubscribeIfNeeded(token, account)
    importHeld(token)
  }, [account, aim?.token])

  // ---- Do Not Disturb: synced with the account, favorites from the Address Book ----
  useEffect(() => {
    setDndSession(account ? aimRef.current.token : null)
    if (!account) return
    // (the Address Book's store loads on its own, after sign-on: it isn't in the first download)
    let live = true
    let off = null
    import("../../utils/contacts").then(({ getContacts, subscribeContacts }) => {
      if (!live) return
      const favorites = () => setDndFavorites(getContacts().filter((c) => c.favorite && c.screenName).map((c) => keyOf(c.screenName)))
      favorites()
      off = subscribeContacts(favorites)
    })
    return () => {
      live = false
      off?.()
    }
  }, [account, aim?.token])

  // "Set my status to Away while Do Not Disturb is on" (and back when it ends, if it was us)
  const dnd = useDnd()
  const awayByDnd = useRef(false)
  useEffect(() => {
    if (!online) return
    const a = aimRef.current
    const want = dnd.active && dnd.state.away
    if (want && !a.me?.away) {
      awayByDnd.current = true
      a.setAway?.(DND_AWAY)
    } else if (!want && awayByDnd.current) {
      awayByDnd.current = false
      if (a.me?.away === DND_AWAY) a.setAway?.("")
    }
  }, [online, dnd.active, dnd.state.away])

  // ---- background or not (the server pushes IMs and calls while hidden) ----
  useEffect(() => {
    if (!online) return
    const report = () => aimRef.current.emit("aim:visibility", { visible: document.visibilityState === "visible" })
    report()
    document.addEventListener("visibilitychange", report)
    window.addEventListener("pageshow", report)
    return () => {
      document.removeEventListener("visibilitychange", report)
      window.removeEventListener("pageshow", report)
    }
  }, [online, aim?.connected])

  // ---- opening things ----
  const openIm = (name) => {
    const a = aimRef.current
    if (a?.status === "online") {
      a.openIm(name)
      return
    }
    // not signed on yet: a remembered device signs on by itself in a moment; otherwise the
    // Buddy List asks for the password. The IM opens once signed on.
    waiting.current = { name, until: Date.now() + SIGN_ON_WAIT_MS }
    setTimeout(() => {
      if (!waiting.current || aimRef.current?.status === "online") return
      if (!windowsRef.current.some((w) => !w.closed && w.name === BUDDY_LIST)) dispatch({ type: "open_window", payload: launch(BUDDY_LIST) })
    }, 2500)
  }
  useEffect(() => {
    if (!online || !waiting.current) return
    const { name, until } = waiting.current
    waiting.current = null
    if (Date.now() < until + 60_000) aimRef.current.openIm(name)
  }, [online])

  const focusOrOpen = (test, program) => {
    const index = windowsRef.current.findIndex((w) => !w.closed && test(w))
    if (index >= 0) dispatch({ type: "focus_window", payload: { index } })
    else if (program) dispatch({ type: "open_window", payload: launch(program) })
  }

  const handle = (target) => {
    if (!target?.kind) return
    switch (target.kind) {
      case "im":
      case "call":
        return target.with && openIm(target.with)
      case "mail":
        return openMail(windowsRef.current, dispatch)
      case "calendar":
        return window.dispatchEvent(new CustomEvent(CALENDAR_OPEN, { detail: { program: "Calendar", calendarId: target.calendarId, eventId: target.eventId } }))
      case "program":
        return target.name && openCouples(target.name, target.extra || {})
      case "invites":
        return focusOrOpen((w) => w.app === "net-invite", "Network Neighborhood")
      case "notifications":
        return shellAction("notifications")
      default:
    }
  }
  const handleRef = useRef(handle)
  handleRef.current = handle

  useEffect(() => {
    const onOpen = (e) => handleRef.current(e.detail)
    window.addEventListener(OPEN_TARGET_EVENT, onOpen)

    // a deep link (a tapped notification that opened 98ish)
    let linkTimer = null
    try {
      const url = new URL(window.location.href)
      const target = targetFromParams(url.searchParams)
      if (url.searchParams.has("open")) {
        for (const k of ["open", "with", "cal", "event", "name", "challenge"]) url.searchParams.delete(k)
        window.history.replaceState(window.history.state, "", url.toString())
      }
      // after the desktop (and its lazy helpers) have come up
      if (target) linkTimer = setTimeout(() => openTarget(target), 900)
    } catch {
      // no link
    }

    // the service worker: a push arrived, or a notification was tapped
    const sw = navigator.serviceWorker
    const onMessage = (e) => {
      if (e.data?.type === "98ish-push") importInbox()
      if (e.data?.type === "98ish-open") {
        try {
          openTarget(targetFromParams(new URL(e.data.url).searchParams))
        } catch {
          // a bad link
        }
      }
    }
    sw?.addEventListener("message", onMessage)

    // back in front: pushes that came meanwhile go in the list, the shown ones go away
    const onVisible = () => {
      if (document.visibilityState !== "visible") return
      importInbox()
      closeShownNotifications()
      // another device may have turned Do Not Disturb on or off; held pushes come in
      if (aimRef.current?.status === "online") {
        syncDnd()
        importHeld(aimRef.current.token)
      }
    }
    onVisible()
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearTimeout(linkTimer)
      window.removeEventListener(OPEN_TARGET_EVENT, onOpen)
      sw?.removeEventListener("message", onMessage)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])

  // using an IM window (a tap, a click, typing) reads that buddy's IMs; one popping up by
  // itself while you're away doesn't
  useEffect(() => {
    const onUse = (e) => {
      const index = Number(e.target?.closest?.("[data-window-index]")?.dataset.windowIndex)
      const w = windowsRef.current[index]
      if (w && !w.closed && w.app === "aim-im") markReadWhere((n) => n.key === `im:${keyOf(w.buddy)}`)
    }
    document.addEventListener("pointerdown", onUse, true)
    document.addEventListener("keydown", onUse, true)
    return () => {
      document.removeEventListener("pointerdown", onUse, true)
      document.removeEventListener("keydown", onUse, true)
    }
  }, [])

  return null
}

export default NotifyBridge
