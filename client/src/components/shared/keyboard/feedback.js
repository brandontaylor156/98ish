import { createBus } from "../../../utils/audio"
import { getSettings } from "../../../utils/settings"
import { quietly } from "./native"

// Key clicks and haptics. Clicks are tiny synthesized ticks on the shared audio engine
// (taskbar volume and mute apply); they follow "Play system sounds" and Keyboard Properties.

const bus = createBus({ gain: 0.5 })

// a short filtered tick: letters, then the deeper space/Enter and Backspace clicks
const TONES = { key: [3400, 0.018, 0.22], space: [1900, 0.024, 0.24], back: [2600, 0.02, 0.2] }

let noiseBuffer = null
export const keyClick = (kind = "key") => {
  const s = getSettings()
  if (!s.systemSounds || !s.keyClicks) return
  const b = bus()
  if (!b) return
  const { ctx, out } = b
  const [freq, length, level] = TONES[kind] || TONES.key
  try {
    if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
      noiseBuffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.05), ctx.sampleRate)
      const data = noiseBuffer.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    }
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = noiseBuffer
    const bp = ctx.createBiquadFilter()
    bp.type = "bandpass"
    bp.frequency.value = freq
    bp.Q.value = 1.4
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(level, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + length)
    src.connect(bp).connect(gain).connect(out)
    src.start(t)
    src.stop(t + length + 0.01)
  } catch {
    // audio not ready
  }
}

// iOS has no navigator.vibrate, but Safari 18 taps the haptic engine when a switch toggles.
// If clicking it ever moves focus (it mustn't), the trick turns itself off.
let switchLabel = null
let switchBroken = false
const switchHaptic = () => {
  if (switchBroken || typeof HTMLInputElement === "undefined" || !("switch" in HTMLInputElement.prototype)) return
  if (!switchLabel) {
    switchLabel = document.createElement("label")
    switchLabel.setAttribute("aria-hidden", "true")
    switchLabel.style.cssText = "position:fixed;left:-200px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none"
    const input = document.createElement("input")
    input.type = "checkbox"
    input.setAttribute("switch", "")
    input.tabIndex = -1
    switchLabel.appendChild(input)
    document.body.appendChild(switchLabel)
  }
  const had = document.activeElement
  quietly(() => {
    switchLabel.click()
    if (document.activeElement !== had) {
      switchBroken = true
      had?.focus?.({ preventScroll: true })
    }
  })
}

// only phones that really buzz: desktop Chrome has navigator.vibrate too (its phone
// emulation included), where every call goes off to a device service for nothing
const canVibrate = () => typeof navigator !== "undefined" && !!navigator.vibrate && /Android/i.test(navigator.userAgent)

export const haptic = () => {
  if (!getSettings().keyVibrate) return
  if (canVibrate()) {
    try {
      navigator.vibrate(8)
    } catch {
      // blocked
    }
    return
  }
  switchHaptic()
}
