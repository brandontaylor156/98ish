import React, { useEffect, useRef, useState } from "react"
import Dialog from "../shared/Dialog"
import { getAudioContext, masterOutput } from "../../utils/audio"
import "./Power.css"

// Starting up and shutting down: the BIOS screen and splash, the startup chime, the
// Shut Down and Log Off dialogs, and "It's now safe to turn off your computer."

// ---- the startup chime (made up on the spot with Web Audio, no sound file) ----

const chime = (ctx) => {
  const now = ctx.currentTime + 0.05
  const out = ctx.createGain()
  out.gain.value = 0.22
  // a soft echo for some room
  const delay = ctx.createDelay()
  delay.delayTime.value = 0.23
  const feedback = ctx.createGain()
  feedback.gain.value = 0.32
  const wet = ctx.createGain()
  wet.gain.value = 0.35
  const speaker = masterOutput(ctx)
  delay.connect(feedback).connect(delay)
  delay.connect(wet).connect(speaker)
  out.connect(speaker)
  out.connect(delay)
  // once the echo has died away, unplug it (a feedback loop would otherwise run forever)
  setTimeout(() => {
    for (const n of [out, delay, feedback, wet]) n.disconnect()
  }, 7000)

  const note = (freq, start, length, type = "sine", level = 1) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0, now + start)
    gain.gain.linearRampToValueAtTime(level, now + start + 0.04)
    gain.gain.exponentialRampToValueAtTime(0.001, now + start + length)
    osc.connect(gain).connect(out)
    osc.start(now + start)
    osc.stop(now + start + length + 0.05)
  }
  // a rising E-flat major 9 arpeggio over a warm pad
  const pad = [155.56, 233.08, 311.13, 392]
  pad.forEach((f) => note(f, 0, 3.6, "triangle", 0.28))
  ;[311.13, 466.16, 622.25, 783.99, 932.33, 1174.66].forEach((f, i) => note(f, 0.12 + i * 0.16, 2.4 - i * 0.15, "sine", 0.55))
  note(1244.51, 1.15, 2.2, "sine", 0.3)
}

// Plays now if the browser allows sound; otherwise the browser holds it until the first
// click, tap or key press (utils/audio.js wakes the page's audio then), and it plays then,
// unless that's too late to be a "startup" sound
export const playStartupSound = () => {
  const ctx = getAudioContext()
  if (!ctx) return
  if (ctx.state === "running") return chime(ctx)
  const t0 = Date.now()
  const onState = () => {
    if (ctx.state !== "running") return
    ctx.removeEventListener("statechange", onState)
    if (Date.now() - t0 < 15000) chime(ctx)
  }
  ctx.addEventListener("statechange", onState)
  ctx.resume().catch(() => {})
  setTimeout(() => ctx.removeEventListener("statechange", onState), 15000)
}

// ---- boot ----

const POST = [
  "98ish BIOS v4.10, An Energy Star Ally",
  "Copyright (C) 1984-98, 98ish Software, Inc.",
  "",
  "PENTIUM-MMX CPU at 233MHz",
  "Memory Test :  131072K OK",
  "",
  "Detecting IDE Primary Master ... 98ISH HARD DISK 2GB",
  "Detecting IDE Primary Slave  ... CD-ROM 24X",
  "",
  "Starting Windows 98ish...",
]

export const BootScreen = ({ onDone }) => {
  const [stage, setStage] = useState("post")
  const [shown, setShown] = useState(0)
  const doneRef = useRef(false)

  const finish = () => {
    if (doneRef.current) return
    doneRef.current = true
    onDone()
  }

  useEffect(() => {
    if (stage === "post") {
      if (shown < POST.length) {
        const t = setTimeout(() => setShown((n) => n + 1), shown === 4 ? 320 : 90)
        return () => clearTimeout(t)
      }
      const t = setTimeout(() => setStage("splash"), 380)
      return () => clearTimeout(t)
    }
    const t = setTimeout(finish, 2400)
    return () => clearTimeout(t)
  }, [stage, shown])

  useEffect(() => {
    const skip = (e) => {
      if (e.type === "keydown" && ["Shift", "Control", "Alt", "Meta"].includes(e.key)) return
      finish()
    }
    // not the key press that started the boot (Enter after typing WIN)
    const id = setTimeout(() => window.addEventListener("keydown", skip), 0)
    return () => {
      clearTimeout(id)
      window.removeEventListener("keydown", skip)
    }
  }, [])

  return (
    <div className="powerScreen bootScreen" onPointerDown={finish} role="presentation" data-stage={stage}>
      {stage === "post" ? (
        <div className="postText">
          <img className="postLogo" src="/windows_logo.png" alt="" />
          {POST.slice(0, shown).map((line, i) => (
            <div key={i}>{line || " "}</div>
          ))}
          <div className="postHint">Press any key or tap to skip</div>
        </div>
      ) : (
        <div className="splash">
          <div className="splashSky" />
          <div className="splashBrand">
            <img src="/windows_logo.png" alt="" />
            <div>
              <span className="splashWord">Windows</span>
              <span className="splashNum">98ish</span>
            </div>
          </div>
          <div className="splashBar" />
        </div>
      )}
    </div>
  )
}

// ---- shut down ----

export const ShutDownDialog = ({ onChoose, onCancel }) => {
  const [choice, setChoice] = useState("shutdown")
  return (
    <div className="powerDim">
      <Dialog title="Shut Down Windows" okLabel="OK" onOk={() => onChoose(choice)} onCancel={onCancel}>
        <div className="shutDownBody">
          <img src="/assets/shut_down.png" alt="" />
          <div>
            <p className="dialogText">What do you want the computer to do?</p>
            {[
              ["shutdown", "Shut down"],
              ["restart", "Restart"],
              ["dos", "Restart in MS-DOS mode"],
            ].map(([id, label]) => (
              <div className="field-row" key={id}>
                <input id={`sd-${id}`} type="radio" name="sd" checked={choice === id} onChange={() => setChoice(id)} />
                <label htmlFor={`sd-${id}`}>{label}</label>
              </div>
            ))}
          </div>
        </div>
      </Dialog>
    </div>
  )
}

export const ShuttingDown = ({ onDone }) => {
  useEffect(() => {
    const t = setTimeout(onDone, 1600)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="powerScreen shuttingDown">
      <div className="splashBrand">
        <img src="/windows_logo.png" alt="" />
        <div>
          <span className="splashWord">Windows</span>
          <span className="splashNum">98ish</span>
        </div>
      </div>
      <p>Windows is shutting down.</p>
    </div>
  )
}

export const SafeToTurnOff = ({ onPowerOn }) => {
  // any key, wherever the focus is (nothing on this screen has it at first)
  useEffect(() => {
    const id = setTimeout(() => window.addEventListener("keydown", onPowerOn), 300)
    return () => {
      clearTimeout(id)
      window.removeEventListener("keydown", onPowerOn)
    }
  }, [])
  return (
    <div className="powerScreen safeOff" onClick={onPowerOn} role="button" tabIndex={0}>
      <p>It's now safe to turn off</p>
      <p>your computer.</p>
      <small>Click or press any key to start it again</small>
    </div>
  )
}

// ---- log off ----

export const LogOffDialog = ({ onYes, onCancel }) => (
  <div className="powerDim">
    <Dialog title="Log Off Windows" okLabel="Yes" cancelLabel="No" onOk={onYes} onCancel={onCancel}>
      <div className="shutDownBody">
        <img src="/assets/log_off.png" alt="" />
        <p className="dialogText">Are you sure you want to log off?</p>
      </div>
    </Dialog>
  </div>
)

// Log On, with user profiles and passwords: lock/LogOn.jsx
export { default as LogOn } from "./lock/LogOn"

// ---- the blue screen (end explorer.exe in Task Manager) ----

export const BlueScreen = ({ process = "EXPLORER.EXE", onDone }) => {
  useEffect(() => {
    // not the click that caused it
    const id = setTimeout(() => {
      window.addEventListener("keydown", onDone)
      window.addEventListener("pointerdown", onDone)
    }, 400)
    return () => {
      clearTimeout(id)
      window.removeEventListener("keydown", onDone)
      window.removeEventListener("pointerdown", onDone)
    }
  }, [])
  return (
    <div className="powerScreen blueScreen" role="alert">
      <div className="bsodBody">
        <p className="bsodTitle">
          <span>98ish</span>
        </p>
        <p>
          A fatal exception 0E has occurred at 0098:C0FFEE98 in {process.toUpperCase()}. The shell has been terminated, and
          there's nothing left to draw the desktop.
        </p>
        <p>* Press any key or tap to restart 98ish.</p>
        <p>* Next time, maybe don't end explorer.exe. Unsaved work in open programs has been lost.</p>
        <p className="bsodPrompt">
          Press any key to continue <span className="bsodCursor">_</span>
        </p>
      </div>
    </div>
  )
}
