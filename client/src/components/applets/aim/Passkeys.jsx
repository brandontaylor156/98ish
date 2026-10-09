import React, { useEffect, useState } from "react"
import { useAim } from "./AimContext"
import { PasskeyIcon } from "./SignOn"
import { deviceName, makePasskey, passkeysSupported } from "../../../utils/passkeys"
import { openHelp } from "../../../utils/help"
import "./Passkeys.css"

// My AIM > Passkeys... (and Control Panel > Passwords): this account's passkeys, Add a passkey
// (the password again, then a second tap that opens Face ID / Touch ID: iPhones only allow
// it straight from a tap), and Remove. server/aim/passkeys.js keeps them (10 at most).

const when = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "never")

const Passkeys = ({ onClose }) => {
  const aim = useAim()
  const online = aim.status === "online"
  const [list, setList] = useState(null)
  const [available, setAvailable] = useState(true)
  const [phase, setPhase] = useState("list") // list | password | ready | working
  const [password, setPassword] = useState("")
  const [options, setOptions] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [removing, setRemoving] = useState(null)
  const supported = passkeysSupported()

  const refresh = async () => {
    const answer = await aim.request("aim:passkeyList", {})
    if (answer?.ok) {
      setList(answer.passkeys)
      setAvailable(answer.available !== false)
    } else setError(answer?.error || "Couldn't load your passkeys.")
  }
  useEffect(() => {
    if (online) refresh()
  }, [online])

  const start = async (event) => {
    event.preventDefault()
    if (password.length < 4) return
    setError(null)
    setPhase("working")
    const answer = await aim.request("aim:passkeyAddStart", { password })
    setPassword("")
    if (!answer?.ok) {
      setPhase("password")
      return setError(answer?.error || "Something went wrong. Please try again.")
    }
    setOptions(answer)
    setPhase("ready")
  }

  // straight from the tap: Face ID / Touch ID / Windows Hello
  const create = async () => {
    if (!options) return
    const used = options
    setOptions(null)
    setError(null)
    setPhase("working")
    try {
      const credential = await makePasskey(used.publicKey)
      const answer = await aim.request("aim:passkeyAdd", { challengeId: used.challengeId, credential, name: deviceName() })
      if (!answer?.ok) throw new Error(answer?.error || "The passkey couldn't be added.")
      setNotice(`Passkey added. Next time, choose "Sign On with a passkey" on the Sign On screen.`)
      await refresh()
    } catch (e) {
      setError(e?.message || "The passkey couldn't be added.")
    }
    setPhase("list")
  }

  const remove = async (id) => {
    setRemoving(null)
    const answer = await aim.request("aim:passkeyRemove", { id })
    if (!answer?.ok) setError("That passkey couldn't be removed.")
    else setNotice("Passkey removed. It won't sign on any more; you can also delete it from your device's saved passwords.")
    refresh()
  }

  if (!online) {
    return (
      <div className="pkRoot">
        <p>Sign on to 98 Messenger to see and add passkeys.</p>
        <div className="pkButtons">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    )
  }

  const full = (list?.length || 0) >= 10

  return (
    <div className="pkRoot" data-passkeys="">
      <div className="pkHead">
        <PasskeyIcon size={32} />
        <p>
          A passkey signs you on as <b>{aim.me?.screenName}</b> with Face ID, Touch ID or your device's PIN instead of the password. It's saved in your
          device's password manager (iCloud Keychain on an iPhone) and never leaves it; 98ish only keeps a public key.
        </p>
      </div>

      <fieldset className="pkList">
        <legend>Your passkeys</legend>
        {list === null ? (
          <div className="pkEmpty">Loading...</div>
        ) : list.length === 0 ? (
          <div className="pkEmpty">No passkeys yet.</div>
        ) : (
          <ul>
            {list.map((p) => (
              <li key={p.id} data-passkey-row="">
                <div className="pkName">
                  {p.name}
                  {p.backedUp ? <span className="pkSynced"> (synced)</span> : null}
                </div>
                <div className="pkMeta">
                  Added {when(p.createdAt)} · Last used {when(p.lastUsedAt)}
                </div>
                {removing === p.id ? (
                  <div className="pkConfirm">
                    Remove it?{" "}
                    <button type="button" onClick={() => remove(p.id)}>
                      Remove
                    </button>{" "}
                    <button type="button" onClick={() => setRemoving(null)}>
                      Keep
                    </button>
                  </div>
                ) : (
                  <button type="button" className="pkRemove" onClick={() => setRemoving(p.id)}>
                    Remove...
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      {notice && <div className="pkNotice">{notice}</div>}
      {error && (
        <div className="pkError" role="alert">
          {error}
        </div>
      )}

      {!supported || !available ? (
        <p className="pkHint">{!supported ? "This browser can't make passkeys." : "Passkeys work on https://98ish.vercel.app (not on this copy of 98ish)."}</p>
      ) : phase === "password" ? (
        <form className="pkAdd" onSubmit={start}>
          <label>
            Type your password to add a passkey:
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={64} autoComplete="current-password" enterKeyHint="go" autoFocus />
          </label>
          <div className="pkButtons">
            <button type="submit" disabled={password.length < 4}>
              Continue
            </button>
            <button type="button" onClick={() => (setPhase("list"), setError(null))}>
              Cancel
            </button>
          </div>
        </form>
      ) : phase === "ready" ? (
        <div className="pkAdd">
          <p>Press Create Passkey, then confirm with Face ID, Touch ID or your PIN.</p>
          <div className="pkButtons">
            <button type="button" className="pkPrimary" onClick={create} data-passkey-create="">
              Create Passkey
            </button>
            <button type="button" onClick={() => (setPhase("list"), setOptions(null))}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="pkButtons">
          <button type="button" className="pkPrimary" disabled={phase === "working" || full} onClick={() => (setPhase("password"), setNotice(null), setError(null))} data-passkey-add="">
            {phase === "working" ? "Working..." : "Add a passkey..."}
          </button>
          <button type="button" onClick={() => openHelp("passkeys")}>
            Help
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      )}
      {full && phase === "list" && <p className="pkHint">You have 10 passkeys, the most an account can have. Remove one to add another.</p>}
    </div>
  )
}

export default Passkeys
