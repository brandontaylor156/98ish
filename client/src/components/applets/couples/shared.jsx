import React, { useEffect, useRef, useState } from "react"
import { coupleApi, on, openCouples, serverNow } from "../../../utils/couple"
import { getSettings, masterGain } from "../../../utils/settings"
import { getAudioContext, masterOutput } from "../../../utils/audio"
import { shrinkPicture } from "../homepage/pictures"
import FileDialog from "../notepad/FileDialog"
import { TwoHearts } from "./art"
import "./couples.css"

// Pieces the couple apps share: a soft chime, clocks and countdowns, photos (picked from
// the 98ish drive or this device, shrunk to fit, fetched once and cached) and the panel
// shown when you aren't paired yet.

// ---- sound ----

// (on the page's shared AudioContext, through the taskbar volume)
export const playLoveChime = (kind = "open") => {
  const settings = getSettings()
  if (!settings.systemSounds || !masterGain(settings)) return
  try {
    const audio = getAudioContext()
    if (!audio) return
    if (audio.state !== "running") audio.resume().catch(() => {})
    const out = audio.createGain()
    out.gain.value = 0.32
    out.connect(masterOutput(audio))
    // a music-box arpeggio (opening) or two little notes (something arrived)
    const notes = kind === "open" ? [[659.25, 0], [830.61, 0.12], [987.77, 0.24], [1318.5, 0.38], [1661.2, 0.56]] : [[880, 0], [1318.5, 0.14]]
    for (const [freq, delay] of notes) {
      const t = audio.currentTime + 0.02 + delay
      for (const [mult, level] of [[1, 0.5], [3, 0.06], [4.2, 0.03]]) {
        const osc = audio.createOscillator()
        const gain = audio.createGain()
        osc.type = "sine"
        osc.frequency.setValueAtTime(freq * mult, t)
        gain.gain.setValueAtTime(0, t)
        gain.gain.linearRampToValueAtTime(level, t + 0.008)
        gain.gain.exponentialRampToValueAtTime(0.0005, t + 1.4)
        osc.connect(gain).connect(out)
        osc.start(t)
        osc.stop(t + 1.5)
      }
    }
  } catch {
    // no sound card: the hearts will have to do
  }
}

// ---- time ----

// re-render every `ms` with the server's clock
export const useNow = (ms = 1000) => {
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

export const countdown = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d) return `${d}d ${h}h ${m}m`
  if (h) return `${h}h ${m}m ${s % 60}s`
  return `${m}m ${s % 60}s`
}

export const dateLabel = (time, withTime = true) =>
  new Date(time).toLocaleString([], { month: "short", day: "numeric", year: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}) })

// "2024-02-14" -> a local date
export const parseDay = (day) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ""))
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
}
export const dayLabel = (day) => parseDay(day)?.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" }) || ""

// "1 year, 3 months, 12 days" from a start day to now
export const togetherFor = (start, now = serverNow()) => {
  const from = start instanceof Date ? start : typeof start === "number" ? new Date(start) : parseDay(start)
  if (!from || Number.isNaN(from.getTime())) return null
  const to = new Date(now)
  let years = to.getFullYear() - from.getFullYear()
  let months = to.getMonth() - from.getMonth()
  let days = to.getDate() - from.getDate()
  if (days < 0) {
    months--
    days += new Date(to.getFullYear(), to.getMonth(), 0).getDate()
  }
  if (months < 0) {
    years--
    months += 12
  }
  if (years < 0) return { years: 0, months: 0, days: 0, text: "Starting soon" }
  const part = (n, word) => (n ? `${n} ${word}${n === 1 ? "" : "s"}` : null)
  const text = [part(years, "year"), part(months, "month"), part(days, "day")].filter(Boolean).join(", ") || "Today!"
  return { years, months, days, text }
}

// "Together for 1 year, 3 months, 12 days" (or "since today")
export const TogetherLine = ({ together }) =>
  together.years + together.months + together.days === 0 ? (
    <>
      Together since <b>today</b> ♥
    </>
  ) : (
    <>
      Together for <b>{together.text}</b>
    </>
  )

// the next time this date comes around (9 in the morning), for "open on our anniversary"
export const nextAnniversary = (day, now = serverNow()) => {
  const start = parseDay(day)
  if (!start) return null
  const at = new Date(new Date(now).getFullYear(), start.getMonth(), start.getDate(), 9)
  if (at.getTime() <= now) at.setFullYear(at.getFullYear() + 1)
  return at.getTime()
}

// ---- live notices ----

export const useCoupleEvent = (event, fn) => {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => on(event, (payload) => ref.current(payload)), [event])
}

// ---- photos ----

const photoCache = new Map() // id -> data URL
const loading = new Map() // id -> promise

export const loadPhoto = (id) => {
  if (photoCache.has(id)) return Promise.resolve(photoCache.get(id))
  if (!loading.has(id)) {
    loading.set(
      id,
      coupleApi("GET", `/photos/${id}`).then((r) => {
        loading.delete(id)
        if (r.ok) photoCache.set(id, r.photo.data)
        return r.ok ? r.photo.data : null
      })
    )
  }
  return loading.get(id)
}
export const rememberPhoto = (id, data) => photoCache.set(id, data)

export const usePhoto = (id) => {
  const [data, setData] = useState(() => photoCache.get(id) || null)
  useEffect(() => {
    if (!id) return
    let live = true
    loadPhoto(id).then((d) => live && setData(d))
    return () => {
      live = false
    }
  }, [id])
  return data
}

export const PhotoThumb = ({ id, className = "usThumb", alt = "", onClick }) => {
  const data = usePhoto(id)
  return data ? <img src={data} alt={alt} className={className} onClick={onClick} draggable="false" /> : <span className={`${className} usThumbLoading`} aria-label="Loading photo" />
}

const readFile = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error("That file couldn't be read."))
    reader.readAsDataURL(file)
  })

// Shrinks a picture to at most 1280 pixels and about 300 KB (PNG or JPEG)
export const fitPhoto = async (dataUrl) => (await shrinkPicture(dataUrl, { max: 1280, budget: 290 * 1024 })).src

// "From My Computer..." (the 98ish drive) and "Upload..." (this device) buttons.
// onPhoto(dataUrl) gets the shrunk picture; onError(message)
export const AddPhoto = ({ onPhoto, onError, disabled, label = "Add photo" }) => {
  const input = useRef(null)
  const [drive, setDrive] = useState(false)
  const [busy, setBusy] = useState(false)
  const take = async (load) => {
    setBusy(true)
    try {
      onPhoto(await fitPhoto(await load()))
    } catch (error) {
      onError?.(error.message || "That picture couldn't be opened.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="usAddPhoto">
      <button type="button" disabled={disabled || busy} onClick={() => input.current?.click()}>
        {busy ? "Shrinking..." : `${label}...`}
      </button>
      <button type="button" disabled={disabled || busy} onClick={() => setDrive(true)} title="Pick a picture from the 98ish drive">
        From My Computer...
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/heic"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          if (file) take(() => readFile(file))
        }}
      />
      {drive && (
        <FileDialog
          mode="open"
          accept={(item) => item.isImage}
          typeLabel="Pictures"
          fileType="image"
          onPick={(file) => {
            setDrive(false)
            take(async () => file.textContent || file.source)
          }}
          onCancel={() => setDrive(false)}
        />
      )}
    </span>
  )
}

// ---- not paired yet ----

export const NotPaired = ({ status, what }) => (
  <div className="usNotPaired">
    <TwoHearts size={64} />
    <h2>{status === "signed-out" ? "Sign on first" : "Just for two"}</h2>
    <p>
      {status === "signed-out"
        ? `${what} is for couples on 98 Messenger. Sign on, then pair with your partner in Us.`
        : `${what} is shared with your partner. Pair up in Us first: it only takes a moment.`}
    </p>
    <button type="button" onClick={() => (status === "signed-out" ? openCouples("98 Messenger") : openCouples("Us"))}>
      {status === "signed-out" ? "Open 98 Messenger" : "Open Us"}
    </button>
  </div>
)
