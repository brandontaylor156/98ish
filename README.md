# 98ish

*A simulated operating system in a nostalgic style. Created by the Brandon Taylor and Cameron De Robertis, the fresh minds behind Simul8-OS*

![Demo Filesystem](github_assets/demo-filesystem.png)

## Features

- **A Windows 98 desktop:** a startup screen and chime, a Start menu with cascading submenus, Find, Run..., Log Off
  and Shut Down (including Restart in MS-DOS mode and "It's now safe to turn off your computer"). Right-click the
  desktop (or long-press on a phone) to arrange icons or make new folders and documents right on the desktop.
  System sounds, screensavers (3D Pipes, Starfield, Mystify, Flying 98ish, Marquee, Beziers), Display Properties
  (wallpapers, your own picture, color schemes) and Date/Time Properties
- **Files that stay put:** a file system saved in your browser. My Computer has cut / copy / paste, drag and drop
  (including to and from the desktop), shortcuts, rename, text file import, picture thumbnails and a Recycle Bin
- **Accessories:** Notepad (Find/Replace, Word Wrap, fonts, .LOG), Paint (every classic tool, saves pictures to the
  drive, Set As Wallpaper), Calculator (Standard and Scientific), Character Map, and an MS-DOS Prompt with DIR, CD,
  COPY, DEL, TREE, EDIT, START, redirection, history and Tab completion
- **Games:** Solitaire and FreeCell (the classic numbered deals), Minesweeper, Tetris, Hearts, SPECTRA (a three.js
  tunnel flyer) and Hover
- **Media Player** with eight original synthesized songs, played live with Web Audio
- **Internet Explorer** with a Wayback Machine time machine: browse the web as it was on any date, plus the 98ish
  Guestbook and web ring
- **98 Messenger**, an AIM-style instant messenger: screen names with passwords, a Buddy List, away messages,
  profiles, typing indicators, warnings, Buddy Chat rooms and SmarterChild, a scripted buddy bot
- **Network Neighborhood:** see who else is on 98ish right now, send them text files or a WinPopup message, and
  challenge them to Checkers, a Minesweeper race or Hearts (computer players fill empty seats)
- **Extras:** 98ish Update, Floppy the helper, and whatever happens if you end explorer.exe in Task Manager

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
| `MONGODB_URI` | MongoDB connection string (e.g. a free MongoDB Atlas cluster) where 98 Messenger accounts, buddy lists and profiles, and the guestbook and its hit counter, are stored. Without it they live in memory and vanish whenever the server restarts |

**Keeping the chat server awake:** Render's free plan sleeps after 15 idle minutes, and the first visitor then waits
20-50 seconds for 98 Messenger to connect. `.github/workflows/keepalive.yml` pings the server every 10 minutes from
GitHub Actions, which is free for public repositories. GitHub pauses scheduled workflows after 60 days without a
commit; turn it back on from the repo's **Actions** tab if that happens.
