// The video player behind Watch Together: the official YouTube IFrame Player API (an
// allowed embed: the video streams from YouTube to each person, nothing is downloaded), or
// a stand-in with the same shape for tests (localStorage "98ish.together.stub" = "1", or
// window.__togetherStub = true): it "plays" by the clock, so headless tests can check sync.
//
// createPlayer(host, { onState, onError, onReady }) -> Promise<player>
//   player.load(videoId, startSeconds, play)  player.play()  player.pause()  player.seek(s)
//   player.time()  player.duration()  player.state() ("unstarted" | "playing" | "paused" |
//   "buffering" | "ended" | "cued")  player.title()  player.videoId()  player.setRate(r)
//   player.volume() / player.setVolume(0..100)   player.destroy()

const STATES = { "-1": "unstarted", 0: "ended", 1: "playing", 2: "paused", 3: "buffering", 5: "cued" }

export const useStub = () => {
  try {
    return window.__togetherStub === true || localStorage.getItem("98ish.together.stub") === "1"
  } catch {
    return false
  }
}

let api = null
const loadApi = () => {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (api) return api
  api = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      resolve(window.YT)
    }
    const script = document.createElement("script")
    script.src = "https://www.youtube.com/iframe_api"
    script.async = true
    script.onerror = () => {
      api = null
      reject(new Error("YouTube couldn't load. Check your connection."))
    }
    document.head.appendChild(script)
    setTimeout(() => {
      if (!window.YT?.Player) {
        api = null
        reject(new Error("YouTube is taking too long to load."))
      }
    }, 20_000)
  })
  return api
}

const youTubePlayer = async (host, { onState, onError, onReady }) => {
  const YT = await loadApi()
  const mount = document.createElement("div")
  host.appendChild(mount)
  let player = null
  let ready = false
  let currentId = null
  await new Promise((resolve) => {
    player = new YT.Player(mount, {
      width: "100%",
      height: "100%",
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 1, origin: window.location.origin, enablejsapi: 1 },
      events: {
        onReady: () => {
          ready = true
          resolve()
          onReady?.()
        },
        onStateChange: (e) => onState?.(STATES[e.data] || "unstarted"),
        onError: (e) => {
          // 2 bad id, 5 HTML5 error, 100 removed/private, 101/150 owner blocks embedding
          const text = e.data === 100 ? "This video is private or was removed." : e.data === 101 || e.data === 150 ? "This video's owner doesn't allow it to play outside YouTube." : "This video can't be played."
          onError?.(text, e.data)
        },
      },
    })
  })
  const safe = (fn, fallback) => {
    try {
      return ready ? fn() : fallback
    } catch {
      return fallback
    }
  }
  return {
    kind: "youtube",
    load: (id, start = 0, play = true) =>
      safe(() => {
        currentId = id
        if (play) player.loadVideoById({ videoId: id, startSeconds: start })
        else player.cueVideoById({ videoId: id, startSeconds: start })
      }),
    play: () => safe(() => player.playVideo()),
    pause: () => safe(() => player.pauseVideo()),
    seek: (s) => safe(() => player.seekTo(s, true)),
    time: () => safe(() => player.getCurrentTime() || 0, 0),
    duration: () => safe(() => player.getDuration() || 0, 0),
    state: () => safe(() => STATES[player.getPlayerState()] || "unstarted", "unstarted"),
    title: () => safe(() => player.getVideoData()?.title || "", ""),
    videoId: () => currentId,
    setRate: (r) => safe(() => player.setPlaybackRate(r)),
    volume: () => safe(() => player.getVolume(), 100),
    setVolume: (v) => safe(() => player.setVolume(Math.max(0, Math.min(100, Math.round(v))))),
    destroy: () => {
      try {
        player?.destroy()
      } catch {
        // gone
      }
      mount.remove()
    },
  }
}

// plays by the clock; durations are 5 minutes
const stubPlayer = async (host, { onState, onReady }) => {
  const box = document.createElement("div")
  box.className = "tgStub"
  host.appendChild(box)
  let id = null
  let base = 0
  let since = null // playing since (ms) or null
  let rate = 1
  let vol = 100
  let state = "unstarted"
  const DURATION = 300
  const time = () => Math.min(DURATION, since === null ? base : base + ((Date.now() - since) / 1000) * rate)
  const setState = (s) => {
    if (state === s) return
    state = s
    onState?.(s)
  }
  const draw = () => {
    box.textContent = id ? `[stub video ${id}] ${state} ${time().toFixed(1)}s` : "[stub player]"
  }
  const timer = setInterval(() => {
    if (since !== null && time() >= DURATION) {
      base = DURATION
      since = null
      setState("ended")
    }
    draw()
  }, 100)
  const player = {
    kind: "stub",
    load: (vid, start = 0, play = true) => {
      id = vid
      base = start
      since = play ? Date.now() : null
      setState(play ? "playing" : "cued")
    },
    play: () => {
      if (!id || since !== null) return
      since = Date.now()
      setState("playing")
    },
    pause: () => {
      if (since === null) return
      base = time()
      since = null
      setState("paused")
    },
    seek: (s) => {
      base = Math.max(0, Math.min(DURATION, s))
      if (since !== null) since = Date.now()
    },
    time,
    duration: () => (id ? DURATION : 0),
    state: () => state,
    title: () => (id ? `Stub video ${id}` : ""),
    videoId: () => id,
    setRate: (r) => {
      base = time()
      if (since !== null) since = Date.now()
      rate = r
    },
    volume: () => vol,
    setVolume: (v) => {
      vol = Math.max(0, Math.min(100, Math.round(v)))
    },
    destroy: () => {
      clearInterval(timer)
      box.remove()
    },
  }
  window.__togetherPlayer = player
  setTimeout(() => onReady?.(), 0)
  return player
}

export const createPlayer = (host, handlers) => (useStub() ? stubPlayer(host, handlers) : youTubePlayer(host, handlers))
