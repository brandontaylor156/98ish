# 98ish

*A simulated operating system in a nostalgic style. Created by the Brandon Taylor and Cameron De Robertis, the fresh minds behind Simul8-OS*

![Demo Filesystem](github_assets/demo-filesystem.png)

## Features

- Draggable, resizable windows with maximized and minimized states, unlimited multitasking, and a phone layout
  where every app fills the screen
- A Windows 98 desktop: a startup screen and chime, a Start menu with cascading Programs / Documents / Favorites /
  Settings submenus, Find, Run..., Log Off and Shut Down (including Restart in MS-DOS mode and "It's now safe to
  turn off your computer"). Right-click the desktop (or long-press on a phone) to arrange icons, make a new
  document or open Display Properties
- Display Properties: wallpapers and patterns, or your own picture; color schemes; turn the startup screen and sound
  on or off
- A file system saved in your browser, so files and folders survive a reload. My Computer has cut / copy / paste,
  rename, drag-and-drop text file import and a Recycle Bin you can restore from or empty
- Notepad, as in Windows 98: Open / Save As dialogs, Find, Replace, Word Wrap, fonts, Time/Date (F5), the "save
  changes?" prompt, and the .LOG trick
- MS-DOS Prompt: DIR, CD, TYPE, COPY, MOVE, REN, DEL, MD, RD, DELTREE, TREE, EDIT, START, COLOR, `>` and `>>`
  redirection, history and Tab completion, all working on the same files as My Computer. Type a program name
  (TETRIS, WINMINE, SPECTRA...) to run it
- Internet Explorer with a Wayback Machine time machine: browse the web as it was on any date
- Games and applets: SPECTRA (a three.js tunnel flyer), Tetris, Minesweeper, Hover, YouTube '98, Task Manager
- 98 Messenger, an AIM-style instant messenger: screen names with passwords, a Buddy List with groups, away
  messages, profiles, typing indicators, warnings, blocking, Buddy Chat rooms, door sounds, and SmarterChild (an
  always-online scripted buddy bot with jokes, trivia and a magic 8-ball). YouTube '98 can share videos to the 98ish
  Lobby chat room

## Demos

![Demo Filesystem](github_assets/demo-filesystem.gif)
![Demo Youtube and Chat](github_assets/demo-youtube-chat.gif)

## Run it locally

```
cp client/.env.example client/.env.local   # then fill in YOUTUBE_KEY
npm install && npm start                   # chat server on :8000 (accounts kept in memory)
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
| `MONGODB_URI` | MongoDB connection string (e.g. a free MongoDB Atlas cluster) where 98 Messenger accounts, buddy lists and profiles are stored. Without it, accounts live in memory and vanish whenever the server restarts |

**Keeping the chat server awake:** Render's free plan sleeps after 15 idle minutes, and the first visitor then waits
20-50 seconds for 98 Messenger to connect. `.github/workflows/keepalive.yml` pings the server every 10 minutes from
GitHub Actions, which is free for public repositories. GitHub pauses scheduled workflows after 60 days without a
commit; turn it back on from the repo's **Actions** tab if that happens.
