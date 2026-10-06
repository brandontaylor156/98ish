// Task Manager's real numbers (the owner chose real over the old simulated NT machine,
// 2026-10-06). A web page can't see other apps or per-window CPU, so it measures what the
// browser does allow and says plainly when something isn't available:
//   busy      how much of the time the page's main thread was busy (long tasks where the
//             browser reports them, otherwise how late short timers fire)
//   fps       frames drawn per second
//   heap      the page's JavaScript memory (Chrome and Edge only; null elsewhere)
//   ping      round trip to the 98ish server, ms (null while offline)

const SERVER_URL = import.meta.env?.VITE_SOCKET_URL || "http://localhost:8000"

// busy % from the long tasks in an interval (each task's part inside it)
export const busyFromLongTasks = (tasks, from, to) => {
  const span = to - from
  if (span <= 0) return 0
  let busy = 0
  for (const t of tasks) {
    const start = Math.max(from, t.startTime)
    const end = Math.min(to, t.startTime + t.duration)
    if (end > start) busy += end - start
  }
  return Math.max(0, Math.min(100, Math.round((busy / span) * 100)))
}

// busy % from timer lateness: probes meant to fire every `every` ms that fired `late` ms late
export const busyFromLag = (lates, every) => {
  if (!lates.length) return 0
  const total = lates.reduce((a, b) => a + Math.max(0, b), 0)
  return Math.max(0, Math.min(100, Math.round((total / (total + lates.length * every)) * 100)))
}

export const createMonitor = () => {
  const longTasks = []
  let observer = null
  try {
    if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
      observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) longTasks.push({ startTime: e.startTime, duration: e.duration })
        if (longTasks.length > 500) longTasks.splice(0, longTasks.length - 500)
      })
      observer.observe({ type: "longtask", buffered: false })
    }
  } catch {
    observer = null
  }
  // timer lateness (Safari has no long tasks)
  const EVERY = 100
  const lates = []
  let probe = null
  let expected = 0
  const tick = () => {
    const now = performance.now()
    lates.push(now - expected)
    if (lates.length > 200) lates.shift()
    expected = now + EVERY
    probe = setTimeout(tick, EVERY)
  }
  if (!observer) {
    expected = performance.now() + EVERY
    probe = setTimeout(tick, EVERY)
  }
  // frames
  let frames = 0
  let raf = 0
  const frame = () => {
    frames++
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
  // the server round trip, every few seconds
  let ping = null
  let pinging = false
  const pingNow = async () => {
    if (pinging || (typeof navigator !== "undefined" && navigator.onLine === false)) {
      if (navigator.onLine === false) ping = null
      return
    }
    pinging = true
    const t0 = performance.now()
    try {
      await fetch(`${SERVER_URL}/`, { cache: "no-store", mode: "cors" })
      ping = Math.round(performance.now() - t0)
    } catch {
      ping = null
    } finally {
      pinging = false
    }
  }
  pingNow()
  const pinger = setInterval(pingNow, 5000)

  let lastAt = performance.now()
  let lastFrames = 0
  return {
    longTasksSupported: !!observer,
    sample() {
      const now = performance.now()
      const busy = observer ? busyFromLongTasks(longTasks, lastAt, now) : busyFromLag(lates.splice(0), EVERY)
      const fps = Math.round(((frames - lastFrames) * 1000) / Math.max(1, now - lastAt))
      lastAt = now
      lastFrames = frames
      const m = performance.memory
      const heap = m && Number.isFinite(m.usedJSHeapSize) ? { used: m.usedJSHeapSize, total: m.totalJSHeapSize, limit: m.jsHeapSizeLimit } : null
      return { busy, fps, heap, ping, at: now }
    },
    stop() {
      observer?.disconnect()
      clearTimeout(probe)
      cancelAnimationFrame(raf)
      clearInterval(pinger)
    },
  }
}
