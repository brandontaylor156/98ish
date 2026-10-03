import { createContext, useContext } from "react"

// What every Appward 98 view can reach: the workspace and the shell's navigation
//   ws, mobile
//   openApp(appId, extra), openRecord(appId, id, extra), newRecord(appId, preset), closeTab(key)
//   runSearch(text), toast(text), pickRecord({ title, onPick, exclude }), confirm({ text, onYes })
//   registerSave(tabKey, fn) -> unregister: the toolbar's Save and Ctrl+S call the active tab's
export const AwContext = createContext(null)
export const useAw = () => useContext(AwContext)

// "2 minutes ago", for notifications and messages
export const ago = (time, now = Date.now()) => {
  const s = Math.max(0, Math.round((now - time) / 1000))
  if (s < 45) return "just now"
  const m = Math.round(s / 60)
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? "" : "s"} ago`
}

export const todayIso = (offset = 0) => {
  const t = new Date()
  t.setDate(t.getDate() + offset)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`
}

// a person's initials on a colored square (messages, cards)
export const AVATAR_COLORS = ["#000080", "#008080", "#800080", "#808000", "#800000", "#008000", "#0000c0", "#a05000"]
export const avatarColor = (handle) => AVATAR_COLORS[[...String(handle)].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_COLORS.length]
export const initials = (name) => String(name || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()

// "Companies" -> "Company", "Deliveries" -> "Delivery", "Sales Orders" -> "Sales Order"
export const singular = (name) => name.replace(/ies$/, "y").replace(/(ss|sh|ch|x)es$/, "$1").replace(/s$/, "")
