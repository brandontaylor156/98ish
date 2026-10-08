// After Delete My Account (the server confirmed: server/account), this device forgets the
// account: its remembered sign on, file sync's token and bookkeeping, the Address Book's
// and Notes' link to it (shared notes stay here as plain copies), Shared Albums' copies, its notifications, cached mail headers and couple/town copies, its saved 98
// Messenger conversations and media (aim/history/historyDb.js), this browser's
// push subscription, and the link from 98ish user profiles to the screen name. With
// `eraseLocal`, the 98ish user logged on here also loses everything kept on this device (the
// drive in IndexedDB, and every localStorage key of theirs via utils/users.js keysOf), as if
// new; otherwise their files and settings stay, as a local guest's.
//
// Every step is best effort and independent: one that fails (storage blocked) doesn't stop
// the rest. Resolves { erased } (true when this device's data was erased: reload the page).

import { currentUserId, keysOf, listUsers, rawRemove, updateUser } from "./users"

const keyOf = (name) => String(name || "").replace(/\s+/g, "").toLowerCase()

// account-tied things kept per 98ish user in localStorage (mapped by utils/userStorage.js)
// (98ish.hfToken / hfQuota: 3D Viewer 98's Hugging Face token and what it knows of the free time)
const ACCOUNT_KEYS = ["98ish.aim.remember", "98ish.mail.index", "98ish.dollhouse.shared", "98ish.cal.reminders", "98ish.push.device", "98ish.hfToken", "98ish.hfQuota"]

const step = async (fn) => {
  try {
    await fn()
  } catch (error) {
    console.warn("[account] a device cleanup step failed", error)
  }
}

export const forgetAccountOnDevice = async ({ key, eraseLocal = false } = {}) => {
  // notifications for this browser stop (the server already forgot the subscription)
  await step(async () => {
    const push = await import("./push")
    await push.disablePush(null)
    if (typeof caches !== "undefined") await caches.delete(push.INBOX_CACHE)
  })
  await step(async () => (await import("./driveSync")).forgetSyncAccount(key))
  await step(async () => (await import("./contacts")).forgetContactsAccount(key))
  await step(async () => (await import("./notes")).forgetNotesAccount(key))
  // Shared Albums: previews, photos and uploads waiting on this device
  await step(async () => (await import("./albums")).forgetAlbumsAccount(key))
  await step(async () => (await import("./notifications")).forgetNotifications(key))
  // 98 Messenger conversations, pictures and voice messages this device kept for the account
  await step(async () => (await import("../components/applets/aim/history/historyDb")).eraseAccount(key))
  await step(() => {
    for (const k of ACCOUNT_KEYS) localStorage.removeItem(k)
    // Sunny Acres: what this device last synced for that account
    const town = JSON.parse(localStorage.getItem("98ish.town.cloud") || "null")
    if (town && typeof town === "object" && key in town) {
      delete town[key]
      localStorage.setItem("98ish.town.cloud", JSON.stringify(town))
    }
    // Sign On no longer offers the name
    const prefs = JSON.parse(localStorage.getItem("98ish.aim.prefs") || "null")
    if (prefs && keyOf(prefs.lastScreenName) === key) localStorage.setItem("98ish.aim.prefs", JSON.stringify({ ...prefs, lastScreenName: "" }))
  })
  // profiles linked to the screen name (Log On, "Forgot PIN?") aren't any more
  await step(() => {
    for (const user of listUsers()) if (user.screenName && keyOf(user.screenName) === key) updateUser(user.id, { screenName: "" })
  })
  if (!eraseLocal) return { erased: false }
  // this 98ish user's files and settings on this device, all of them
  await step(async () => (await import("./fs")).eraseThisDrive())
  await step(() => {
    const all = []
    for (let i = 0; i < localStorage.length; i++) all.push(localStorage.key(i))
    for (const k of keysOf(currentUserId(), all)) rawRemove(k)
  })
  return { erased: true }
}
