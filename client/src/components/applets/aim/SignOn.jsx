import React, { useEffect, useState } from "react"
import { useAim } from "./AimContext"

const STEPS = ["Connecting...", "Verifying screen name and password...", "Starting services..."]

// The Sign On window: running man, screen name, password, and "Get a Screen Name"
const SignOn = () => {
  const { status, error, prefs, signOn, openDeleteAccount } = useAim()
  const [register, setRegister] = useState(false)
  const [screenName, setScreenName] = useState(prefs.lastScreenName)
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [remember, setRemember] = useState(prefs.remember !== false)
  const [localError, setLocalError] = useState(null)
  const [step, setStep] = useState(0)
  const busy = status === "signingOn"

  // Walk through the classic sign-on steps while the server answers
  useEffect(() => {
    if (!busy) return setStep(0)
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 600)
    return () => clearInterval(timer)
  }, [busy])

  const submit = (event) => {
    event.preventDefault()
    if (busy) return
    if (register && password !== confirm) return setLocalError("The passwords you entered do not match.")
    setLocalError(null)
    signOn(screenName, password, register, remember)
  }

  const shownError = localError || error

  return (
    <form className="aimSignOn" onSubmit={submit}>
      <div className="aimSignOnBanner">
        <img src="/assets/program_icons/aim2.png" alt="" draggable="false" />
        <div>
          <div className="aimSignOnBrand">98 Messenger</div>
          <div className="aimSignOnTagline">Instant Messenger</div>
        </div>
      </div>

      {busy ? (
        <div className="aimSignOnProgress">
          <img src="/assets/program_icons/aim2-48.png" alt="" className="aimRunningMan" draggable="false" />
          <div>{STEPS[step]}</div>
          <div className="aimProgress">
            <div className="aimProgressFill" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
          </div>
        </div>
      ) : (
        <div className="aimSignOnFields">
          {register && <div className="aimSignOnTitle">Get a Screen Name</div>}
          <label className="aimField">
            <span>
              <u>S</u>creen Name
            </span>
            <input
              value={screenName}
              onChange={(e) => setScreenName(e.target.value)}
              maxLength={16}
              autoComplete="username"
              enterKeyHint="next"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck="false"
            />
          </label>
          <button type="button" className="aimLink" onClick={() => (setRegister(!register), setLocalError(null))}>
            {register ? "I already have a screen name" : "Get a Screen Name"}
          </button>
          <label className="aimField">
            <span>
              <u>P</u>assword
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={64}
              autoComplete={register ? "new-password" : "current-password"}
              enterKeyHint={register ? "next" : "go"}
            />
          </label>
          {register && (
            <label className="aimField">
              <span>Confirm Password</span>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} maxLength={64} autoComplete="new-password" enterKeyHint="go" />
            </label>
          )}
          <div className="field-row aimRemember">
            <input id="aim-remember" type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <label htmlFor="aim-remember">Sign me on automatically</label>
          </div>
          {shownError && (
            <div className="aimSignOnError" role="alert">
              {shownError}
              {/^This screen name is being deleted/.test(shownError) && (
                <button type="button" className="aimSignOnFinish" onClick={openDeleteAccount}>
                  Finish deleting...
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="aimSignOnFooter">
        <span className="aimVersion">Version 98ish.0</span>
        <button type="submit" className="aimSignOnButton" disabled={busy || !screenName.trim() || !password}>
          <img src="/assets/program_icons/aim2-48.png" alt="" draggable="false" />
          {register ? "Register" : "Sign On"}
        </button>
      </div>
    </form>
  )
}

export default SignOn
