import { fs, validName, FILE_TYPE, readContent } from "../../../utils/fs"
import { now } from "../../../utils/clock"
import { programs } from "../../../utils/programs"
import { unlock } from "../../../utils/achievements"

// The MS-DOS Prompt's command interpreter, kept apart from the screen so it can be tested
// on its own. run(line, shell) returns { out: [lines], cls, exit, open: [...] } and may
// change shell.cwd / shell.color.

export const VERSION = "Windows 98ish [Version 4.10.1998]"

const HELP = {
  CD: "Displays the name of or changes the current directory.\n\nCD [drive:][path]\nCD ..\n\n  ..   Changes to the parent directory.",
  CLS: "Clears the screen.",
  COLOR: "Sets the console colors.\n\nCOLOR [attr]\n\n  attr  Two hex digits: the first is the background, the second the text.\n        0 = Black  1 = Blue  2 = Green  3 = Aqua  4 = Red  5 = Purple\n        6 = Yellow 7 = White 8 = Gray   9 = Light Blue  A = Light Green\n        B = Light Aqua  C = Light Red  D = Light Purple  E = Light Yellow\n        F = Bright White\n\nExample: COLOR 0A",
  COPY: "Copies one or more files to another location.\n\nCOPY source destination",
  DATE: "Displays the date.",
  DEL: "Deletes one or more files. Wildcards (* and ?) work.\n\nDEL [drive:][path]filename\n\nDeleted files are gone for good: they skip the Recycle Bin.",
  DELTREE: "Deletes a directory and everything in it.\n\nDELTREE [drive:]path",
  DIR: "Displays a list of files and subdirectories in a directory.\n\nDIR [drive:][path][filename] [/W]\n\n  /W   Uses wide list format.",
  ECHO: "Displays messages.\n\nECHO [message]\n\nUse > to write the output to a file: ECHO hello > hello.txt",
  EDIT: "Opens a file in Notepad, creating it if it doesn't exist.\n\nEDIT [drive:][path]filename",
  EXIT: "Quits the MS-DOS Prompt.",
  HELP: "Provides help for commands, or opens 98ish Help for a program.\n\nHELP [command]\nHELP program\n\nExamples: HELP DIR   HELP TETRIS\n\nWINHELP opens 98ish Help.",
  MD: "Creates a directory.\n\nMD [drive:]path",
  MEM: "Displays the amount of used and free memory.",
  MOVE: "Moves a file or directory.\n\nMOVE source destination",
  REN: "Renames a file or directory.\n\nREN [drive:][path]name newname",
  RD: "Removes an empty directory.\n\nRD [drive:]path",
  START: "Opens a program, folder, document or web address.\n\nSTART name\n\nExamples: START TETRIS   START C:\\Documents   START www.geocities.com",
  TIME: "Displays the time.",
  TREE: "Graphically displays the folder structure of a drive or path.\n\nTREE [drive:][path] [/F]\n\n  /F   Displays the names of the files in each folder.",
  TYPE: "Displays the contents of a text file.\n\nTYPE [drive:][path]filename",
  VER: "Displays the version.",
  VOL: "Displays the disk volume label.",
}
HELP.CHDIR = HELP.CD
HELP.MKDIR = HELP.MD
HELP.RMDIR = HELP.RD
HELP.ERASE = HELP.DEL
HELP.RENAME = HELP.REN
HELP.NOTEPAD = HELP.EDIT
HELP.MORE = HELP.TYPE

const COMMAND_LIST = [
  ["CD", "Displays or changes the current directory."],
  ["CLS", "Clears the screen."],
  ["COLOR", "Sets the text and background colors."],
  ["COPY", "Copies files."],
  ["DATE", "Displays the date."],
  ["DEL", "Deletes files (for good)."],
  ["DELTREE", "Deletes a directory and all of its contents."],
  ["DIR", "Lists the files in a directory."],
  ["ECHO", "Displays messages."],
  ["EDIT", "Edits a text file in Notepad."],
  ["EXIT", "Quits the MS-DOS Prompt."],
  ["HELP", "Shows help for a command (HELP DIR) or a program (HELP TETRIS)."],
  ["MD", "Creates a directory."],
  ["MEM", "Displays memory usage."],
  ["MOVE", "Moves files and directories."],
  ["RD", "Removes an empty directory."],
  ["REN", "Renames a file or directory."],
  ["START", "Opens a program, folder, file or web address."],
  ["TIME", "Displays the time."],
  ["TREE", "Shows the folder structure."],
  ["TYPE", "Displays a text file."],
  ["VER", "Displays the Windows version."],
  ["VOL", "Displays the disk volume label."],
]

// Program names you can type: TETRIS, WINMINE, NOTEPAD...
export const ALIASES = {
  tetris: "Tetris",
  sol: "Solitaire",
  mspaint: "Paint",
  pbrush: "Paint",
  freecell: "FreeCell",
  pinball: "Pinball",
  winmine: "Minesweeper",
  minesweeper: "Minesweeper",
  mines: "Minesweeper",
  notepad: "Notepad",
  wordpad: "WordPad",
  write: "WordPad",
  sndrec32: "Sound Recorder",
  sndrec: "Sound Recorder",
  iexplore: "Internet Explorer",
  compass: "Compass",
  browser: "Compass",
  web: "Compass",
  www: "Compass",
  ie: "Internet Explorer",
  explorer: "My Computer",
  spectra: "SPECTRA",
  hover: "Hover",
  taskmgr: "Task Manager",
  aim: "98 Messenger",
  messenger: "98 Messenger",
  mplayer: "Media Player",
  mplayer2: "YouTube '98",
  youtube: "YouTube '98",
  command: "MS-DOS Prompt",
  desk: "Display Properties",
  "desk.cpl": "Display Properties",
  control: "Control Panel",
  controlpanel: "Control Panel",
  "access.cpl": "Accessibility Options",
  access: "Accessibility Options",
  accessibility: "Accessibility Options",
  "appwiz.cpl": "Add/Remove Programs",
  appwiz: "Add/Remove Programs",
  mouse: "Mouse",
  "intl.cpl": "Regional Settings",
  regional: "Regional Settings",
  "inetcpl.cpl": "Internet Options",
  inetcpl: "Internet Options",
  fonts: "Fonts",
  "powercfg.cpl": "Power Management",
  power: "Power Management",
  "mmsys.cpl": "Sounds",
  sounds: "Sounds",
  storage: "Storage",
  magnify: "Magnifier",
  magnifier: "Magnifier",
  recycled: "Recycle Bin",
  backup: "Backup",
  msbackup: "Backup",
  calc: "Calculator",
  calendar: "Calendar",
  cal: "Calendar",
  calndr: "Calendar",
  winhelp: "98ish Help",
  winhlp32: "98ish Help",
  hh: "98ish Help",
  helptopics: "98ish Help",
  notes: "Notes",
  stickies: "Notes",
  stikynot: "Notes",
  tasks: "Tasks",
  todo: "Tasks",
  wab: "Address Book",
  addrbook: "Address Book",
  addressbook: "Address Book",
  contacts: "Address Book",
  find: "Find",
  search: "Find",
  weather: "Weather",
  forecast: "Weather",
  clock: "Clock",
  alarm: "Clock",
  timer: "Clock",
  stopwatch: "Clock",
  charmap: "Character Map",
  welcome: "Welcome to 98ish",
  timedate: "Date/Time Properties",
  "timedate.cpl": "Date/Time Properties",
  keyboard: "Keyboard Properties",
  "main.cpl": "Keyboard Properties",
  osk: "Keyboard Properties",
  passwords: "Passwords",
  "password.cpl": "Passwords",
  users: "Passwords",
  themes: "Desktop Themes",
  "themes.cpl": "Desktop Themes",
  "sysdm.cpl": "System Properties",
  msimn: "98ish Mail",
  us: "Us",
  letters: "Love Letters",
  story: "Our Story",
  pet: "Our Pet",
  mail: "98ish Mail",
  frontpg: "HomePage Studio",
  homepage: "HomePage Studio",
  reversi: "Reversi",
  othello: "Reversi",
  chess: "Chess",
  checkers: "Checkers",
  battleship: "Battleship",
  ski: "Downhill",
  downhill: "Downhill",
  pickleball: "Pickleball 98",
  speedtype: "Speed Typist 98",
  typist: "Speed Typist 98",
  typing: "Speed Typist 98",
  wordduel: "Word Duel",
  words: "Word Duel",
  hexlands: "Hexlands",
  hex: "Hexlands",
  shred: "Shred 98",
  shred98: "Shred 98",
  guitar: "Shred 98",
  lastcard: "Last Card",
  cards: "Last Card",
  monsterduel: "Monster Duel",
  monsters: "Monster Duel",
  mduel: "Monster Duel",
  blockten: "Block Ten",
  tenten: "Block Ten",
  blocks: "Block Ten",
  boomfrenzy: "Boom Frenzy",
  boom: "Boom Frenzy",
  bombs: "Boom Frenzy",
  colormatch: "Color Match",
  colors: "Color Match",
  echopads: "Echo Pads",
  pads: "Echo Pads",
  zapit: "Zap It!",
  zap: "Zap It!",
  tetherball: "Tetherball",
  tether: "Tetherball",
  town: "Sunny Acres",
  acres: "Sunny Acres",
  farm: "Sunny Acres",
  camera: "Camera",
  cam: "Camera",
  webcam: "Camera",
  photobooth: "Camera",
  photos: "Photos",
  pictures: "Photos",
  imaging: "Photos",
  slideshow: "Photos",
  puzzle: "Photo Puzzle",
  jigsaw: "Photo Puzzle",
  doodle: "Doodle Together",
  draw: "Doodle Together",
  quiz: "Lovebirds Quiz Show",
  lovebirds: "Lovebirds Quiz Show",
  quizshow: "Lovebirds Quiz Show",
  dollhouse: "Dream House",
  appward: "Appward 98",
  appward98: "Appward 98",
  dreamhouse: "Dream House",
  house: "Dream House",
}

export const programFor = (word) => {
  const bare = word.toLowerCase().replace(/^"|"$/g, "").replace(/\.(exe|com|bat)$/, "")
  const name = ALIASES[bare] || programs.find((p) => p.name.toLowerCase().replace(/[^a-z0-9]/g, "") === bare.replace(/[^a-z0-9]/g, ""))?.name
  return name ? programs.find((p) => p.name === name) : null
}

// ---- words and paths ----

// split on spaces, keeping "quoted names" together
export const tokenize = (text) => {
  const out = []
  const re = /"([^"]*)"?|(\S+)/g
  let m
  while ((m = re.exec(text))) out.push(m[1] ?? m[2])
  return out
}

// "..\\Games", "\\Documents", "C:\\x" relative to cwd -> parts array
export const toParts = (arg, cwd) => {
  let rest = String(arg)
  let parts
  const drive = rest.match(/^([a-z]):/i)
  if (drive) {
    rest = rest.slice(2)
    parts = /^[\\/]/.test(rest) || drive[1].toUpperCase() + ":" !== cwd[0] ? [drive[1].toUpperCase() + ":"] : [...cwd]
  } else if (/^[\\/]/.test(rest)) parts = [cwd[0]]
  else parts = [...cwd]
  for (const seg of rest.split(/[\\/]+/)) {
    if (!seg || seg === ".") continue
    if (/^\.{2,}$/.test(seg)) {
      // ".." up one, "..." up two (a Windows 98 trick)
      for (let i = 1; i < seg.length && parts.length > 1; i++) parts.pop()
      continue
    }
    parts.push(seg)
  }
  return parts
}

const resolveArg = (arg, cwd) => fs.resolve(toParts(arg, cwd))

const hasWild = (s) => /[*?]/.test(s)
const globRe = (pattern) =>
  new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i")

// "*.txt" or "C:\\Documents\\*" -> { dir, matches }
const expand = (arg, cwd) => {
  const parts = toParts(arg, cwd)
  const last = parts.at(-1)
  if (!hasWild(last)) {
    const item = fs.resolve(parts)
    return { dir: item?.parent || fs.resolve(parts.slice(0, -1)), matches: item ? [item] : [] }
  }
  const dir = fs.resolve(parts.slice(0, -1))
  if (!dir?.isDirectory) return { dir: null, matches: [] }
  const re = globRe(last === "*.*" ? "*" : last)
  return { dir, matches: dir.content.filter((c) => re.test(c.name)) }
}

// ---- 8.3 names, sizes, dates (for DIR) ----

const shortNames = (items) => {
  const used = new Map()
  const names = new Map()
  for (const item of items) {
    const clean = item.name.toUpperCase().replace(/[^A-Z0-9.!#$%&'()\-@^_`{}~]/g, "")
    const dot = item.isDirectory ? -1 : clean.lastIndexOf(".")
    let stem = dot > 0 ? clean.slice(0, dot) : clean.replace(/\./g, "")
    const ext = dot > 0 ? clean.slice(dot + 1).replace(/\./g, "").slice(0, 3) : ""
    stem = stem || "FILE"
    const lossy = stem.length > 8 || clean !== item.name.toUpperCase().replace(/\s+$/, "")
    if (lossy) {
      const base = stem.slice(0, 6)
      const n = (used.get(base + ext) || 0) + 1
      used.set(base + ext, n)
      stem = `${base}~${n}`
    }
    names.set(item, [stem, ext])
  }
  return names
}

export const sizeOf = (item) => (item.isDirectory ? item.content.reduce((s, c) => s + sizeOf(c), 0) : item.size)
const commas = (n) => n.toLocaleString("en-US")

const stamp = (d = new Date(1998, 5, 25, 20, 1)) => {
  const p = (n) => String(n).padStart(2, "0")
  const h = d.getHours() % 12 || 12
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getFullYear() % 100)}  ${String(h).padStart(2)}:${p(d.getMinutes())}${d.getHours() < 12 ? "a" : "p"}`
}

const FREE_BYTES = 1_998_069_760

// ---- the commands ----

const dir = (args, shell) => {
  const wide = args.some((a) => /^\/w$/i.test(a))
  const target = args.find((a) => !a.startsWith("/")) || "."
  let folder = resolveArg(target, shell.cwd)
  let filter = null
  if (!folder || !folder.isDirectory) {
    const { dir: parent, matches } = expand(target, shell.cwd)
    if (!parent || !matches.length) return ["", " Volume in drive C is 98ISH", " Volume Serial Number is 1998-0625", "File not found"]
    folder = parent
    filter = new Set(matches)
  }
  const items = folder.content.filter((c) => !filter || filter.has(c))
  const names = shortNames(folder.content)
  const out = ["", " Volume in drive C is 98ISH", " Volume Serial Number is 1998-0625", ` Directory of ${fs.displayPath(folder)}`, ""]
  const isRoot = fs.partsOf(folder).length === 1
  const rows = []
  if (!filter && !isRoot) rows.push({ dot: "." }, { dot: ".." })
  rows.push(...items)
  if (wide) {
    const cells = rows.map((r) => {
      if (r.dot) return `[${r.dot}]`
      const [stem, ext] = names.get(r)
      const n = ext ? `${stem}.${ext}` : stem
      return r.isDirectory ? `[${n}]` : n
    })
    for (let i = 0; i < cells.length; i += 5) out.push(cells.slice(i, i + 5).map((c) => c.padEnd(16)).join("").trimEnd())
  } else {
    for (const r of rows) {
      if (r.dot) {
        out.push(`${r.dot.padEnd(13)}<DIR>        ${stamp()} ${r.dot}`)
        continue
      }
      const [stem, ext] = names.get(r)
      const size = r.isDirectory ? "<DIR>       " : commas(sizeOf(r)).padStart(12)
      out.push(`${stem.padEnd(8)} ${ext.padEnd(3)} ${size} ${stamp(r.meta?.modified ? new Date(r.meta.modified) : undefined)} ${r.name}`)
    }
  }
  const files = items.filter((i) => !i.isDirectory)
  const dirs = rows.length - files.length
  out.push(`${String(files.length).padStart(9)} file(s)  ${commas(files.reduce((s, f) => s + sizeOf(f), 0)).padStart(14)} bytes`)
  out.push(`${String(dirs).padStart(9)} dir(s)   ${commas(FREE_BYTES).padStart(14)} bytes free`)
  return out
}

const tree = (args, shell) => {
  const withFiles = args.some((a) => /^\/f$/i.test(a))
  const target = args.find((a) => !a.startsWith("/")) || "."
  const folder = resolveArg(target, shell.cwd)
  if (!folder?.isDirectory) return ["Invalid path - " + target.toUpperCase()]
  const out = ["Folder PATH listing for volume 98ISH", "Volume serial number is 1998-0625", fs.displayPath(folder)]
  const walk = (dirItem, prefix) => {
    const kids = dirItem.content.filter((c) => withFiles || c.isDirectory)
    kids.forEach((kid, i) => {
      const last = i === kids.length - 1
      if (kid.isDirectory) {
        out.push(`${prefix}${last ? "\u2514\u2500\u2500\u2500" : "\u251c\u2500\u2500\u2500"}${kid.name}`)
        walk(kid, prefix + (last ? "    " : "\u2502   "))
      } else out.push(`${prefix}${kids.slice(i).some((k) => k.isDirectory) ? "\u2502   " : "    "}${kid.name}`)
    })
  }
  walk(folder, "")
  if (out.length === 3) out.push("No subfolders exist")
  return out
}

const destination = (src, destArg, cwd) => {
  // into an existing folder, or as a new name
  const target = resolveArg(destArg, cwd)
  if (target?.isDirectory) return { dir: target, name: src.name }
  const parts = toParts(destArg, cwd)
  const dirItem = fs.resolve(parts.slice(0, -1))
  if (!dirItem?.isDirectory) return null
  return { dir: dirItem, name: parts.at(-1), existing: target }
}

const copyOrMove = (args, shell, move) => {
  const [srcArg, destArg = "."] = args.filter((a) => !a.startsWith("/"))
  if (!srcArg) return ["Required parameter missing"]
  const { matches } = expand(srcArg, shell.cwd)
  const sources = move ? matches : matches.filter((m) => !m.isDirectory)
  if (!sources.length) return [matches.length ? "Can't copy a directory with COPY. Use MOVE, or copy the files inside it." : `File not found - ${srcArg}`]
  const out = []
  let done = 0
  for (const src of sources) {
    const dest = destination(src, destArg, shell.cwd)
    if (!dest) return [...out, "Invalid directory"]
    const problem = validName(dest.name)
    if (problem) return [...out, problem]
    if (dest.existing === src || (dest.dir === src.parent && dest.name === src.name)) {
      out.push("File cannot be copied onto itself")
      continue
    }
    if (move) {
      try {
        for (let p = dest.dir; p; p = p.parent) if (p === src) throw new Error("Cannot move a directory into itself")
        if (dest.existing) {
          if (dest.existing.isDirectory) throw new Error(`${dest.name} already exists`)
          dest.dir.removeItem(dest.existing.name)
        }
        src.parent.removeItem(src.name)
        src.name = dest.name
        dest.dir.insertItem(src)
        out.push(`${fs.displayPath(dest.dir).replace(/\\$/, "")}\\${src.name} [ok]`)
        done++
      } catch (error) {
        out.push(error.message)
      }
    } else {
      if (dest.existing && !dest.existing.isText && dest.existing.type !== src.type) {
        out.push(`${dest.name} is a program; not overwritten`)
        continue
      }
      // the copy shares the stored contents (a big picture isn't read to copy it)
      if (dest.existing && !dest.existing.isDirectory) dest.existing.copyContentFrom(src)
      else fs.createFileIn(dest.dir, dest.name, src.type, "").copyContentFrom(src)
      if (sources.length > 1) out.push(src.name)
      done++
    }
  }
  if (!move) out.push(`${String(done).padStart(9)} file(s) copied`)
  return out
}

// Turns `> file` / `>> file` at the end of a line into a redirect
const splitRedirect = (line) => {
  const m = line.match(/^(.*?)\s*(>>?)\s*("[^"]+"|[^>\s]+)\s*$/)
  if (!m || !m[1].trim()) return { line, redirect: null }
  return { line: m[1], redirect: { append: m[2] === ">>", target: m[3].replace(/^"|"$/g, "") } }
}

const COLORS = "000000 000080 008000 008080 800000 800080 808000 c0c0c0 808080 0000ff 00ff00 00ffff ff0000 ff00ff ffff00 ffffff".split(" ").map((c) => "#" + c)

export const run = (input, shell) => {
  const result = { out: [], open: [] }
  const raw = input.trim()
  if (!raw) return result
  const { line, redirect } = splitRedirect(raw)

  // "cd.." and "cd\" work without a space, as in DOS
  const m = line.match(/^([a-z]:|cd|chdir|md|rd|echo|dir|type)(?=[.\\/]|$)(.*)$/i) || line.match(/^(\S+)\s*(.*)$/)
  const cmd = m[1].toLowerCase()
  const rest = m[2].trim()
  const args = tokenize(rest)
  let out = []

  switch (cmd) {
    case "cls":
      return { ...result, cls: true }
    case "exit":
      return { ...result, exit: true }
    case "win":
      return { ...result, exit: true, win: true }
    case "ver":
      out = ["", VERSION, ""]
      unlock("dos-ver")
      break
    case "vol":
      out = [" Volume in drive C is 98ISH", " Volume Serial Number is 1998-0625"]
      break
    case "help":
    case "/?":
      if (args[0] && HELP[args[0].toUpperCase()]) out = HELP[args[0].toUpperCase()].split("\n")
      else if (args[0] && programFor(args.join(" "))) {
        // a program: its page in 98ish Help
        const program = programFor(args.join(" ")).name
        out = [`Opening 98ish Help for ${program}...`]
        result.open.push({ help: { program } })
      } else if (args[0]) out = [`No help for ${args.join(" ").toUpperCase()}. Type HELP for the list of commands, or WINHELP for 98ish Help.`]
      else
        out = [
          "For more information on a command, type HELP command-name",
          ...COMMAND_LIST.map(([c, d]) => c.padEnd(10) + d),
          "",
          "You can also type a program's name to run it: TETRIS, WINMINE, NOTEPAD, SPECTRA...",
          "For help with Windows 98ish itself, type WINHELP.",
        ]
      break
    case "echo":
      if (rest === "." || rest.startsWith(".")) out = [rest.slice(1)]
      else out = [rest || "ECHO is on"]
      break
    case "date":
      out = [`Current date is ${now().toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" }).replace(",", "")}`]
      break
    case "time":
      out = [`Current time is ${now().toLocaleTimeString("en-US", { hour12: false })}`]
      break
    case "mem":
      out = [
        "",
        "Memory Type        Total  =   Used  +   Free",
        "----------------  -------   -------   -------",
        "Conventional         640K       38K      602K",
        "Upper                  0K        0K        0K",
        "Extended (XMS)   130,048K   47,104K   82,944K",
        "",
        "Largest executable program size        602K (616,448 bytes)",
        "MS-DOS is resident in the high memory area.",
      ]
      break
    case "color": {
      const attr = (args[0] || "07").toLowerCase()
      if (!/^[0-9a-f]{1,2}$/.test(attr)) {
        out = HELP.COLOR.split("\n")
        break
      }
      const [bg, fg] = attr.length === 1 ? ["0", attr] : attr
      if (bg === fg) {
        out = ["The text and background can't be the same color."]
        break
      }
      shell.color = { bg: COLORS[parseInt(bg, 16)], fg: COLORS[parseInt(fg, 16)] }
      break
    }
    case "cd":
    case "chdir": {
      if (!rest) {
        out = [fs.displayPath(fs.resolve(shell.cwd))]
        break
      }
      const item = resolveArg(rest.replace(/^"|"$/g, ""), shell.cwd)
      if (!item) out = ["Invalid directory"]
      else if (!item.isDirectory) out = ["Invalid directory"]
      else shell.cwd = fs.partsOf(item)
      break
    }
    case "dir":
      out = dir(args, shell)
      break
    case "tree":
      out = tree(args, shell)
      unlock("dos-tree")
      break
    // the secret word (not in HELP)
    case "xyzzy":
      out = ["A puff of orange smoke drifts out of the floppy drive.", "Nothing else happens. Or does it?"]
      unlock("xyzzy")
      break
    case "type":
    case "more": {
      if (!args[0]) {
        out = ["Required parameter missing"]
        break
      }
      const item = resolveArg(args[0], shell.cwd)
      if (!item) out = [`File not found - ${args[0]}`]
      else if (item.isDirectory) out = ["Access denied"]
      else if (!item.isText && item.type !== "internet") out = [`${item.name} is a program. Type its name to run it.`]
      else if (!item.loaded) {
        readContent(item)
        out = ["Reading the file from the disk... Type the command again in a moment."]
      } else out = (item.textContent || "").replace(/\r/g, "").split("\n")
      if (item?.name === "~SECRET.TXT") unlock("hidden-file")
      break
    }
    case "md":
    case "mkdir": {
      if (!args[0]) {
        out = ["Required parameter missing"]
        break
      }
      const parts = toParts(args[0], shell.cwd)
      const parent = fs.resolve(parts.slice(0, -1))
      const problem = validName(parts.at(-1))
      if (!parent?.isDirectory) out = ["Unable to create directory"]
      else if (problem) out = [problem]
      else if (parent.getItem(parts.at(-1)) || fs.resolve(parts)) out = ["Unable to create directory: it already exists"]
      else fs.createDirectoryIn(parent, parts.at(-1))
      break
    }
    case "rd":
    case "rmdir":
    case "deltree": {
      const target = args.find((a) => !a.startsWith("/"))
      if (!target) {
        out = ["Required parameter missing"]
        break
      }
      const item = resolveArg(target, shell.cwd)
      const all = cmd === "deltree" || args.some((a) => /^\/s$/i.test(a))
      if (!item?.isDirectory) out = ["Invalid path, not directory,", "or directory not empty"]
      else if (fs.partsOf(item).length <= 1) out = ["Access denied"]
      else if (item.content.length && !all) out = ["Invalid path, not directory,", "or directory not empty"]
      else {
        // inside the folder being removed? step out of it first
        const inside = fs.partsOf(item).every((p, i) => shell.cwd[i]?.toLowerCase() === p.toLowerCase())
        if (inside) shell.cwd = fs.partsOf(item.parent)
        if (cmd === "deltree") out = [`Deleting ${item.name}...`]
        item.parent.removeItem(item.name)
      }
      break
    }
    case "del":
    case "erase": {
      const target = args.find((a) => !a.startsWith("/"))
      if (!target) {
        out = ["Required parameter missing"]
        break
      }
      const { matches } = expand(target, shell.cwd)
      const item = !hasWild(target) && matches[0]
      // DEL folder deletes the files inside it
      const files = item?.isDirectory ? item.content.filter((c) => !c.isDirectory) : matches.filter((c) => !c.isDirectory)
      if (!matches.length) out = ["File not found"]
      else if (!files.length) out = item?.isDirectory ? ["File not found"] : ["Access denied"]
      else for (const f of files) f.parent.removeItem(f.name)
      break
    }
    case "ren":
    case "rename": {
      const [from, to] = args
      if (!from || !to) {
        out = ["Required parameter missing"]
        break
      }
      const item = resolveArg(from, shell.cwd)
      const problem = validName(to)
      if (!item || fs.partsOf(item).length <= 1) out = ["File not found"]
      else if (/[\\/]/.test(to)) out = ["Invalid parameter: the new name can't include a path"]
      else if (problem) out = [problem]
      else if (item.parent.getItem(to) && item.parent.getItem(to) !== item) out = ["Duplicate file name or file not found"]
      else {
        const wasCwd = fs.partsOf(item)
        item.name = to
        if (wasCwd.every((p, i) => shell.cwd[i]?.toLowerCase() === p.toLowerCase())) shell.cwd = [...fs.partsOf(item), ...shell.cwd.slice(wasCwd.length)]
      }
      break
    }
    case "copy":
      out = copyOrMove(args, shell, false)
      break
    case "move":
      out = copyOrMove(args, shell, true)
      break
    case "edit":
    case "notepad":
    case "notepad.exe":
    case "edit.com": {
      if (!args[0]) {
        result.open.push({ program: "Notepad" })
        break
      }
      let item = resolveArg(args[0], shell.cwd)
      if (item?.isDirectory) {
        out = ["Access denied"]
        break
      }
      if (item && !item.isText) {
        out = [`${item.name} is a program, not a text file.`]
        break
      }
      if (!item) {
        const parts = toParts(args[0], shell.cwd)
        const parent = fs.resolve(parts.slice(0, -1))
        const problem = validName(parts.at(-1))
        if (!parent?.isDirectory) {
          out = ["Path not found"]
          break
        }
        if (problem) {
          out = [problem]
          break
        }
        item = fs.createFileIn(parent, parts.at(-1), FILE_TYPE.text, "")
      }
      result.open.push({ file: item })
      break
    }
    case "start": {
      const target = rest.replace(/^"|"$/g, "")
      if (!target) {
        result.open.push({ program: "MS-DOS Prompt" })
        break
      }
      if (/^(https?:\/\/|www\.)/i.test(target) || /^[\w-]+\.(com|net|org|edu|gov)(\/|$)/i.test(target)) {
        result.open.push({ url: /^https?:/i.test(target) ? target : "http://" + target })
        break
      }
      const item = resolveArg(target, shell.cwd)
      if (item) result.open.push({ item })
      else if (programFor(target)) result.open.push({ program: programFor(target).name })
      else out = [`Cannot find the file '${target}' (or one of its components).`]
      break
    }
    default: {
      // a drive letter
      if (/^[a-z]:$/.test(cmd)) {
        if (cmd.toUpperCase() !== "C:") out = [cmd === "a:" ? "Not ready reading drive A\nAbort, Retry, Fail?F" : "Invalid drive specification"].flatMap((s) => s.split("\n"))
        break
      }
      // a program on the drive or a known program name
      const item = resolveArg(m[1], shell.cwd)
      if (item && !item.isDirectory && !item.isText) {
        result.open.push({ item })
        break
      }
      const program = programFor(m[1])
      if (program) {
        result.open.push(program.app === "ie" && rest ? { url: rest } : { program: program.name })
        break
      }
      out = ["Bad command or file name"]
    }
  }

  if (redirect) {
    const parts = toParts(redirect.target, shell.cwd)
    const parent = fs.resolve(parts.slice(0, -1))
    const existing = fs.resolve(parts)
    const text = out.join("\r\n") + "\r\n"
    if (!parent?.isDirectory) return { ...result, out: ["Path not found"] }
    if (existing?.isDirectory) return { ...result, out: ["Access denied"] }
    if (existing && !existing.isText) return { ...result, out: ["Access denied"] }
    if (existing && redirect.append && !existing.loaded) {
      readContent(existing)
      return { ...result, out: ["Reading the file from the disk... Type the command again in a moment."] }
    }
    const problem = validName(parts.at(-1))
    if (problem) return { ...result, out: [problem] }
    if (existing) existing.textContent = redirect.append ? existing.textContent + text : text
    else fs.createFileIn(parent, parts.at(-1), FILE_TYPE.text, text)
    return result
  }

  return { ...result, out }
}

export const promptFor = (cwd) => `${fs.displayPath(fs.resolve(cwd) || fs.resolve("C:")).replace(/\\$/, "")}${cwd.length === 1 ? "\\" : ""}>`

// Tab completion: the next name in the current folder that starts with what's typed
export const complete = (input, shell, cycle = 0) => {
  const m = input.match(/^(.*?\s)?("?)([^"\s]*)$/)
  if (!m) return null
  const [, before = "", , word] = m
  const slash = Math.max(word.lastIndexOf("\\"), word.lastIndexOf("/"))
  const dirPart = slash >= 0 ? word.slice(0, slash + 1) : ""
  const stem = word.slice(slash + 1).toLowerCase()
  const folder = dirPart ? resolveArg(dirPart, shell.cwd) : fs.resolve(shell.cwd)
  if (!folder?.isDirectory) return null
  const hits = folder.content.filter((c) => c.name.toLowerCase().startsWith(stem))
  if (!hits.length) return null
  const pick = hits[cycle % hits.length].name
  const full = dirPart + pick
  return before + (/\s/.test(full) ? `"${full}"` : full)
}
