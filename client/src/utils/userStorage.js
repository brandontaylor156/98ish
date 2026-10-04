// Imported FIRST by main.jsx, before any module that reads localStorage at load time
// (the drive, settings, achievements...): from here on, localStorage's getItem, setItem and
// removeItem go through userKey() (utils/users.js), so each person on this device gets
// their own copy of every "98ish." key without any app knowing about users.
// The default user's keys are the plain ones, so with one user nothing changes at all.

import { setRawStorage, userKey } from "./users"

const install = () => {
  let ls = null
  try {
    ls = globalThis.localStorage || null
  } catch {
    return // storage blocked (private mode): nothing to keep apart
  }
  if (!ls || typeof Storage === "undefined" || Storage.prototype.__98ishUsers) return
  const proto = Storage.prototype
  const get = proto.getItem
  const set = proto.setItem
  const remove = proto.removeItem
  setRawStorage({ ls, get: get.bind(ls), set: set.bind(ls), remove: remove.bind(ls) })
  const map = (store, key) => (store === ls ? userKey(String(key)) : key)
  proto.getItem = function (key) {
    return get.call(this, map(this, key))
  }
  proto.setItem = function (key, value) {
    return set.call(this, map(this, key), value)
  }
  proto.removeItem = function (key) {
    return remove.call(this, map(this, key))
  }
  Object.defineProperty(proto, "__98ishUsers", { value: true })
}

install()
