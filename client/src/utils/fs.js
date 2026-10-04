// The 98ish file system: a tree of Directories and Files under a root that holds the C:
// drive. It's saved to this device (localStorage) and every change is announced through
// onFsChange so open windows (My Computer, Notepad, MS-DOS Prompt) stay in sync.
// Deleting moves items to the Recycle Bin, which remembers where they came from.

import { unlock } from "./achievements"
import { userKey } from "./users"

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
  #textContent = ""
  #source = null

  constructor(name = "", type = FILE_TYPE.text, textContent = "", source = null) {
    super(name || "Untitled")
    this.#type = FILE_TYPE[type] ? type : FILE_TYPE.text
    this.#textContent = String(textContent ?? "")
    this.#source = source
  }

  get textContent() {
    return this.#textContent
  }

  set textContent(content) {
    const value = `${content ?? ""}`
    if (value === this.#textContent) return
    this.#textContent = value
    changed()
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

  get copy() {
    return new File(`${this.name} copy`, this.#type, this.#textContent, this.#source)
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

// each user's own drive (utils/users.js: the default user keeps "98ish.fs.v1")
const STORAGE_KEY = userKey("98ish.fs.v1")

const serialize = (item) =>
  item.isDirectory
    ? { k: "d", n: item.name, t: item.type, m: item.meta, c: item.content.map(serialize) }
    : { k: "f", n: item.name, t: item.type, x: item.textContent, m: item.meta }

const deserialize = (node) => {
  const item = node.k === "d" ? new Directory(node.n, node.t) : new File(node.n, node.t, node.x)
  if (node.m && typeof node.m === "object") item.meta = node.m
  if (node.k === "d") for (const child of node.c || []) item.insertItem(deserialize(child))
  return item
}

const load = (fsys) => {
  let saved = null
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
  } catch {
    saved = null
  }
  quietly(() => {
    if (saved && Array.isArray(saved.root)) {
      try {
        for (const node of saved.root) fsys.root.insertItem(deserialize(node))
        for (const node of saved.bin || []) fsys.recycleBin.insertItem(deserialize(node))
        // starting files added in later versions (deleted ones stay deleted)
        const seen = new Set(saved.defaults || [])
        for (const entry of DEFAULT_ITEMS) if (!seen.has(entry[0])) addAt(fsys, entry)
        return
      } catch {
        for (const item of fsys.root.content) fsys.root.removeItem(item.name)
        for (const item of fsys.recycleBin.content) fsys.recycleBin.removeItem(item.name)
      }
    }
    for (const entry of DEFAULT_ITEMS) addAt(fsys, entry)
  })
}

// true if saved; false if the browser's storage is full or unavailable (then changes
// last for this visit only)
const save = (fsys) => {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        root: fsys.root.content.map(serialize),
        bin: fsys.recycleBin.content.map(serialize),
        defaults: DEFAULT_ITEMS.map((e) => e[0]),
      })
    )
    return true
  } catch {
    return false
  }
}

export const fs = new FileSystem()
load(fs)
fs.openDirectory("C:")

let saveTimer = null
onFsChange(() => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => save(fs), 250)
})
// Don't lose the last quarter second of typing when the tab closes
if (typeof window !== "undefined") window.addEventListener("pagehide", () => save(fs))

// Save right now. False means the drive (this browser's storage) is full: big files like
// pictures check this and undo the write, so they can tell you instead of losing it later.
export const saveNow = () => {
  clearTimeout(saveTimer)
  return save(fs)
}

// Write a file's contents and save at once; on a full drive the old contents come back
// (and a file that was just made is removed). Returns true if it was saved.
export const writeAndSave = (file, content, { created = false } = {}) => {
  const before = file.textContent
  file.textContent = content
  if (saveNow()) return true
  if (created && file.parent) file.parent.removeItem(file.name)
  else file.textContent = before
  saveNow()
  return false
}

// ---- whole-drive copies (Backup and the online drive) ----

// Everything on the drive and in the Recycle Bin, in the shape it's saved in
export const exportDrive = () => ({ root: fs.root.content.map(serialize), bin: fs.recycleBin.content.map(serialize) })

// Saved folders and files made back into items (not added anywhere yet); throws if one is damaged
export const itemsFromNodes = (nodes) => nodes.map(deserialize)

// Replace everything with a copy from exportDrive(). Nothing changes if it can't be read.
export const importDrive = (drive) => {
  const root = quietly(() => itemsFromNodes(drive.root))
  const bin = quietly(() => itemsFromNodes(drive.bin || []))
  if (!root.some((item) => item.isDirectory && item.name === "C:")) throw new Error("There is no drive C: in it.")
  quietly(() => {
    for (const item of fs.root.content) fs.root.removeItem(item.name)
    for (const item of fs.recycleBin.content) fs.recycleBin.removeItem(item.name)
    for (const item of root) fs.root.insertItem(item)
    for (const item of bin) fs.recycleBin.insertItem(item)
    fs.openDirectory("C:")
  })
  changed()
  return saveNow()
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
