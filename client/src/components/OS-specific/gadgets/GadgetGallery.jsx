import React from "react"
import Dialog from "../../shared/Dialog"
import { gadgets, useGadgets } from "../../../utils/gadgets"
import { GADGETS, hasGadget } from "../../../utils/gadgetsCore"
import { openHelp } from "../../../utils/help"
import "./Gadgets.css"

// The desktop's "Gadgets..." (right-click, or touch and hold on a phone): tick the gadgets
// you want on the desktop. Each one is added or taken away at once; OK closes.
const ICONS = {
  clock: "/assets/program_icons/clock.svg",
  weather: "/assets/program_icons/weather.svg",
  calendar: "/assets/program_icons/calendar.svg",
  notes: "/assets/program_icons/notes.svg",
  meter: "/assets/program_icons/taskManager-48.png",
}

const GadgetGallery = ({ onClose, mobile }) => {
  const state = useGadgets()
  return (
    <Dialog title="Gadgets" onOk={onClose} okLabel="OK">
      <p className="dialogText gdgIntro">Tick a gadget to put it on your desktop{mobile ? " (they sit in a row at the bottom)" : "; drag it by its title bar"}.</p>
      <ul className="gdgPick">
        {GADGETS.map((g) => {
          const on = hasGadget(state, g.kind)
          return (
            <li key={g.kind}>
              <input type="checkbox" id={`gdg-${g.kind}`} checked={on} onChange={() => (on ? gadgets.remove(g.kind) : gadgets.add(g.kind))} />
              <label htmlFor={`gdg-${g.kind}`}>
                <img src={ICONS[g.kind]} alt="" width="24" height="24" />
                <span>
                  <b>{g.name}</b>
                  <span className="gdgAbout">{g.about}</span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      <button type="button" className="gdgHelp" onClick={() => openHelp("gadgets")}>
        About gadgets...
      </button>
    </Dialog>
  )
}

export default GadgetGallery
