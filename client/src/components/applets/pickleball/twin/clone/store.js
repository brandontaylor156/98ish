// Twin Clones on this device: your clones list (localStorage "98ish.pickleball.clones", kept
// separately for each user by the storage seam, utils/userStorage.js). Small: a clone is a
// few KB of counts. At most MAX_CLONES; the oldest unused one goes when it's full.

const KEY = "98ish.pickleball.clones"
export const MAX_CLONES = 16

const read = () => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]")
    return Array.isArray(v) ? v.filter((c) => c && c.id && c.counts) : []
  } catch {
    return []
  }
}
const write = (list) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_CLONES)))
    return true
  } catch {
    return false
  }
}

const listeners = new Set()
const emit = () => listeners.forEach((fn) => fn())
export const subscribeClones = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const listClones = () => read().sort((a, b) => (b.updated || 0) - (a.updated || 0))
export const getClone = (id) => read().find((c) => c.id === id) || null
export const saveClone = (clone) => {
  const list = read().filter((c) => c.id !== clone.id)
  list.unshift({ ...clone, updated: Date.now() })
  const ok = write(list.sort((a, b) => (b.updated || 0) - (a.updated || 0)))
  emit()
  return ok
}
export const deleteClone = (id) => {
  write(read().filter((c) => c.id !== id))
  emit()
}
