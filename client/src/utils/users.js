// User profiles on one device (Windows 98's "Users"): each person has their own desktop,
// settings, theme, files and scores, an optional password or PIN, a picture, and an
// optional linked 98 Messenger screen name.
//
// THE STORAGE SEAM. Everything 98ish keeps on the device is under keys that start with
// "98ish.". Per-user data is told apart by one function:
//
//   userKey("98ish.fs.v1")          the key for the person logged on now
//   userKey("98ish.fs.v1", id)      ... for someone else
//   keyPrefix(id)                   "98ish." for the default user, "98ish.u.<id>." for others
//
// The default user (the first one, "Guest" until renamed) keeps the plain keys, so the data
// a device already has IS the default user's: nothing is copied or moved, nothing can be
// lost. Other people's keys are "98ish.u.<id>.<rest>". A few keys belong to the device, not
// a person (GLOBAL_KEYS: the user list, who's logged on, the lock state).
//
// utils/userStorage.js applies userKey to localStorage itself (getItem/setItem/removeItem),
// installed before any other module runs, so the ~90 existing localStorage keys need no
// edits. Any other store (IndexedDB...) calls userKey() / keyPrefix() itself for its record
// keys or database name, and registers onUserRemoved(fn) to delete a removed person's data.
//
// Who is logged on is read once per page load; switching people reloads the page
// (switchUser), so every module starts fresh with the new person's keys.

export const DEFAULT_ID = "default"
export const USERS_KEY = "98ish.users"
export const CURRENT_KEY = "98ish.currentUser"
const LEGACY_NAME_KEY = "98ish.user" // the name typed at Log On before profiles existed
const LOGGED_ON_FLAG = "98ish.loggedOn" // sessionStorage: this reload is a fresh log on

// device keys, never per person
export const GLOBAL_KEYS = new Set([USERS_KEY, CURRENT_KEY, LEGACY_NAME_KEY, "98ish.lock", "98ish.productId", "98ish.visitor"])

const PREFIX = "98ish."
const USER_PREFIX = "98ish.u."

// ---- raw storage (never mapped: users.js reads device keys and other people's keys) ----

let raw = null
const rawStore = () => {
  if (raw) return raw
  let ls = null
  try {
    ls = globalThis.localStorage || null
  } catch {
    ls = null
  }
  if (!ls) return null
  const proto = Object.getPrototypeOf(ls)
  raw = {
    ls,
    get: (proto.getItem || ls.getItem).bind(ls),
    set: (proto.setItem || ls.setItem).bind(ls),
    remove: (proto.removeItem || ls.removeItem).bind(ls),
  }
  return raw
}
// userStorage.js hands over the unpatched methods before patching
export const setRawStorage = (value) => {
  raw = value
}
export const rawGet = (key) => {
  try {
    return rawStore()?.get(key) ?? null
  } catch {
    return null
  }
}
export const rawSet = (key, value) => {
  try {
    rawStore()?.set(key, value)
    return true
  } catch {
    return false
  }
}
export const rawRemove = (key) => {
  try {
    rawStore()?.remove(key)
  } catch {
    // blocked
  }
}

// ---- keys ----

export const keyPrefix = (id = currentUserId()) => (!id || id === DEFAULT_ID ? PREFIX : `${USER_PREFIX}${id}.`)

// The key `key` has for person `id` (the one logged on by default). Keys outside 98ish,
// device keys and keys already made per-person come back unchanged.
export const userKey = (key, id = currentUserId()) => {
  if (typeof key !== "string" || !key.startsWith(PREFIX) || key.startsWith(USER_PREFIX) || GLOBAL_KEYS.has(key)) return key
  if (!id || id === DEFAULT_ID) return key
  return `${USER_PREFIX}${id}.${key.slice(PREFIX.length)}`
}

// Every raw localStorage key that belongs to person `id`
export const keysOf = (id, allKeys) => {
  if (id === DEFAULT_ID) return allKeys.filter((k) => k.startsWith(PREFIX) && !k.startsWith(USER_PREFIX) && !GLOBAL_KEYS.has(k))
  return allKeys.filter((k) => k.startsWith(`${USER_PREFIX}${id}.`))
}

// ---- the user list ----

const cleanName = (name) => String(name ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 32)

const defaultUser = () => ({ id: DEFAULT_ID, name: cleanName(rawGet(LEGACY_NAME_KEY)) || "Guest", picture: null, screenName: "", lock: null, created: 0 })

const readList = () => {
  try {
    const saved = JSON.parse(rawGet(USERS_KEY))
    if (saved && Array.isArray(saved.users) && saved.users.length) {
      const users = saved.users.filter((u) => u && typeof u.id === "string").map((u) => ({ picture: null, screenName: "", lock: null, ...u, name: cleanName(u.name) || "User" }))
      if (!users.some((u) => u.id === DEFAULT_ID)) users.unshift(defaultUser())
      return users
    }
  } catch {
    // damaged: start from the default user (their data is untouched)
  }
  return [defaultUser()]
}

const listeners = new Set()
let users = readList()
const writeList = () => {
  rawSet(USERS_KEY, JSON.stringify({ version: 1, users }))
  listeners.forEach((fn) => fn(users))
}

export const listUsers = () => users
export const getUser = (id) => users.find((u) => u.id === id) || null
export const findUserByName = (name) => users.find((u) => u.name.toLowerCase() === cleanName(name).toLowerCase()) || null
// true once anyone besides the default user exists (Log On then shows the list)
export const hasProfiles = () => users.length > 1

export const subscribeUsers = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// for tests and other tabs: read the list again
export const reloadUsers = () => {
  users = readList()
  listeners.forEach((fn) => fn(users))
}

// ---- who is logged on (fixed for this page load) ----

let current = null
export const currentUserId = () => {
  if (current) return current
  const saved = rawGet(CURRENT_KEY)
  current = saved && users.some((u) => u.id === saved) ? saved : DEFAULT_ID
  return current
}
export const currentUser = () => getUser(currentUserId()) || users[0]
export const currentUserName = () => currentUser()?.name || "Guest"

// ---- changes ----

const newId = () => {
  const bytes = new Uint8Array(6)
  globalThis.crypto?.getRandomValues?.(bytes)
  let id = ""
  for (const b of bytes) id += (b % 36).toString(36)
  return id.length === 6 && !/^0+$/.test(id) ? id : Math.random().toString(36).slice(2, 8)
}

// -> the new user, or throws a message for the person
export const createUser = ({ name, picture = null, screenName = "" } = {}) => {
  const clean = cleanName(name)
  if (!clean) throw new Error("Type a user name.")
  if (findUserByName(clean)) throw new Error(`There is already a user named ${clean}.`)
  if (users.length >= 12) throw new Error("This computer already has 12 users. Remove one first.")
  let id = newId()
  while (getUser(id)) id = newId()
  const user = { id, name: clean, picture, screenName: String(screenName || "").trim().slice(0, 16), lock: null, created: Date.now() }
  users = [...users, user]
  writeList()
  return user
}

export const updateUser = (id, patch) => {
  const user = getUser(id)
  if (!user) return null
  const next = { ...user, ...patch, id }
  if ("name" in patch) {
    next.name = cleanName(patch.name)
    if (!next.name) throw new Error("Type a user name.")
    const other = findUserByName(next.name)
    if (other && other.id !== id) throw new Error(`There is already a user named ${next.name}.`)
  }
  if ("screenName" in patch) next.screenName = String(patch.screenName || "").trim().slice(0, 16)
  users = users.map((u) => (u.id === id ? next : u))
  writeList()
  return next
}

// other stores (IndexedDB drive...) delete a removed person's data here: fn(id, prefix)
const cleanups = new Set()
export const onUserRemoved = (fn) => {
  cleanups.add(fn)
  return () => cleanups.delete(fn)
}

// Removes a person and everything 98ish kept for them on this device. Not the default user
// (their data is the device's original data) and not whoever is logged on.
export const removeUser = (id) => {
  if (id === DEFAULT_ID) throw new Error("The first user can't be removed. You can rename them.")
  if (id === currentUserId()) throw new Error("You can't remove the user who is logged on.")
  if (!getUser(id)) return
  const store = rawStore()
  if (store) {
    const all = []
    for (let i = 0; i < store.ls.length; i++) all.push(store.ls.key(i))
    for (const key of keysOf(id, all)) rawRemove(key)
  }
  for (const fn of cleanups) {
    try {
      fn(id, keyPrefix(id))
    } catch {
      // that store cleans up next time
    }
  }
  users = users.filter((u) => u.id !== id)
  writeList()
}

// Log on as someone: remember them and reload so every module reads their keys.
// `reload` is replaceable for tests.
export const switchUser = (id, { reload = () => globalThis.location?.reload() } = {}) => {
  if (!getUser(id)) return false
  rawSet(CURRENT_KEY, id)
  try {
    globalThis.sessionStorage?.setItem(LOGGED_ON_FLAG, String(Date.now()))
  } catch {
    // no session storage: the boot screen shows, which is fine
  }
  reload()
  return true
}

// Was this page load a log on (a switch of users)? Asked once at startup; true skips the
// startup screen, since the person just logged on.
export const takeLoggedOnFlag = () => {
  try {
    const at = Number(globalThis.sessionStorage?.getItem(LOGGED_ON_FLAG))
    globalThis.sessionStorage?.removeItem(LOGGED_ON_FLAG)
    return at > 0 && Date.now() - at < 60_000
  } catch {
    return false
  }
}

// A picture for a profile: shrinks a photo to a 96x96 JPEG data URL. Resolves with it;
// rejects with a message for the person.
export const loadUserPicture = (file) =>
  new Promise((resolve, reject) => {
    if (!file || !String(file.type).startsWith("image/")) return reject("That file isn't a picture.")
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const size = 96
      const canvas = document.createElement("canvas")
      canvas.width = size
      canvas.height = size
      const s = Math.min(img.width, img.height)
      canvas.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size)
      resolve(canvas.toDataURL("image/jpeg", 0.85))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject("That picture couldn't be opened. (iPhone HEIC photos: pick one saved as JPEG.)")
    }
    img.src = url
  })

// built-in pictures (public/assets/users/)
export const USER_PICTURES = ["flower", "cat", "rocket", "heart", "guitar", "duck", "ball", "moon"].map((id) => `/assets/users/${id}.svg`)
export const pictureFor = (user) => user?.picture || USER_PICTURES[Math.abs([...String(user?.id || "")].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % USER_PICTURES.length]
