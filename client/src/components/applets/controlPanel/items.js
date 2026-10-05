import { launch } from "../../../utils/programs"
import { shellAction } from "../../../utils/shell"

// What's in the Control Panel, in Windows 98's alphabetical order. Each item opens a
// program (a settings window, most of them shared with the Start menu) or asks the taskbar
// for one of its dialogs. text: what the left pane says about it.

const icon = (name) => `/assets/program_icons/cpl/${name}.svg`

export const CPL_ITEMS = [
  { id: "access", name: "Accessibility Options", icon: icon("access"), program: "Accessibility Options", text: "Changes the text size, high contrast colors, motion, the Magnifier and keyboard settings, for easier use." },
  { id: "programs", name: "Add/Remove Programs", icon: icon("programs"), program: "Add/Remove Programs", text: "Shows the programs on 98ish and their sizes, and takes them off the desktop or out of the Start menu." },
  { id: "datetime", name: "Date/Time", icon: "/assets/program_icons/datetime.svg", program: "Date/Time Properties", text: "Changes the date, time, and time zone 98ish shows." },
  { id: "themes", name: "Desktop Themes", icon: "/assets/program_icons/themes.svg", program: "Desktop Themes", text: "Changes the whole look of your desktop at once: wallpaper, colors, sounds and pointers." },
  { id: "dnd", name: "Do Not Disturb", icon: icon("dnd"), action: "dnd-settings", text: "Silences pop-ups and sounds for a while or on a schedule. Everything still waits in the Notification Center." },
  { id: "display", name: "Display", icon: icon("display"), program: "Display Properties", text: "Changes the wallpaper, screen saver, color scheme and startup screen." },
  { id: "fonts", name: "Fonts", icon: icon("fonts"), program: "Fonts", text: "Shows the fonts 98ish uses, with samples of each." },
  { id: "internet", name: "Internet Options", icon: icon("internet"), program: "Internet Options", text: "Changes Internet Explorer's home page and time machine date, and clears its History." },
  { id: "keyboard", name: "Keyboard", icon: "/assets/program_icons/keyboard.svg", program: "Keyboard Properties", text: "Chooses the 98ish keyboard or your phone's own, and how keys repeat and click." },
  { id: "mouse", name: "Mouse", icon: icon("mouse"), program: "Mouse", text: "Changes the double-click speed, pointers, pointer trails, button order, and touch settings." },
  { id: "notify", name: "Notifications", icon: icon("notify"), action: "notification-settings", text: "Chooses which notifications 98ish shows, and which it sends to your phone." },
  { id: "passwords", name: "Passwords", icon: "/assets/program_icons/passwords.svg", program: "Passwords", text: "Sets a password or PIN for the lock screen, and manages the people who use this computer." },
  { id: "power", name: "Power Management", icon: icon("power"), program: "Power Management", text: "Chooses when the screen saver starts and 98ish locks, and keeps the screen on." },
  { id: "regional", name: "Regional Settings", icon: icon("regional"), program: "Regional Settings", text: "Changes how times, dates, numbers and temperatures (°F or °C) are shown, and the first day of the week." },
  { id: "sounds", name: "Sounds", icon: icon("sounds"), program: "Sounds", text: "Changes the system sounds, the sound scheme and the volume." },
  { id: "storage", name: "Storage", icon: icon("storage"), program: "Storage", text: "Shows how much space 98ish uses on this device, keeps your files from being cleared, and empties the Recycle Bin." },
  { id: "system", name: "System", icon: icon("system"), program: "System Properties", text: "Shows information about your computer, and the Achievements you've found." },
  { id: "taskbar", name: "Taskbar & Start Menu", icon: icon("taskbar"), action: "taskbar-properties", text: "Changes taskbar settings, such as Auto hide, the clock and Quick Launch." },
]

// what the Control Panel shows first (docs/simplicity.md): the settings most people want
export const COMMON_IDS = ["display", "sounds", "notify", "access", "passwords", "storage"]

export const openCplItem =(item, dispatch) => {
  if (item.program) dispatch({ type: "open_window", payload: launch(item.program) })
  else if (item.action) shellAction(item.action)
}
