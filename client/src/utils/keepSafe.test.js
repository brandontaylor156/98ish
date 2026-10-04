import test from "node:test"
import assert from "node:assert/strict"
import { keepSafeAdvice, snoozed, SNOOZE_MS } from "./keepSafe.js"

test("an online copy being kept: nothing to say", () => {
  for (const phase of ["idle", "syncing", "pending", "offline", "error"]) assert.equal(keepSafeAdvice({ phase, signedOn: true }), null)
  // a device sync token keeps syncing after 98 Messenger signs off
  assert.equal(keepSafeAdvice({ phase: "idle", signedOn: false }), null)
})

test("guests are told to sign on (and about Backup); signed on with sync off, to turn it on", () => {
  const guest = keepSafeAdvice({ phase: "signedOut" })
  assert.equal(guest.kind, "guest")
  assert.match(guest.text, /^Your files are only on this device\. Sign on to 98 Messenger to keep them safe and on all your devices/)
  assert.match(guest.text, /Backup/)
  assert.equal(keepSafeAdvice({ phase: "off" }).kind, "guest")
  const off = keepSafeAdvice({ phase: "off", signedOn: true })
  assert.equal(off.kind, "off")
  assert.match(off.text, /Turn it on in Backup/)
})

test("Safari on iPhone outside the Home Screen hears about the 7 days", () => {
  assert.match(keepSafeAdvice({ phase: "signedOut", ios: true }).text, /7 days/)
  assert.doesNotMatch(keepSafeAdvice({ phase: "signedOut", ios: true, standalone: true }).text, /7 days/)
  assert.doesNotMatch(keepSafeAdvice({ phase: "signedOut", ios: true, persisted: true }).text, /7 days/)
  assert.doesNotMatch(keepSafeAdvice({ phase: "signedOut", ios: false }).text, /7 days/)
})

test("a closed note stays closed for a while, per place", () => {
  const now = 1_000_000_000_000
  assert.equal(snoozed({ camera: now - 1000 }, "camera", now), true)
  assert.equal(snoozed({ camera: now - 1000 }, "photos", now), false)
  assert.equal(snoozed({ camera: now - SNOOZE_MS - 1 }, "camera", now), false)
  assert.equal(snoozed(null, "camera", now), false)
})
