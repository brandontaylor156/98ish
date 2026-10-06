// Fake process table + CPU/memory simulation for the Task Manager.

// Core NT processes that are always "running". cpu = [chance of any activity
// per tick, max % when active]. mem in K.
export const SYSTEM_PROCESSES = [
  { image: "System Idle Process", pid: 0, mem: 16, threads: 1, handles: 0, critical: true },
  { image: "System", pid: 8, mem: 216, threads: 37, handles: 172, cpu: [0.35, 2], critical: true },
  { image: "smss.exe", pid: 140, mem: 344, threads: 6, handles: 33, critical: true },
  { image: "csrss.exe", pid: 164, mem: 1512, threads: 10, handles: 342, cpu: [0.3, 2], critical: true },
  { image: "winlogon.exe", pid: 184, mem: 2040, threads: 16, handles: 503, critical: true },
  { image: "services.exe", pid: 212, mem: 3388, threads: 33, handles: 541, cpu: [0.05, 1], critical: true },
  { image: "lsass.exe", pid: 224, mem: 1084, threads: 14, handles: 311, critical: true },
  { image: "svchost.exe", pid: 400, mem: 2940, threads: 9, handles: 228, cpu: [0.08, 1] },
  { image: "spoolsv.exe", pid: 428, mem: 2596, threads: 11, handles: 113 },
  { image: "svchost.exe", pid: 452, mem: 4664, threads: 24, handles: 389, cpu: [0.1, 1] },
  { image: "mstask.exe", pid: 476, mem: 1792, threads: 6, handles: 102 },
  { image: "winmgmt.exe", pid: 520, mem: 812, threads: 3, handles: 94 },
  { image: "explorer.exe", pid: 772, mem: 6124, threads: 14, handles: 282, cpu: [0.2, 3] },
]

// Window name -> executable that "owns" it.
export const APP_PROFILES = {
  "Task Manager": { image: "taskmgr.exe", mem: 1996, threads: 3, handles: 31, cpu: [0.7, 3] },
  Us: { image: "us.exe", mem: 2214, threads: 3, handles: 44, cpu: [0.1, 1] },
  "Love Letters": { image: "letters.exe", mem: 3108, threads: 4, handles: 61, cpu: [0.15, 2] },
  "Our Story": { image: "ourstory.exe", mem: 6420, threads: 5, handles: 92, cpu: [0.2, 3] },
  "Our Pet": { image: "ourpet.exe", mem: 3870, threads: 4, handles: 58, cpu: [0.3, 4] },
  Tetris: { image: "tetris.exe", mem: 4212, threads: 4, handles: 57, cpu: [0.95, 9] },
  SPECTRA: { image: "spectra.exe", mem: 48212, threads: 14, handles: 312, cpu: [6, 38] },
  Hover: { image: "hover.exe", mem: 9408, threads: 6, handles: 88, cpu: [1, 22] },
  "YouTube '98": { image: "mplayer2.exe", mem: 7752, threads: 9, handles: 141, cpu: [0.9, 12] },
  "Music 98": { image: "wmplayer.exe", mem: 9216, threads: 11, handles: 188, cpu: [0.6, 6] },
  "Pickleball Club 98": { image: "pbclub.exe", mem: 7680, threads: 8, handles: 131, cpu: [0.4, 7] },
  "Buddy Locator": { image: "locator.exe", mem: 18432, threads: 12, handles: 214, cpu: [0.7, 14] },
  "Watch Together": { image: "together.exe", mem: 8340, threads: 10, handles: 152, cpu: [0.8, 10] },
  "Internet Explorer": { image: "iexplore.exe", mem: 14872, threads: 11, handles: 296, cpu: [0.8, 9] },
  Compass: { image: "compass.exe", mem: 21760, threads: 14, handles: 342, cpu: [1, 12] },
  "View Video": { image: "iexplore.exe", mem: 11284, threads: 12, handles: 263, cpu: [0.8, 10] },
  "My Computer": { image: "explorer.exe", mem: 3516, threads: 5, handles: 96, cpu: [0.15, 2] },
  Notepad: { image: "notepad.exe", mem: 1356, threads: 1, handles: 22, cpu: [0.05, 1] },
  Minesweeper: { image: "winmine.exe", mem: 1588, threads: 1, handles: 26, cpu: [0.15, 1] },
  Solitaire: { image: "sol.exe", mem: 1844, threads: 1, handles: 31, cpu: [0.15, 2] },
  FreeCell: { image: "freecell.exe", mem: 1652, threads: 1, handles: 28, cpu: [0.1, 1] },
  Pinball: { image: "pinball.exe", mem: 6840, threads: 3, handles: 74, cpu: [3, 18] },
  "Critter Catch Pinball": { image: "critters.exe", mem: 7420, threads: 3, handles: 79, cpu: [3, 19] },
  "98 Messenger": { image: "aim.exe", mem: 5960, threads: 8, handles: 164, cpu: [0.25, 2] },
  "MS-DOS Prompt": { image: "command.com", mem: 932, threads: 1, handles: 18, cpu: [0.05, 1] },
  "Recycle Bin": { image: "explorer.exe", mem: 2980, threads: 4, handles: 71, cpu: [0.1, 1] },
  "Windows Update": { image: "wupdmgr.exe", mem: 3204, threads: 5, handles: 88, cpu: [0.1, 4] },
  "Display Properties": { image: "rundll32.exe", mem: 1704, threads: 2, handles: 39, cpu: [0.05, 1] },
  Passwords: { image: "rundll32.exe", mem: 1210, threads: 2, handles: 31, cpu: [0.05, 1] },
  "Control Panel": { image: "control.exe", mem: 2120, threads: 3, handles: 52, cpu: [0.05, 1] },
  Magnifier: { image: "magnify.exe", mem: 2860, threads: 3, handles: 47, cpu: [0.4, 4] },
  Calculator: { image: "calc.exe", mem: 1124, threads: 1, handles: 19, cpu: [0.05, 1] },
  Calendar: { image: "calndr98.exe", mem: 2480, threads: 3, handles: 41, cpu: [0.05, 1.5] },
  "Address Book": { image: "wab.exe", mem: 2216, threads: 3, handles: 46, cpu: [0.05, 1.5] },
  Notes: { image: "stikynot.exe", mem: 1340, threads: 2, handles: 29, cpu: [0.05, 1] },
  Tasks: { image: "tasks98.exe", mem: 1580, threads: 2, handles: 31, cpu: [0.05, 1] },
  Find: { image: "explorer.exe", mem: 1880, threads: 2, handles: 38, cpu: [0.05, 2] },
  "98ish Help": { image: "hh.exe", mem: 1712, threads: 2, handles: 33, cpu: [0.05, 1.5] },
  Weather: { image: "weather.exe", mem: 1180, threads: 3, handles: 22, cpu: [0.05, 1] },
  Clock: { image: "clock.exe", mem: 640, threads: 2, handles: 14, cpu: [0.1, 1] },
  "Character Map": { image: "charmap.exe", mem: 1288, threads: 1, handles: 24, cpu: [0.05, 1] },
  "Welcome to 98ish": { image: "welcome.exe", mem: 1420, threads: 1, handles: 27, cpu: [0.05, 1] },
  "Date/Time Properties": { image: "rundll32.exe", mem: 1536, threads: 2, handles: 33, cpu: [0.05, 1] },
  "Media Player": { image: "mplayer.exe", mem: 6408, threads: 7, handles: 118, cpu: [0.9, 7] },
  "Network Neighborhood": { image: "explorer.exe", mem: 3124, threads: 5, handles: 104, cpu: [0.2, 2] },
  WinPopup: { image: "winpopup.exe", mem: 812, threads: 1, handles: 19, cpu: [0.05, 1] },
  Checkers: { image: "checkers.exe", mem: 1844, threads: 2, handles: 34, cpu: [0.2, 2] },
  "Minesweeper Race": { image: "winmine.exe", mem: 1712, threads: 2, handles: 31, cpu: [0.2, 2] },
  Backup: { image: "msbackup.exe", mem: 2148, threads: 3, handles: 44, cpu: [0.1, 2] },
  Hearts: { image: "mshearts.exe", mem: 2380, threads: 3, handles: 47, cpu: [0.25, 3] },
  WordPad: { image: "wordpad.exe", mem: 2856, threads: 2, handles: 44, cpu: [0.1, 2] },
  "Sound Recorder": { image: "sndrec32.exe", mem: 1932, threads: 3, handles: 37, cpu: [0.1, 3] },
  "98ish Mail": { image: "msimn.exe", mem: 6120, threads: 9, handles: 152, cpu: [0.2, 3] },
  "HomePage Studio": { image: "frontpg.exe", mem: 7340, threads: 6, handles: 131, cpu: [0.3, 5] },
  Reversi: { image: "reversi.exe", mem: 1420, threads: 2, handles: 29, cpu: [0.2, 2] },
  Chess: { image: "chess.exe", mem: 3260, threads: 3, handles: 44, cpu: [0.35, 18] },
  Battleship: { image: "battle.exe", mem: 1968, threads: 2, handles: 36, cpu: [0.2, 2] },
  Downhill: { image: "ski.exe", mem: 5124, threads: 4, handles: 61, cpu: [0.95, 11] },
  "Pickleball 98": { image: "pkball98.exe", mem: 38640, threads: 9, handles: 214, cpu: [4, 22] },
  "Speed Typist 98": { image: "sptype98.exe", mem: 2940, threads: 3, handles: 49, cpu: [0.2, 6] },
  "Chess Puzzles": { image: "chesspzl.exe", mem: 3410, threads: 3, handles: 46, cpu: [0.2, 6] },
  Imposter: { image: "imposter.exe", mem: 2380, threads: 3, handles: 41, cpu: [0.1, 4] },
  "Word Duel": { image: "wrdduel.exe", mem: 2610, threads: 3, handles: 47, cpu: [0.2, 5] },
  Hexlands: { image: "hexlands.exe", mem: 4380, threads: 4, handles: 63, cpu: [0.4, 9] },
  "Shred 98": { image: "shred98.exe", mem: 44210, threads: 11, handles: 238, cpu: [6, 26] },
  "Last Card": { image: "lastcard.exe", mem: 3380, threads: 3, handles: 52, cpu: [0.3, 7] },
  "Monster Duel": { image: "mduel.exe", mem: 9840, threads: 5, handles: 96, cpu: [0.4, 9] },
  "Casino 98": { image: "casino98.exe", mem: 2860, threads: 2, handles: 41, cpu: [0.1, 3] },
  "Texas Hold'em": { image: "holdem.exe", mem: 4120, threads: 4, handles: 63, cpu: [0.3, 8] },
  Blackjack: { image: "blackjk.exe", mem: 2210, threads: 2, handles: 38, cpu: [0.1, 4] },
  Roulette: { image: "roulette.exe", mem: 2540, threads: 2, handles: 40, cpu: [0.1, 6] },
  Slots: { image: "lucky98.exe", mem: 2380, threads: 2, handles: 36, cpu: [0.1, 7] },
  "Video Poker": { image: "vpoker.exe", mem: 1960, threads: 2, handles: 33, cpu: [0.1, 3] },
  Craps: { image: "craps.exe", mem: 2290, threads: 2, handles: 37, cpu: [0.1, 4] },
  Baccarat: { image: "baccarat.exe", mem: 2150, threads: 2, handles: 35, cpu: [0.1, 3] },
  "Block Ten": { image: "blockten.exe", mem: 1876, threads: 2, handles: 33, cpu: [0.15, 4] },
  "Boom Frenzy": { image: "boomfrnz.exe", mem: 2240, threads: 2, handles: 38, cpu: [0.3, 8] },
  "Color Match": { image: "colormch.exe", mem: 1620, threads: 2, handles: 31, cpu: [0.15, 4] },
  "Echo Pads": { image: "echopads.exe", mem: 1480, threads: 2, handles: 29, cpu: [0.1, 3] },
  "Zap It!": { image: "zapit.exe", mem: 1710, threads: 2, handles: 34, cpu: [0.2, 5] },
  Tetherball: { image: "tether.exe", mem: 14320, threads: 5, handles: 92, cpu: [1.5, 14] },
  "Sunny Acres": { image: "acres.exe", mem: 7480, threads: 4, handles: 88, cpu: [0.6, 9] },
  Camera: { image: "camera98.exe", mem: 6120, threads: 5, handles: 71, cpu: [2, 14] },
  Photos: { image: "photos.exe", mem: 3460, threads: 3, handles: 52, cpu: [0.1, 4] },
  "Photo Puzzle": { image: "puzzle.exe", mem: 4210, threads: 3, handles: 47, cpu: [0.2, 6] },
  "Doodle Together": { image: "doodle.exe", mem: 3388, threads: 3, handles: 52, cpu: [0.3, 7] },
  "Lovebirds Quiz Show": { image: "lovebird.exe", mem: 2240, threads: 3, handles: 41, cpu: [0.15, 3] },
  "Appward 98": { image: "appward.exe", mem: 8640, threads: 7, handles: 173, cpu: [0.3, 4] },
  "Dream House": { image: "dreamhse.exe", mem: 5320, threads: 3, handles: 58, cpu: [0.4, 8] },
}

const fallbackProfile = (name) => ({
  image: (name || "program").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) + ".exe",
  mem: 2048,
  threads: 2,
  handles: 40,
  cpu: [0.2, 2],
})

export const profileFor = (name) => APP_PROFILES[name] || fallbackProfile(name)

// Stable, NT-looking (multiple of 4) PID for the window at `index`.
export const pidForWindow = (index) => 1040 + index * 56 + ((index * 37) % 9) * 4

export const PHYSICAL_TOTAL = 130612
export const COMMIT_LIMIT = 314880
const KERNEL_COMMIT = 21480

export const buildProcessList = (windows) => {
  const apps = []
  ;(windows || []).forEach((w, index) => {
    if (w.closed) return
    // Every 98 Messenger window (IMs, chat rooms) is part of aim.exe
    const profile = profileFor(w.app?.startsWith("aim") ? "98 Messenger" : w.app === "ie" ? "Internet Explorer" : w.program || w.name)
    apps.push({
      ...profile,
      key: "w" + index,
      pid: pidForWindow(index),
      windowIndex: index,
    })
  })
  const system = SYSTEM_PROCESSES.map((p) => ({ ...p, key: "s" + p.pid, system: true }))
  return [...system, ...apps]
}

const rand = (n) => Math.random() * n

// One simulation step. `prev` is the previous sim state (or null), `procs` the
// current process list, `seconds` how much "time" passed.
export const stepSim = (prev, procs, seconds) => {
  const cpu = {}
  const mem = {}
  const cpuTime = { ...(prev ? prev.cpuTime : {}) }
  let busy = 0
  // the occasional burst from one random process, like a real machine
  const active = procs.filter((p) => p.pid !== 0)
  const spiker = Math.random() < 0.05 && active.length ? active[Math.floor(rand(active.length))].key : null

  procs.forEach((p) => {
    if (p.pid === 0) return
    let value = 0
    if (p.cpu && Math.random() < p.cpu[0]) {
      value = Math.round(rand(p.cpu[1]) + (p.cpu[1] > 4 ? p.cpu[1] / 3 : 0))
    }
    if (p.key === spiker) value += Math.round(12 + rand(30))
    value = Math.min(value, 99 - busy)
    cpu[p.key] = Math.max(0, value)
    busy += cpu[p.key]

    const last = prev && prev.mem[p.key] !== undefined ? prev.mem[p.key] : p.mem + Math.round(rand(p.mem * 0.04))
    let next = last + Math.round((Math.random() - 0.45) * Math.max(8, p.mem * 0.006))
    next = Math.min(Math.max(next, Math.round(p.mem * 0.97)), Math.round(p.mem * 1.08))
    mem[p.key] = next
  })
  const idle = procs.find((p) => p.pid === 0)
  if (idle) {
    cpu[idle.key] = 100 - busy
    mem[idle.key] = idle.mem
  }

  procs.forEach((p) => {
    // seed process lifetimes so CPU Time doesn't all start at 0:00:00
    if (cpuTime[p.key] === undefined) {
      cpuTime[p.key] = p.pid === 0 ? 5321 : p.system ? Math.round(rand(p.cpu ? 40 : 4)) : 0
    }
    cpuTime[p.key] += ((cpu[p.key] || 0) / 100) * seconds
  })

  const procMem = Object.values(mem).reduce((a, b) => a + b, 0)
  const commit = procMem + KERNEL_COMMIT + Math.round(rand(60))
  const peak = Math.max(prev ? prev.peak : 0, commit + (prev ? 0 : 7360))
  const cache = prev ? Math.min(Math.max(prev.cache + Math.round((Math.random() - 0.5) * 120), 21000), 27000) : 23448
  const available = Math.max(4096, PHYSICAL_TOTAL - procMem - cache - 38192)

  const history = prev ? prev.cpuHistory.slice(-299) : []
  const memHistory = prev ? prev.memHistory.slice(-299) : []
  history.push(busy)
  memHistory.push(commit)

  return {
    tick: prev ? prev.tick + 1 : 0,
    cpu,
    mem,
    cpuTime,
    usage: busy,
    commit,
    peak,
    cache,
    available,
    cpuHistory: history,
    memHistory,
    paged: prev ? prev.paged : 9872 + Math.round(rand(400)),
    nonpaged: prev ? prev.nonpaged : 1744 + Math.round(rand(80)),
  }
}

export const formatK = (n) => Math.round(n).toLocaleString("en-US")

export const formatCpuTime = (seconds) => {
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
}
