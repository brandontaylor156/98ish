// Every program in 98ish: its icon, window size, whether it sits on the desktop, its Start
// menu group, the file type that opens it, and whether only one copy can run (single:
// opening it again brings the open one forward, like Task Manager in Windows). Windows are
// opened with windowFor() or the helpers below so every window payload has the same shape.
// online: the game's id on the online room system (components/shared/online): invitations
// and ?join= links open this program.

import { PROJECTS } from "./projects"

export const programs = [
  { name: "SPECTRA", type: "spectra", icon: "/assets/program_icons/spectra.svg", width: 860, height: 600, group: "Games", single: true },
  { name: "Tetris", type: "tetris", icon: "/assets/program_icons/tetris3-48.png", width: 600, height: 600, group: "Games", single: true },
  { name: "Internet Explorer", app: "ie", type: "ie", icon: "/assets/internet_explorer.png", width: 900, height: 640, group: "Internet" },
  { name: "Task Manager", type: "taskmanager", icon: "/assets/program_icons/taskManager-48.png", width: 430, height: 480, group: "System Tools", single: true },
  { name: "Hover", type: "hover", icon: "/assets/program_icons/hover2-48.png", width: 600, height: 600, group: "Entertainment", single: true },
  { name: "Media Player", app: "media", type: "media", icon: "/assets/program_icons/mediaplayer.svg", width: 440, height: 560, group: "Entertainment", desktop: false, single: true },
  { name: "YouTube '98", type: "video", icon: "/assets/program_icons/video-48.png", width: 820, height: 620, group: "Internet", single: true },
  { name: "My Computer", app: "explorer", icon: "/assets/program_icons/computer_explorer.png", width: 640, height: 440, group: null },
  { name: "Notepad", app: "notepad", type: "notepad", icon: "/assets/note.png", width: 520, height: 420, group: "Accessories" },
  { name: "Solitaire", app: "solitaire", type: "solitaire", icon: "/assets/program_icons/solitaire.svg", width: 620, height: 500, group: "Games", desktop: false, single: true },
  { name: "FreeCell", app: "freecell", type: "freecell", icon: "/assets/program_icons/freecell.svg", width: 640, height: 520, group: "Games", desktop: false, single: true },
  { name: "WordPad", app: "wordpad", type: "wordpad", icon: "/assets/program_icons/wordpad.svg", width: 640, height: 480, group: "Accessories", desktop: false },
  { name: "Sound Recorder", app: "recorder", type: "recorder", icon: "/assets/program_icons/recorder.svg", width: 340, height: 250, group: "Entertainment", desktop: false },
  { name: "Paint", app: "paint", type: "paint", icon: "/assets/program_icons/paint.svg", width: 700, height: 540, group: "Accessories", desktop: false },
  { name: "Pinball", app: "pinball", type: "pinball", icon: "/assets/program_icons/pinball.svg", width: 620, height: 740, group: "Games", desktop: false, single: true },
  { name: "Minesweeper", type: "minesweeper", icon: "/assets/program_icons/mine-48.png", width: 373, height: 456, group: "Games", single: true },
  { name: "98 Messenger", type: "chat", icon: "/assets/program_icons/aim2-48.png", width: 260, height: 520, group: "Internet", single: true },
  { name: "Network Neighborhood", app: "network", icon: "/assets/program_icons/network.svg", width: 560, height: 420, group: null, single: true },
  { name: "Hearts", app: "net-hearts", type: "hearts", icon: "/assets/program_icons/hearts.svg", width: 660, height: 560, group: "Games", desktop: false, single: true },
  { name: "WinPopup", app: "net-popup", type: "winpopup", icon: "/assets/program_icons/winpopup.svg", width: 360, height: 300, group: "Accessories", desktop: false, single: true },
  { name: "Recycle Bin", app: "recycle", icon: "/assets/recycle_bin_empty.png", width: 560, height: 380, group: null, single: true },
  { name: "MS-DOS Prompt", app: "dos", type: "dos", icon: "/assets/dos.png", width: 640, height: 400, group: "Accessories", desktop: false },
  { name: "Windows Update", app: "update", icon: "/assets/program_icons/update.svg", width: 540, height: 440, group: null, desktop: false, single: true },
  { name: "Display Properties", app: "display", icon: "/assets/vaporwave.png", width: 420, height: 470, group: null, desktop: false, single: true },
  { name: "Calculator", app: "calc", type: "calc", icon: "/assets/program_icons/calc.svg", width: 270, height: 272, group: "Accessories", desktop: false },
  { name: "Character Map", app: "charmap", type: "charmap", icon: "/assets/program_icons/charmap.svg", width: 610, height: 280, group: "System Tools", desktop: false, single: true },
  { name: "Backup", app: "backup", icon: "/assets/program_icons/backup.svg", width: 420, height: 460, group: "System Tools", desktop: false, single: true },
  { name: "Date/Time Properties", app: "datetime", icon: "/assets/program_icons/datetime.svg", width: 420, height: 370, group: null, desktop: false, single: true },
  { name: "Desktop Themes", app: "themes", icon: "/assets/program_icons/themes.svg", width: 560, height: 500, group: null, desktop: false, single: true },
  { name: "System Properties", app: "sysprops", icon: "/assets/program_icons/computer_explorer.png", width: 420, height: 470, group: null, desktop: false, single: true },
  { name: "98ish Mail", app: "mail", type: "mail", icon: "/assets/program_icons/mail.svg", width: 760, height: 540, group: "Internet", desktop: false, single: true },
  { name: "HomePage Studio", app: "homepage", type: "homepage", icon: "/assets/program_icons/homepage.svg", width: 940, height: 620, group: "Internet", desktop: false, single: true },
  // from the Start menu these play against the computer; Network Neighborhood opens network games
  { name: "Reversi", app: "net-reversi", type: "reversi", icon: "/assets/program_icons/reversi.svg", width: 420, height: 560, group: "Games", desktop: false, single: true },
  { name: "Chess", app: "net-chess", type: "chess", icon: "/assets/program_icons/chess.svg", width: 700, height: 580, group: "Games", desktop: false, single: true },
  // online rooms (Quick Match, codes, the computer); Network Neighborhood invitations open their own match windows
  { name: "Checkers", app: "net-checkers", type: "checkers", icon: "/assets/program_icons/checkers.svg", width: 460, height: 580, group: "Games", desktop: false, single: true, online: "checkers" },
  { name: "Battleship", app: "net-battleship", type: "battleship", icon: "/assets/program_icons/battleship.svg", width: 660, height: 500, group: "Games", desktop: false, single: true },
  // Brandon's other web apps (utils/projects.js), each in its own window
  ...PROJECTS.map((p) => ({ name: p.name, app: "webapp", icon: p.icon, width: 1000, height: 680, group: "My Projects", single: true })),
  { name: "Pickleball 98", app: "pickleball", type: "pickleball", icon: "/assets/program_icons/pickleball.svg", width: 900, height: 640, group: "Games", desktop: false, single: true },
  { name: "Shred 98", app: "shred", type: "shred", icon: "/assets/program_icons/shred.svg", width: 940, height: 660, group: "Games", desktop: false, single: true },
  { name: "Downhill", app: "ski", type: "ski", icon: "/assets/program_icons/ski.svg", width: 640, height: 520, group: "Games", desktop: false, single: true },
  { name: "Word Duel", app: "wordduel", type: "wordduel", icon: "/assets/program_icons/wordduel.svg", width: 560, height: 690, group: "Games", desktop: false, single: true, online: "wordduel" },
  { name: "Block Ten", app: "blockten", type: "blockten", icon: "/assets/program_icons/blockten.svg", width: 440, height: 640, group: "Games", desktop: false, single: true },
  { name: "Sunny Acres", app: "town", type: "town", icon: "/assets/program_icons/town.svg", width: 860, height: 620, group: "Games", desktop: false, single: true },
  { name: "Photo Puzzle", app: "puzzle", type: "puzzle", icon: "/assets/program_icons/puzzle.svg", width: 820, height: 600, group: "Us", desktop: false, single: true },
  { name: "Doodle Together", app: "doodle", type: "doodle", icon: "/assets/program_icons/doodle.svg", width: 780, height: 640, group: "Us", desktop: false, single: true },
  { name: "Lovebirds Quiz Show", app: "quiz", type: "quiz", icon: "/assets/program_icons/quiz.svg", width: 560, height: 620, group: "Us", desktop: false, single: true },
  // couples (utils/couple.js): Us is on the desktop once you're paired ("paired")
  { name: "Us", app: "us", icon: "/assets/program_icons/us.svg", width: 540, height: 540, group: "Us", desktop: "paired", single: true },
  { name: "Love Letters", app: "loveletters", icon: "/assets/program_icons/loveletters.svg", width: 720, height: 580, group: "Us", desktop: false, single: true },
  { name: "Our Story", app: "ourstory", icon: "/assets/program_icons/ourstory.svg", width: 760, height: 620, group: "Us", desktop: false, single: true },
  { name: "Dream House", app: "dollhouse", type: "dollhouse", icon: "/assets/program_icons/dollhouse.svg", width: 900, height: 640, group: "Us", desktop: false, single: true },
  // an unofficial retro tribute to Appward (appward.com): a business suite as a 1998 client
  { name: "Appward 98", app: "appward", type: "appward", icon: "/assets/program_icons/appward.svg", width: 980, height: 660, group: "Business", desktop: true, single: true },
  { name: "Our Pet", app: "pet", icon: "/assets/program_icons/pet.svg", width: 480, height: 660, group: "Us", desktop: false, single: true },
]

// The desktop shows these (MS-DOS Prompt and Display Properties live in the Start menu)
export const desktopPrograms = programs.filter((p) => p.desktop !== false)

export const programByName = (name) => programs.find((p) => p.name === name) || null
export const programByType = (type) => programs.find((p) => p.type === type) || null

// The window payload the window manager expects, for a program plus anything extra
// (a file for Notepad, a folder for My Computer, a URL for Internet Explorer...)
export const windowFor = (program, extra = {}) => ({
  name: program.name,
  program: program.name, // what Task Manager calls it, whatever the title bar says
  app: program.app,
  minimized: false,
  maximized: false,
  active: true,
  closed: false,
  width: program.width,
  height: program.height,
  positionX: 10,
  positionY: 0,
  icon_url: program.icon,
  ...extra,
})

export const launch = (name, extra) => windowFor(programByName(name), extra)

// An Internet Explorer window, optionally opening a page (as of the date IE is set to)
export const ieWindow = (url) => launch("Internet Explorer", { url })

// My Computer, opened at a folder: ["C:", "Documents"] (empty = the My Computer view)
export const explorerWindow = (path = []) => launch("My Computer", { path })

// Notepad, optionally editing a file from the file system
export const notepadWindow = (file = null) => launch("Notepad", { file })

// Paint, optionally editing a picture from the file system
export const paintWindow = (file = null) => launch("Paint", { file })

// WordPad, optionally editing a document (rich text or plain text)
export const wordpadWindow = (file = null) => launch("WordPad", { file })

// Sound Recorder, optionally opening a Wave Sound
export const recorderWindow = (file = null) => launch("Sound Recorder", { file })

// Media Player, optionally playing a song (its id or file name, like "HIGHWAY.MID")
export const mediaPlayerWindow = (song = null) => launch("Media Player", { song })
