// Are this person's files kept anywhere but this device? The words for "no", where it
// matters (Camera after a photo, Photos, My Computer's status bar, Control Panel > Storage).
// Pure, so Node can test it (keepSafe.test.js).
//
// The facts behind it: 98ish keeps the drive in this browser's IndexedDB. A browser may clear
// that when the device runs low on space unless navigator.storage.persist() was granted, and
// Safari on iPhone clears a website's storage after about 7 days without a visit unless 98ish
// was added to the Home Screen. File sync (utils/driveSync.js) keeps a copy online for a
// signed-on 98 Messenger account, which is what brings photos back on a new phone.

// sync phases that mean an online copy is being kept (see driveSync.js statusText)
const SYNCING = new Set(["idle", "syncing", "pending", "offline", "error"])

// { phase (file sync), signedOn (98 Messenger), persisted (true/false/null), ios, standalone }
// -> null (an online copy is kept) | { kind: "guest" | "off", title, text, short }
export const keepSafeAdvice = ({ phase, signedOn = false, persisted = null, ios = false, standalone = false } = {}) => {
  if (SYNCING.has(phase)) return null
  const safari = ios && !standalone && persisted !== true
    ? " Safari can also clear a website's files after about 7 days without a visit; adding 98ish to your Home Screen stops that."
    : ""
  if (signedOn) {
    return {
      kind: "off",
      title: "File sync is off",
      text: `File sync is off, so your files are only on this device. Turn it on in Backup to keep them safe and on all your devices.${safari}`,
      short: "Only on this device",
    }
  }
  return {
    kind: "guest",
    title: "Only on this device",
    text: `Your files are only on this device. Sign on to 98 Messenger to keep them safe and on all your devices, or save a copy with Backup.${safari}`,
    short: "Only on this device",
  }
}

// a note someone closed stays closed this long (per place)
export const SNOOZE_MS = 30 * 24 * 60 * 60_000
export const snoozed = (dismissed, place, now = Date.now()) => !!dismissed?.[place] && now - dismissed[place] < SNOOZE_MS
