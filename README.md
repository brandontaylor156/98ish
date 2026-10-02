# 98ish

*A simulated operating system in a nostalgic style. Created by the Brandon Taylor and Cameron De Robertis, the fresh minds behind Simul8-OS*

![Demo Filesystem](github_assets/demo-filesystem.png)

## Features

- **A Windows 98 desktop:** startup screen and chime, Start menu with cascading submenus, Run..., Log Off and Shut
  Down (including Restart in MS-DOS mode). A taskbar with Quick Launch, a tray (volume, network, mail), Cascade /
  Tile, an Alt+Q window switcher and keyboard shortcuts (Ctrl+Alt+E / D / R / K). Right-click the desktop (or
  long-press on a phone) to make files and folders right there
- **Make it yours:** Display Properties (wallpapers, your own picture, color schemes, screensavers), Desktop Themes
  (Space, Underwater, Vaporwave, Dinosaurs: wallpaper, colors, sounds and pointers together), system sounds and
  Date/Time Properties
- **Install it on your phone:** add 98ish to the home screen and it opens like an app, and works offline after the
  first visit (chat, multiplayer and the web need a connection)
- **Files:** a drive saved in your browser, with My Computer (cut / copy / paste, drag and drop, shortcuts, picture
  thumbnails, a Recycle Bin), upload from and download to your real computer (folders as .zip), Backup / Restore of
  the whole drive, and an optional online copy that follows your 98 Messenger account to other devices
- **Accessories:** Notepad, WordPad (fonts, colors, pictures, printing), Paint, Sound Recorder (record, reverse,
  echo...), Calculator, Character Map and an MS-DOS Prompt
- **Games:** Tetris (Marathon, Sprint 40L, Ultra, Survival, and Tetris Online: Battle 2P, a 2-6 player Arena
  with items and Sprint races, with Quick Match, computer players and star rankings), Sunny Acres (a farming and
  town-building game), Block Ten (a 10x10 block puzzle), Pinball: Deep Sea Dive, Solitaire, FreeCell, Minesweeper,
  Downhill, Reversi, Chess, Battleship, Hearts, SPECTRA and Hover. Every game has chat (a private room for a match,
  a lobby for everyone playing it), and on phones you can move and resize the on-screen controls
- **Media Player** with eight original synthesized songs
- **Internet Explorer** with a Wayback Machine time machine, plus 98ish.com: the Guestbook, the Members directory
  and the web ring
- **HomePage Studio:** build a GeoCities-style homepage (marquees, clip art, hit counter, background music) and
  publish it at `www.98ish.com/~yourname`
- **98 Messenger and 98ish Mail:** AIM-style instant messaging (buddy list, away messages, chat rooms,
  SmarterChild) and Outlook Express-style mail with attachments between screen names
- **Network Neighborhood:** see who else is online, send files and pictures, WinPopup messages, and play Checkers,
  Chess, Reversi, Battleship, Hearts or a Minesweeper race against them
- **My Projects:** Baseline Today, Job Market Radar and One Closet open as their own 98ish programs
- **Extras:** 98ish Update, Floppy the helper, 22 hidden achievements (My Computer > Properties), and whatever
  happens if you end explorer.exe

## Demos

![Demo Filesystem](github_assets/demo-filesystem.gif)
![Demo Youtube and Chat](github_assets/demo-youtube-chat.gif)

## Run it locally

```
cp client/.env.example client/.env.local   # then fill in YOUTUBE_KEY
npm install && npm start                   # chat server on :8000 (accounts kept in memory); npm test runs its tests
cd client && npm install && npm run dev    # app on :5173
```

## Deploy

**App (Vercel):** import the repo, set **Root Directory** to `client`, and add these environment variables:

| Name | Value |
| --- | --- |
| `YOUTUBE_KEY` | YouTube Data API v3 key. Server-only; read by `client/api/youtube.js` |
| `VITE_SOCKET_URL` | URL of the chat server below |

**Chat server:** `server.js` holds long-lived Socket.io connections, which Vercel functions can't. Deploy the repo
root to a Node host such as Render, Railway or Fly.io with start command `npm start`. It listens on `$PORT`.
Environment variables:

| Name | Value |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string (e.g. a free MongoDB Atlas cluster) where 98 Messenger accounts, buddy lists and profiles, mail, homepages, online drives, and the guestbook and its hit counters are stored. Without it they live in memory and vanish whenever the server restarts |

**Keeping the chat server awake:** Render's free plan sleeps after 15 idle minutes, and the first visitor then waits
20-50 seconds for 98 Messenger to connect. `.github/workflows/keepalive.yml` pings the server every 10 minutes from
GitHub Actions, which is free for public repositories. GitHub pauses scheduled workflows after 60 days without a
commit; turn it back on from the repo's **Actions** tab if that happens.
