import React, { useEffect, useState } from "react"
import MoreOptions from "../shared/MoreOptions"
import { summarize } from "../../utils/disclosure"
import Dialog from "../shared/Dialog"
import { openCouples } from "../../utils/couple"
import { disablePush, enablePush, getPushConfig, getPushSettings, pushOnHere, pushState, savePushSettings, sendTestPush, usePushSession } from "../../utils/push"
import { BellIcon } from "./NotifyTray"
import { MoonIcon } from "./DndTray"
import { useDnd } from "../../utils/dnd"
import { shellAction } from "../../utils/shell"

// Notification settings (the bell's Settings..., Start > Settings > Notifications):
//   - turning push notifications on for this device: one tap (the browser asks), or on an
//     iPhone in Safari, a little guide to putting 98ish on the Home Screen first (iPhones
//     only deliver notifications to Home Screen apps, iOS 16.4 and later)
//   - what to be told about, and quiet hours (saved on the server, for every device)

const KINDS = [
  ["im", "Instant messages"],
  ["calls", "Calls (incoming and missed)"],
  ["calendar", "Calendar reminders"],
  ["couples", "Us: letters, flowers, Our Pet, quiz turns"],
  ["mail", "98ish Mail"],
  ["games", "Game invitations"],
  ["notes", "Shared notes: a buddy shares or changes one"],
]

// ---- the Add to Home Screen guide (original drawings) ----

const ShareGlyph = ({ size = 22 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    <path d="M8 9H6v12h12V9h-2" fill="none" stroke="#1a6dff" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M12 15V3M8 6.5L12 2.5l4 4" fill="none" stroke="#1a6dff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const AddGlyph = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="none" stroke="#222" strokeWidth="1.6" />
    <path d="M12 8v8M8 12h8" stroke="#222" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

const InstallGuide = () => (
  <div className="installGuide" aria-label="How to add 98ish to your Home Screen">
    <p className="dialogText">iPhones only show notifications for apps on the Home Screen. It takes three taps:</p>
    <ol className="installSteps">
      <li>
        <div className="installPic safariBar" aria-hidden="true">
          <span className="safariUrl">98ish.vercel.app</span>
          <span className="safariButtons">
            <span>‹</span>
            <span>›</span>
            <span className="safariShare">
              <ShareGlyph />
            </span>
            <span>▢</span>
          </span>
        </div>
        Tap the <b>Share</b> button in Safari (the square with an arrow, at the bottom of the screen, or at the top on an iPad).
      </li>
      <li>
        <div className="installPic shareSheet" aria-hidden="true">
          <span className="sheetRow">
            Copy <span className="sheetIcon">⧉</span>
          </span>
          <span className="sheetRow is-picked">
            Add to Home Screen <AddGlyph />
          </span>
          <span className="sheetRow">
            Add Bookmark <span className="sheetIcon">☆</span>
          </span>
        </div>
        Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.
      </li>
      <li>
        <div className="installPic homeScreen" aria-hidden="true">
          <span className="homeApp">
            <img src="/icons/apple-touch-icon.png" alt="" width="40" height="40" />
            98ish
          </span>
        </div>
        Open <b>98ish</b> from your Home Screen, sign on, and come back here to turn notifications on.
      </li>
    </ol>
  </div>
)

// ---- the dialog ----

const NotifySettings = ({ onClose }) => {
  const session = usePushSession()
  const token = session?.token
  const dnd = useDnd()
  const [state, setState] = useState(pushState)
  const [server, setServer] = useState(null) // { enabled }
  const [onHere, setOnHere] = useState(false)
  const [settings, setSettings] = useState(null)
  const [devices, setDevices] = useState([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null) // { text, error }

  useEffect(() => {
    let live = true
    getPushConfig(true).then((c) => live && setServer({ enabled: !!c.enabled }))
    pushOnHere(session?.account).then((on) => live && setOnHere(on))
    if (token) {
      getPushSettings(token).then((r) => {
        if (!live || !r.ok) return
        setSettings(r.settings)
        setDevices(r.devices || [])
      })
    }
    return () => {
      live = false
    }
  }, [token])

  const refreshDevices = () => token && getPushSettings(token).then((r) => r.ok && setDevices(r.devices || []))

  // straight from the tap: the browser's question comes first
  const turnOn = async () => {
    setBusy(true)
    setMessage(null)
    const result = await enablePush(token, session?.account)
    setBusy(false)
    setState(pushState())
    if (!result.ok) return setMessage({ text: result.error, error: true })
    setOnHere(true)
    if (result.settings) setSettings(result.settings)
    refreshDevices()
    setMessage({ text: "Notifications are on for this device. ♪" })
  }
  const turnOff = async () => {
    setBusy(true)
    await disablePush(token)
    setBusy(false)
    setOnHere(false)
    refreshDevices()
    setMessage({ text: "Notifications are off for this device." })
  }
  const test = async () => {
    setBusy(true)
    const r = await sendTestPush(token)
    setBusy(false)
    setMessage(r.ok ? { text: r.sent ? "Sent! It should pop up in a moment (put 98ish in the background to see it)." : "Nothing was sent: no device has notifications on." } : { text: r.error, error: true })
  }

  const change = (patch) => setSettings((s) => ({ ...s, ...patch }))
  const save = async () => {
    if (token && settings) {
      const r = await savePushSettings(token, { categories: settings.categories, quiet: settings.quiet, callsInQuiet: settings.callsInQuiet, tz: Intl.DateTimeFormat().resolvedOptions().timeZone })
      if (!r.ok) return setMessage({ text: r.error || "Couldn't save. Try again.", error: true })
    }
    onClose()
  }

  // what this device can do
  let device
  if (state === "ios-install") device = <InstallGuide />
  else if (!token) {
    device = (
      <>
        <p className="dialogText">Sign on to 98 Messenger to get notifications here: they go to your screen name.</p>
        <button type="button" onClick={() => (openCouples("98 Messenger"), onClose())}>
          Sign On...
        </button>
      </>
    )
  } else if (state === "ios-old") device = <p className="dialogText">Notifications with 98ish closed need iOS 16.4 or later. Update your iPhone in Settings &gt; General &gt; Software Update.</p>
  else if (state === "unsupported") device = <p className="dialogText">This browser can't show notifications while 98ish is closed. You'll still see everything in the Notification Center.</p>
  else if (server && !server.enabled) device = <p className="dialogText">Notifications aren't set up on this 98ish server yet. You'll still see everything in the Notification Center while 98ish is open.</p>
  else if (state === "denied") device = <p className="dialogText">Notifications are blocked for 98ish in this browser. Allow them in the browser's site settings (or Settings &gt; Notifications &gt; 98ish on an iPhone), then come back.</p>
  else if (onHere) {
    device = (
      <>
        <p className="dialogText ncOn">
          <BellIcon /> Notifications are <b>on</b> for this device.
        </p>
        <div className="ncButtons">
          <button type="button" onClick={test} disabled={busy}>
            Send a test
          </button>
          <button type="button" onClick={turnOff} disabled={busy}>
            Turn off
          </button>
        </div>
      </>
    )
  } else {
    device = (
      <>
        <p className="dialogText">Get IMs, calls, reminders and more even when 98ish is closed.</p>
        <button type="button" className="ncEnable" onClick={turnOn} disabled={busy || !server}>
          <BellIcon /> Turn on notifications
        </button>
      </>
    )
  }

  const off = !token || !settings || (server && !server.enabled)
  const kindsOff = KINDS.filter(([id]) => settings?.categories?.[id] === false).map(([, label]) => label)
  return (
    <Dialog title="Notifications" onOk={save} onCancel={onClose}>
      <div className="ncSettings">
        <fieldset>
          <legend>This device</legend>
          {device}
          {message && <p className={message.error ? "dialogText ncMessage is-error" : "dialogText ncMessage"} role="status">{message.text}</p>}
          {devices.length > 0 && (
            <p className="dialogText ncDevices">
              On for: {devices.map((d) => d.device).join(", ")}
            </p>
          )}
        </fieldset>
        <div className="ncDndLink">
          <MoonIcon on={dnd.active} />
          <span>
            Do Not Disturb is <b>{dnd.active ? "on" : "off"}</b>.
          </span>
          <button type="button" onClick={() => (onClose(), shellAction("dnd-settings"))}>
            Do Not Disturb...
          </button>
        </div>
        {/* which kinds and quiet hours: More options (docs/simplicity.md) */}
        <MoreOptions id="notify.settings" className="ncMore" summary={summarize(kindsOff.length ? `Not: ${kindsOff.join(", ")}` : `All ${KINDS.length} kinds`, settings?.quiet?.on ? `Quiet ${settings.quiet.from || "22:00"} to ${settings.quiet.to || "07:00"}` : "No quiet hours")}>
        <fieldset disabled={off}>
          <legend>Notify me about</legend>
          {KINDS.map(([id, label]) => (
            <div className="field-row" key={id}>
              <input id={`nc-${id}`} type="checkbox" checked={settings?.categories?.[id] !== false} onChange={(e) => change({ categories: { ...settings.categories, [id]: e.target.checked } })} />
              <label htmlFor={`nc-${id}`}>{label}</label>
            </div>
          ))}
        </fieldset>
        <fieldset disabled={off}>
          <legend>Quiet hours</legend>
          <div className="field-row ncQuiet">
            <input id="nc-quiet" type="checkbox" checked={!!settings?.quiet?.on} onChange={(e) => change({ quiet: { ...settings.quiet, on: e.target.checked } })} />
            <label htmlFor="nc-quiet">From</label>
            <input type="time" aria-label="Quiet from" value={settings?.quiet?.from || "22:00"} onChange={(e) => e.target.value && change({ quiet: { ...settings.quiet, from: e.target.value } })} />
            <span>to</span>
            <input type="time" aria-label="Quiet until" value={settings?.quiet?.to || "07:00"} onChange={(e) => e.target.value && change({ quiet: { ...settings.quiet, to: e.target.value } })} />
          </div>
          <div className="field-row">
            <input id="nc-calls" type="checkbox" checked={settings?.callsInQuiet !== false} onChange={(e) => change({ callsInQuiet: e.target.checked })} />
            <label htmlFor="nc-calls">Let calls ring through</label>
          </div>
        </fieldset>
        <p className="dialogText ncFootnote">A closed 98ish can't ring like a phone call: an incoming call shows as a notification, and tapping it opens 98ish to answer while it's still ringing.</p>
        </MoreOptions>
      </div>
    </Dialog>
  )
}

export default NotifySettings
