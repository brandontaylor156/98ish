# Real-substance audit (2026-10-06)

The owner: "We need to start moving away from sample placeholder data within the apps and create actual usable actionable fully featured and working substance." When shown the starter documents he kept most of them for the aesthetic ("RUN THE DOCS BY ME. Some of them are kinda nice"), so **every category-A item below is a question for him before anything changes.**

Method: every program in `client/src/utils/programs.js` (104 entries) and its applet folder; greps for sample/demo/seed/starter/fake/stub/coming-soon/no-op handlers/hard-coded content arrays/seeded score tables; reading the daily-use apps' empty states; the server for canned responses (`server/aim/bot.js`, `server/net/guestbook.js`, homepages, arcade). Pickleball 98 internals were skimmed only (two other forks are working there).

Categories: **A** charm/aesthetic, intentional 98-era flavor (ask before touching) · **B** placeholder to replace with real data or a real empty state · **C** fake or half-built feature to make work · **D** dead UI to remove or finish. Effort: S/M/L.

## Headline finding

The daily-use apps are already real. Messenger, Photos, Music 98, Notes, Tasks, Calendar, Mail, Address Book, Weather, Camera, Sound Recorder, Paint, WordPad, Notepad, Compass, Internet Explorer, YouTube '98, Network Neighborhood, Control Panel and Find all run on real data (your drive, Messenger accounts, the 98ish server, Open-Meteo, the Wayback Machine, the YouTube API) and show proper empty states ("Your music library is empty.", "No notes yet. Choose New note to write one.", "Your Address Book is empty. Click New Contact, or import a vCard"). No lorem ipsum, no fake contacts or emails, no seeded high-score tables, no "coming soon" dialogs, no no-op menu items were found.

What remains is a short list, mostly deliberate 98-era jokes (A), plus a few real gaps (B/C/D).

## Counts

| Category | Count |
|---|---|
| A (charm, needs the owner's call) | 14 |
| B (placeholder → real) | 4 |
| C (fake/half-built → working) | 3 |
| D (dead UI) | 1 |

## Findings by program (ranked by how much they matter to the group)

### Media Player
| File:line | What you see | Cat | Real version | Effort |
|---|---|---|---|---|
| `applets/mediaPlayer/MediaPlayer.jsx:73`, `mediaPlayer/songs/index.js:11` | With no "music" files on the drive it plays 8 built-in original synthesized songs (Startup, Highway, Fusion, Neon Pop, Ballad, Chiptune, Ambient, Funky). | A | Keep as the "sample music" a 98 PC shipped with, or hide behind Music 98. | S |
| `applets/mediaPlayer/MediaPlayer.jsx:72-73` | It can only play its own sequenced songs; your real MP3/M4A songs (Music 98's `song` files), Sound Recorder `.wav` files and videos don't play here, though Music 98 does. Two music apps, one of them mostly a demo. | C | Make Media Player the 98-style player for any audio/video file on the drive (songs, sounds, videos, opened from My Computer), sharing Music 98's engine; or fold it into Music 98's "Now Playing" skin. | M |

### Appward 98
| File:line | What you see | Cat | Real version | Effort |
|---|---|---|---|---|
| `applets/appward/Splash.jsx:190,231-240`, `seed.js:16-196` | The setup wizard defaults to "Yes, fill my workspace with sample data (recommended)": the fictional Acme Widgets Co., coworkers Raj, Maria and Tom, projects, problems, kudos. | B | Default to an empty workspace with a "Load sample data" button for exploring; or keep sample as an opt-in. | S |
| `applets/appward/Chat.jsx:95-104` | Sample coworkers write back scripted replies when mentioned in Appward chat. | A/B | Real chat between 98ish buddies who share a workspace (shared workspace over the existing sync), canned coworkers only in the sample. | L |

### Photo Puzzle
| File:line | What you see | Cat | Real version | Effort |
|---|---|---|---|---|
| `applets/puzzle/Puzzle.jsx:405-420`, `puzzle/art.js:354` | "Choose a picture" leads with four drawn sample pictures (Sunset Hearts, Flower Garden, Balloon Ride, Starry Night); your own photos are behind "From My Computer..." and "Upload a Photo...". | B | Lead with your most recent photos from My Pictures/Shared Albums as one-tap tiles; keep the samples after them (or for an empty library). | S |

### Clock (Calendar's World Clock)
| File:line | What you see | Cat | Real version | Effort |
|---|---|---|---|---|
| `applets/calendar/clockStore.js:19` | World Clock starts with New York, London and Tokyo. | B | Start with your own zone plus the zones of your Messenger buddies who share one (or just your zone and "Add a city"). | S |

### Speed Typist 98
| File:line | What you see | Cat | Real version | Effort |
|---|---|---|---|---|
| (known issue in CLAUDE.md) | Quick Match waits for people and doesn't add computer racers when nobody's online, so a solo Quick Match never starts. | C | Fill empty seats with clearly labeled computer racers after a few seconds, as Tetris and Hold'em rooms do. | S |

### Task Manager
| File:line | What you see | Cat | Real version | Effort |
|---|---|---|---|---|
| `applets/taskManager/processes.js:1-20`, `TaskManager.jsx:235-583` | A simulated NT process table (smss.exe, csrss.exe...) with fake CPU/memory graphs. | A | Keep as the joke; optionally mix in real numbers (open 98ish windows as processes, `performance.memory`/`deviceMemory` where the browser gives them). | S-M |
| `applets/taskManager/TaskManager.jsx:394` | View > "Select Columns..." is always grayed out. | D | Remove it, or let it toggle the columns that exist. | S |

### System Properties
| File:line | What you see | Cat | Real version | Effort |
|---|---|---|---|---|
| `applets/system/SystemProperties.jsx:80-86` | "98ish Turbo 400 MHz processor, 64.0MB RAM, 3D accelerator with a whole 8MB". | A | Keep the joke, or show the real device (CPU cores via `hardwareConcurrency`, approximate RAM via `deviceMemory`, GPU renderer string, screen) in the same 98 wording. | S |

### 98ish Update (Windows Update)
| File:line | What you see | Cat | Real version | Effort |
|---|---|---|---|---|
| `applets/update/WindowsUpdate.jsx:5-21` | Made-up "critical updates" (Y2K Readiness, Dial-Up Modem Sound Enhancement, Free RAM Upgrade...) downloaded at fake 56k speeds. | A | Keep the joke; or turn it into a real "What's new in 98ish" updater that lists actual recent releases (from the deployed build's changelog) and reloads to the new version. | M |

### MS-DOS Prompt
| File:line | What you see | Cat | Real version | Effort |
|---|---|---|---|---|
| `applets/dos/commands.js:562-573` | `mem` prints a fixed, made-up memory table. | A | Keep, or report real drive usage/browser memory. (Every other command works on the real drive.) | S |

### 98 Messenger / 98ish Mail (server)
| File:line | What you see | Cat | Real version | Effort |
|---|---|---|---|---|
| `server/aim/bot.js:1-160`, `server/aim/index.js:793` | SmarterChild: an always-online scripted buddy (jokes, trivia, games) that also writes scripted replies to mail. | A | Keep as the 2001 classic; optionally let SmarterChild hand questions to Ask Floppy's on-device brain. | S |

### Internet Explorer (98ish.com local sites)
| File:line | What you see | Cat | Real version | Effort |
|---|---|---|---|---|
| `applets/internetExplorer/local/LocalSite.jsx:319-371` | "Minesweeper Strategy Shrine" with an "UNDER CONSTRUCTION / MORE TIPS COMING SOON" banner. | A | Keep (pure 1998), or fill the shrine with real tips from Help. | S |
| `LocalSite.jsx:375-412` | "Cool Links of the Web" (a fixed link list) and "Rocky's Home Page" (a pet rock's page). | A | Keep. (Guestbook, hit counters and Members pages are real.) | — |

### HomePage Studio
| File:line | What you see | Cat | Real version | Effort |
|---|---|---|---|---|
| `applets/homepage/HomePageStudio.jsx:30-46` | A new page starts from a 90s template: "*~*~* Welcome to my corner of the Web!! *~*~*" marquee, a dancing clip-art figure, "This page is all about *me*...", links, counter, guestbook, under-construction GIF, webring. | A | Keep as the starter template (you edit it), or start blank with "Use the classic template". | S |

### Minesweeper
| File:line | What you see | Cat | Real version | Effort |
|---|---|---|---|---|
| `applets/minesweeper/Minesweeper.jsx:36` | Best Times start as "999 seconds, Anonymous", exactly as Windows did. | A | Keep. | — |

### Love Notes screensaver
| File:line | What you see | Cat | Real version | Effort |
|---|---|---|---|---|
| `components/screensavers/savers/lovenotesText.js:5` | Default lines "You are my favorite person / Thinking of you / Have the best day / You make my heart happy" until you type your own. | A | Keep as defaults, or use the latest Love Letters / notes from your partner. | S |

### Dream House
| File:line | What you see | Cat | Real version | Effort |
|---|---|---|---|---|
| `applets/dollhouse/model.js:493-505` | A new house starts furnished (attic, bedroom, bath, living room, kitchen, garden). | A | Keep as the game's starting house, or offer "Start empty". | S |

### Pickleball 98 (skimmed; other forks are working there)
| File:line | What you see | Cat | Real version | Effort |
|---|---|---|---|---|
| `applets/pickleball/twin/` ("Try the demo rally") | Twin Replay, Coach and Clones can be tried on a built-in demo rally before you film anything. | A | Keep; it's labeled and useful. | — |

### Starter documents (already decided 2026-10-06)
Kept by the owner: "Oh wow!", "Look at that", "Isn't that something?", "Sure is", Welcome to WordPad, Hello World, README (refreshed), ~SECRET.TXT. Cover Letter became a real WordPad template.

## Top B/C/D fixes, ranked by value to the group

1. **Media Player plays your real files** (C, M): any song/sound/video on the drive, opened from My Computer, sharing Music 98's engine; ends the "two music apps, one a demo" confusion.
2. **Speed Typist Quick Match fills with computer racers** (C, S): solo Quick Match currently never starts.
3. **Photo Puzzle leads with your own photos** (B, S).
4. **Appward defaults to an empty workspace** with sample data as an opt-in button (B, S).
5. **World Clock starts with your zone (and your buddies')** (B, S).
6. **Task Manager's dead "Select Columns..."** removed or made to work (D, S).
7. **Appward shared workspaces with real buddies instead of scripted coworkers** (A/B → C, L).

(Only 7 B/C/D items exist; the rest of the list is charm for the owner to decide.)

## Questions for the owner (category A)

1. Media Player's 8 built-in songs: keep them as the PC's "sample music", or remove them now that Music 98 plays your own songs?
2. Task Manager's fake NT processes and graphs: keep the joke, or show real numbers (your open windows, browser memory)?
3. System Properties' "98ish Turbo 400 MHz, 64 MB RAM, 8 MB 3D accelerator": keep the joke, or show your phone's real specs in 98 wording?
4. 98ish Update's made-up updates (Y2K Readiness, Free RAM Upgrade...): keep the joke, or make it a real "what's new in 98ish" updater?
5. MS-DOS `mem`'s fixed table: keep, or show real usage?
6. SmarterChild's scripted chat and mail replies: keep as is, or let him pass real questions to Floppy's brain?
7. The Minesweeper Strategy Shrine's "UNDER CONSTRUCTION / MORE TIPS COMING SOON": keep, or fill it with real tips?
8. "Cool Links of the Web" and "Rocky's Home Page" on 98ish.com: keep?
9. HomePage Studio's 90s starter template: keep it as the starting page, or start blank with a "classic template" button?
10. Minesweeper's "999 seconds, Anonymous" best times: keep (it's how Windows did it)?
11. The Love Notes screensaver's default lines: keep, or pull your partner's latest love letters?
12. Dream House's furnished starter house: keep, or offer "start empty"?
13. Twin Replay's demo rally: keep as the try-it-first example?
14. Appward's scripted coworkers (in the sample workspace): keep them in the sample, even if the default becomes an empty workspace?
