// What Start menu search and Find can find besides files, and how to open it. Anything can
// add to it (the Control Panel, an app's own settings):
//
//   registerSearchable([{ id, type: "settings", title, keywords: ["wallpaper"], detail,
//                         icon, open: { program, extra } | (dispatch) => {...} }])
//     -> a function that removes them again
//   registerSearchProvider("messages", { search: (query) => [result], ... })
//     for live data that only one part of 98ish has (98 Messenger's conversations)
//
// A result: { id, type, title, subtitle, icon, open(dispatch), score? }. Types (and their
// order in the results): programs, settings, files, contacts, events, messages, mail, photos,
// help (98ish Help's topics register themselves with type "help" and a `body` of their words:
// applets/help/register.js).
// This file stays small and loads with the Start menu; the searching is in utils/search.js.

export const SEARCH_TYPES = [
  { id: "programs", label: "Programs", icon: "/assets/programs.png" },
  { id: "settings", label: "Settings", icon: "/assets/vaporwave.png" },
  { id: "files", label: "Files and Folders", icon: "/assets/directory_folder.png" },
  { id: "contacts", label: "Contacts", icon: "/assets/program_icons/addressbook.svg" },
  { id: "events", label: "Calendar", icon: "/assets/program_icons/calendar.svg" },
  { id: "messages", label: "Messages", icon: "/assets/program_icons/aim2-48.png" },
  { id: "mail", label: "Mail", icon: "/assets/program_icons/mail.svg" },
  { id: "photos", label: "Photos", icon: "/assets/program_icons/photos.svg" },
  { id: "help", label: "Help Topics", icon: "/assets/program_icons/help.svg" },
]

const entries = new Map() // id -> entry
const providers = new Map() // id -> provider
let version = 0

export const registerSearchable = (list) => {
  const ids = []
  for (const entry of [].concat(list)) {
    if (!entry?.id || !entry.title) continue
    entries.set(entry.id, { type: "settings", keywords: [], ...entry })
    ids.push(entry.id)
  }
  version++
  return () => {
    ids.forEach((id) => entries.delete(id))
    version++
  }
}
export const searchableEntries = () => [...entries.values()]
export const searchableVersion = () => version

export const registerSearchProvider = (id, provider) => {
  providers.set(id, provider)
  return () => {
    if (providers.get(id) === provider) providers.delete(id)
  }
}
export const searchProviders = () => [...providers.entries()]

// Extra words people type for programs ("calc", "pictures", "im")
export const PROGRAM_KEYWORDS = {
  "Boom Frenzy": ["bombs", "whack a mole", "bomb game", "reflex", "panic"],
  "Color Match": ["colour", "colors", "brain game", "stroop", "reaction"],
  "Echo Pads": ["memory game", "simon says", "sequence", "repeat the pattern", "colors and tones"],
  "Zap It!": ["bop", "reflex", "gestures", "party game", "pass the phone", "shake"],
  Tetherball: ["playground", "ball on a rope", "pole", "3D sports"],
  Calculator: ["calc", "math", "sums", "add", "numbers"],
  Photos: ["pictures", "images", "gallery", "photo viewer", "slideshow"],
  Camera: ["webcam", "selfie", "photo booth", "take a picture"],
  Paint: ["draw", "drawing", "mspaint", "pictures"],
  Notepad: ["text", "notes", "editor", "txt"],
  WordPad: ["word", "write", "documents", "letter"],
  "98 Messenger": ["aim", "im", "instant message", "chat", "buddies", "buddy list", "messenger", "video call", "call"],
  "98ish Mail": ["email", "e-mail", "inbox", "outlook", "letters", "mail"],
  "Address Book": ["contacts", "people", "phone numbers", "addresses", "birthdays", "wab", "vcard"],
  Calendar: ["events", "schedule", "agenda", "appointments", "reminders", "dates"],
  Clock: ["alarm", "timer", "stopwatch", "world clock", "time"],
  Weather: ["forecast", "temperature", "rain", "sunny", "snow", "storm", "humidity", "wind", "uv", "sunrise", "sunset", "fahrenheit", "celsius", "msn weather"],
  "My Computer": ["files", "explorer", "drive", "folders", "c:"],
  Compass: ["browser", "web browser", "web", "internet", "www", "websites", "surf", "browse", "tabs", "bookmarks", "favorites", "history", "downloads", "wikipedia", "search the web", "url"],
  "Internet Explorer": ["ie", "wayback", "time machine", "old web", "internet", "geocities"],
  "MS-DOS Prompt": ["dos", "command", "cmd", "terminal", "shell", "prompt"],
  "Task Manager": ["processes", "taskmgr", "end task", "performance"],
  "Media Player": ["music", "songs", "midi", "mplayer"],
  "Sound Recorder": ["record", "microphone", "voice", "audio"],
  "Recycle Bin": ["trash", "deleted", "garbage", "bin"],
  "Character Map": ["symbols", "emoji", "special characters", "charmap"],
  "Network Neighborhood": ["network", "lan", "share", "online players"],
  "Windows Update": ["updates", "update"],
  Backup: ["sync", "restore", "online drive", "msbackup"],
  "Welcome to 98ish": ["tour", "getting started", "welcome"],
  "98ish Help": ["help", "help topics", "how do i", "support", "winhelp", "manual", "faq"],
  Minesweeper: ["mines", "winmine"],
  Solitaire: ["cards", "klondike", "sol"],
  FreeCell: ["cards"],
  Hearts: ["cards"],
  "YouTube '98": ["video", "videos", "youtube"],
  WinPopup: ["popup", "net send", "message"],
  Us: ["couple", "partner", "love", "girlfriend", "boyfriend"],
  "Love Letters": ["letters", "love"],
  Find: ["search", "find files", "look for"],
}

// The settings 98ish has today; the Control Panel adds its own with registerSearchable
const S = (id, title, keywords, open, detail, icon) => ({ id: `settings:${id}`, type: "settings", title, keywords, open, detail, icon })
const prog = (program, extra) => ({ program, extra })
const shell = (action) => ({ shell: action })

registerSearchable([
  S("display-background", "Change the wallpaper", ["wallpaper", "background", "desktop picture", "display"], prog("Display Properties", { tab: "background" }), "Display Properties > Background", "/assets/vaporwave.png"),
  S("display-screensaver", "Screen saver", ["screensaver", "screen saver", "idle", "password protected"], prog("Display Properties", { tab: "screensaver" }), "Display Properties > Screen Saver", "/assets/vaporwave.png"),
  S("display-appearance", "Colors, fonts and icons", ["appearance", "color scheme", "colors", "theme", "high contrast", "font size", "icons", "cursor"], prog("Display Properties", { tab: "appearance" }), "Display Properties > Appearance", "/assets/vaporwave.png"),
  S("display-startup", "Startup screen and sound", ["startup", "boot screen", "startup sound", "chime", "sounds"], prog("Display Properties", { tab: "startup" }), "Display Properties > Startup", "/assets/vaporwave.png"),
  S("themes", "Desktop Themes", ["themes", "theme", "sound scheme", "sounds", "pointers", "look"], prog("Desktop Themes"), "Settings > Desktop Themes", "/assets/program_icons/themes.svg"),
  S("sounds", "Sounds", ["sound", "sounds", "sound scheme", "volume", "mute", "system sounds", "audio"], prog("Desktop Themes"), "Desktop Themes > Sounds (volume: the taskbar speaker)", "/assets/program_icons/themes.svg"),
  S("datetime", "Date and time", ["date", "time", "clock", "date/time", "timedate"], prog("Date/Time Properties", { tab: "date" }), "Date/Time Properties", "/assets/program_icons/datetime.svg"),
  S("timezone", "Time zone", ["time zone", "timezone", "daylight saving", "dst", "zone"], prog("Date/Time Properties", { tab: "zone" }), "Date/Time Properties > Time Zone", "/assets/program_icons/datetime.svg"),
  S("keyboard", "Keyboard", ["keyboard", "on-screen keyboard", "touch keyboard", "typing", "key repeat"], prog("Keyboard Properties"), "Settings > Keyboard", "/assets/program_icons/keyboard.svg"),
  S("passwords", "Passwords and PIN", ["password", "passwords", "pin", "lock screen", "lock", "security", "change password"], prog("Passwords", { tab: "change" }), "Settings > Passwords and Users", "/assets/program_icons/passwords.svg"),
  S("lock", "Lock screen", ["lock", "lock screen", "lock after", "auto lock", "idle lock"], prog("Passwords", { tab: "lock" }), "Passwords and Users > Lock Screen", "/assets/program_icons/passwords.svg"),
  S("users", "User profiles", ["users", "user", "profiles", "accounts", "log on", "switch user"], prog("Passwords", { tab: "users" }), "Passwords and Users > Users", "/assets/program_icons/passwords.svg"),
  S("dnd", "Do Not Disturb", ["do not disturb", "dnd", "quiet", "silence", "mute notifications", "moon", "focus", "sleep", "bedtime", "schedule"], shell("dnd-settings"), "Settings > Do Not Disturb", "/assets/program_icons/cpl/dnd.svg"),
  S("weather-units", "Temperature units (°F or °C)", ["fahrenheit", "celsius", "temperature", "units", "weather"], prog("Regional Settings"), "Regional Settings > Regional Settings", "/assets/program_icons/cpl/regional.svg"),
  S("notifications", "Notifications", ["notifications", "notification center", "push", "alerts", "quiet hours", "badges"], shell("notification-settings"), "Settings > Notifications", "/assets/program_icons/winpopup.svg"),
  S("taskbar", "Taskbar and Start menu", ["taskbar", "start menu", "quick launch", "clock", "auto hide"], shell("taskbar-properties"), "Settings > Taskbar & Start Menu", "/assets/start98.png"),
  S("shortcuts", "Keyboard shortcuts", ["shortcuts", "hotkeys", "keys", "keyboard shortcuts"], shell("shortcuts"), "Settings > Keyboard Shortcuts", "/assets/README.png"),
  S("system", "System Properties", ["system", "about", "achievements", "version", "computer"], prog("System Properties"), "My Computer > Properties", "/assets/program_icons/computer_explorer.png"),
  S("backup-sync", "Sync my files online", ["sync", "backup", "online drive", "cloud"], prog("Backup"), "System Tools > Backup", "/assets/program_icons/backup.svg"),
])
