import { useEffect, useState } from "react"
import { playSystemSound } from "./systemSounds"

// Achievements: little secrets around 98ish. Anywhere in the app, `unlock("id")` marks one
// as found (once) and pops up a toast; `progress("id", step, total)` counts distinct steps
// (each Paint tool used...) and unlocks when all are done. Kept in this browser.

const KEY = "98ish.achievements"
const PROGRESS_KEY = "98ish.achievements.progress"

export const ACHIEVEMENTS = [
  { id: "bsod", title: "Fatal Exception", text: "Crashed 98ish so hard it turned blue.", hint: "Some processes in Task Manager really shouldn't be ended." },
  { id: "dos-mode", title: "Real Mode", text: "Restarted in MS-DOS mode.", hint: "Look closely at the Shut Down options." },
  { id: "dos-ver", title: "Version Control", text: "Asked MS-DOS which version this is.", hint: "MS-DOS knows which version of Windows it belongs to. Just ask." },
  { id: "dos-tree", title: "Family Tree", text: "Drew the whole drive as a tree.", hint: "There's a DOS command that draws your folders." },
  { id: "xyzzy", title: "Magic Word", text: "Said the magic word at the C:\\> prompt.", hint: "An old adventure-game magic word works in MS-DOS. Five letters, two of them Y." },
  { id: "notepad-log", title: "Dear Diary", text: "Found Notepad's .LOG trick.", hint: "Start a Notepad file with a certain four-character word, save it, and open it again." },
  { id: "hidden-file", title: "Spelunker", text: "Found the file nobody was supposed to find.", hint: "Something is hiding in a temporary folder deep inside C:\\." },
  { id: "recycle", title: "Taking Out the Trash", text: "Emptied the Recycle Bin.", hint: "Delete something, then make it gone for good." },
  { id: "wallpaper", title: "Interior Decorator", text: "Put your own picture on the desktop.", hint: "Display Properties and Paint can both change the wallpaper." },
  { id: "updates", title: "Fully Patched", text: "Installed every Windows Update.", hint: "Windows Update has a few critical things for you. All of them." },
  { id: "smarterchild", title: "Robot Friend", text: "Chatted with SmarterChild.", hint: "Somebody on 98 Messenger is always online." },
  { id: "guestbook", title: "Sign Here", text: "Signed the 98ish guestbook.", hint: "A homepage on the Web Ring would love to hear from you." },
  { id: "full-song", title: "Encore", text: "Listened to a whole song in Media Player.", hint: "Play something in My Music all the way to the end." },
  { id: "paint-tools", title: "Renaissance Pixel", text: "Used every tool in Paint.", hint: "Paint has sixteen tools. Try them all." },
  { id: "solitaire", title: "Bouncing Cards", text: "Won a game of Solitaire.", hint: "Get all four suits home in Solitaire." },
  { id: "freecell", title: "Free at Last", text: "Won a game of FreeCell.", hint: "Almost every FreeCell deal can be won." },
  { id: "mine-expert", title: "Bomb Squad", text: "Cleared an Expert Minesweeper field.", hint: "Game > Expert in Minesweeper. Good luck." },
  { id: "ten-windows", title: "Multitasker", text: "Had 10 windows open at once.", hint: "How many windows can one desktop hold?" },
  { id: "konami", title: "Thirty Lives", text: "Entered the famous code on the desktop.", hint: "Up, up, down, down... on the bare desktop." },
  { id: "theme", title: "New Look", text: "Applied a desktop theme.", hint: "Settings in the Start menu has a whole new look for you." },
  { id: "switcher", title: "Juggler", text: "Switched windows from the keyboard.", hint: "Hold Alt and press Q (see Keyboard Shortcuts)." },
  { id: "quick-launch", title: "Launch Pad", text: "Added a program to Quick Launch.", hint: "Drag a desktop icon onto the little icons next to Start." },
]

export const achievementById = (id) => ACHIEVEMENTS.find((a) => a.id === id) || null

const readJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback
  } catch {
    return fallback
  }
}

const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage full or blocked: remembered for this visit only
  }
}

let unlocked = null // { [id]: time unlocked }
const all = () => (unlocked ||= readJson(KEY, {}))

const listeners = new Set()
const toastListeners = new Set()

export const isUnlocked = (id) => !!all()[id]

export const unlock = (id) => {
  const a = achievementById(id)
  if (!a || isUnlocked(id)) return false
  unlocked = { ...all(), [id]: Date.now() }
  writeJson(KEY, unlocked)
  listeners.forEach((fn) => fn(unlocked))
  toastListeners.forEach((fn) => fn(a))
  playSystemSound("tada")
  return true
}

// one more distinct step toward an achievement (say, a Paint tool); unlocks at `total`
export const progress = (id, step, total) => {
  if (isUnlocked(id)) return
  const saved = readJson(PROGRESS_KEY, {})
  const steps = new Set(saved[id] || [])
  if (steps.has(step)) return
  steps.add(step)
  writeJson(PROGRESS_KEY, { ...saved, [id]: [...steps] })
  if (steps.size >= total) unlock(id)
}

// for tests and "start over"
export const resetAchievements = () => {
  unlocked = {}
  writeJson(KEY, {})
  writeJson(PROGRESS_KEY, {})
  listeners.forEach((fn) => fn(unlocked))
}

// { unlocked: { id: time }, list: ACHIEVEMENTS, count }
export const useAchievements = () => {
  const [value, setValue] = useState(all)
  useEffect(() => {
    listeners.add(setValue)
    setValue(all())
    return () => listeners.delete(setValue)
  }, [])
  return { unlocked: value, list: ACHIEVEMENTS, count: Object.keys(value).filter((id) => achievementById(id)).length }
}

// the toast listens here (one at a time)
export const onUnlock = (fn) => {
  toastListeners.add(fn)
  return () => toastListeners.delete(fn)
}
