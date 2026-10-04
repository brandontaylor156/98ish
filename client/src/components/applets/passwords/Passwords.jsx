import React, { useRef, useState } from "react"
import Dialog from "../../shared/Dialog"
import SecretField from "../../OS-specific/lock/SecretField"
import { UserBadge, useUsers } from "../../OS-specific/lock/UserBits"
import { checkSecretFor, clearSecret, hasSecret, lockNow, setSecret } from "../../../utils/lock"
import { checkSecret } from "../../../utils/lockCrypto"
import { USER_PICTURES, createUser, currentUserId, getUser, loadUserPicture, removeUser, updateUser } from "../../../utils/users"
import { getSettings, setSettings, useSettings } from "../../../utils/settings"
import "./Passwords.css"

// Passwords Properties (Start > Settings > Passwords and Users; also Display Properties'
// "Password protected" and Start > Lock Computer when there's nothing to unlock with yet):
//   Change Passwords  set, change or remove your PIN or password (only a hash is kept)
//   Lock              lock after N idle minutes, lock with the screen saver, lock now
//   User Profiles     everyone on this device: add, rename, picture, a linked 98 Messenger
//                     screen name (for "Forgot PIN?"), remove

const TABS = [
  ["change", "Change Passwords"],
  ["lock", "Lock"],
  ["users", "User Profiles"],
]
const WAITS = [0, 1, 2, 5, 10, 15, 30, 60]
const wordFor = (kind) => (kind === "pin" ? "PIN" : "password")

const ChangeTab = ({ reason }) => {
  useUsers() // re-render when the profile changes
  const me = getUser(currentUserId())
  const has = hasSecret(me)
  const [kind, setKind] = useState(me.lock?.kind || "pin")
  const [old, setOld] = useState("")
  const [next, setNext] = useState("")
  const [again, setAgain] = useState("")
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const [busy, setBusy] = useState(false)

  const reset = () => (setOld(""), setNext(""), setAgain(""))

  const confirmOld = async () => {
    if (!has) return true
    const result = await checkSecretFor(me.id, old)
    if (!result.ok) setError(result.error)
    return result.ok
  }

  const save = async () => {
    setError(null)
    setDone(null)
    const problem = checkSecret(kind, next)
    if (problem) return setError(problem)
    if (next !== again) return setError(`The new ${wordFor(kind)}s don't match. Type them again.`)
    setBusy(true)
    try {
      if (!(await confirmOld())) return
      await setSecret(me.id, kind, next)
      reset()
      setDone(`Your ${wordFor(kind)} has been ${has ? "changed" : "set"}. 98ish locks after ${getSettings().lockAfter || "no"} idle minutes${getSettings().lockOnSaver ? ", with the screen saver," : ""} and with Start > Lock Computer.`)
    } catch (e) {
      setError(e.message || "That couldn't be saved.")
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setError(null)
    setDone(null)
    setBusy(true)
    try {
      if (!(await confirmOld())) return
      clearSecret(me.id)
      reset()
      setDone("The password is removed. 98ish won't lock for you any more.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="pwStack"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      {reason === "lock" && !has && <p className="pwNote">To lock 98ish, first set a PIN or password here. Then Start &gt; Lock Computer, Win+L or Ctrl+Alt+L lock it.</p>}
      {reason === "reset" && !has && <p className="pwNote">Your old PIN was removed. Set a new one here.</p>}
      <div className="pwHead">
        <UserBadge user={me} />
        <span className="pwStatus">{has ? `Has a ${wordFor(me.lock.kind)}.` : "No password set."}</span>
      </div>
      <fieldset className="pwField">
        <legend>{has ? "Change" : "Set"} your Windows password</legend>
        <div className="field-row">
          <input id="pw-kind-pin" type="radio" name="pw-kind" checked={kind === "pin"} onChange={() => (setKind("pin"), setNext(""), setAgain(""))} />
          <label htmlFor="pw-kind-pin">PIN (4 to 12 digits)</label>
        </div>
        <div className="field-row">
          <input id="pw-kind-password" type="radio" name="pw-kind" checked={kind === "password"} onChange={() => (setKind("password"), setNext(""), setAgain(""))} />
          <label htmlFor="pw-kind-password">Password</label>
        </div>
        {has && (
          <div className="pwRow">
            <label htmlFor="pw-old">Old {wordFor(me.lock.kind)}:</label>
            <input id="pw-old" type="password" inputMode={me.lock.kind === "pin" ? "numeric" : undefined} autoComplete="current-password" value={old} onChange={(e) => setOld(e.target.value)} disabled={busy} />
          </div>
        )}
        <div className="pwRow">
          <label htmlFor="pw-new">New {wordFor(kind)}:</label>
          <input id="pw-new" type="password" inputMode={kind === "pin" ? "numeric" : undefined} autoComplete="new-password" maxLength={kind === "pin" ? 12 : 128} value={next} onChange={(e) => setNext(kind === "pin" ? e.target.value.replace(/\D/g, "") : e.target.value)} disabled={busy} />
        </div>
        <div className="pwRow">
          <label htmlFor="pw-again">Confirm new {wordFor(kind)}:</label>
          <input id="pw-again" type="password" inputMode={kind === "pin" ? "numeric" : undefined} autoComplete="new-password" maxLength={kind === "pin" ? 12 : 128} value={again} onChange={(e) => setAgain(kind === "pin" ? e.target.value.replace(/\D/g, "") : e.target.value)} disabled={busy} />
        </div>
      </fieldset>
      {error && (
        <p className="pwError" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="pwDone" role="status">
          {done}
        </p>
      )}
      <div className="pwButtons">
        {has && (
          <button type="button" onClick={remove} disabled={busy || !old}>
            Remove
          </button>
        )}
        <button type="submit" disabled={busy || !next || !again || (has && !old)}>
          {busy ? "Saving..." : has ? "Change" : `Set ${wordFor(kind) === "PIN" ? "PIN" : "Password"}`}
        </button>
      </div>
      <p className="pwHint">Only a scrambled (salted, hashed) copy is kept on this device; the PIN itself is never stored. Forgot it? The lock screen can reset it through your linked 98 Messenger account.</p>
    </form>
  )
}

const LockTab = () => {
  const settings = useSettings()
  useUsers()
  const has = hasSecret(getUser(currentUserId()))
  return (
    <div className="pwStack">
      {!has && <p className="pwNote">Set a PIN or password on the Change Passwords tab first: without one, 98ish never locks.</p>}
      <fieldset className="pwField">
        <legend>When to lock</legend>
        <div className="pwRow">
          <label htmlFor="pw-after">Lock after</label>
          <select id="pw-after" value={settings.lockAfter} onChange={(e) => setSettings({ lockAfter: Number(e.target.value) })}>
            {WAITS.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? "Never" : `${m} minute${m === 1 ? "" : "s"}`}
              </option>
            ))}
          </select>
          <span>with no input</span>
        </div>
        <div className="field-row">
          <input id="pw-saver" type="checkbox" checked={!!settings.lockOnSaver} onChange={(e) => setSettings({ lockOnSaver: e.target.checked })} />
          <label htmlFor="pw-saver">Lock when the screen saver starts (Password protected)</label>
        </div>
      </fieldset>
      <p className="pwHint">
        98ish also opens locked when you come back after the wait, even if your phone reloaded the page. Lock right away with Start &gt; Lock Computer, Win+L or Ctrl+Alt+L.
      </p>
      <div className="pwButtons">
        <button type="button" disabled={!has} onClick={() => lockNow()}>
          Lock Computer Now
        </button>
      </div>
    </div>
  )
}

const PicturePicker = ({ value, onPick }) => {
  const fileRef = useRef(null)
  const [error, setError] = useState(null)
  return (
    <div className="pwPictures">
      {USER_PICTURES.map((src) => (
        <button key={src} type="button" className={value === src ? "pwPic is-picked" : "pwPic"} aria-label={`Picture ${src.split("/").pop().replace(".svg", "")}`} onClick={() => onPick(src)}>
          <img src={src} alt="" />
        </button>
      ))}
      <button type="button" onClick={() => fileRef.current?.click()}>
        Browse...
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          try {
            onPick(await loadUserPicture(file))
            setError(null)
          } catch (message) {
            setError(String(message))
          }
        }}
      />
      {error && <p className="pwError">{error}</p>}
    </div>
  )
}

const UsersTab = () => {
  const users = useUsers()
  const meId = currentUserId()
  const me = getUser(meId)
  const [name, setName] = useState(me.name)
  const [picture, setPicture] = useState(me.picture)
  const [screenName, setScreenName] = useState(me.screenName || "")
  const [secret, setSecretText] = useState("")
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState("")
  const [removing, setRemoving] = useState(null) // a user
  const [removeSecret, setRemoveSecret] = useState("")
  const [removeError, setRemoveError] = useState(null)

  const screenChanged = screenName.trim() !== (me.screenName || "")
  const needSecret = screenChanged && hasSecret(me)

  const save = async () => {
    setError(null)
    setDone(null)
    if (needSecret) {
      const result = await checkSecretFor(meId, secret)
      if (!result.ok) return setError(result.error)
    }
    try {
      updateUser(meId, { name, picture, screenName })
      setSecretText("")
      setDone("Saved.")
    } catch (e) {
      setError(e.message)
    }
  }

  const add = () => {
    try {
      const user = createUser({ name: newName })
      setAdding(false)
      setNewName("")
      setDone(`${user.name} has their own desktop now. To use it: Start > Log Off, then pick ${user.name}.`)
    } catch (e) {
      setError(e.message)
    }
  }

  const doRemove = async () => {
    if (hasSecret(removing)) {
      const result = await checkSecretFor(removing.id, removeSecret)
      if (!result.ok) return setRemoveError(result.error)
    }
    try {
      removeUser(removing.id)
      setDone(`${removing.name} was removed from this device.`)
      setRemoving(null)
    } catch (e) {
      setRemoveError(e.message)
    }
  }

  return (
    <div className="pwStack pwUsers">
      <div className="userTiles pwUserList" role="list" aria-label="Users on this computer">
        {users.map((u) => (
          <div key={u.id} className="pwUserRow" role="listitem">
            <UserBadge user={u} small />
            <span className="pwUserTags">
              {u.id === meId ? "(logged on)" : ""}
              {u.lock ? " PIN/password" : ""}
              {u.screenName ? ` - ${u.screenName}` : ""}
            </span>
            {u.id !== meId && u.id !== "default" && (
              <button type="button" className="pwRemove" onClick={() => (setRemoving(u), setRemoveSecret(""), setRemoveError(null))}>
                Remove...
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="pwButtons pwButtonsLeft">
        <button type="button" onClick={() => (setAdding(true), setNewName(""), setError(null))}>
          New User...
        </button>
      </div>

      <fieldset className="pwField">
        <legend>Your profile</legend>
        <div className="pwRow">
          <label htmlFor="pw-name">User name:</label>
          <input id="pw-name" type="text" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="pwRowTop">
          <span>Picture:</span>
          <PicturePicker value={picture} onPick={setPicture} />
        </div>
        <div className="pwRow">
          <label htmlFor="pw-screen">98 Messenger screen name:</label>
          <input id="pw-screen" type="text" maxLength={16} autoCapitalize="off" autoCorrect="off" placeholder="(none)" value={screenName} onChange={(e) => setScreenName(e.target.value)} />
        </div>
        {needSecret && (
          <div className="pwRow">
            <label htmlFor="pw-confirm">Your {wordFor(me.lock.kind)}:</label>
            <SecretField id="pw-confirm" kind={me.lock.kind} value={secret} onChange={setSecretText} label={`Your ${wordFor(me.lock.kind)}`} />
          </div>
        )}
        <p className="pwHint">The linked screen name fills in at 98 Messenger's Sign On, and "Forgot PIN?" on the lock screen resets your PIN by signing in to it. "Sign me on automatically" is kept separately for each user.</p>
        <div className="pwButtons">
          <button type="button" onClick={save} disabled={needSecret && !secret}>
            Save
          </button>
        </div>
      </fieldset>
      {error && (
        <p className="pwError" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="pwDone" role="status">
          {done}
        </p>
      )}

      {adding && (
        <Dialog title="New User" okLabel="Create" okDisabled={!newName.trim()} onOk={add} onCancel={() => setAdding(false)}>
          <p className="dialogText">Each user gets their own desktop, files, settings and theme on this device.</p>
          <label htmlFor="pw-newuser">User name:</label>
          <input id="pw-newuser" type="text" maxLength={32} value={newName} onChange={(e) => setNewName(e.target.value)} />
        </Dialog>
      )}
      {removing && (
        <Dialog title="Remove User" okLabel="Remove" sound="chord" onOk={doRemove} onCancel={() => setRemoving(null)} okDisabled={hasSecret(removing) && !removeSecret}>
          <p className="dialogText">
            Remove <b>{removing.name}</b> and everything 98ish keeps for them on this device (their desktop, files, pictures, settings and scores)? This can't be undone.
          </p>
          {hasSecret(removing) && (
            <>
              <label htmlFor="pw-remove-secret">
                {removing.name}'s {wordFor(removing.lock.kind)}:
              </label>
              <SecretField id="pw-remove-secret" kind={removing.lock.kind} value={removeSecret} onChange={setRemoveSecret} label={`${removing.name}'s ${wordFor(removing.lock.kind)}`} />
            </>
          )}
          {removeError && <p className="pwError">{removeError}</p>}
        </Dialog>
      )}
    </div>
  )
}

const Passwords = ({ tab: firstTab = "change", reason, onClose }) => {
  const [tab, setTab] = useState(firstTab)
  return (
    <div className="pwRoot">
      <menu role="tablist" className="pwTabs">
        {TABS.map(([id, label]) => (
          <li key={id} role="tab" aria-selected={tab === id}>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                setTab(id)
              }}
            >
              {label}
            </a>
          </li>
        ))}
      </menu>
      <div className="window pwPanel" role="tabpanel">
        {tab === "change" && <ChangeTab reason={reason} />}
        {tab === "lock" && <LockTab />}
        {tab === "users" && <UsersTab />}
      </div>
      <div className="pwButtons">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

export default Passwords
