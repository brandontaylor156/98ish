// The 98ish file system: a tree of Directories and Files under a root that holds the C:
// drive. It's saved to this device (IndexedDB, see "saving to this device" below) and every
// change is announced through onFsChange so open windows (My Computer, Notepad, MS-DOS
// Prompt) stay in sync. Deleting moves items to the Recycle Bin, which remembers where they
// came from. Everything here is synchronous except reading a big file that isn't loaded
// yet (readContent) and saving (saveNow, writeAndSave).

import { unlock } from "./achievements"
import { DEFAULT_ID, currentUserId, onUserRemoved } from "./users"
import { DB_NAME, INLINE_MAX, MIGRATED_KEY, OLD_KEY, byteSize, contentKey, migrateFromLocal, openDriveDb, readMarker, readOldDrive, retireOldDrive } from "./driveStore"

const listeners = new Set()
let notifyQueued = false
let silent = 0 // >0 while building trees (no change events)

// Subscribe to changes; returns an unsubscribe function
export const onFsChange = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// Batched: many changes in one tick (a folder move) are one event
const changed = () => {
  if (silent || notifyQueued) return
  notifyQueued = true
  queueMicrotask(() => {
    notifyQueued = false
    for (const fn of listeners) fn()
  })
}

const quietly = (fn) => {
  silent++
  try {
    return fn()
  } finally {
    silent--
  }
}

export const FILE_TYPE = {
  text: "text",
  executable: "executable",
  note: "note",
  notepad: "notepad",
  internet: "internet",
  dos: "dos",
  tetris: "tetris",
  minesweeper: "minesweeper",
  solitaire: "solitaire",
  freecell: "freecell",
  pinball: "pinball",
  hover: "hover",
  spectra: "spectra",
  chat: "chat",
  video: "video",
  taskmanager: "taskmanager",
  ie: "ie",
  compass: "compass",
  shortcut: "shortcut",
  paint: "paint",
  image: "image", // a picture: its PNG is a data URL in textContent
  media: "media",
  music: "music",
  hearts: "hearts",
  wordpad: "wordpad",
  richtext: "richtext", // a WordPad document: sanitized HTML in textContent
  recorder: "recorder",
  sound: "sound", // a Wave Sound: a 16-bit mono WAV data URL in textContent
  reversi: "reversi",
  chess: "chess",
  checkers: "checkers",
  battleship: "battleship",
  ski: "ski",
  pickleball: "pickleball",
  shred: "shred",
  blockten: "blockten",
  speedtype: "speedtype",
  wordduel: "wordduel",
  lastcard: "lastcard",
  hexlands: "hexlands",
  monsterduel: "monsterduel",
  town: "town",
  puzzle: "puzzle",
  doodle: "doodle",
  quiz: "quiz",
  dollhouse: "dollhouse",
  appward: "appward",
  calc: "calc",
  calendar: "calendar",
  clock: "clock",
  charmap: "charmap",
  mail: "mail",
  homepage: "homepage",
  winpopup: "winpopup",
  camera: "camera",
  photos: "photos",
  addressbook: "addressbook",
  find: "find",
  vcard: "vcard", // a contact card (.vcf): its vCard text in textContent; opens in the Address Book
}

export const DIRECTORY_TYPE = {
  folder: "folder",
  drive: "drive",
  documents: "documents",
  bookmarks: "bookmarks",
  programs: "programs",
  desktop: "desktop",
}

// characters that would break paths (? and * are allowed: the starting files use them)
const INVALID_NAME = /[\\/:"<>|]/

export const validName = (name) => {
  const value = String(name ?? "").trim()
  if (!value) return "A file name can't be blank."
  if (/^[A-Za-z]:$/.test(value)) return null // a drive letter, like C:
  if (INVALID_NAME.test(value)) return 'A file name can\'t contain any of these characters: \\ / : " < > |'
  if (value.length > 64) return "That name is too long."
  return null
}

export class Item {
  #name = ""
  #parent = null
  meta = {} // { deletedFrom, deletedAt, originalName } for items in the Recycle Bin

  constructor(name) {
    if (this.constructor === Item) throw new Error("Item class is Abstract. It can only be extended.")
    this.name = name
  }

  get path() {
    return this.parent ? `${this.parent.path}/${this.name}` : this.name
  }

  get name() {
    return this.#name
  }

  set name(newName) {
    const value = String(newName ?? "").trim()
    const problem = validName(value)
    if (problem) throw new Error(problem)
    if (value === this.#name) return
    if (this.parent && this.parent.hasItem(value)) throw new Error(`There is already an item named "${value}" here.`)
    const parent = this.#parent
    if (parent) parent._rekey(this.#name, value, this)
    this.#name = value
    changed()
  }

  get parent() {
    return this.#parent
  }

  set parent(newParent) {
    if (newParent === this.#parent) return
    const prevParent = this.#parent
    this.#parent = newParent
    if (prevParent) prevParent.removeItem(this.name)
    if (newParent) newParent.insertItem(this)
    changed()
  }

  get isDirectory() {
    return this instanceof Directory
  }
}

export class File extends Item {
  #type = FILE_TYPE.text
  #source = null
  // The contents. A small text lives in _text. A big one (a photo, a sound, a long
  // document) that's been saved lives in IndexedDB under _key and is read when needed:
  // _text is null then, textContent reads from the cache (or starts loading it and
  // returns "" for the moment: use readContent(file) to wait for it).
  _text = ""
  _key = null
  _hash = null // content key of _text, worked out when asked
  _size = null // bytes (null: work it out from _text)
  _thumb = null // a small JPEG data URL of a big picture
  _head = "" // the first characters of a stored text (what kind of data URL it is)
  mtime = Date.now() // last time the contents changed (ms)

  constructor(name = "", type = FILE_TYPE.text, textContent = "", source = null) {
    super(name || "Untitled")
    this.#type = FILE_TYPE[type] ? type : FILE_TYPE.text
    this._text = String(textContent ?? "")
    this.#source = source
  }

  get textContent() {
    if (this._text !== null) return this._text
    return cachedContent(this._key)
  }

  set textContent(content) {
    const value = `${content ?? ""}`
    if (this._text !== null ? value === this._text : contentKey(value) === this._key) return
    this._text = value
    this._key = null
    this._hash = null
    this._size = null
    this._thumb = null
    this.mtime = Date.now()
    if (this.#type === FILE_TYPE.image) queueThumb(this)
    changed()
  }

  // true when textContent can be read right now
  get loaded() {
    return this._text !== null || hasCached(this._key)
  }

  // the content key: the same for files with the same text (sync compares these)
  get contentHash() {
    if (this._text === null) return this._key
    if (this._hash === null) this._hash = contentKey(this._text)
    return this._hash
  }

  // bytes on the drive (a picture counts its JPEG/PNG bytes, not the base64 text)
  get size() {
    if (this._size === null) this._size = byteSize(this._text ?? "")
    return this._size
  }

  // characters in the text, loaded or not (the content key ends with it)
  get textLength() {
    if (this._text !== null) return this._text.length
    return parseInt(String(this._key || "").split("-").pop(), 36) || 0
  }

  // a small preview of a big picture (null for small ones: use textContent)
  get thumb() {
    return this._thumb
  }

  // the start of the contents, loaded or not ("data:image/jpeg;base64,...")
  get head() {
    return this._text !== null ? this._text.slice(0, HEAD_CHARS) : this._head
  }

  get source() {
    return this.#source
  }

  get type() {
    return this.#type
  }

  get isText() {
    return this.#type === FILE_TYPE.text || this.#type === FILE_TYPE.note
  }

  get isImage() {
    return this.#type === FILE_TYPE.image
  }

  // take another file's contents without reading them (they share the stored copy)
  copyContentFrom(other) {
    if (other === this || other.isDirectory) return
    this._text = other._text
    this._key = other._key
    this._hash = other._hash
    this._size = other._size
    this._thumb = other._thumb
    this._head = other._head
    this.mtime = Date.now()
    changed()
  }

  // a copy shares the stored contents (nothing is read or written until one changes)
  get copy() {
    const twin = new File(`${this.name} copy`, this.#type, "", this.#source)
    twin._text = this._text
    twin._key = this._key
    twin._hash = this._hash
    twin._size = this._size
    twin._thumb = this._thumb
    twin._head = this._head
    twin.mtime = this.mtime
    return twin
  }
}

export class Directory extends Item {
  #type = DIRECTORY_TYPE.folder
  #children = new Map()

  constructor(name = "", type) {
    super(name || "New Folder")
    this.#type = DIRECTORY_TYPE[type] ? type : DIRECTORY_TYPE.folder
  }

  get content() {
    return Array.from(this.#children.values())
  }

  get type() {
    return this.#type
  }

  get copy() {
    const dirCopy = new Directory(`${this.name} copy`, this.type)
    for (const item of this.content) {
      const itemCopy = item.copy
      itemCopy.name = item.name
      dirCopy.insertItem(itemCopy)
    }
    return dirCopy
  }

  hasItem(itemName) {
    return this.#children.has(itemName)
  }

  getItem(itemName) {
    return this.#children.get(itemName) || null
  }

  // Returns true if the item is now in this directory, false if the name was taken
  insertItem(item) {
    if (this.#children.get(item.name) === item) return true
    if (this.hasItem(item.name)) return false
    if (item === this) throw new Error("A folder can't contain itself.")
    for (let p = this.parent; p; p = p.parent) if (p === item) throw new Error("A folder can't be moved inside itself.")
    this.#children.set(item.name, item)
    item.parent = this
    changed()
    return true
  }

  removeItem(itemName) {
    const item = this.getItem(itemName)
    if (item) {
      this.#children.delete(itemName)
      item.parent = null
      changed()
    }
    return !this.hasItem(itemName)
  }

  // keep the children map keyed by the new name after a rename (keeps order)
  _rekey(oldName, newName, item) {
    const entries = [...this.#children.entries()].map(([k, v]) => (k === oldName && v === item ? [newName, v] : [k, v]))
    this.#children = new Map(entries)
  }
}

// "New Folder" -> "New Folder (2)" if taken
export const uniqueName = (dir, base) => {
  if (!dir.hasItem(base)) return base
  const dot = base.lastIndexOf(".")
  const [stem, ext] = dot > 0 ? [base.slice(0, dot), base.slice(dot)] : [base, ""]
  for (let i = 2; ; i++) {
    const candidate = `${stem} (${i})${ext}`
    if (!dir.hasItem(candidate)) return candidate
  }
}

export class FileSystem {
  #self = new Directory("root")
  #currentDirectory = this.#self
  #currentDirectoryPath = [this.#currentDirectory]
  recycleBin = new Directory("Recycle Bin")

  get currentDirectory() {
    return this.#currentDirectory
  }

  get currentDirectoryPath() {
    return this.#currentDirectoryPath.map((dir) => `${dir.name}`)
  }

  get root() {
    return this.#self
  }

  get content() {
    return this.currentDirectory.content
  }

  // ---- path helpers (each window keeps its own folder; nothing global) ----

  // ["C:", "Documents"] or "C:\\Documents" or "C:/Documents" -> Directory | File | null
  resolve(path) {
    const parts = Array.isArray(path) ? path : String(path).split(/[\\/]+/).filter(Boolean)
    let node = this.root
    for (const part of parts) {
      if (!node.isDirectory) return null
      const next = node.getItem(part) || node.content.find((c) => c.name.toLowerCase() === String(part).toLowerCase())
      if (!next) return null
      node = next
    }
    return node
  }

  // Item -> ["C:", "Documents"]
  partsOf(item) {
    const parts = []
    for (let node = item; node && node !== this.root; node = node.parent) parts.unshift(node.name)
    return parts
  }

  // Item -> "C:\\Documents\\notes"
  displayPath(item) {
    const parts = this.partsOf(item)
    if (!parts.length) return ""
    return parts.length === 1 ? `${parts[0]}\\` : parts.join("\\")
  }

  createFileIn(dir, name, type = FILE_TYPE.text, text = "") {
    const file = new File(name, type, text)
    if (!dir.insertItem(file)) throw new Error(`There is already an item named "${name}" here.`)
    return file
  }

  createDirectoryIn(dir, name, type = DIRECTORY_TYPE.folder) {
    const folder = new Directory(name, type)
    if (!dir.insertItem(folder)) throw new Error(`There is already an item named "${name}" here.`)
    return folder
  }

  // ---- Recycle Bin ----

  deleteItem(item) {
    if (!item.parent || item.parent === this.root || item.type === DIRECTORY_TYPE.drive) throw new Error("This item can't be deleted.")
    const from = this.displayPath(item.parent)
    const originalName = item.name
    item.parent.removeItem(item.name)
    item.meta = { deletedFrom: from, deletedAt: Date.now(), originalName }
    item.name = uniqueName(this.recycleBin, originalName)
    this.recycleBin.insertItem(item)
  }

  // Back where it came from (recreating the folder if it's gone); returns the folder
  restoreItem(item) {
    const { deletedFrom, originalName } = item.meta
    let dir = this.resolve(deletedFrom || "C:")
    if (!dir || !dir.isDirectory) {
      dir = this.root.getItem("C:")
      for (const part of String(deletedFrom || "").split("\\").slice(1).filter(Boolean)) {
        dir = dir.getItem(part)?.isDirectory ? dir.getItem(part) : this.createDirectoryIn(dir, part)
      }
    }
    this.recycleBin.removeItem(item.name)
    item.name = uniqueName(dir, originalName || item.name)
    item.meta = {}
    dir.insertItem(item)
    return dir
  }

  deleteForever(item) {
    this.recycleBin.removeItem(item.name)
  }

  emptyRecycleBin() {
    if (this.recycleBin.content.length) unlock("recycle")
    for (const item of this.recycleBin.content) this.recycleBin.removeItem(item.name)
  }

  // ---- search ----

  findAllItemsByQuery(query, fromDirectory = this.root) {
    const q = String(query).toLowerCase()
    const out = []
    const walk = (dir) => {
      for (const item of dir.content) {
        if (item.name.toLowerCase().includes(q)) out.push(item)
        if (item.isDirectory) walk(item)
      }
    }
    walk(fromDirectory)
    return out
  }

  findItem(predicate, fromDirectory = this.root) {
    const test = typeof predicate === "function" ? predicate : (item) => item.name === predicate
    for (const item of fromDirectory.content) {
      if (test(item)) return item
      if (item.isDirectory) {
        const found = this.findItem(test, item)
        if (found) return found
      }
    }
    return null
  }

  // ---- older cwd-based API (kept for compatibility) ----

  openDirectory(path) {
    const dir = this.resolve(String(path).replace(/^root\/?/, ""))
    if (!dir || !dir.isDirectory) return null
    this.#currentDirectory = dir
    const chain = []
    for (let node = dir; node; node = node.parent) chain.unshift(node)
    this.#currentDirectoryPath = chain
    return dir
  }

  goBack() {
    if (this.#currentDirectoryPath.length > 1) {
      this.#currentDirectoryPath.pop()
      this.#currentDirectory = this.#currentDirectoryPath.at(-1)
    }
    return this.#currentDirectory
  }

  goBackToDirectory(dirName) {
    const index = this.currentDirectoryPath.lastIndexOf(dirName)
    if (index < 0) return
    this.#currentDirectoryPath = this.#currentDirectoryPath.slice(0, index + 1)
    this.#currentDirectory = this.#currentDirectoryPath.at(-1)
    return this.#currentDirectory
  }

  createFile(fileName, ...options) {
    return this.createFileIn(this.currentDirectory, fileName, ...options)
  }

  createDirectory(name, type) {
    return this.createDirectoryIn(this.currentDirectory, name, type)
  }

  getItem(itemName) {
    return this.currentDirectory.getItem(itemName)
  }
}

// ---------- the starting files ----------

const README_TEXT = `98ish:

A simulated operating system in a nostalgic style.
by Brandon Taylor and Cameron De Robertis.

Tech Stack:
- React,
- Bootstrap,
- 98.css`

// WordPad's sample document (the same kind of HTML WordPad saves)
const WELCOME_DOC = [
  '<p style="text-align: center"><font face="Georgia" style="font-size: 24pt" color="#000080"><b>Welcome to WordPad</b></font></p>',
  '<p style="text-align: center"><i>Your 98ish word processor</i></p>',
  "<p><br></p>",
  "<p>WordPad does what Notepad can't: <b>bold</b>, <i>italic</i>, <u>underline</u>, <s>strikeout</s>, and text in ",
  '<font color="#ff0000">red</font>, <font color="#008000">green</font> or <font color="#0000ff">blue</font>. ',
  'Try <font face="Comic Sans MS">a friendly font</font>, <font face="Courier New">a typewriter</font>, ',
  '<font style="font-size: 16pt">big letters</font> or <font style="font-size: 8pt">small print</font>.</p>',
  "<p><br></p>",
  "<p><b>Things to try:</b></p>",
  "<ul><li>Select some text and pick a font, size or color on the format bar.</li>",
  "<li>Format &gt; Paragraph... indents paragraphs, like the one below.</li>",
  "<li>Insert &gt; Object... drops in a picture you made in Paint.</li>",
  "<li>Insert &gt; Date and Time... stamps today's date.</li>",
  "<li>File &gt; Print Preview shows how your pages will look on paper.</li></ul>",
  "<p><br></p>",
  '<p style="margin-left: 0.5in; margin-right: 0.5in; text-indent: 0.25in"><i>This paragraph is indented half an inch on each side, ',
  "with its first line indented a little more, the way term papers used to look.</i></p>",
  "<p><br></p>",
  '<p style="text-align: right">Have fun!</p>',
].join("")

// [path, kind, type, text]
const DEFAULT_ITEMS = [
  ["C:", "dir", "drive"],
  ["C:/Documents", "dir", "documents"],
  ["C:/Documents/Oh wow!", "file", "text"],
  ["C:/Documents/Look at that", "file", "text"],
  ["C:/Documents/Isn't that something?", "file", "text"],
  ["C:/Documents/Sure is", "file", "text"],
  ["C:/Desktop", "dir", "desktop"],
  ["C:/Programs", "dir", "programs"],
  ["C:/Programs/SPECTRA", "file", "spectra"],
  ["C:/Programs/Internet Explorer", "file", "ie"],
  ["C:/Programs/Tetris", "file", "tetris"],
  ["C:/Programs/Task Manager", "file", "taskmanager"],
  ["C:/Programs/Hover", "file", "hover"],
  ["C:/Programs/YouTube '98", "file", "video"],
  ["C:/Programs/Notepad", "file", "notepad"],
  ["C:/Programs/Paint", "file", "paint"],
  ["C:/Programs/WordPad", "file", "wordpad"],
  ["C:/Programs/Sound Recorder", "file", "recorder"],
  ["C:/Documents/Welcome to WordPad", "file", "richtext", WELCOME_DOC],
  ["C:/Programs/Minesweeper", "file", "minesweeper"],
  ["C:/Programs/Solitaire", "file", "solitaire"],
  ["C:/Programs/FreeCell", "file", "freecell"],
  ["C:/Programs/Pinball", "file", "pinball"],
  ["C:/Programs/98 Messenger", "file", "chat"],
  ["C:/Programs/MS-DOS Prompt", "file", "dos"],
  ["C:/Programs/Media Player", "file", "media"],
  // the Media Player's songs (textContent is the song id)
  ["C:/My Music", "dir", "folder"],
  ...[
    ["STARTUP.MID", "startup"],
    ["HIGHWAY.MID", "highway"],
    ["FUSION.MID", "fusion"],
    ["NEONPOP.MID", "neonpop"],
    ["RAINDAY.MID", "ballad"],
    ["8BITRUN.MID", "chiptune"],
    ["NEBULA.MID", "ambient"],
    ["GROOVE.MID", "funky"],
  ].map(([name, id]) => [`C:/My Music/${name}`, "file", "music", id]),
  ["C:/Programs/Hearts", "file", "hearts"],
  ["C:/Programs/Reversi", "file", "reversi"],
  ["C:/Programs/Chess", "file", "chess"],
  ["C:/Programs/Checkers", "file", "checkers"],
  ["C:/Programs/Battleship", "file", "battleship"],
  ["C:/Programs/Downhill", "file", "ski"],
  ["C:/Programs/Pickleball", "file", "pickleball"],
  ["C:/Programs/Shred 98", "file", "shred"],
  ["C:/Programs/Block Ten", "file", "blockten"],
  ["C:/Programs/Speed Typist 98", "file", "speedtype"],
  ["C:/Programs/Word Duel", "file", "wordduel"],
  ["C:/Programs/Last Card", "file", "lastcard"],
  ["C:/Programs/Hexlands", "file", "hexlands"],
  ["C:/Programs/Monster Duel", "file", "monsterduel"],
  ["C:/Programs/Sunny Acres", "file", "town"],
  ["C:/Programs/Photo Puzzle", "file", "puzzle"],
  ["C:/Programs/Doodle Together", "file", "doodle"],
  ["C:/Programs/Lovebirds Quiz Show", "file", "quiz"],
  ["C:/Programs/Dream House", "file", "dollhouse"],
  ["C:/Programs/Appward 98", "file", "appward"],
  ["C:/Programs/Calculator", "file", "calc"],
  ["C:/Programs/Calendar", "file", "calendar"],
  ["C:/Programs/Clock", "file", "clock"],
  ["C:/Programs/Character Map", "file", "charmap"],
  ["C:/Programs/98ish Mail", "file", "mail"],
  ["C:/Programs/HomePage Studio", "file", "homepage"],
  ["C:/Programs/WinPopup", "file", "winpopup"],
  ["C:/Programs/Camera", "file", "camera"],
  ["C:/Programs/Photos", "file", "photos"],
  ["C:/Programs/Address Book", "file", "addressbook"],
  ["C:/Programs/Compass", "file", "compass"],
  // Camera saves here; Photos opens here
  ["C:/My Pictures", "dir", "folder"],
  ["C:/Bookmarks", "dir", "bookmarks"],
  ...["AOL", "Yahoo", "Tim Tang", "Ask Jeeves", "Geocities", "eBay", "IMDb", "Chit Chat", "ReDirector", "98ish Guestbook"].map((n) => [`C:/Bookmarks/${n}`, "file", "internet"]),
  ["C:/Hello World", "file", "text", "Hello World!"],
  ["C:/README", "file", "note", README_TEXT],
  ["C:/Cover Letter", "file", "text"],
  // a secret for the curious (an achievement)
  ["C:/Windows/Temp/~SECRET.TXT", "file", "text", "You found the secret file!\r\n\r\nNobody ever looks in C:\\Windows\\Temp. Except you.\r\nAs a reward, here is a fact: the 98ish floppy drive holds exactly one helper.\r\n\r\n- Floppy"],
]

// add an item at a path, creating missing folders; skips it if the name is taken
const addAt = (fsys, [path, kind, type, text = ""]) => {
  const parts = path.split("/")
  let dir = fsys.root
  for (const part of parts.slice(0, -1)) {
    let next = dir.getItem(part)
    if (!next) {
      next = new Directory(part, "folder")
      dir.insertItem(next)
    }
    if (!next.isDirectory) return
    dir = next
  }
  const name = parts.at(-1)
  if (dir.hasItem(name)) return
  dir.insertItem(kind === "dir" ? new Directory(name, type) : new File(name, type, text))
}

// ---------- saving to this device ----------
//
// The drive is kept in IndexedDB (see driveStore.js for the layout and the move from the
// old localStorage drive). The whole folder tree, with small files inline, is loaded before
// 98ish starts (main.jsx waits for fsReady); big contents are read when something needs
// them and kept in a cache. Every change is saved a moment later (40 ms) in one
// transaction. Without IndexedDB (some private windows) the drive is kept the old way,
// in localStorage (about 5 MB), and storageInfo() says why.

const DEFAULT_PATHS = DEFAULT_ITEMS.map((e) => e[0])
const LOCAL_CAPACITY = 5 * 1024 * 1024 // what browsers let one site keep in localStorage
const THUMB_SIDE = 192
const HEAD_CHARS = 48
const SAVE_DELAY_MS = 40

const browser = typeof window !== "undefined"
const isPhone = browser && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "")
const CACHE_CHARS = (isPhone ? 48 : 160) * 1024 * 1024 // big contents kept in memory

let mode = "memory" // idb | local (old localStorage drive) | unavailable (can't save) | memory
let db = null
let storedKeys = new Set() // content keys saved in IndexedDB
const missingKeys = new Set()
const info = { mode: "memory", ready: false, problem: null, problemText: "", migration: null, justMigrated: false, persisted: null, lastSaveOk: true }
const statusListeners = new Set()
const setInfo = (patch) => {
  Object.assign(info, patch)
  for (const fn of statusListeners) fn({ ...info })
}

// each user's own drive (utils/users.js): the first user keeps the "98ish-drive" database;
// others get "98ish-drive-<id>". The old localStorage drive ("98ish.fs.v1") is already per
// user through the localStorage wrapper (utils/userStorage.js).
const driveDbName = (id = currentUserId()) => (!id || id === DEFAULT_ID ? DB_NAME : `${DB_NAME}-${id}`)
onUserRemoved((id) => {
  try {
    if (typeof indexedDB !== "undefined" && id && id !== DEFAULT_ID) indexedDB.deleteDatabase(driveDbName(id))
  } catch {
    // gone already
  }
})

// { mode, ready, problem: null | "noidb" | "migrate" | "unavailable" | "full", problemText,
//   migration: { at, files, folders, chars } | null, justMigrated, persisted, lastSaveOk }
export const storageInfo = () => ({ ...info })
export const onStorageStatus = (fn) => {
  statusListeners.add(fn)
  return () => statusListeners.delete(fn)
}

export const DISK_FULL = "Drive C: is full. Delete some files you no longer need (and empty the Recycle Bin), then try again."

// ---- big contents, read on demand ----

const contentListeners = new Set()
let contentQueued = false
// Something finished loading (or a thumbnail is ready): windows showing it repaint
export const onFsContent = (fn) => {
  contentListeners.add(fn)
  return () => contentListeners.delete(fn)
}
const contentArrived = () => {
  if (contentQueued) return
  contentQueued = true
  queueMicrotask(() => {
    contentQueued = false
    for (const fn of contentListeners) fn()
  })
}

const cache = new Map() // key -> { text, at }, least recently used first
let cacheChars = 0
const loading = new Map() // key -> Promise<string>

const hasCached = (key) => !!key && cache.has(key)

const keep = (key, text) => {
  const old = cache.get(key)
  if (old) cacheChars -= old.text.length
  cache.delete(key)
  cache.set(key, { text, at: Date.now() })
  cacheChars += text.length
  if (cacheChars <= CACHE_CHARS) return
  // forget the least recently used ones (not anything used in the last 20 seconds, unless
  // the cache is far over: then anything but the newest)
  const now = Date.now()
  const hard = cacheChars > CACHE_CHARS * 2
  for (const [k, entry] of cache) {
    if (cacheChars <= CACHE_CHARS || k === key) break
    if (!hard && now - entry.at < 20_000) continue
    cache.delete(k)
    cacheChars -= entry.text.length
  }
}

const loadKey = (key) => {
  if (!key) return Promise.resolve("")
  const entry = cache.get(key)
  if (entry) return Promise.resolve(entry.text)
  if (loading.has(key)) return loading.get(key)
  const promise = (db ? db.getContent(key) : Promise.resolve(undefined)).then(
    (text) => {
      loading.delete(key)
      if (typeof text !== "string") {
        missingKeys.add(key)
        console.warn("[fs] a file's contents are missing", key)
        return ""
      }
      keep(key, text)
      contentArrived()
      return text
    },
    (error) => {
      loading.delete(key)
      console.warn("[fs] a file couldn't be read", error)
      return ""
    }
  )
  loading.set(key, promise)
  return promise
}

const cachedContent = (key) => {
  if (!key) return ""
  const entry = cache.get(key)
  if (entry) {
    // most recently used goes last
    if (Date.now() - entry.at > 1000) {
      cache.delete(key)
      entry.at = Date.now()
      cache.set(key, entry)
    }
    return entry.text
  }
  if (!missingKeys.has(key)) loadKey(key)
  return ""
}

// true when a file's contents can be read right now (a big file may still be loading)
export const contentReady = (file) => !file || file.isDirectory || file._text !== null || hasCached(file._key)

// A file's contents, waiting for them if they're not loaded yet
export const readContent = (file) => {
  if (!file || file.isDirectory) return Promise.resolve("")
  if (file._text !== null) return Promise.resolve(file._text)
  return loadKey(file._key)
}

// The contents without keeping them in memory afterwards (Backup, sync uploads)
export const peekContent = async (file) => {
  if (!file || file.isDirectory) return ""
  if (file._text !== null) return file._text
  const entry = cache.get(file._key)
  if (entry) return entry.text
  if (loading.has(file._key)) return loading.get(file._key)
  const text = db ? await db.getContent(file._key).catch(() => undefined) : undefined
  return typeof text === "string" ? text : ""
}

// Load a file (or everything in a folder) before using it
export const ensureLoaded = async (item) => {
  if (!item) return
  if (item.isDirectory) {
    for (const child of item.content) await ensureLoaded(child)
  } else await readContent(item)
}

// ---- thumbnails of big pictures (for folder views, Photos, Camera) ----

const thumbQueue = new Set()
let thumbsRunning = false

const makeThumb = (src) =>
  new Promise((resolve) => {
    if (typeof Image === "undefined" || !/^data:image\//.test(src)) return resolve(null)
    const img = new Image()
    img.onload = () => {
      try {
        const w = img.naturalWidth || 1
        const h = img.naturalHeight || 1
        const scale = Math.min(1, THUMB_SIDE / Math.max(w, h))
        const canvas = document.createElement("canvas")
        canvas.width = Math.max(1, Math.round(w * scale))
        canvas.height = Math.max(1, Math.round(h * scale))
        const ctx = canvas.getContext("2d")
        ctx.fillStyle = "#fff"
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.imageSmoothingQuality = "high"
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL("image/jpeg", 0.72))
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = src
  })

const queueThumb = (file) => {
  if (!browser || mode !== "idb") return
  thumbQueue.add(file)
  if (!thumbsRunning) setTimeout(runThumbs, 400)
}

const runThumbs = async () => {
  if (thumbsRunning) return
  thumbsRunning = true
  try {
    while (thumbQueue.size) {
      const file = thumbQueue.values().next().value
      thumbQueue.delete(file)
      if (!file.isImage || file._thumb || !file.parent) continue
      const key = file.contentHash
      const text = await peekContent(file)
      if (text.length <= INLINE_MAX) continue
      const thumb = await makeThumb(text)
      if (thumb && file.contentHash === key) {
        file._thumb = thumb
        contentArrived()
        scheduleSave()
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  } finally {
    thumbsRunning = false
  }
}

// What to show for a picture in a folder view: its thumbnail, or the picture itself when it's
// small or already loaded. null while a big one's thumbnail is still being made (so a folder
// of hundreds of photos never loads them all at once).
export const previewOf = (file) => {
  if (!file || file.isDirectory || !file.isImage) return null
  if (file._thumb) return file._thumb
  if (file._text !== null) return file._text || null
  if (hasCached(file._key)) return cachedContent(file._key)
  if (file.textLength <= INLINE_MAX || mode !== "idb") return file.textContent || null
  queueThumb(file)
  return null
}

// pictures saved before thumbnails existed (or moved from the old drive)
const queueMissingThumbs = (dir) => {
  for (const item of dir.content) {
    if (item.isDirectory) queueMissingThumbs(item)
    else if (item.isImage && !item._thumb && item.size > (INLINE_MAX * 3) / 4) queueThumb(item)
  }
}

// ---- tree <-> saved nodes ----

// An Item -> a saved node. In IndexedDB mode a big text becomes a content key (and is
// added to out.puts if it isn't stored yet).
const nodeOf = (item, out) => {
  if (item.isDirectory) return { k: "d", n: item.name, t: item.type, m: item.meta, c: item.content.map((child) => nodeOf(child, out)) }
  const node = { k: "f", n: item.name, t: item.type, m: item.meta, s: item.size, v: item.mtime }
  if (item._thumb && out.thumbs) node.th = item._thumb
  if (item._text !== null) {
    if (!out.split || item._text.length <= INLINE_MAX) node.x = item._text
    else {
      const key = item.contentHash
      node.h = key
      node.hd = item._text.slice(0, HEAD_CHARS)
      out.refs.add(key)
      if (!storedKeys.has(key)) out.puts.set(key, item._text)
      out.settle.push([item, key])
    }
  } else {
    node.h = item._key
    node.hd = item._head
    out.refs.add(item._key)
  }
  return node
}

// A saved node (new or old shape) -> an Item
const fromNode = (node) => {
  if (node.k === "d") {
    const dir = new Directory(node.n, node.t)
    if (node.m && typeof node.m === "object") dir.meta = node.m
    for (const child of node.c || []) dir.insertItem(fromNode(child))
    return dir
  }
  const file = new File(node.n, node.t, typeof node.x === "string" ? node.x : "")
  if (typeof node.x !== "string" && typeof node.h === "string" && node.h) {
    file._text = null
    file._key = node.h
    file._hash = node.h
    file._head = typeof node.hd === "string" ? node.hd : ""
  }
  if (Number.isFinite(node.s)) file._size = node.s
  file.mtime = Number(node.v) || 0
  if (typeof node.th === "string" && node.th.startsWith("data:image/")) file._thumb = node.th
  if (node.m && typeof node.m === "object") file.meta = node.m
  return file
}

const loadInto = (fsys, saved) =>
  quietly(() => {
    try {
      for (const node of saved.root) fsys.root.insertItem(fromNode(node))
      for (const node of saved.bin || []) fsys.recycleBin.insertItem(fromNode(node))
      // starting files added in later versions (deleted ones stay deleted)
      const seen = new Set(saved.defaults || [])
      for (const entry of DEFAULT_ITEMS) if (!seen.has(entry[0])) addAt(fsys, entry)
      return true
    } catch (error) {
      console.error("[fs] the saved drive couldn't be read", error)
      for (const item of fsys.root.content) fsys.root.removeItem(item.name)
      for (const item of fsys.recycleBin.content) fsys.recycleBin.removeItem(item.name)
      return false
    }
  })

const loadDefaults = (fsys) => quietly(() => DEFAULT_ITEMS.forEach((entry) => addAt(fsys, entry)))

const localStore = () => {
  try {
    return browser ? window.localStorage : null
  } catch {
    return null
  }
}

// ---- saving ----

let saveTimer = null
let saving = Promise.resolve(true)
const testHooks = {} // dev only: { fail(puts) -> true to act like a full disk }

const saveIdb = async () => {
  const out = { split: true, thumbs: true, refs: new Set(), puts: new Map(), settle: [] }
  const index = {
    version: 2,
    root: fs.root.content.map((item) => nodeOf(item, out)),
    bin: fs.recycleBin.content.map((item) => nodeOf(item, out)),
    defaults: DEFAULT_PATHS,
    savedAt: Date.now(),
  }
  const deletes = [...storedKeys].filter((key) => !out.refs.has(key))
  try {
    if (testHooks.fail?.([...out.puts.values()])) throw new DOMException("The drive is full.", "QuotaExceededError")
    await db.commit({ index, puts: [...out.puts], deletes })
  } catch (error) {
    console.warn("[fs] the drive couldn't be saved", error)
    return false
  }
  for (const key of out.puts.keys()) storedKeys.add(key)
  for (const key of deletes) storedKeys.delete(key)
  // saved big texts move from the file into the cache (and can be forgotten later)
  for (const [file, key] of out.settle) {
    if (file._text === null || file.contentHash !== key) continue
    const text = file._text
    file._size = file.size
    file._head = text.slice(0, HEAD_CHARS)
    file._key = key
    file._text = null
    keep(key, text)
  }
  return true
}

const saveLocal = () => {
  const out = { split: false, thumbs: false, refs: new Set(), puts: new Map(), settle: [] }
  try {
    localStore().setItem(
      OLD_KEY,
      JSON.stringify({
        root: fs.root.content.map((item) => nodeOf(item, out)),
        bin: fs.recycleBin.content.map((item) => nodeOf(item, out)),
        defaults: DEFAULT_PATHS,
        savedAt: Date.now(),
      })
    )
    return true
  } catch {
    return false
  }
}

// quiet: the caller tells you itself (writeAndSave's callers show their own message; the
// background save right after one of theirs fails the same way and stays quiet too)
let quietFailAt = 0
const doSave = async ({ quiet = false } = {}) => {
  const ok = mode === "idb" ? await saveIdb() : mode === "local" ? saveLocal() : true
  if (!ok && quiet) quietFailAt = Date.now()
  if (ok && !info.lastSaveOk) setInfo({ lastSaveOk: true, ...(info.problem === "full" ? { problem: null, problemText: "" } : {}) })
  else if (!ok && !quiet && Date.now() - quietFailAt > 3000 && info.problem !== "full") setInfo({ lastSaveOk: false, problem: "full", problemText: DISK_FULL })
  return ok
}

// Save right now. Resolves false if the drive is full (or this browser's storage refuses):
// big files like pictures check this and undo the write, so they can tell you.
export const saveNow = (options) => {
  clearTimeout(saveTimer)
  saveTimer = null
  const run = () => doSave(options)
  saving = saving.then(run, run)
  return saving
}

// Soon after a change: IndexedDB writes started while a page closes are dropped by the
// browser, so the window for losing one must stay tiny (a burst of changes is one save)
const scheduleSave = () => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => saveNow(), SAVE_DELAY_MS)
}

// Write a file's contents and save at once; on a full drive the old contents come back
// (and a file that was just made is removed). Resolves true if it was saved.
export const writeAndSave = async (file, content, { created = false } = {}) => {
  const before = { _text: file._text, _key: file._key, _hash: file._hash, _size: file._size, _thumb: file._thumb, _head: file._head, mtime: file.mtime }
  file.textContent = content
  if (await saveNow({ quiet: true })) return true
  if (created && file.parent) file.parent.removeItem(file.name)
  else {
    Object.assign(file, before)
    changed()
  }
  await saveNow({ quiet: true })
  return false
}

// ---- starting up ----

const requestPersist = async () => {
  try {
    const storage = navigator.storage
    if (!storage?.persist) return setInfo({ persisted: null })
    let persisted = storage.persisted ? await storage.persisted() : false
    if (!persisted) persisted = await storage.persist()
    setInfo({ persisted: !!persisted })
  } catch {
    setInfo({ persisted: null })
  }
}
// Some browsers only grant it after the person has used the page (Firefox asks; Chrome looks
// at engagement; Safari grants it to Home Screen apps): ask once more on the first tap. The
// answer is in storageInfo().persisted, shown in Drive C: Properties and Control Panel >
// Storage, and the "only on this device" notes (shared/KeepSafe.jsx) mention it on iPhone.
if (browser) window.addEventListener("pointerdown", () => info.persisted === false && requestPersist(), { once: true, passive: true })

const start = async () => {
  const storage = localStore()
  const factory = browser && typeof indexedDB !== "undefined" ? indexedDB : null
  db = factory ? await openDriveDb(factory, { name: driveDbName() }) : null
  let index = null
  if (db) {
    try {
      index = await db.getIndex()
    } catch (error) {
      console.warn("[fs] the drive index couldn't be read", error)
      db = null
    }
  }
  let problem = null
  let problemText = ""
  let migration = null
  let justMigrated = false
  if (db && !index) {
    const moved = await migrateFromLocal({ db, storage })
    if (moved.ok) {
      index = moved.index
      migration = { at: moved.at, files: moved.files, folders: moved.folders, chars: moved.chars }
      justMigrated = true
    } else if (!moved.none) {
      // keep using the old drive this time; the next start tries again
      problem = "migrate"
      problemText = moved.error
      db = null
    }
  }
  if (db) {
    mode = "idb"
    try {
      storedKeys = new Set(await db.contentKeys())
    } catch {
      storedKeys = new Set()
    }
    if (index && !loadInto(fs, index)) {
      // a damaged index: show the starting files, and don't save over it
      mode = "unavailable"
      loadDefaults(fs)
      setInfo({ mode, problem: "unavailable", problemText: "98ish couldn't read your files. Changes you make won't be saved. Restart 98ish to try again, or restore a backup." })
      fs.openDirectory("C:")
      return setInfo({ ready: true })
    }
    if (!index) loadDefaults(fs)
    if (!migration) migration = (await db.getMeta("migration").catch(() => null)) || null
    if (storage) retireOldDrive(storage, migration)
    setInfo({ mode, problem: null, migration, justMigrated })
    requestPersist()
    if (!index) saveNow()
    queueMissingThumbs(fs.root)
  } else {
    const marker = storage ? readMarker(storage) : null
    if (marker && !problem) {
      // the drive moved to IndexedDB earlier, but IndexedDB won't open now: show the old
      // copy, and don't save over anything
      mode = "unavailable"
      problem = "unavailable"
      problemText = "98ish couldn't open your files in this browser's storage right now. Changes you make won't be saved. Restart 98ish (reload the page) to try again."
    } else {
      mode = storage ? "local" : "memory"
      if (!problem && browser) {
        problem = "noidb"
        problemText = "This browser isn't letting 98ish use its larger storage (a private window does this), so your files are kept in its small storage: about 5 MB."
      }
    }
    const { drive } = readOldDrive(storage)
    if (!(drive && loadInto(fs, drive))) loadDefaults(fs)
    setInfo({ mode, problem, problemText, migration: marker })
  }
  fs.openDirectory("C:")
  setInfo({ ready: true })
}

export const fs = new FileSystem()

// Resolves once the drive is loaded (main.jsx waits for it before showing anything)
export const fsReady = start().catch((error) => {
  console.error("[fs] starting the drive failed", error)
  if (!fs.root.content.length) loadDefaults(fs)
  fs.openDirectory("C:")
  mode = "memory"
  setInfo({ mode, ready: true, problem: "unavailable", problemText: "98ish couldn't open your files. Changes you make won't be saved. Reload the page to try again." })
})

onFsChange(scheduleSave)
// Leaving: save what's waiting (switching apps on a phone keeps the page alive long enough;
// a closing page may drop it, which is why saves come so soon after changes)
if (browser) {
  window.addEventListener("pagehide", () => saveTimer && saveNow())
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && saveTimer && saveNow())
}

// ---- small records kept with the drive (file sync's bookkeeping) ----

const META_PREFIX = "98ish.drivemeta."

export const readDriveMeta = async (key) => {
  if (mode === "idb") return (await db.getMeta(key).catch(() => null)) ?? null
  try {
    return JSON.parse(localStore()?.getItem(META_PREFIX + key)) ?? null
  } catch {
    return null
  }
}

export const writeDriveMeta = async (key, value) => {
  if (mode === "idb") return db.putMeta(key, value).then(() => true, () => false)
  try {
    if (value === null) localStore()?.removeItem(META_PREFIX + key)
    else localStore()?.setItem(META_PREFIX + key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

// ---- how full is drive C:? ----

export const itemBytes = (item) => (item.isDirectory ? item.content.reduce((sum, child) => sum + itemBytes(child), 0) : item.size)

// -> { mode, used (bytes of files, Recycle Bin included), free, capacity, persisted }
export const driveUsage = async () => {
  const used = itemBytes(fs.root) + itemBytes(fs.recycleBin)
  if (mode === "idb") {
    let estimate = null
    try {
      estimate = await navigator.storage?.estimate?.()
    } catch {
      estimate = null
    }
    if (estimate?.quota) {
      const free = Math.max(0, estimate.quota - (estimate.usage || 0))
      return { mode, used, free, capacity: used + free, persisted: info.persisted }
    }
    return { mode, used, free: null, capacity: null, persisted: info.persisted }
  }
  let chars = 0
  try {
    const storage = localStore()
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      chars += key.length + (storage.getItem(key)?.length || 0)
    }
  } catch {
    // blocked
  }
  return { mode, used, free: Math.max(0, LOCAL_CAPACITY - chars), capacity: LOCAL_CAPACITY, persisted: false }
}

// ---- whole-drive copies (Backup, Restore) ----

const exportNode = async (item) =>
  item.isDirectory
    ? { k: "d", n: item.name, t: item.type, m: item.meta, c: await exportNodes(item.content) }
    : { k: "f", n: item.name, t: item.type, x: await peekContent(item), m: item.meta }
const exportNodes = async (items) => {
  const out = []
  for (const item of items) out.push(await exportNode(item))
  return out
}

// Everything on the drive and in the Recycle Bin with every file's text: { root, bin }
// (the shape backups use)
export const exportDrive = async () => ({ root: await exportNodes(fs.root.content), bin: await exportNodes(fs.recycleBin.content) })

// The same as JSON text, handed out in pieces (one file at a time) so a big drive never
// has to fit in one string: emit(text) is called for each piece
export const writeDriveJson = async (emit) => {
  const J = JSON.stringify
  const writeItems = async (items) => {
    emit("[")
    let first = true
    for (const item of items) {
      if (!first) emit(",")
      first = false
      if (item.isDirectory) {
        emit(`{"k":"d","n":${J(item.name)},"t":${J(item.type)},"m":${J(item.meta || {})},"c":`)
        await writeItems(item.content)
        emit("}")
      } else {
        emit(`{"k":"f","n":${J(item.name)},"t":${J(item.type)},"m":${J(item.meta || {})},"x":`)
        emit(J(await peekContent(item)))
        emit("}")
      }
    }
    emit("]")
  }
  emit('{"root":')
  await writeItems(fs.root.content)
  emit(',"bin":')
  await writeItems(fs.recycleBin.content)
  emit("}")
}

// Counts without reading any contents: { files, folders, recycled, bytes }
export const driveSummary = () => {
  const counts = { files: 0, folders: 0, recycled: fs.recycleBin.content.length, bytes: itemBytes(fs.root) }
  const walk = (dir) => {
    for (const item of dir.content) {
      if (item.isDirectory) {
        if (item.type !== DIRECTORY_TYPE.drive) counts.folders++
        walk(item)
      } else counts.files++
    }
  }
  walk(fs.root)
  return counts
}

// Saved folders and files made back into items (not added anywhere yet); throws if one is damaged
export const itemsFromNodes = (nodes) => quietly(() => nodes.map(fromNode))

const replaceAll = (root, bin) =>
  quietly(() => {
    for (const item of fs.root.content) fs.root.removeItem(item.name)
    for (const item of fs.recycleBin.content) fs.recycleBin.removeItem(item.name)
    for (const item of root) fs.root.insertItem(item)
    for (const item of bin) fs.recycleBin.insertItem(item)
    fs.openDirectory("C:")
  })

// Replace everything with a copy from exportDrive(). Nothing changes if it can't be read;
// resolves false (with everything put back) if it doesn't fit.
export const importDrive = async (drive) => {
  const root = itemsFromNodes(drive.root)
  const bin = itemsFromNodes(drive.bin || [])
  if (!root.some((item) => item.isDirectory && item.name === "C:")) throw new Error("There is no drive C: in it.")
  const before = { root: fs.root.content, bin: fs.recycleBin.content }
  replaceAll(root, bin)
  changed()
  if (await saveNow({ quiet: true })) {
    queueMissingThumbs(fs.root)
    return true
  }
  replaceAll(before.root, before.bin)
  changed()
  await saveNow()
  return false
}

// Delete My Account with "also erase this device's files": stop saving, close the database
// and delete this person's drive (IndexedDB, plus the old localStorage drive and the sync
// bookkeeping kept beside it). The page reloads right after, onto a fresh drive.
export const eraseThisDrive = async () => {
  await saving.catch(() => {})
  clearTimeout(saveTimer)
  saveTimer = null
  const open = db
  mode = "memory"
  db = null
  try {
    open?.close()
  } catch {
    // closed already
  }
  try {
    const storage = localStore()
    storage?.removeItem(OLD_KEY)
    storage?.removeItem(MIGRATED_KEY)
  } catch {
    // blocked
  }
  if (typeof indexedDB === "undefined") return true
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(driveDbName())
      request.onsuccess = () => resolve(true)
      request.onerror = () => resolve(false)
      request.onblocked = () => setTimeout(() => resolve(false), 1500)
    } catch {
      resolve(false)
    }
  })
}

// For tests: wipe back to the starting files
export const resetFileSystem = () => {
  quietly(() => {
    for (const item of fs.root.content) fs.root.removeItem(item.name)
    for (const item of fs.recycleBin.content) fs.recycleBin.removeItem(item.name)
    for (const entry of DEFAULT_ITEMS) addAt(fs, entry)
  })
  changed()
}

// Dev-only handle for browser tests (also in a production build made with VITE_TEST_HOOKS=1, for
// tests that need the service worker; the real deploy never sets it)
if (browser && (import.meta.env?.DEV || import.meta.env?.VITE_TEST_HOOKS === "1")) {
  window.__drive = {
    fs,
    info: storageInfo,
    ready: fsReady,
    saveNow,
    writeAndSave,
    readContent,
    exportDrive,
    driveUsage,
    driveSummary,
    storedKeys: () => [...storedKeys],
    cacheInfo: () => ({ entries: cache.size, chars: cacheChars }),
    forget: () => {
      cache.clear()
      cacheChars = 0
    },
    failSaves: (fn) => (testHooks.fail = fn || null),
    find: (path) => fs.resolve(path),
  }
}
