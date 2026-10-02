// Every program in 98ish: its icon, window size, whether it sits on the desktop, its Start
// menu group, and the file type that opens it. Windows are opened with windowFor() or the
// helpers below so every window payload has the same shape.

export const programs = [
  { name: "SPECTRA", type: "spectra", icon: "/assets/program_icons/spectra.svg", width: 860, height: 600, group: "Games" },
  { name: "Tetris", type: "tetris", icon: "/assets/program_icons/tetris3-48.png", width: 600, height: 600, group: "Games" },
  { name: "Internet Explorer", app: "ie", type: "ie", icon: "/assets/internet_explorer.png", width: 900, height: 640, group: "Internet" },
  { name: "Task Manager", type: "taskmanager", icon: "/assets/program_icons/taskManager-48.png", width: 430, height: 480, group: "System Tools" },
  { name: "Hover", type: "hover", icon: "/assets/program_icons/hover2-48.png", width: 600, height: 600, group: "Entertainment" },
  { name: "Media Player", app: "media", type: "media", icon: "/assets/program_icons/mediaplayer.svg", width: 440, height: 560, group: "Entertainment", desktop: false },
  { name: "YouTube '98", type: "video", icon: "/assets/program_icons/video-48.png", width: 820, height: 620, group: "Internet" },
  { name: "My Computer", app: "explorer", icon: "/assets/program_icons/computer_explorer.png", width: 640, height: 440, group: null },
  { name: "Notepad", app: "notepad", type: "notepad", icon: "/assets/note.png", width: 520, height: 420, group: "Accessories" },
  { name: "Solitaire", app: "solitaire", type: "solitaire", icon: "/assets/program_icons/solitaire.svg", width: 620, height: 500, group: "Games", desktop: false },
  { name: "FreeCell", app: "freecell", type: "freecell", icon: "/assets/program_icons/freecell.svg", width: 640, height: 520, group: "Games", desktop: false },
  { name: "Paint", app: "paint", type: "paint", icon: "/assets/program_icons/paint.svg", width: 700, height: 540, group: "Accessories", desktop: false },
  { name: "Minesweeper", type: "minesweeper", icon: "/assets/program_icons/mine-48.png", width: 373, height: 456, group: "Games" },
  { name: "98 Messenger", type: "chat", icon: "/assets/program_icons/aim2-48.png", width: 260, height: 520, group: "Internet" },
  { name: "Network Neighborhood", app: "network", icon: "/assets/program_icons/network.svg", width: 560, height: 420, group: null },
  { name: "Hearts", app: "net-hearts", type: "hearts", icon: "/assets/program_icons/hearts.svg", width: 660, height: 560, group: "Games", desktop: false },
  { name: "WinPopup", app: "net-popup", type: "winpopup", icon: "/assets/program_icons/winpopup.svg", width: 360, height: 300, group: "Accessories", desktop: false },
  { name: "Recycle Bin", app: "recycle", icon: "/assets/recycle_bin_empty.png", width: 560, height: 380, group: null },
  { name: "MS-DOS Prompt", app: "dos", type: "dos", icon: "/assets/dos.png", width: 640, height: 400, group: "Accessories", desktop: false },
  { name: "Windows Update", app: "update", icon: "/assets/program_icons/update.svg", width: 540, height: 440, group: null, desktop: false },
  { name: "Display Properties", app: "display", icon: "/assets/vaporwave.png", width: 420, height: 470, group: null, desktop: false },
  { name: "Calculator", app: "calc", type: "calc", icon: "/assets/program_icons/calc.svg", width: 270, height: 272, group: "Accessories", desktop: false },
  { name: "Character Map", app: "charmap", type: "charmap", icon: "/assets/program_icons/charmap.svg", width: 610, height: 280, group: "System Tools", desktop: false },
  { name: "Date/Time Properties", app: "datetime", icon: "/assets/program_icons/datetime.svg", width: 420, height: 370, group: null, desktop: false },
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

// Media Player, optionally playing a song (its id or file name, like "HIGHWAY.MID")
export const mediaPlayerWindow = (song = null) => launch("Media Player", { song })
