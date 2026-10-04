import React, { useState } from "react"
import { keyOf, useAim } from "./AimContext"
import { currentUser, listUsers } from "../../../utils/users"
import { forgetAccountOnDevice } from "../../../utils/account"
import { openHelp } from "../../../utils/help"
import "./DeleteAccount.css"

// Delete My Account (98 Messenger > My AIM > Delete My Account..., Control Panel > Passwords
// and Users > User Profiles): what goes, that it's permanent, the screen name and password
// typed again, a Delete Account button that is never the default (Enter does nothing), then
// "Your account was deleted". The server deletes everything (server/account); this device
// then forgets the account (utils/account.js), and erases this 98ish user's files and
// settings here too unless the box is cleared.

export const WHAT_GOES = [
  "Your screen name, profile, Buddy List and block list. Someone else can take the name afterward.",
  "Files synced online from My Documents, My Pictures and the Desktop, and the device sync passwords.",
  "Your 98ish Mail, every folder. Mail you sent stays with the people who got it, with your name taken off.",
  "Your Address Book's online copy.",
  "Your calendar and the Us calendar. In shared calendars: your events, comments and activity (you leave them).",
  "Us: your pairing, love letters, Our Story and its photos, flowers, Our Pet and the Dream House. Your partner is told, without details, that the pairing ended.",
  "Quizzes and puzzles you sent or got, Sunny Acres towns, Tetris Online ranks, your HomePage Studio page and guestbook entries you signed while signed on.",
  "Notification settings, devices and messages waiting for you.",
]

const Warning = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" className="aimDelIcon">
    <path d="M16 2 31 29H1Z" fill="#ffff00" stroke="#000" strokeWidth="1.5" strokeLinejoin="round" />
    <rect x="14.5" y="10" width="3" height="11" fill="#000" />
    <rect x="14.5" y="23" width="3" height="3" fill="#000" />
  </svg>
)

const DeleteAccount = ({ onClose }) => {
  const aim = useAim()
  const online = aim.status === "online"
  const signedOnAs = online ? aim.me?.screenName : null
  const user = currentUser()
  const [phase, setPhase] = useState("form") // form | working | done
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [erase, setErase] = useState(true)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null) // { screenName, erased }
  const others = listUsers().length > 1

  // signed on: the name typed must be this account's; signed off (finishing a deletion that
  // stopped half way): any name, the server checks the password
  const matches = signedOnAs ? keyOf(name) === keyOf(signedOnAs) : keyOf(name).length >= 3
  const ready = matches && password.length >= 4

  const remove = async () => {
    if (!ready || phase !== "form") return
    setPhase("working")
    setError(null)
    const answer = await aim.deleteAccount(name.trim(), password)
    if (!answer?.ok) {
      setPhase("form")
      setPassword("")
      setError(answer?.error || "Your account couldn't be deleted. Please try again.")
      return
    }
    const done = await forgetAccountOnDevice({ key: keyOf(answer.screenName), eraseLocal: erase })
    setResult({ screenName: answer.screenName, erased: done.erased })
    setPhase("done")
  }

  const finish = () => {
    // this device's data is gone: start fresh (a new drive, default settings)
    if (result?.erased) window.location.reload()
    else onClose?.()
  }

  if (phase === "done") {
    return (
      <div className="aimDel" data-delete-account="done">
        <div className="aimDelHead">
          <img src="/assets/program_icons/aim2-48.png" alt="" width="32" height="32" />
          <h2>Your account was deleted</h2>
        </div>
        <p>
          The 98 Messenger account <b>{result.screenName}</b> and everything listed was deleted from the 98ish server. The screen name is free again.
        </p>
        <p>
          {result.erased
            ? `On this device, ${others ? `${user?.name}'s` : "your"} files and settings were erased too. 98ish will restart.`
            : `On this device, ${others ? `${user?.name}'s` : "your"} files and settings are still here, kept only on this device.`}
        </p>
        <p className="aimDelHint">You can use 98ish without an account, or make a new one any time.</p>
        <div className="aimDelButtons">
          <button type="button" onClick={finish} autoFocus>
            OK
          </button>
        </div>
      </div>
    )
  }

  const working = phase === "working"
  return (
    <form className="aimDel" data-delete-account="form" onSubmit={(e) => e.preventDefault()} aria-busy={working}>
      <div className="aimDelHead">
        <Warning />
        <h2>Delete My Account</h2>
      </div>
      <p>
        This permanently deletes the 98 Messenger account {signedOnAs ? <b>{signedOnAs}</b> : "below"} and everything 98ish keeps for it online. <b>It can't be undone.</b>
      </p>
      {!online && <p className="aimDelHint">You're signed off. To delete an account, sign on to it first. (If a deletion stopped part way, you can finish it here.)</p>}
      <fieldset>
        <legend>What will be deleted</legend>
        <ul className="aimDelList">
          {WHAT_GOES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="aimDelHint">
          Copies on other people's devices (IMs they got, cards in their Address Book) are theirs.{" "}
          <button type="button" className="aimDelLink" onClick={() => openHelp("privacy-overview")}>
            What 98ish keeps
          </button>
        </p>
      </fieldset>
      <fieldset>
        <legend>This device</legend>
        <div className="aimDelCheck">
          <input id="aim-del-erase" type="checkbox" checked={erase} onChange={(e) => setErase(e.target.checked)} disabled={working} />
          <label htmlFor="aim-del-erase">
            Also erase {others ? `${user?.name || "this user"}'s` : "my"} files and settings on this device (drive C:, desktop, settings, scores)
          </label>
        </div>
        <p className="aimDelHint">{erase ? "98ish restarts fresh afterward." : "Your files and settings stay here, kept only on this device, as a guest's."}</p>
      </fieldset>
      <div className="aimDelFields">
        <label htmlFor="aim-del-name">Type your screen name to confirm:</label>
        <input id="aim-del-name" type="text" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} maxLength={16} value={name} onChange={(e) => setName(e.target.value)} disabled={working} />
        <label htmlFor="aim-del-password">Password:</label>
        <input id="aim-del-password" type="password" autoComplete="current-password" maxLength={64} value={password} onChange={(e) => setPassword(e.target.value)} disabled={working} />
      </div>
      {error && (
        <p className="aimDelError" role="alert">
          {error}
        </p>
      )}
      {working && (
        <p className="aimDelWorking" role="status">
          <span className="aimDelBar" aria-hidden="true" />
          Deleting your account...
        </p>
      )}
      <div className="aimDelButtons">
        <button type="button" className="aimDelGo" disabled={!ready || working} onClick={remove}>
          Delete Account
        </button>
        <button type="button" onClick={onClose} disabled={working}>
          Cancel
        </button>
      </div>
    </form>
  )
}

export default DeleteAccount
