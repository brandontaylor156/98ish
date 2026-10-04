// Progressive disclosure (docs/simplicity.md): whether someone opened a program's "More
// options", remembered per program part and per user. One localStorage key holds them all;
// the user storage seam (utils/userStorage.js) gives every person on the device their own.

import { useCallback, useEffect, useState } from "react"

export const DISCLOSURE_KEY = "98ish.moreOptions"

const listeners = new Set()

const readAll = () => {
  try {
    const all = JSON.parse(localStorage.getItem(DISCLOSURE_KEY) || "{}")
    return all && typeof all === "object" ? all : {}
  } catch {
    return {}
  }
}

// whether `id` was left open (`fallback` until someone chooses). { "*": true } opens every
// one nobody chose for (older browser tests set it to find everything where it used to be)
export const isOpen = (id, fallback = false) => {
  const all = readAll()
  const value = all[id]
  if (typeof value === "boolean") return value
  return typeof all["*"] === "boolean" ? all["*"] : fallback
}

export const rememberOpen = (id, open) => {
  if (!id) return
  try {
    const all = readAll()
    all[id] = !!open
    localStorage.setItem(DISCLOSURE_KEY, JSON.stringify(all))
  } catch {
    // private windows: it just isn't remembered
  }
  for (const fn of listeners) fn(id, !!open)
}

// [open, setOpen] for a disclosure, remembered under `id` (no id: not remembered)
export const useDisclosure = (id, fallback = false) => {
  const [open, setOpenState] = useState(() => (id ? isOpen(id, fallback) : fallback))
  useEffect(() => {
    if (!id) return undefined
    const onChange = (changed, value) => changed === id && setOpenState(value)
    listeners.add(onChange)
    return () => listeners.delete(onChange)
  }, [id])
  const setOpen = useCallback(
    (next) => {
      setOpenState((was) => {
        const value = typeof next === "function" ? next(was) : next
        if (id) queueMicrotask(() => rememberOpen(id, value))
        return value
      })
    },
    [id]
  )
  return [open, setOpen]
}

// "On this device · Doesn't repeat · 15 min reminder": the one-line summary of what's
// tucked away, from the parts that are set
export const summarize = (...parts) => parts.flat().filter((p) => p !== null && p !== undefined && p !== false && p !== "").join(" · ")
