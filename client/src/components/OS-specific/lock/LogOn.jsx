import React, { useState } from "react"
import Dialog from "../../shared/Dialog"
import SecretField from "./SecretField"
import { UserBadge, useUsers } from "./UserBits"
import { checkSecretFor, hasSecret, touch } from "../../../utils/lock"
import { createUser, currentUser, findUserByName, switchUser, updateUser } from "../../../utils/users"

// "Welcome to Windows": the Log On dialog after Log Off (and after a restart when there
// are several users or a password).
// - One user (the default "Guest" setup): as before, the name typed becomes the user's
//   name; a password is checked only if one was set.
// - Several users: pick one (or type the name) and give their password or PIN. Someone
//   new gets Windows 98's "You have not logged on at this computer before" question and,
//   on Yes, their own desktop, settings and files.
// Logging on as the same person carries on; anyone else reloads the page as them.

const LogOn = ({ onDone }) => {
  const users = useUsers()
  const multi = users.length > 1
  const me = currentUser()
  const [name, setName] = useState(me.name)
  const [secret, setSecret] = useState("")
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState(null) // asking about someone new

  const picked = findUserByName(name)
  const target = multi ? picked : me // whose password the box is for
  const word = target?.lock?.kind === "pin" ? "PIN" : "Password"

  const logOnAs = async (user) => {
    if (hasSecret(user)) {
      setBusy(true)
      const result = await checkSecretFor(user.id, secret)
      setBusy(false)
      if (!result.ok) {
        setSecret("")
        return setError(result.error)
      }
    }
    if (user.id === me.id) {
      touch(true)
      return onDone()
    }
    switchUser(user.id)
  }

  const submit = async () => {
    if (busy) return
    setError(null)
    const typed = name.trim()
    if (!multi) {
      // one user: the name typed is theirs (unless it's taken by... nobody else exists)
      if (hasSecret(me) && !(await check(me))) return
      if (typed && typed !== me.name) {
        try {
          updateUser(me.id, { name: typed })
        } catch (e) {
          return setError(e.message)
        }
      }
      touch(true)
      return onDone()
    }
    if (!typed) return setError("Type a user name, or pick one from the list.")
    if (!picked) return setNewName(typed)
    logOnAs(picked)
  }

  const check = async (user) => {
    setBusy(true)
    const result = await checkSecretFor(user.id, secret)
    setBusy(false)
    if (result.ok) return true
    setSecret("")
    setError(result.error)
    return false
  }

  const cancel = () => {
    // Cancel carries on as the same person, if nothing protects them
    if (!hasSecret(me)) onDone()
    else setError(`Type ${me.name}'s ${me.lock.kind === "pin" ? "PIN" : "password"}, or pick another user.`)
  }

  if (newName) {
    return (
      <div className="powerScreen logOn">
        <Dialog
          title="Windows"
          okLabel="Yes"
          cancelLabel="No"
          onOk={() => {
            try {
              const user = createUser({ name: newName })
              switchUser(user.id)
            } catch (e) {
              setNewName(null)
              setError(e.message)
            }
          }}
          onCancel={() => setNewName(null)}
        >
          <div className="shutDownBody">
            <img src="/assets/log_off.png" alt="" />
            <div>
              <p className="dialogText">You have not logged on at this computer before.</p>
              <p className="dialogText">Would you like 98ish to keep a separate desktop, settings and files for {newName}?</p>
            </div>
          </div>
        </Dialog>
      </div>
    )
  }

  return (
    <div className="powerScreen logOn">
      <Dialog title="Welcome to Windows" okLabel={busy ? "Checking..." : "OK"} okDisabled={busy} onOk={submit} onCancel={cancel}>
        <div className="shutDownBody">
          <img src="/windows_logo.png" alt="" />
          <div className="logOnFields">
            <p className="dialogText">Type a user name and password to log on to Windows.</p>
            {multi && (
              <div className="userTiles logOnUsers" role="listbox" aria-label="Users">
                {users.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    role="option"
                    aria-selected={picked?.id === u.id}
                    className={picked?.id === u.id ? "userTile is-picked" : "userTile"}
                    onClick={() => {
                      setName(u.name)
                      setSecret("")
                      setError(null)
                      // focus the password, ready to type
                      setTimeout(() => document.getElementById("lo-pass")?.focus(), 0)
                    }}
                  >
                    <UserBadge user={u} small />
                  </button>
                ))}
              </div>
            )}
            <label htmlFor="lo-name">User name:</label>
            <input id="lo-name" type="text" autoFocus autoComplete="username" value={name} onChange={(e) => (setName(e.target.value), setError(null))} />
            <label htmlFor="lo-pass">{word}:</label>
            {target?.lock ? (
              <SecretField id="lo-pass" kind={target.lock.kind} value={secret} onChange={(v) => (setSecret(v), setError(null))} disabled={busy} label={word} />
            ) : (
              <input id="lo-pass" type="password" placeholder={multi && !picked ? "" : "(none set)"} autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />
            )}
            {error && (
              <p className="lockError" role="alert">
                {error}
              </p>
            )}
            <div className="logOnNew">
              <span className="logOnHint">{multi ? "Someone new? Type your name, then OK." : "Someone else using 98ish? Type their name:"}</span>
              <button
                type="button"
                onClick={() => {
                  const typed = name.trim()
                  if (!typed || findUserByName(typed)) return setError("Type the new person's name in User name first.")
                  setNewName(typed)
                }}
              >
                New User...
              </button>
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

export default LogOn
