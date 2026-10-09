import React, { useEffect, useState } from "react"
import { useAim } from "./AimContext"
import { getPasskey, passkeysSupported } from "../../../utils/passkeys"

const STEPS = ["Connecting...", "Verifying screen name and password...", "Starting services..."]

// a little gold key (passkeys)
export const PasskeyIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="5" cy="8" r="3.5" fill="#ffd700" stroke="#000" />
    <circle cx="4" cy="8" r="1" fill="#000" />
    <path d="M8.5 7h6.5v2h-1.5v2h-1.5v-2h-1v2h-1.5v-2h-1z" fill="#ffd700" stroke="#000" strokeWidth=".8" />
  </svg>
)

// The Sign On window: running man, screen name, password, and "Get a Screen Name"
const SignOn = () => {
  const { status, error, prefs, signOn, openDeleteAccount, passkeyOptions, signOnPasskey } = useAim()
  const [register, setRegister] = useState(false)
  const [screenName, setScreenName] = useState(prefs.lastScreenName)
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [remember, setRemember] = useState(prefs.remember !== false)
  const [localError, setLocalError] = useState(null)
  const [step, setStep] = useState(0)
  const busy = status === "signingOn"
  // "Sign On with a passkey": the server's challenge is fetched ahead (and every 4 minutes),
  // so the tap can open Face ID / Touch ID at once (utils/passkeys.js says why)
  const canPasskey = passkeysSupported()
  const [passkey, setPasskey] = useState(null) // { ok, challengeId, publicKey } | { ok: false }
  const [passkeyRound, setPasskeyRound] = useState(0)
  useEffect(() => {
    if (!canPasskey || register || busy) return
    let live = true
    const load = () => passkeyOptions().then((o) => live && setPasskey(o || null))
    load()
    const timer = setInterval(load, 4 * 60_000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [canPasskey, register, busy, passkeyRound])

  const passkeySignOn = async () => {
    if (busy) return
    setLocalError(null)
    let options = passkey
    setPasskey(null) // each challenge works once
    try {
      if (!options?.ok) options = await passkeyOptions()
      if (!options?.ok) return setLocalError(options?.error || "Passkeys aren't available right now.")
      const credential = await getPasskey(options.publicKey)
      await signOnPasskey(options.challengeId, credential, remember)
    } catch (e) {
      if (!e?.cancelled) setLocalError(e?.message || "The passkey didn't work.")
    } finally {
      setPasskeyRound((n) => n + 1)
    }
  }

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
          {canPasskey && !register && passkey?.ok !== false && (
            <button type="button" className="aimPasskeyButton" onClick={passkeySignOn} data-passkey-signon="">
              <PasskeyIcon />
              Sign On with a passkey
            </button>
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
