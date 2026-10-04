import React, { useEffect, useRef, useState } from "react"
import SecretField from "./SecretField"
import ForgotPin from "./ForgotPin"
import { UserBadge, useUsers } from "./UserBits"
import { answerAfterUnlock, checkSecretFor, tryUnlock, useLock, waitFor } from "../../../utils/lock"
import { currentUser, currentUserId, hasProfiles, switchUser } from "../../../utils/users"
import "./Lock.css"

// 98ish is locked: an opaque cover (nothing of the desktop is drawn: the desktop stays
// running underneath, hidden, so Messenger stays signed on and unsaved work survives) with
// the "Computer Locked" dialog. While locked, arrivals show only as "New message", and an
// incoming call shows who's calling: Decline works at once, Answer asks for the PIN first
// and answers as soon as it's right (answering opens the call window on the desktop).

const secretWord = (user) => (user?.lock?.kind === "pin" ? "PIN" : "password")

// the time and date at the top, like a phone's lock screen
const LockClock = () => {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="lockClock" aria-hidden="true">
      <div className="lockTime">{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
      <div className="lockDate">{now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</div>
    </div>
  )
}

// seconds left of a wrong-try wait, counting down
const useWait = (id) => {
  const [wait, setWait] = useState(() => waitFor(id))
  useEffect(() => {
    setWait(waitFor(id))
  }, [id])
  useEffect(() => {
    if (!wait) return
    const t = setTimeout(() => setWait(waitFor(id)), 1000)
    return () => clearTimeout(t)
  }, [wait, id])
  return [wait, setWait]
}

const UnlockForm = ({ user, onSwitch, onForgot, answering }) => {
  const [secret, setSecret] = useState("")
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useWait(user.id)
  const field = useRef(null)
  const word = secretWord(user)

  useEffect(() => {
    if (answering) field.current?.focus()
  }, [answering])

  const submit = async (e) => {
    e.preventDefault()
    if (busy || wait || !secret) return
    setBusy(true)
    const result = await tryUnlock(secret)
    setBusy(false)
    if (result.ok) return
    setSecret("")
    setError(result.error)
    setWait(result.wait || 0)
    setTimeout(() => field.current?.focus(), 0)
  }

  return (
    <form className="window lockDialog" onSubmit={submit} aria-labelledby="lock-title">
      <div className="title-bar">
        <div className="title-bar-text" id="lock-title">
          Computer Locked
        </div>
      </div>
      <div className="window-body lockBody">
        <UserBadge user={user} />
        <p className="lockText">
          {answering ? (
            <>Type your {word} to answer the call.</>
          ) : (
            <>
              This computer is in use and has been locked. Only <b>{user.name}</b> can unlock it.
            </>
          )}
        </p>
        <label htmlFor="lock-secret" className="lockLabel">
          {word === "PIN" ? "PIN:" : "Password:"}
        </label>
        <SecretField ref={field} id="lock-secret" kind={user.lock?.kind} value={secret} onChange={(v) => (setSecret(v), setError(null))} disabled={busy || wait > 0} autoFocus label={word} />
        <p className="lockError" role="alert" aria-live="assertive">
          {wait > 0 ? `Too many wrong tries. Try again in ${wait} second${wait === 1 ? "" : "s"}.` : error || " "}
        </p>
        <div className="lockButtons">
          <button type="submit" className="lockOk" disabled={busy || wait > 0 || !secret}>
            {busy ? "Checking..." : "OK"}
          </button>
          {hasProfiles() && (
            <button type="button" onClick={onSwitch}>
              Switch User...
            </button>
          )}
          <button type="button" className="lockForgot" onClick={onForgot}>
            Forgot {word}?
          </button>
        </div>
      </div>
    </form>
  )
}

// Log on as someone else from the lock screen (the page reloads as them)
const SwitchUser = ({ onBack }) => {
  const users = useUsers()
  const others = users.filter((u) => u.id !== currentUserId())
  const [pick, setPick] = useState(null)
  const [secret, setSecret] = useState("")
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useWait(pick?.id)

  const go = async (e) => {
    e?.preventDefault()
    if (!pick || busy || wait) return
    setBusy(true)
    const result = await checkSecretFor(pick.id, secret)
    setBusy(false)
    if (result.ok) return void switchUser(pick.id)
    setSecret("")
    setError(result.error)
    setWait(result.wait || 0)
  }

  return (
    <form className="window lockDialog" onSubmit={go} aria-labelledby="switch-title">
      <div className="title-bar">
        <div className="title-bar-text" id="switch-title">
          Switch User
        </div>
      </div>
      <div className="window-body lockBody">
        <p className="lockText">Pick who's using 98ish. {currentUser().name}'s open programs will close; unsaved changes in them will be lost.</p>
        <div className="userTiles" role="listbox" aria-label="Users">
          {others.map((u) => (
            <button
              key={u.id}
              type="button"
              role="option"
              aria-selected={pick?.id === u.id}
              className={pick?.id === u.id ? "userTile is-picked" : "userTile"}
              onClick={() => (setPick(u), setSecret(""), setError(null))}
            >
              <UserBadge user={u} small />
            </button>
          ))}
        </div>
        {pick?.lock && (
          <>
            <label htmlFor="switch-secret" className="lockLabel">
              {pick.name}'s {secretWord(pick)}:
            </label>
            <SecretField id="switch-secret" kind={pick.lock.kind} value={secret} onChange={(v) => (setSecret(v), setError(null))} disabled={busy || wait > 0} autoFocus label={`${pick.name}'s ${secretWord(pick)}`} />
          </>
        )}
        <p className="lockError" role="alert">
          {wait > 0 ? `Too many wrong tries. Try again in ${wait} seconds.` : error || " "}
        </p>
        <div className="lockButtons">
          <button type="submit" disabled={!pick || busy || wait > 0 || (pick.lock && !secret)}>
            {busy ? "Checking..." : "Log On"}
          </button>
          <button type="button" onClick={onBack}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  )
}

const LockScreen = ({ onReset }) => {
  const { notices, call, pendingAnswer } = useLock()
  const [view, setView] = useState("unlock") // unlock | switch | forgot
  const user = currentUser()

  // (keys go only to the lock screen: utils/lock.js stops them before any app sees them)

  // a key pressed with nothing focused goes to the field
  useEffect(() => {
    if (!document.activeElement || document.activeElement === document.body || !document.activeElement.closest(".lockScreen")) {
      document.querySelector(".lockScreen input")?.focus({ preventScroll: true })
    }
  }, [view])

  return (
    <div className="lockScreen" role="dialog" aria-modal="true" aria-label="98ish is locked" onContextMenu={(e) => e.preventDefault()}>
      <LockClock />
      <div className="lockStack">
        {call && (
          <div className="window lockCall" role="alertdialog" aria-label="Incoming call">
            <div className="title-bar">
              <div className="title-bar-text">Incoming {call.video ? "Video Call" : "Call"}</div>
            </div>
            <div className="window-body">
              <p className="lockText">
                <b>{call.peer}</b> is calling you{call.video ? " (video)" : ""}...
              </p>
              <div className="lockButtons">
                <button
                  type="button"
                  className="callAnswer"
                  onClick={() => {
                    setView("unlock")
                    answerAfterUnlock(call.video)
                  }}
                >
                  {pendingAnswer ? "Unlock to answer" : call.video ? "Answer Video" : "Answer"}
                </button>
                <button type="button" className="callDecline" onClick={() => call.decline()}>
                  Decline
                </button>
              </div>
            </div>
          </div>
        )}
        {view === "unlock" && <UnlockForm user={user} answering={!!pendingAnswer && !!call} onSwitch={() => setView("switch")} onForgot={() => setView("forgot")} />}
        {view === "switch" && <SwitchUser onBack={() => setView("unlock")} />}
        {view === "forgot" && <ForgotPin user={user} onBack={() => setView("unlock")} onReset={onReset} />}
        {notices > 0 && (
          <div className="window lockNotice" role="status">
            <div className="title-bar">
              <div className="title-bar-text">98ish</div>
            </div>
            <div className="window-body">New message{notices > 1 ? ` (${notices})` : ""}</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default LockScreen
