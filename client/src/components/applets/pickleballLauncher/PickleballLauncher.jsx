import React from "react"
import { pickleballUrl } from "../../../utils/pickleballSite"
import "./PickleballLauncher.css"

// Pickleball 98 has its own site now. Its icon opens it in a new tab straight away
// (App.jsx); this small window only shows when the browser blocked that tab.
const PickleballLauncher = ({ meet = null, onClose }) => {
  const url = pickleballUrl(meet)
  return (
    <div className="pklRoot">
      <img src="/assets/program_icons/pickleball.svg" alt="" width="48" height="48" />
      <p>Pickleball 98 has its own site now, with My Park, Explore, Real Games and tournaments.</p>
      <a className="pklOpen" href={url} target="_blank" rel="noopener" onClick={() => onClose?.()}>
        Open Pickleball 98
      </a>
    </div>
  )
}

export default PickleballLauncher
