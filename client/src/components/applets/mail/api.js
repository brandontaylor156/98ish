import { SERVER_URL } from "./mailStatus"
import { fs, uniqueName, writeAndSave } from "../../../utils/fs"

// The mail server's HTTP API, signed with the 98 Messenger session's token. Every call
// resolves to { ok, ... } or { ok: false, error } (never throws).
export const mailApi = (token) => {
  const call = async (method, path, body) => {
    try {
      const response = await fetch(`${SERVER_URL}/api/mail${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
      return await response.json().catch(() => ({ ok: false, error: `The mail server had a problem (${response.status}).` }))
    } catch {
      return { ok: false, error: "Couldn't reach the mail server. It may be waking up; try again in a minute." }
    }
  }
  return {
    folders: () => call("GET", "/folders"),
    list: (folder) => call("GET", `/messages?folder=${folder}`),
    get: (id) => call("GET", `/messages/${encodeURIComponent(id)}`),
    markRead: (id, read) => call("PATCH", `/messages/${encodeURIComponent(id)}`, { read }),
    restore: (id) => call("PATCH", `/messages/${encodeURIComponent(id)}`, { action: "restore" }),
    remove: (id) => call("DELETE", `/messages/${encodeURIComponent(id)}`),
    emptyDeleted: () => call("POST", "/empty-deleted"),
    send: (message) => call("POST", "/send", message),
    saveDraft: (message) => call("POST", "/drafts", message),
  }
}

// Files that can travel by mail: anything the drive keeps as a string, except programs
export const ATTACHABLE = ["text", "note", "image", "richtext", "sound", "music"]
export const MAX_MESSAGE_BYTES = 1024 * 1024
export const ATTACHMENTS_FOLDER = "C:\\Documents\\Mail Attachments"

export const byteSize = (text) => new Blob([String(text ?? "")]).size

// Save an attachment into C:\Documents\Mail Attachments (made if needed) under a name
// that isn't taken. -> the new file, or throws with a message for the user
export const saveAttachment = (attachment) => {
  const docs = fs.resolve("C:/Documents") || fs.resolve("C:")
  const dir = fs.resolve("C:/Documents/Mail Attachments") || fs.createDirectoryIn(docs, "Mail Attachments")
  const file = fs.createFileIn(dir, uniqueName(dir, attachment.name), attachment.type, "")
  if (!writeAndSave(file, attachment.content, { created: true })) throw new Error(`There isn't enough room on the drive to save "${attachment.name}".`)
  return file
}
