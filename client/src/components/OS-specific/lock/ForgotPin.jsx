import React, { useState } from "react"
import io from "socket.io-client"
import { clearSecret } from "../../../utils/lock"

// "Forgot PIN?" on the lock screen.
// - With a linked 98 Messenger screen name (Passwords Properties > User Profiles): sign in
//   to that account; the server checks the password (aim:verify, rate limited) and the
//   PIN is removed. The local reset isn't offered then, so the account protects the lock.
// - Without one: remove the lock settings on this device after a clear warning. Files,
//   settings and messages stay. (Anyone holding the device could do that, which the
//   warning says.)

const SERVER = import.meta.env.VITE_SOCKET_URL || "http://localhost:8000"

export const verifyMessenger = (screenName, password) =>
  new Promise((resolve) => {
    const socket = io(SERVER, { forceNew: true, reconnection: false, timeout: 10_000 })
    const done = (result) => {
      socket.close()
      resolve(result)
    }
    socket.on("connect_error", () => done({ ok: false, error: "Couldn't reach the 98 Messenger service. Check the connection and try again." }))
    socket.timeout(15_000).emit("aim:verify", { screenName, password }, (timeout, result) =>
      done(timeout ? { ok: false, error: "The 98 Messenger service didn't answer. Try again." } : result || { ok: false, error: "Something went wrong." })
    )
  })

const same = (a, b) => String(a).replace(/\s+/g, "").toLowerCase() === String(b).replace(/\s+/g, "").toLowerCase()

const ForgotPin = ({ user, onBack, onReset }) => {
  const word = user.lock?.kind === "pin" ? "PIN" : "password"
  const linked = user.screenName
  const [screenName] = useState(linked || "")
  const [password, setPassword] = useState("")
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [understood, setUnderstood] = useState(false)

  const reset = () => {
    clearSecret(user.id)
    onReset?.()
  }

  const viaMessenger = async (e) => {
    e.preventDefault()
    if (busy || !password) return
    setBusy(true)
    setError(null)
    const result = await verifyMessenger(screenName, password)
    setBusy(false)
    if (!result?.ok) return setError(result?.error || "Incorrect screen name or password.")
    if (!same(result.screenName, linked)) return setError(`That isn't ${user.name}'s screen name.`)
    reset()
  }

  if (linked) {
    return (
      <form className="window lockDialog" onSubmit={viaMessenger} aria-labelledby="forgot-title">
        <div className="title-bar">
          <div className="title-bar-text" id="forgot-title">
            Forgot {word}
          </div>
        </div>
        <div className="window-body lockBody">
          <p className="lockText">
            Sign in with {user.name}'s 98 Messenger account to remove the {word}. You can set a new one afterwards.
          </p>
          <label htmlFor="forgot-name" className="lockLabel">
            Screen name:
          </label>
          <input id="forgot-name" type="text" value={screenName} readOnly />
          <label htmlFor="forgot-pass" className="lockLabel">
            98 Messenger password:
          </label>
          <input id="forgot-pass" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => (setPassword(e.target.value), setError(null))} disabled={busy} />
          <p className="lockError" role="alert">
            {error || " "}
          </p>
          <div className="lockButtons">
            <button type="submit" disabled={busy || !password}>
              {busy ? "Checking..." : "Sign In"}
            </button>
            <button type="button" onClick={onBack}>
              Cancel
            </button>
          </div>
        </div>
      </form>
    )
  }

  return (
    <form className="window lockDialog" onSubmit={(e) => (e.preventDefault(), understood && reset())} aria-labelledby="forgot-title">
      <div className="title-bar">
        <div className="title-bar-text" id="forgot-title">
          Forgot {word}
        </div>
      </div>
      <div className="window-body lockBody">
        <div className="lockWarn">
          <img src="/assets/shut_down.png" alt="" />
          <p className="lockText">
            {user.name} has no 98 Messenger screen name linked, so the {word} can only be reset by removing the lock settings on this device.
          </p>
        </div>
        <ul className="lockList">
          <li>The {word} is removed and 98ish stops locking for {user.name}.</li>
          <li>Files, pictures, settings and messages all stay.</li>
          <li>Anyone holding this device can do this. To protect the reset, link a screen name in Passwords Properties &gt; User Profiles.</li>
        </ul>
        <div className="field-row">
          <input id="forgot-ok" type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          <label htmlFor="forgot-ok">I understand. Remove the {word}.</label>
        </div>
        <div className="lockButtons">
          <button type="submit" disabled={!understood}>
            Remove {word}
          </button>
          <button type="button" onClick={onBack}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  )
}

export default ForgotPin
