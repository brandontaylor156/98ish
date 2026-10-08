// The decisions behind file sync (driveSync.js does the talking and the writing). Pure: no
// React, no fs.js, so Node tests can drive it.
//
// Every synced file or folder has a path ("C:/My Pictures/PHOTO001.JPG"). For each path this
// device remembers the "base": what it and the server last agreed on ({ rev, hash, kind,
// type, deleted }). Comparing the base with what's here now says what changed here; the
// server's entries newer than the last revision seen say what changed elsewhere.
//   - changed only there: take theirs (a delete moves the file to the Recycle Bin)
//   - changed only here: send ours, based on the base's revision
//   - changed in both, differently: keep both. Theirs takes the path; ours is renamed
//     "name (from iPhone).ext" and sent as a new file
//   - deleted there but edited here: ours stays and is sent again

export const DEFAULT_FOLDERS = ["Documents", "My Pictures", "Desktop"]
// folders that never sync (programs and the system's own)
export const NEVER_SYNC = ["Programs", "Windows", "Bookmarks"]

export const inScope = (path, folders) => folders.some((f) => path === `C:/${f}` || path.startsWith(`C:/${f}/`))

export const depthOf = (path) => path.split("/").length

// The synced part of the drive as it is now: Map(path -> { kind, type, hash, size, mtime, item })
// `drive` is the C: Directory (anything with name/isDirectory/content/type and, for files,
// contentHash/size/mtime)
export const scanLocal = (drive, folders) => {
  const out = new Map()
  const walk = (dir, prefix) => {
    for (const item of dir.content) {
      const path = `${prefix}/${item.name}`
      if (item.isDirectory) {
        out.set(path, { kind: "d", type: item.type, hash: null, size: 0, mtime: 0, item })
        walk(item, path)
      } else out.set(path, { kind: "f", type: item.type, hash: item.contentHash, size: item.size, mtime: item.mtime || 0, item })
    }
  }
  for (const name of folders) {
    const dir = drive?.isDirectory ? drive.content.find((item) => item.name === name) : null
    if (!dir) continue
    const path = `C:/${name}`
    if (dir.isDirectory) {
      out.set(path, { kind: "d", type: dir.type, hash: null, size: 0, mtime: 0, item: dir })
      walk(dir, path)
    }
  }
  return out
}

// A file that doesn't go online: a big video/song/PDF kept on this device (fs.js storeMedia:
// over 8 MB, utils/mediaRules.js), or text longer than the server takes (maxFile)
export const staysOnDevice = (item, maxFile = 0) => !!item && !item.isDirectory && (!!item.deviceOnly || (maxFile > 0 && (item.textLength || 0) > maxFile))

// does what's here differ from the base?
export const differs = (local, base) => {
  if (!base || base.deleted) return !!local
  if (!local) return true
  if (local.kind !== base.kind) return true
  if (local.kind === "f") return local.hash !== base.hash || local.type !== base.type
  return false
}

// what's here and an entry from the server are the same thing
export const sameAs = (local, entry) => !!local && !entry.deleted && local.kind === entry.kind && (entry.kind === "d" || (local.hash === entry.hash && local.type === entry.type))

// An entry from the server -> what to do:
//   "same"     already like that here: just remember it
//   "take"     take theirs (write it, or for a delete, recycle ours)
//   "keepBoth" both changed: rename ours, then take theirs
//   "keepOurs" theirs is a delete but ours changed: keep ours (it's sent again)
//   "ignore"   theirs is a delete of something not here
export const decide = (entry, local, base) => {
  if (sameAs(local, entry)) return "same"
  const changedHere = differs(local, base)
  if (entry.deleted) {
    if (!local) return "ignore"
    return changedHere ? "keepOurs" : "take"
  }
  if (!local) return "take"
  if (!changedHere) return "take"
  // both are folders: nothing to keep apart
  if (local.kind === "d" && entry.kind === "d") return "same"
  return "keepBoth"
}

// What to send: changes here since the base, folders before their files, and deletes after
// (deepest first), so a rename uploads nothing new and a folder goes after its contents
export const planPush = (local, base, folders) => {
  const ups = []
  const downs = []
  for (const [path, l] of local) {
    const b = base[path]
    if (!differs(l, b)) continue
    ups.push({ path, kind: l.kind, type: l.type, hash: l.hash, size: l.size, mtime: l.mtime, baseRev: b?.rev || 0, deleted: false })
  }
  for (const [path, b] of Object.entries(base)) {
    if (b.deleted || local.has(path) || !inScope(path, folders)) continue
    downs.push({ path, kind: b.kind, type: b.type, deleted: true, baseRev: b.rev })
  }
  ups.sort((a, b) => depthOf(a.path) - depthOf(b.path))
  downs.sort((a, b) => depthOf(b.path) - depthOf(a.path))
  return [...ups, ...downs]
}

// "photo.jpg" -> "photo (from iPhone).jpg" (a name not taken in the folder)
export const conflictName = (name, device, taken = () => false) => {
  const dot = name.lastIndexOf(".")
  const [stem, ext] = dot > 0 && name.length - dot <= 6 ? [name.slice(0, dot), name.slice(dot)] : [name, ""]
  const tag = ` (from ${device})`
  const base = `${stem.slice(0, Math.max(1, 64 - tag.length - ext.length - 4))}${tag}`
  let candidate = `${base}${ext}`
  for (let i = 2; taken(candidate); i++) candidate = `${base} ${i}${ext}`
  return candidate
}

// A short name for this device, from its browser
export const deviceName = (ua = "") => {
  if (/iPhone/i.test(ua)) return "iPhone"
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua))) return "iPad"
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Android phone" : "Android tablet"
  if (/CrOS/i.test(ua)) return "Chromebook"
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac"
  if (/Windows/i.test(ua)) return "Windows PC"
  if (/Linux/i.test(ua)) return "Linux PC"
  return "another computer"
}

// The base after the server took a change (or an entry pulled from it)
export const baseOf = (entry) => ({ rev: entry.rev, hash: entry.hash || null, kind: entry.kind, type: entry.type, deleted: !!entry.deleted })
