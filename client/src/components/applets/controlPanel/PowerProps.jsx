import React, { useEffect, useState } from "react"
import { SCREENSAVERS } from "../../screensavers"
import { hasSecret } from "../../../utils/lock"
import { launch } from "../../../utils/programs"
import { useWakeLockActive, wakeLockSupported } from "../../../utils/wakeLock"
import MoreOptions from "../../shared/MoreOptions"
import { summarize } from "../../../utils/disclosure"
import { Check, Choice, PropSheet, sheetButtons, useDraft } from "./Sheet"

const MINUTES = [1, 2, 3, 5, 10, 15, 20, 25, 30, 45, 60]
const minutes = (n) => `After ${n} min${n === 1 ? "" : "s"}`

// the battery, where the browser tells (Chrome on laptops and Android)
const useBattery = () => {
  const [battery, setBattery] = useState(null)
  useEffect(() => {
    let b = null
    let live = true
    const update = () => live && b && setBattery({ level: b.level, charging: b.charging })
    navigator.getBattery?.()
      .then((x) => {
        b = x
        update()
        b.addEventListener("levelchange", update)
        b.addEventListener("chargingchange", update)
      })
      .catch(() => {})
    return () => {
      live = false
      b?.removeEventListener("levelchange", update)
      b?.removeEventListener("chargingchange", update)
    }
  }, [])
  return battery
}

// Power Management: when the screen saver starts, when 98ish locks, and keeping the screen
// on (the Wake Lock API, where the browser has it)
const PowerProps = ({ dispatch, onClose }) => {
  const d = useDraft(["screensaver", "screensaverWait", "lockAfter", "keepAwake"])
  const { draft, update } = d
  const battery = useBattery()
  const awake = useWakeLockActive()
  const saver = SCREENSAVERS.find((s) => s.id === draft.screensaver)
  const canWake = wakeLockSupported()

  return (
    <PropSheet name="Power Management Properties" tabs={[{ id: "schemes", label: "Power Schemes" }]} tab="schemes" onTab={() => {}} {...sheetButtons(d, onClose)}>
      <div className="cplHead">
        <img src="/assets/program_icons/cpl/power.svg" alt="" />
        <p data-power="source">
          {!battery
            ? "Choose when the screen saver starts and when 98ish locks itself."
            : battery.charging || battery.level >= 1
              ? `Power source: plugged in${battery.level < 1 ? `, charging (${Math.round(battery.level * 100)}%)` : ""}.`
              : `Power source: batteries, ${Math.round(battery.level * 100)}% left.`}
        </p>
      </div>
      <fieldset>
        <legend>Screen saver</legend>
        <Choice
          label="Start the screen saver:"
          value={saver ? draft.screensaverWait : "never"}
          options={[{ id: "never", label: "Never" }, ...MINUTES.map((n) => ({ id: n, label: minutes(n) }))]}
          onChange={(v) => (v === "never" ? update({ screensaver: "none" }) : update({ screensaverWait: Number(v), screensaver: saver ? draft.screensaver : SCREENSAVERS[0].id }))}
        />
        <p className="cplHint">{saver ? `The screen saver is ${saver.label}.` : "No screen saver is chosen."}</p>
      </fieldset>
      <fieldset>
        <legend>Lock</legend>
        <Choice label="Lock 98ish:" value={draft.lockAfter || 0} options={[{ id: 0, label: "Never" }, ...MINUTES.map((n) => ({ id: n, label: minutes(n) }))]} onChange={(v) => update({ lockAfter: Number(v) })} />
        <p className="cplHint">{hasSecret() ? "After this long with nothing typed or clicked, 98ish asks for your password or PIN." : "Locking needs a password or PIN first (Control Panel > Passwords)."}</p>
      </fieldset>
      {/* the screen saver's own settings and keeping the screen on: More options (docs/simplicity.md) */}
      <MoreOptions id="power.more" summary={summarize(saver ? `Screen saver: ${saver.label}` : "No screen saver", draft.keepAwake ? "Screen kept on" : "Screen may turn off")}>
        <div className="cplRow">
          <button type="button" onClick={() => dispatch({ type: "open_window", payload: launch("Display Properties", { tab: "screensaver" }) })}>
            Screen Saver...
          </button>
        </div>
        <fieldset>
          <legend>Screen</legend>
          <Check label="Keep the screen on while 98ish is open" checked={draft.keepAwake} disabled={!canWake} onChange={(keepAwake) => update({ keepAwake })} />
          <p className="cplHint" data-power="wake">
            {!canWake ? "This browser can't keep the screen on." : awake ? "The screen is being kept on." : "Handy for slideshows, the Clock and long games. It uses more battery."}
          </p>
        </fieldset>
      </MoreOptions>
    </PropSheet>
  )
}

export default PowerProps
