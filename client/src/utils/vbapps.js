// Visual Basic 98 programs shared in a message, on this device: AimContext hands over its
// socket request function while signed on (attachVbApps), forwards "vb:update" here, and
// handles "vb:invite" itself (a line in the conversation with an Open button). A running
// shared program listens with onVbUpdate(id, fn). The server is server/aim/vbapps.js.

let link = null // { request(event, payload) -> Promise, meName() }
const listeners = new Map() // id -> Set(fn)

export const VBAPP_EVENTS = ["vb:update"]

export const attachVbApps = (next) => {
  link = next
}
export const vbOnline = () => !!link
export const vbMeName = () => link?.meName?.() || ""

const ask = async (event, payload) => {
  if (!link) return { ok: false, error: "Sign on to 98 Messenger to share programs." }
  try {
    return (await link.request(event, payload)) || { ok: false, error: "No answer from 98 Messenger." }
  } catch {
    return { ok: false, error: "Couldn't reach 98 Messenger." }
  }
}

// target: { with: screenName } | { room } | { hangout: true }
export const vbShare = (project, target) => ask("vb:share", { app: project, title: project?.form?.caption, ...target })
export const vbOpen = (id) => ask("vb:open", { id })
export const vbSet = (id, k, v) => ask("vb:set", { id, k, v })
export const vbClose = (id) => ask("vb:close", { id })
// "it's open here" (again: after a reconnect the server has forgotten)
export const vbWatch = (id) => ask("vb:watch", { id })
export const vbMine = () => ask("vb:mine", {})
export const vbForget = (id) => ask("vb:forget", { id })

export const onVbUpdate = (id, fn) => {
  if (!listeners.has(id)) listeners.set(id, new Set())
  listeners.get(id).add(fn)
  return () => {
    listeners.get(id)?.delete(fn)
    if (!listeners.get(id)?.size) listeners.delete(id)
  }
}

export const handleVbEvent = (event, payload) => {
  if (event === "vb:update" && payload?.id) listeners.get(payload.id)?.forEach((fn) => fn(payload))
}
