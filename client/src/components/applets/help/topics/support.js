// 98ish Help: troubleshooting, and privacy (what's kept where, what the server sees).
// Format: see ../helpCore.js.

export const books = [
  { id: "trouble", title: "Troubleshooting", order: 90 },
  { id: "privacy", title: "Privacy and your data", order: 95 },
]

export const topics = [
  // ---------------------------------------------------------------- Troubleshooting
  {
    id: "trouble-start",
    book: "trouble",
    title: "Something's not working: start here",
    summary: "Pick what's wrong and jump to the fix.",
    keywords: ["troubleshooting", "problems", "not working", "help me", "broken", "fix", "bug"],
    body: [
      "Sorry something's not right! Find what's happening below.",
      {
        list: [
          "A game or 98 Messenger says it's connecting or **waking up**: [[server-waking]]",
          "**No sound**, especially on an iPhone: [[no-sound]]",
          "**Notifications** don't come when 98ish is closed: [[push-setup]]",
          "**Drive C: is full**, or a photo won't save: [[storage-full]]",
          "A **call** won't connect, or drops: [[calls-trouble]]",
          "The **on-screen keyboard** is in the way, or you need emoji or AutoFill: [[keyboard-trouble]]",
          "Your **files are missing**: [[lost-files]]",
          "A **game** is stuck or acting up: [[game-trouble]]",
          "You want to **start over** or clear things out: [[reset-data]]",
          "You **forgot your PIN**: [[forgot-pin]]",
        ],
      },
      { h: "Quick things that fix a lot" },
      {
        steps: [
          "Close the program and open it again.",
          "Reload the page (pull down in Safari, or the reload button in your browser). Your files and settings are kept.",
          "Check that your phone or computer is online.",
          "Wait a minute and try again: the 98ish server may be waking up.",
        ],
        title: "Try these first:",
      },
      { tip: "Found a real bug, or have an idea? Welcome to 98ish > Get involved > **Send feedback** opens the 98ish page on GitHub, where you can tell us about it." },
    ],
    related: ["server-waking", "no-sound", "reset-data", "privacy-overview"],
  },
  {
    id: "server-waking",
    book: "trouble",
    title: "\"Waking up the server\" and connection problems",
    summary: "Online games, 98 Messenger and Mail need the 98ish server, which can take up to a minute to wake up.",
    keywords: ["waking up", "server", "connecting", "reconnecting", "can't connect", "offline", "slow to sign on", "game server"],
    body: [
      "Everything you do with other people (98 Messenger, Mail, online games, shared calendars, Us, file sync) goes through the 98ish server. It runs on a free plan, which can take a nap when nobody has used it for a while.",
      "When that happens you'll see something like **Waking up the game server...** with a seconds counter, or 98 Messenger stays on **Connecting...**. Waking up takes **up to about a minute**. Just wait; it connects by itself.",
      { h: "What the messages mean" },
      {
        table: {
          head: ["You see", "What to do"],
          rows: [
            ["Connecting... / Waking up the game server...", "Wait up to a minute."],
            ["Reconnecting...", "The connection blinked (a phone going to sleep, a tunnel). It comes back by itself."],
            ["You're not connected to the internet", "Check Wi-Fi or cellular data, then press **Try Again**."],
            ["Can't reach the game server right now", "Check your connection and press **Try Again** in a minute."],
          ],
        },
      },
      { note: "Things you do alone (your files, Notepad, Paint, playing the computer in most games) work without the server, even offline once 98ish has loaded." },
      { tip: "A Calendar or Dream House change that couldn't reach the server says so, and is sent again when the server is back." },
    ],
    related: ["trouble-start", "online-play", "messenger", "game-trouble"],
  },
  {
    id: "no-sound",
    book: "trouble",
    title: "No sound (especially on iPhone)",
    summary: "Sound starts after your first tap; check the volume, the ringer switch and the 98ish speaker.",
    keywords: ["no sound", "silent", "mute", "audio", "iPhone sound", "ringer switch", "volume", "can't hear"],
    body: [
      "Browsers don't let a web page make any sound until you've **tapped or clicked** something. So the startup chime, game music and other sounds start after your first tap. That's normal.",
      { h: "Still quiet? Check these" },
      {
        steps: [
          "Tap anywhere in 98ish once, then try again.",
          "Check the **speaker** in the 98ish taskbar: is it muted, or the slider all the way down?",
          "Turn up your phone's or computer's own volume.",
          "On iPhone, check the **ring/silent switch** (or Action button) on the side. In silent mode iPhones mute most web page sounds. The Media Player plays through it, like a music app.",
          "Make sure **Play system sounds** is ticked in Sounds (Control Panel) if it's the dings and clicks you're missing.",
          "If 98ish was in the background, tap once after coming back: iPhones pause web sound in the background.",
        ],
        title: "To get sound back:",
      },
      { note: "During a 98 Messenger call, your iPhone picks the speaker or earpiece itself. Use the volume buttons, or Control Center to switch to headphones." },
      { open: "Sounds", label: "Open Sounds" },
    ],
    related: ["sounds", "messenger-calls", "trouble-start"],
  },
  {
    id: "push-setup",
    book: "trouble",
    title: "Notifications don't come when 98ish is closed",
    summary: "On iPhone, notifications need 98ish on the Home Screen (iOS 16.4 or later), turned on from Notifications settings.",
    keywords: ["push notifications", "notifications not working", "no notifications", "iPhone notifications", "Home Screen", "quiet hours", "test notification"],
    body: [
      "While 98ish is open, everything shows in the bell (the Notification Center) on the taskbar. To get IMs, calls, reminders and more **when 98ish is closed**, turn on notifications for each device. You need to be signed on to 98 Messenger: notifications go to your screen name.",
      { h: "On an iPhone" },
      "iPhones only send notifications to web apps that are on the **Home Screen**, and it needs **iOS 16.4 or later**.",
      {
        steps: [
          "Open 98ish in **Safari**.",
          "Tap the **Share** button (the square with an arrow), scroll down and tap **Add to Home Screen**, then **Add**.",
          "Open **98ish from your Home Screen** (not Safari) and sign on to 98 Messenger.",
          "Open Start > Settings > **Notifications...** and tap **Turn on notifications**, then **Allow**.",
          "Tap **Send a test** to check it works.",
        ],
        title: "To turn them on:",
      },
      { shell: "notification-settings", label: "Open Notifications settings" },
      { h: "Still nothing?" },
      {
        list: [
          "If it says notifications are **blocked**, allow them in iPhone Settings > Notifications > 98ish (or your browser's site settings), then come back.",
          "Check **Quiet hours** in the Notifications settings. Calls can ring through if you tick **Let calls ring through**.",
          "Check the kinds under **Notify me about** (Instant messages, Calls, Calendar reminders, Us, Mail, Game invitations).",
          "Notifications only arrive when you're away from 98ish (signed off, or 98ish closed or in the background). While you're using it, they show in the bell instead.",
          "If it says notifications aren't set up on this server, there's nothing to fix on your side.",
        ],
      },
      { note: "A closed 98ish can't ring like a phone call. An incoming call shows as a notification; tap it to open 98ish and answer while it's still ringing." },
    ],
    related: ["notifications", "home-screen", "messenger-calls", "calendar"],
  },
  {
    id: "storage-full",
    book: "trouble",
    title: "\"Drive C: is full\"",
    summary: "Make room on drive C:, keep your files from being cleared, and why a private window has less space.",
    keywords: ["drive full", "disk full", "out of space", "storage full", "can't save", "private browsing", "not enough space"],
    body: [
      "98ish keeps your files in your browser, on this device. If the browser runs out of the space it gives 98ish, saving fails with **Drive C: is full**.",
      {
        steps: [
          "Delete files you don't need, especially big photos and videos in My Pictures.",
          "**Empty the Recycle Bin** (right-click it, or the button in Control Panel > Storage). Deleted files still take space until you do.",
          "Try saving again.",
        ],
        title: "To make room:",
      },
      "**Control Panel > Storage** shows how much 98ish uses and how much is free on this device. In My Computer, right-click drive C: and choose Properties for the same picture.",
      { open: "Storage", label: "Open Storage" },
      { h: "Keep your files safe" },
      "Browsers may clear a website's files when a device runs very low on space. In Storage, click **Keep my files on this device** to ask the browser not to. Browsers usually agree once 98ish is added to the Home Screen or used often.",
      { h: "Private windows" },
      "In a private (incognito) window, some browsers won't give 98ish its bigger storage, so your files go in a small one (about 5 MB), and private windows usually forget everything when they close. 98ish shows a notice when that happens. Use a normal window to keep your files.",
      { tip: "Make a Backup now and then, or turn on file sync, so a full or cleared device never costs you your files." },
    ],
    related: ["storage", "recycle-bin", "backup", "file-sync", "reset-data"],
  },
  {
    id: "reset-data",
    book: "trouble",
    title: "Starting over and clearing data safely",
    summary: "Back up first, then clear just what you need: a user, the Recycle Bin, or all of 98ish's data in the browser.",
    keywords: ["reset", "clear data", "start over", "delete everything", "website data", "clear cache", "fresh start", "remove 98ish"],
    body: [
      { warning: "Clearing 98ish's website data deletes **everything 98ish keeps on this device**: your files and photos, settings, game scores and saves, and every user profile. It can't be undone. Back up first." },
      {
        steps: ["Open **Backup** (Start > Programs > System Tools).", "Click **Back up to your computer**. A .98ish file is saved to your Downloads.", "Or turn on **Sync with 98 Messenger** so My Documents, My Pictures and the Desktop are kept online."],
        title: "Back up first:",
      },
      { open: "Backup", label: "Open Backup" },
      { h: "Try something smaller first" },
      {
        list: [
          "Too many files? Delete them and empty the Recycle Bin.",
          "Too many icons? Hide programs with [[add-remove|Add/Remove Programs]].",
          "Someone else's things? Remove their user profile in Passwords and Users (this deletes only their data).",
          "A messy desktop look? Pick Windows 98ish Standard in Desktop Themes.",
          "Want an old version of your drive back? Backup > **Restore from a backup** replaces everything on C: with the backup.",
        ],
      },
      { h: "Clearing all of 98ish's data" },
      {
        phone: "iPhone (Safari): Settings > Apps > Safari (or Settings > Safari on older iPhones) > Advanced > Website Data, find 98ish.vercel.app and delete it. If 98ish is on your Home Screen, it keeps its own data: deleting the Home Screen icon removes that copy.",
        computer: "Chrome or Edge: click the icon at the left of the address bar, choose Site settings, then Delete data. Firefox and Safari have similar options in their privacy settings.",
      },
      { note: "This only clears this device. Your 98 Messenger account, mail, server calendars, synced files and Us things stay on the server, and come back when you sign on again." },
    ],
    related: ["backup", "storage-full", "users", "privacy-delete"],
  },
  {
    id: "calls-trouble",
    book: "trouble",
    title: "Calls won't connect, or have no picture or sound",
    summary: "Fixes for 98 Messenger voice and video calls: permissions, Wi-Fi vs cellular, and keeping 98ish open.",
    keywords: ["call failed", "call won't connect", "video call problem", "microphone", "camera blocked", "cellular", "Wi-Fi", "call dropped"],
    body: [
      "98 Messenger calls go straight from one device to the other. Most Wi-Fi works fine. Some networks, often **cellular data** or a strict work or school Wi-Fi, block direct connections. Then the call rings and is answered, but after about 30 seconds it says it **couldn't connect**.",
      {
        steps: ["Try again with **both of you on Wi-Fi**.", "If one of you is on cellular, switch that phone to Wi-Fi (or the other way around) and call again."],
        title: "If a call couldn't connect:",
      },
      { h: "Camera or microphone problems" },
      {
        list: [
          "**98ish isn't allowed to use your camera/microphone:** allow it in your browser's site settings. On iPhone: Settings > Safari > Camera and Microphone (or Settings > Apps > Safari).",
          "**No camera or microphone was found:** plug one in, or use a device that has one.",
          "**Being used by another app:** close the other app (a video chat, the Camera app) and try again.",
          "**Your camera stopped:** tap **Camera On** to turn it back on.",
        ],
      },
      { h: "On an iPhone" },
      "Keep 98ish open and on screen during the call: Safari pauses calls in the background or when the screen locks.",
      { note: "Calls need you both signed on to 98 Messenger. If the other person is signed off with notifications on, their phone gets a notification and the call can still reach them if they open 98ish while it rings." },
    ],
    related: ["messenger-calls", "no-sound", "push-setup"],
  },
  {
    id: "keyboard-trouble",
    book: "trouble",
    title: "Keyboard problems on a phone",
    summary: "Hide the 98ish keyboard, switch to your phone's own keyboard for emoji, dictation or AutoFill, or turn it off.",
    keywords: ["keyboard", "on-screen keyboard", "emoji", "dictation", "AutoFill", "keyboard covers buttons", "phone keyboard"],
    body: [
      "On touch screens, 98ish types with its own **98ish keyboard**, a Windows 98-style keyboard that sits above the taskbar. It stays up while you tap around, so it doesn't jump up and down.",
      { h: "Common fixes" },
      {
        list: [
          "**It's covering a button:** tap the **X** in the keyboard's title bar (Hide keyboard), then tap the button.",
          "**You need emoji, dictation, another language or password AutoFill:** tap the **phone button** in the keyboard's title bar. That box switches to your phone's own keyboard. On a password box, the **Passwords** button does the same for AutoFill.",
          "**You'd rather always use your phone's keyboard:** open Start > Settings > Keyboard and choose **My phone's own keyboard**.",
          "**Key clicks or vibration bother you:** turn them off under **While typing** in Keyboard Properties.",
        ],
      },
      { open: "Keyboard Properties", label: "Open Keyboard Properties" },
    ],
    related: ["phone-keyboard", "phone-basics"],
  },
  {
    id: "lost-files",
    book: "trouble",
    title: "Where did my files go?",
    summary: "Check the Recycle Bin, the right user, the right browser or Home Screen app, and file sync.",
    keywords: ["lost files", "missing files", "deleted by mistake", "undelete", "recover", "files gone", "(from iPhone)"],
    body: [
      "Files almost never just disappear. Check these, in order:",
      {
        steps: [
          "**The Recycle Bin.** Deleted files go there. Open it, select the file and choose Restore.",
          "**The right person.** If several people use this device, each user has their own files. Check who's logged on (Start > Log Off shows the name).",
          "**The same browser.** Each browser keeps its own 98ish. On iPhone, 98ish opened from the **Home Screen** keeps its files separate from 98ish in **Safari**.",
          "**Search.** Type the file's name in the Start menu's search box, or use Find.",
          "**File sync.** If you sync with 98 Messenger, sign on and let it catch up (Backup > Sync Now). A file deleted on another device lands in this device's Recycle Bin.",
          "**A backup.** Backup > Restore from a backup puts back everything from a .98ish file (it replaces what's on C: now).",
        ],
        title: "To find a missing file:",
      },
      { note: "If a file was changed on two devices before they synced, both copies are kept: one gets a name like \"Notes (from iPhone)\"." },
      { warning: "Files deleted with the DEL command in the MS-DOS Prompt skip the Recycle Bin and are gone for good." },
    ],
    related: ["recycle-bin", "file-sync", "backup", "users", "search"],
  },
  {
    id: "game-trouble",
    book: "trouble",
    title: "Game problems",
    summary: "What to do when a game is stuck, an online match won't start, or the controls get in the way.",
    keywords: ["game stuck", "game frozen", "lag", "online game problem", "controls", "can't join room", "opponent left"],
    body: [
      { h: "A game is stuck or slow" },
      {
        list: [
          "Close the game window and open it again.",
          "Close other big games you have open: the 3D ones (Pickleball 98, Shred 98, SPECTRA) use a lot of power.",
          "Reload the page if it still misbehaves. Your scores are kept.",
        ],
      },
      { h: "Online play" },
      {
        list: [
          "**Waiting a long time to connect:** the server may be waking up. See [[server-waking]].",
          "**A room code doesn't work:** check the letters, and make sure the room is still open (the host may have left). Codes are for the same game.",
          "**Nobody in Quick Match:** choose Play the Computer, or invite a friend with a room code.",
          "**Someone dropped out:** a computer player takes over their seat, so the game keeps going.",
        ],
      },
      { h: "On a phone" },
      "The on-screen buttons can be moved and resized if they cover something: see [[touch-controls]]. Turning the phone sideways gives some games more room.",
      { tip: "No sound in a game? See [[no-sound]]." },
    ],
    related: ["online-play", "touch-controls", "server-waking", "no-sound"],
  },

  // ---------------------------------------------------------------- Privacy
  {
    id: "privacy-overview",
    book: "privacy",
    title: "What 98ish keeps, and where",
    summary: "Most of 98ish lives only on your device. Here's what stays with you and what goes to the 98ish server.",
    keywords: ["privacy", "data", "where is my data stored", "local storage", "on this device", "personal information"],
    body: [
      "98ish is built so that most of your things never leave your device.",
      { h: "Only on this device (in your browser)" },
      {
        list: [
          "Your **files and photos** on drive C: (unless you turn on file sync).",
          "Your **settings**: wallpaper, theme, sounds, accessibility, and game scores and saves.",
          "**Notepad, WordPad, Paint** documents, Camera photos and Sound Recorder clips.",
          "**Appward 98**'s workspace, and calendars marked **On this device**.",
          "Your **lock screen PIN or password**, stored only as a scrambled (salted and hashed) copy.",
          "Each **user profile** keeps its own copy of all of the above.",
        ],
      },
      { h: "On the 98ish server (when you use them)" },
      {
        list: [
          "Your **98 Messenger account**: screen name, password (stored scrambled), profile, buddy list and away message.",
          "**98ish Mail** messages and attachments, and **calendars** you keep on the server.",
          "Your **Address Book**, if you sign on (it syncs per account).",
          "**Synced files**, only if you turn on sync in Backup.",
          "**Us** things between you and your partner, and shared games (Sunny Acres towns, Dream House, Our Pet, quizzes, puzzles).",
          "**Public** things: published homepages and Guestbook entries.",
        ],
      },
      "Read more in [[privacy-server]].",
    ],
    related: ["privacy-server", "privacy-couples", "privacy-delete", "users"],
  },
  {
    id: "privacy-server",
    book: "privacy",
    title: "What the 98ish server sees",
    summary: "How messages, calls, online games and other services travel, and what other sites are involved.",
    keywords: ["server", "what the server sees", "messages privacy", "call privacy", "IP address", "security", "who can see"],
    body: [
      "Here's how the online parts of 98ish work, in plain words.",
      {
        list: [
          "**Instant messages** pass through the server to your buddy. They aren't saved there, except an IM sent to someone who's signed off with notifications on: it waits on the server until they sign on. Your conversations are kept only while 98ish is open; they aren't saved on the device.",
          "**Calls** go directly between the two devices. The server only helps them find each other (who's calling whom, and connection details). It doesn't carry your voice or video.",
          "**Mail** is stored on the server so it's there when you sign on anywhere. Each person keeps their own copy.",
          "**Online games** and **game chat** go through the server while you play. Game chat keeps the last few messages in memory for people who join later.",
          "**Network Neighborhood** shows every open 98ish to everyone online: under your screen name if you're signed on, or as GUEST-XXXX if not.",
          "**Your password** is stored scrambled. \"Sign me on automatically\" keeps a sign-on key on your device; the server keeps only a scrambled copy of it.",
          "To stop password guessing, the server counts failed sign-ons for a few minutes.",
        ],
      },
      { h: "Other websites" },
      {
        list: [
          "**Internet Explorer's time machine** fetches old pages from the Internet Archive (web.archive.org).",
          "**YouTube '98** searches and plays videos from YouTube.",
          "**Notifications** to your phone are delivered by your phone's or browser's own push service (Apple, Google or Mozilla).",
          "**My Projects** are separate websites.",
        ],
      },
      { note: "98ish is a small hobby project run by friends, not a company. Don't use it for anything truly secret." },
    ],
    related: ["privacy-overview", "privacy-couples", "messenger-calls", "push-setup"],
  },
  {
    id: "privacy-couples",
    book: "privacy",
    title: "Privacy for couples (Us)",
    summary: "What you share in Us is only for the two of you, and unpairing hides it right away.",
    keywords: ["couples privacy", "Us privacy", "love letters privacy", "unpair", "partner", "who can see"],
    body: [
      "Everything you share in **Us** (Love Letters, Our Story and its photos, flowers, and your Us calendar) can only be seen by your two 98 Messenger accounts. Anyone else asking the server for it is turned away.",
      { list: ["**Sealed letters** stay sealed on the server until their day: not even the person they're for can open them early.", "Your **Us calendar** is visible only while you're paired.", "Shared games like Our Pet and Dream House belong to the two of you."] },
      { h: "Unpairing" },
      "In Us you can **Unpair**. That hides everything you share right away, for both of you. It's kept for 30 days in case you pair up again, then deleted for good. To delete it immediately, tick **Delete our letters, story and photos now** when you unpair.",
      { open: "Us", label: "Open Us" },
    ],
    related: ["us-pairing", "us-together", "privacy-overview", "privacy-delete"],
  },
  {
    id: "privacy-delete",
    book: "privacy",
    title: "Deleting your things",
    summary: "How to remove files, synced copies, a user, couple data, a homepage, or everything on a device.",
    keywords: ["delete my data", "remove data", "unpublish", "delete online files", "forget me", "erase"],
    body: [
      "You're in charge of what 98ish keeps. Here's how to remove each kind of thing:",
      {
        table: {
          head: ["What", "How"],
          rows: [
            ["A file", "Delete it, then empty the Recycle Bin."],
            ["Synced copies online", "Backup > Sync with 98 Messenger > delete online files. The files on your devices stay; sync turns off."],
            ["Someone's profile on this device", "Passwords and Users > User Profiles > Remove."],
            ["Us letters, story and photos", "Unpair in Us and tick Delete our letters, story and photos now."],
            ["Your homepage", "HomePage Studio > Unpublish. Your draft stays on your device."],
            ["Mail", "Delete it, then empty Deleted Items in 98ish Mail."],
            ["Everything on this device", "Clear the website data (see [[reset-data]])."],
          ],
        },
      },
      { warning: "Deleting can't be undone. Make a Backup first if you might want something back." },
      { note: "Guestbook entries are public. Ask the 98ish owners (Welcome to 98ish > Get involved) if you want one taken down, or to have your 98 Messenger account removed." },
    ],
    related: ["reset-data", "privacy-overview", "privacy-couples", "backup"],
  },
]
