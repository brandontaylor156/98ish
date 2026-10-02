# 98ish

*A simulated operating system in a nostalgic style. Created by the Brandon Taylor and Cameron De Robertis, the fresh minds behind Simul8-OS*

![Demo Filesystem](github_assets/demo-filesystem.png)

## Features

- Draggable, resizeable, windows with maximized and minimized states
- Tree data structure for filesystem, including live search of files/directories and built-in text editor
- Several interactive applets (Tetris, Minesweeper, YouTube client, etc.)
- 98 Messenger, an AIM-style instant messenger: screen names with passwords, a Buddy List with groups, away
  messages, profiles, typing indicators, warnings, blocking, Buddy Chat rooms, door sounds, and SmarterChild (an
  always-online scripted buddy bot with jokes, trivia and a magic 8-ball). YouTube '98 can share videos to the 98ish
  Lobby chat room
- Unlimited applet multitasking

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
