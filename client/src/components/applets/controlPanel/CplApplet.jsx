import React from "react"
import { programByName } from "../../../utils/programs"
import Accessibility from "./Accessibility"
import AddRemove from "./AddRemove"
import MouseProps from "./MouseProps"
import Regional from "./Regional"
import Storage from "./Storage"
import InternetOptions from "./InternetOptions"
import Fonts from "./Fonts"
import PowerProps from "./PowerProps"
import SoundsProps from "./SoundsProps"
import "./ControlPanel.css"

// The Control Panel applets 98ish adds (programs.js entries with app: "cpl"), by `applet`.
// One download for all of them: each is small.
const APPLETS = {
  access: Accessibility,
  programs: AddRemove,
  mouse: MouseProps,
  regional: Regional,
  storage: Storage,
  internet: InternetOptions,
  fonts: Fonts,
  power: PowerProps,
  sounds: SoundsProps,
}

const CplApplet = ({ program, ...props }) => {
  const Applet = APPLETS[programByName(program)?.applet]
  return Applet ? <Applet {...props} /> : null
}

export default CplApplet
