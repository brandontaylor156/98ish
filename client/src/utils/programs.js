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
  // the real Web (tabs, bookmarks, history), through the 98ish server's relay (server/web)
  { name: "Compass", app: "compass", type: "compass", icon: "/assets/program_icons/compass.svg", width: 980, height: 680, group: "Internet" },
  { name: "Task Manager", type: "taskmanager", icon: "/assets/program_icons/taskManager-48.png", width: 430, height: 480, group: "System Tools", single: true },
  { name: "Hover", type: "hover", icon: "/assets/program_icons/hover2-48.png", width: 600, height: 600, group: "Games", single: true },
  { name: "Media Player", app: "media", type: "media", icon: "/assets/program_icons/mediaplayer.svg", width: 440, height: 560, group: "Entertainment", desktop: false, single: true },
  // your own songs (C:\My Music), Windows Media Player 7 style (applets/music)
  { name: "Music 98", app: "musiclib", type: "musiclib", icon: "/assets/program_icons/music98.svg", width: 520, height: 640, group: "Entertainment", desktop: false, single: true },
  // a YouTube video in sync with an IM buddy or a chat room (applets/together, server/aim/together.js)
  { name: "Watch Together", app: "together", type: "together", icon: "/assets/program_icons/together.svg", width: 520, height: 680, group: "Internet", also: ["Entertainment", "Together", "Us"], desktop: false, single: true },
  // opt-in location sharing with buddies on a map (applets/locator, server/locate)
  // the multiplayer desktop: friends over on your 98ish (applets/hangout, server/aim/hangout.js + ydocs.js)
  { name: "Come Over", app: "hangout", type: "hangout", icon: "/assets/program_icons/hangout.svg", width: 520, height: 560, group: "Internet", also: ["Together", "Us"], desktop: false, single: true },
  // make your own programs and send them in 98 Messenger (applets/vb98, server/aim/vbapps.js)
  // LAN Party 98 (applets/lanparty): shareware DOS games alone or on a LAN with friends (js-dos, IPX over WebRTC), Flash via Ruffle
  { name: "LAN Party 98", app: "lanparty", type: "lanparty", icon: "/assets/program_icons/lanparty.svg", width: 760, height: 600, group: "Games", desktop: false, single: true },
  { name: "Virtual PC 98", app: "virtualpc", type: "virtualpc", icon: "/assets/program_icons/virtualpc.svg", width: 760, height: 560, group: "Accessories", desktop: false, single: true },
  { name: "Visual Basic 98", app: "vb98", type: "vb98", icon: "/assets/program_icons/vb98.svg", width: 780, height: 580, group: "Accessories", also: ["Development"], desktop: false },
  // Snap to 3D (applets/viewer3d): photo -> 3D model on a free Hugging Face Space, or import a .glb; toys open more windows
  { name: "3D Viewer 98", app: "viewer3d", type: "viewer3d", icon: "/assets/program_icons/viewer3d.svg", width: 520, height: 600, group: "Accessories", desktop: false },
  // find places, see where you are, directions (Photon/Nominatim search, Valhalla routes, OpenFreeMap; applets/maps, utils/maps.js openMaps)
  // PDFs on drive C:, page by page (applets/pdfViewer; pdf.js from jsDelivr, or the browser's own viewer)
  // a picture of part of the 98ish screen, marked up and saved/copied/sent (applets/snipping; Ctrl+Shift+S)
  { name: "Snipping Tool", app: "snip", type: "snip", icon: "/assets/program_icons/snip.svg", width: 460, height: 420, group: "Accessories", desktop: false, single: true },
  // photos of pages -> straight PDFs (applets/scanner; corners found on the device, utils/pdfWriter.js)
  { name: "Scanner 98", app: "scanner", type: "scanner", icon: "/assets/program_icons/scanner.svg", width: 560, height: 640, group: "Accessories", also: ["Business"], desktop: false, single: true },
  { name: "PDF Viewer", app: "pdf", type: "pdfviewer", icon: "/assets/program_icons/pdfviewer.svg", width: 640, height: 640, group: "Accessories", desktop: false },
  { name: "Maps 98", app: "maps", type: "maps", icon: "/assets/program_icons/maps.svg", width: 860, height: 600, group: "Accessories", also: ["Internet"], desktop: false, single: true },
  { name: "Buddy Locator", app: "locator", type: "locator", icon: "/assets/program_icons/locator.svg", width: 780, height: 580, group: "Internet", also: ["Together", "Us"], desktop: false, single: true },
  { name: "YouTube '98", type: "video", icon: "/assets/program_icons/video-48.png", width: 820, height: 620, group: "Internet", single: true },
  { name: "My Computer", app: "explorer", icon: "/assets/program_icons/computer_explorer.png", width: 640, height: 440, group: null },
  { name: "Notepad", app: "notepad", type: "notepad", icon: "/assets/note.png", width: 520, height: 420, group: "Accessories" },
  { name: "Solitaire", app: "solitaire", type: "solitaire", icon: "/assets/program_icons/solitaire.svg", width: 620, height: 500, group: "Games", desktop: false, single: true },
  { name: "FreeCell", app: "freecell", type: "freecell", icon: "/assets/program_icons/freecell.svg", width: 640, height: 520, group: "Games", desktop: false, single: true },
  { name: "WordPad", app: "wordpad", type: "wordpad", icon: "/assets/program_icons/wordpad.svg", width: 640, height: 480, group: "Accessories", desktop: false },
  { name: "Sound Recorder", app: "recorder", type: "recorder", icon: "/assets/program_icons/recorder.svg", width: 340, height: 250, group: "Entertainment", desktop: false },
  // the camera (webcam or phone camera) and the picture viewer; photos live in C:\My Pictures
  { name: "Camera", app: "camera", type: "camera", icon: "/assets/program_icons/camera.svg", width: 780, height: 600, group: "Accessories", also: ["Entertainment"], single: true },
  { name: "Photos", app: "photos", type: "photos", icon: "/assets/program_icons/photos.svg", width: 820, height: 580, group: "Accessories", also: ["Entertainment"] },
  { name: "Paint", app: "paint", type: "paint", icon: "/assets/program_icons/paint.svg", width: 700, height: 540, group: "Accessories", desktop: false },
  { name: "Critter Catch Pinball", app: "critterpinball", type: "critterpinball", icon: "/assets/program_icons/critterpinball.svg", width: 700, height: 780, group: "Games", desktop: false, single: true },
  { name: "Minesweeper", type: "minesweeper", icon: "/assets/program_icons/mine-48.png", width: 373, height: 456, group: "Games", single: true },
  { name: "98 Messenger", type: "chat", icon: "/assets/program_icons/aim2-48.png", width: 260, height: 520, group: "Internet", single: true, also: ["Community"] },
  { name: "Network Neighborhood", app: "network", icon: "/assets/program_icons/network.svg", width: 560, height: 420, group: "Community", single: true },
  { name: "Hearts", app: "net-hearts", type: "hearts", icon: "/assets/program_icons/hearts.svg", width: 660, height: 560, group: "Games", desktop: false, single: true },
  { name: "WinPopup", app: "net-popup", type: "winpopup", icon: "/assets/program_icons/winpopup.svg", width: 360, height: 300, group: "Accessories", desktop: false, single: true, also: ["Community"] },
  { name: "Recycle Bin", app: "recycle", icon: "/assets/recycle_bin_empty.png", width: 560, height: 380, group: null, single: true },
  { name: "MS-DOS Prompt", app: "dos", type: "dos", icon: "/assets/dos.png", width: 640, height: 400, group: "Accessories", desktop: false },
  { name: "Windows Update", app: "update", icon: "/assets/program_icons/update.svg", width: 540, height: 440, group: null, desktop: false, single: true },
  { name: "Display Properties", app: "display", icon: "/assets/vaporwave.png", width: 420, height: 470, group: null, desktop: false, single: true },
  // 98ish Calendar (shared calendars, reminders) and Clock (world clocks, alarms, timer, stopwatch)
  { name: "Calendar", app: "calendar", type: "calendar", icon: "/assets/program_icons/calendar.svg", width: 900, height: 620, group: "Accessories", single: true, also: ["Us"] },
  // contacts (utils/contacts.js; birthdays go on the Calendar, buddies and Mail use them) and
  // Find (search everything: utils/search.js; Start > Find, or "See all results")
  { name: "Address Book", app: "addressbook", type: "addressbook", icon: "/assets/program_icons/addressbook.svg", width: 780, height: 540, group: "Accessories", desktop: false, single: true, also: ["Community"] },
  // sticky notes with checklists, shared with buddies (utils/notes.js, server/notes), and an
  // Outlook-style task list whose tasks are Calendar to-do events (applets/tasks/tasksCore.js)
  { name: "Notes", app: "notes", type: "notes", icon: "/assets/program_icons/notes.svg", width: 760, height: 520, group: "Accessories", single: true, also: ["Us"] },
  { name: "Tasks", app: "tasks", type: "tasks", icon: "/assets/program_icons/tasks.svg", width: 520, height: 560, group: "Accessories", single: true },
  { name: "Find", app: "find", type: "find", icon: "/assets/program_icons/find.svg", width: 660, height: 500, group: null, desktop: false, single: true },
  // 98ish Weather (Open-Meteo forecasts; utils/weatherPrefs.js, applets/weather/)
  { name: "Weather", app: "weather", type: "weather", icon: "/assets/program_icons/weather.svg", width: 520, height: 600, group: "Accessories", desktop: false, single: true },
  { name: "Clock", app: "clock", type: "clock", icon: "/assets/program_icons/clock.svg", width: 420, height: 500, group: "Accessories", desktop: false, single: true },
  { name: "Calculator", app: "calc", type: "calc", icon: "/assets/program_icons/calc.svg", width: 270, height: 272, group: "Accessories", desktop: false },
  { name: "Character Map", app: "charmap", type: "charmap", icon: "/assets/program_icons/charmap.svg", width: 610, height: 280, group: "System Tools", desktop: false, single: true },
  // wave 4: a spreadsheet (applets/sheets: formulas in engine.js) and small utilities
  { name: "Sheets 98", app: "sheets", type: "sheets", icon: "/assets/program_icons/sheets.svg", width: 760, height: 520, group: "Accessories", also: ["Business"], desktop: false },
  { name: "Unit Converter", app: "units", type: "units", icon: "/assets/program_icons/units.svg", width: 340, height: 440, group: "Accessories", desktop: false, single: true },
  { name: "Color Picker", app: "colorpicker", type: "colorpicker", icon: "/assets/program_icons/colorpicker.svg", width: 380, height: 560, group: "Accessories", desktop: false, single: true },
  { name: "QR Code", app: "qrcode", type: "qrcode", icon: "/assets/program_icons/qrcode.svg", width: 380, height: 560, group: "Accessories", desktop: false, single: true },
  { name: "Dice & Coin", app: "dice", type: "dice", icon: "/assets/program_icons/dice.svg", width: 360, height: 460, group: "Accessories", also: ["Games"], desktop: false, single: true },
  { name: "Backup", app: "backup", icon: "/assets/program_icons/backup.svg", width: 420, height: 460, group: "System Tools", desktop: false, single: true },
  { name: "Date/Time Properties", app: "datetime", icon: "/assets/program_icons/datetime.svg", width: 420, height: 370, group: null, desktop: false, single: true },
  // passwords, PINs, the lock screen and user profiles
  { name: "Passwords", app: "passwords", icon: "/assets/program_icons/passwords.svg", width: 430, height: 500, group: null, desktop: false, single: true },
  { name: "Keyboard Properties", app: "keyboard", icon: "/assets/program_icons/keyboard.svg", width: 420, height: 440, group: null, desktop: false, single: true },
  { name: "Desktop Themes", app: "themes", icon: "/assets/program_icons/themes.svg", width: 560, height: 500, group: null, desktop: false, single: true },
  { name: "System Properties", app: "sysprops", icon: "/assets/program_icons/computer_explorer.png", width: 420, height: 470, group: null, desktop: false, single: true },
  // Control Panel (Start > Settings, My Computer, Run "control") and the applets it adds
  // (applets/controlPanel/; `applet` picks one in CplApplet.jsx)
  { name: "Control Panel", app: "control", icon: "/assets/program_icons/cpl/control.svg", width: 660, height: 470, group: null, desktop: false, single: true },
  { name: "Accessibility Options", app: "cpl", applet: "access", icon: "/assets/program_icons/cpl/access.svg", width: 430, height: 500, group: null, desktop: false, single: true },
  { name: "Add/Remove Programs", app: "cpl", applet: "programs", icon: "/assets/program_icons/cpl/programs.svg", width: 480, height: 520, group: null, desktop: false, single: true },
  { name: "Mouse", app: "cpl", applet: "mouse", icon: "/assets/program_icons/cpl/mouse.svg", width: 420, height: 480, group: null, desktop: false, single: true },
  { name: "Regional Settings", app: "cpl", applet: "regional", icon: "/assets/program_icons/cpl/regional.svg", width: 430, height: 470, group: null, desktop: false, single: true },
  { name: "Storage", app: "cpl", applet: "storage", icon: "/assets/program_icons/cpl/storage.svg", width: 440, height: 520, group: null, desktop: false, single: true },
  { name: "Internet Options", app: "cpl", applet: "internet", icon: "/assets/program_icons/cpl/internet.svg", width: 420, height: 460, group: null, desktop: false, single: true },
  { name: "Fonts", app: "cpl", applet: "fonts", icon: "/assets/program_icons/cpl/fonts.svg", width: 560, height: 440, group: null, desktop: false, single: true },
  { name: "Power Management", app: "cpl", applet: "power", icon: "/assets/program_icons/cpl/power.svg", width: 420, height: 460, group: null, desktop: false, single: true },
  { name: "Sounds", app: "cpl", applet: "sounds", icon: "/assets/program_icons/cpl/sounds.svg", width: 420, height: 480, group: null, desktop: false, single: true },
  // Windows 98's Magnifier: a window showing what's under the pointer, bigger
  { name: "Magnifier", app: "magnifier", icon: "/assets/program_icons/cpl/magnifier.svg", width: 520, height: 280, group: "Accessories", desktop: false, single: true },
  { name: "98ish Mail", app: "mail", type: "mail", icon: "/assets/program_icons/mail.svg", width: 760, height: 540, group: "Internet", desktop: false, single: true, also: ["Community"] },
  { name: "HomePage Studio", app: "homepage", type: "homepage", icon: "/assets/program_icons/homepage.svg", width: 940, height: 620, group: "Internet", desktop: false, single: true, also: ["Community"] },
  // from the Start menu these play against the computer; Network Neighborhood opens network games
  { name: "Reversi", app: "net-reversi", type: "reversi", icon: "/assets/program_icons/reversi.svg", width: 420, height: 560, group: "Games", desktop: false, single: true },
  { name: "Chess", app: "net-chess", type: "chess", icon: "/assets/program_icons/chess.svg", width: 700, height: 580, group: "Games", desktop: false, single: true },
  // online rooms (Quick Match, codes, the computer); Network Neighborhood invitations open their own match windows
  { name: "Checkers", app: "net-checkers", type: "checkers", icon: "/assets/program_icons/checkers.svg", width: 460, height: 580, group: "Games", desktop: false, single: true, online: "checkers" },
  { name: "Battleship", app: "net-battleship", type: "battleship", icon: "/assets/program_icons/battleship.svg", width: 660, height: 500, group: "Games", desktop: false, single: true },
  // Brandon's other web apps (utils/projects.js), each in its own window
  ...PROJECTS.map((p) => ({ name: p.name, app: "webapp", icon: p.icon, width: 1000, height: 680, group: "My Projects", single: true })),
  { name: "Pickleball 98", app: "pickleball", type: "pickleball", icon: "/assets/program_icons/pickleball.svg", width: 960, height: 660, group: "Games", desktop: false, single: true, online: "pickleball" },
  { name: "Shred 98", app: "shred", type: "shred", icon: "/assets/program_icons/shred.svg", width: 940, height: 660, group: "Games", desktop: false, single: true },
  { name: "Downhill", app: "ski", type: "ski", icon: "/assets/program_icons/ski.svg", width: 640, height: 520, group: "Games", desktop: false, single: true },
  { name: "Speed Typist 98", app: "speedtype", type: "speedtype", icon: "/assets/program_icons/speedtype.svg", width: 720, height: 560, group: "Games", desktop: false, single: true, online: "speedtype" },
  { name: "Word Duel", app: "wordduel", type: "wordduel", icon: "/assets/program_icons/wordduel.svg", width: 560, height: 690, group: "Games", desktop: false, single: true, online: "wordduel" },
  { name: "Imposter", app: "imposter", type: "imposter", icon: "/assets/program_icons/imposter.svg", width: 620, height: 700, group: "Games", desktop: false, single: true, online: "imposter" },
  { name: "Last Card", app: "lastcard", type: "lastcard", icon: "/assets/program_icons/lastcard.svg", width: 900, height: 680, group: "Games", desktop: false, single: true, online: "lastcard" },
  { name: "Hexlands", app: "hexlands", type: "hexlands", icon: "/assets/program_icons/hexlands.svg", width: 1000, height: 700, group: "Games", desktop: false, single: true, online: "hexlands" },
  { name: "Monster Duel", app: "monsterduel", type: "monsterduel", icon: "/assets/program_icons/monsterduel.svg", width: 1000, height: 720, group: "Games", desktop: false, single: true, online: "monsterduel" },
  // Casino 98 (applets/casino): one window, the program picks the game; they share a chip bank
  { name: "Casino 98", app: "casino", type: "casino", icon: "/assets/program_icons/casino.svg", width: 660, height: 580, group: "Games", desktop: false, single: true },
  { name: "Texas Hold'em", app: "casino", type: "holdem", icon: "/assets/program_icons/holdem.svg", width: 920, height: 680, group: "Games", desktop: false, single: true, online: "holdem" },
  { name: "Blackjack", app: "casino", type: "blackjack", icon: "/assets/program_icons/blackjack.svg", width: 680, height: 600, group: "Games", desktop: false, single: true },
  { name: "Roulette", app: "casino", type: "roulette", icon: "/assets/program_icons/roulette.svg", width: 820, height: 680, group: "Games", desktop: false, single: true },
  { name: "Slots", app: "casino", type: "slots", icon: "/assets/program_icons/slots.svg", width: 480, height: 660, group: "Games", desktop: false, single: true },
  { name: "Video Poker", app: "casino", type: "videopoker", icon: "/assets/program_icons/videopoker.svg", width: 640, height: 580, group: "Games", desktop: false, single: true },
  { name: "Craps", app: "casino", type: "craps", icon: "/assets/program_icons/craps.svg", width: 720, height: 680, group: "Games", desktop: false, single: true },
  { name: "Baccarat", app: "casino", type: "baccarat", icon: "/assets/program_icons/baccarat.svg", width: 660, height: 620, group: "Games", desktop: false, single: true },
  { name: "Block Ten", app: "blockten", type: "blockten", icon: "/assets/program_icons/blockten.svg", width: 440, height: 640, group: "Games", desktop: false, single: true },
  // quick games (docs/games-new.md)
  { name: "Boom Frenzy", app: "boomfrenzy", type: "boomfrenzy", icon: "/assets/program_icons/boomfrenzy.svg", width: 460, height: 640, group: "Games", desktop: false, single: true },
  { name: "Color Match", app: "colormatch", type: "colormatch", icon: "/assets/program_icons/colormatch.svg", width: 560, height: 560, group: "Games", desktop: false, single: true, online: "colormatch" },
  { name: "Echo Pads", app: "echo", type: "echo", icon: "/assets/program_icons/echo.svg", width: 480, height: 600, group: "Games", desktop: false, single: true, online: "echo" },
  { name: "Zap It!", app: "zapit", type: "zapit", icon: "/assets/program_icons/zapit.svg", width: 460, height: 600, group: "Games", desktop: false, single: true },
  { name: "Tetherball", app: "tetherball", type: "tetherball", icon: "/assets/program_icons/tetherball.svg", width: 820, height: 600, group: "Games", desktop: false, single: true, online: "tetherball" },
  { name: "Sunny Acres", app: "town", type: "town", icon: "/assets/program_icons/town.svg", width: 860, height: 620, group: "Games", desktop: false, single: true },
  { name: "Photo Puzzle", app: "puzzle", type: "puzzle", icon: "/assets/program_icons/puzzle.svg", width: 820, height: 600, group: "Us", desktop: false, single: true, also: ["Games", "Together"] },
  { name: "Doodle Together", app: "doodle", type: "doodle", icon: "/assets/program_icons/doodle.svg", width: 780, height: 640, group: "Together", desktop: false, single: true, also: ["Us"] },
  { name: "Lovebirds Quiz Show", app: "quiz", type: "quiz", icon: "/assets/program_icons/quiz.svg", width: 560, height: 620, group: "Together", desktop: false, single: true, also: ["Us"] },
  // couples (utils/couple.js): Us is on the desktop once you're paired ("paired")
  { name: "Us", app: "us", icon: "/assets/program_icons/us.svg", width: 540, height: 540, group: "Us", desktop: "paired", single: true },
  { name: "Love Letters", app: "loveletters", icon: "/assets/program_icons/loveletters.svg", width: 720, height: 580, group: "Us", desktop: false, single: true },
  { name: "Our Story", app: "ourstory", icon: "/assets/program_icons/ourstory.svg", width: 760, height: 620, group: "Us", desktop: false, single: true },
  { name: "Dream House", app: "dollhouse", type: "dollhouse", icon: "/assets/program_icons/dollhouse.svg", width: 900, height: 640, group: "Us", desktop: false, single: true },
  // an unofficial retro tribute to Appward (appward.com): a business suite as a 1998 client
  { name: "Appward 98", app: "appward", type: "appward", icon: "/assets/program_icons/appward.svg", width: 980, height: 660, group: "Business", desktop: true, single: true },
  { name: "Our Pet", app: "pet", icon: "/assets/program_icons/pet.svg", width: 480, height: 660, group: "Us", desktop: false, single: true },
  // the screen that greets you when 98ish starts (also Start > Help), and its guided tour
  { name: "Welcome to 98ish", app: "welcome", icon: "/assets/program_icons/welcome.svg", width: 660, height: 480, group: "System Tools", desktop: false, single: true },
  // Help and Support: every topic, Contents/Index/Search/Favorites (applets/help; Start > Help,
  // F1, Help > Help Topics in the programs; utils/help.js openHelp())
  { name: "98ish Help", app: "help", icon: "/assets/program_icons/help.svg", width: 760, height: 540, group: "System Tools", desktop: false, single: true },
]

// The desktop shows these (MS-DOS Prompt and Display Properties live in the Start menu)
export const desktopPrograms = programs.filter((p) => p.desktop !== false)

// Programs that were folded into another (2026-10-07): an old shortcut, a DOS alias, a Help
// link or a push deep link with the old name or file type opens the one that took its place
export const RETIRED_PROGRAMS = {
  Pinball: { to: "Critter Catch Pinball" }, // Pinball: Blue Screen; its high scores show in Critter Catch's High Scores
  "Chess Puzzles": { to: "Chess", extra: { chessMode: "puzzles" } }, // now Chess's Puzzles mode
}
const RETIRED_TYPES = { pinball: "Pinball", chesspuzzles: "Chess Puzzles" }
export const retiredExtra = (name) => RETIRED_PROGRAMS[name]?.extra || {}

export const programByName = (name) => programs.find((p) => p.name === name) || (RETIRED_PROGRAMS[name] ? programs.find((p) => p.name === RETIRED_PROGRAMS[name].to) : null) || null
export const programByType = (type) => programs.find((p) => p.type === type) || (RETIRED_TYPES[type] ? programByName(RETIRED_TYPES[type]) : null) || null

// A to Z the way people read names ("3D Viewer 98" < "Baccarat" < "Chess"; case and accents ignored)
const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true })
export const byName = (a, b) => collator.compare(a, b)
export const sortByName = (list, nameOf = (x) => x.name) => [...list].sort((a, b) => byName(nameOf(a), nameOf(b)))

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

// (a retired name opens its new home in the right mode; a handoff tells one that's already open)
export const launch = (name, extra) =>
  windowFor(programByName(name), RETIRED_PROGRAMS[name]?.extra ? { ...retiredExtra(name), handoff: { id: Date.now(), ...retiredExtra(name) }, ...extra } : extra)

// An Internet Explorer window, optionally opening a page (as of the date IE is set to)
export const ieWindow = (url) => launch("Internet Explorer", { url })

// Compass, the real web browser, optionally opening a page
export const compassWindow = (url) => launch("Compass", url ? { url } : {})

// A web link opened anywhere in 98ish: 98ish's own pages (the web ring, the guestbook) stay
// in Internet Explorer; everything else opens in Compass
export const webWindow = (url) => (/^https?:\/\/(www\.)?98ish\.com(\/|$)/i.test(String(url || "")) ? ieWindow(url) : compassWindow(url))

// My Computer, opened at a folder: ["C:", "Documents"] (empty = the My Computer view)
export const explorerWindow = (path = []) => launch("My Computer", { path })

// Notepad, optionally editing a file from the file system
export const notepadWindow = (file = null) => launch("Notepad", { file })

// Paint, optionally editing a picture from the file system
export const paintWindow = (file = null) => launch("Paint", { file })

// Photos, showing a picture (and its folder) or a folder of pictures (["C:", "My Pictures"])
export const photosWindow = (file = null, path = null) => launch("Photos", { file, path })

// WordPad, optionally editing a document (rich text or plain text)
export const wordpadWindow = (file = null) => launch("WordPad", { file })

// Sound Recorder, optionally opening a Wave Sound
export const recorderWindow = (file = null) => launch("Sound Recorder", { file })

// Media Player, optionally playing a file on the drive (its path, "C:/My Music/Song.mp3")
export const mediaPlayerWindow = (file = null) => launch("Media Player", { file })
