// What Camera can do in this browser, and what to tell you when it can't. Pure (the
// browser's answers are passed in), so Node can test it.

// Why the camera isn't showing: { title, text, retry } for the message in the viewer.
// env: { secure, hasMedia, iphone } ; error: what getUserMedia threw (or null)
export const cameraProblem = ({ secure = true, hasMedia = true, iphone = false } = {}, error = null) => {
  if (!secure)
    return { title: "The camera needs a secure page", text: "Browsers only let a page use the camera over https. Open 98ish at its https:// address and try again.", retry: false }
  if (!hasMedia)
    return { title: "No camera support", text: "This browser doesn't let web pages use a camera. You can still take a picture with your device's camera app below.", retry: false }
  const name = error?.name || ""
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError")
    return {
      title: "Camera access is blocked",
      text: iphone
        ? "98ish isn't allowed to use the camera. In Safari, tap aA in the address bar > Website Settings > Camera > Allow (or Settings > Apps > Safari > Camera), then tap Try Again."
        : "98ish isn't allowed to use the camera. Click the camera icon in the address bar, choose Allow, then click Try Again.",
      retry: true,
    }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError")
    return { title: "No camera found", text: "There's no camera connected to this device. Plug in a webcam and click Try Again, or use a picture from your device below.", retry: true }
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError")
    return { title: "The camera is busy", text: "Another app or tab is using the camera. Close it, then click Try Again.", retry: true }
  return { title: "The camera didn't start", text: `Something went wrong starting the camera${error?.message ? ` (${error.message})` : ""}. Click Try Again.`, retry: true }
}

// The video clip format to record in, from what MediaRecorder says it supports. iPhones
// record MP4; Chrome and Firefox WebM. "" lets the browser pick.
export const CLIP_TYPES = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
export const pickClipType = (isTypeSupported) => {
  if (typeof isTypeSupported !== "function") return ""
  for (const type of CLIP_TYPES) {
    try {
      if (isTypeSupported(type)) return type
    } catch {
      // keep looking
    }
  }
  return ""
}

export const clipExtension = (mime) => (/mp4/i.test(mime || "") ? ".mp4" : /quicktime/i.test(mime || "") ? ".mov" : ".webm")

// iPhones and iPads (iPadOS says it's a Mac, but has touch)
export const isAppleMobile = (ua = "", touchPoints = 0) => /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && touchPoints > 1)

export const TIMERS = [0, 3, 10]
export const nextTimer = (seconds) => TIMERS[(TIMERS.indexOf(seconds) + 1) % TIMERS.length]

export const MODES = [
  { id: "photo", label: "Photo" },
  { id: "burst", label: "Burst" },
  { id: "strip", label: "Photo Strip" },
  { id: "video", label: "Video" },
]

export const BURST_COUNT = 5
export const STRIP_COUNT = 4
export const MAX_CLIP_SECONDS = 15

export const clockText = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
