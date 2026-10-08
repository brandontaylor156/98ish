import React from "react"
import Dialog from "./Dialog"
import { useIsTouch } from "../../hooks/useMediaQuery"

// The Windows 98 Print box in front of the real print window (utils/print.js). OK (Print)
// must call printDocument straight away, inside the tap: iOS only opens its print screen
// from a user's tap. `name` is the document's name; `note` an extra line (a picture's size).
const Printer = () => (
  <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" shapeRendering="crispEdges">
    <path d="M9.5 2.5h13v10h-13z" fill="#fff" stroke="#000" />
    <path d="M11 5h10M11 7h10M11 9h7" stroke="#808080" />
    <path d="M2.5 12.5h27v12h-27z" fill="#c0c0c0" stroke="#000" />
    <path d="M3 13h26" stroke="#fff" />
    <path d="M9.5 20.5h13v9h-13z" fill="#fff" stroke="#000" />
    <path d="M11 23h10M11 25h10M11 27h6" stroke="#808080" />
    <rect x="25" y="15" width="2" height="2" fill="#00c000" />
  </svg>
)

const PrintDialog = ({ name, note, onPrint, onCancel }) => {
  const touch = useIsTouch()
  return (
    <Dialog title="Print" okLabel="Print" onOk={onPrint} onCancel={onCancel}>
      <div className="printDlg">
        <Printer />
        <div>
          <p className="dialogText">
            <b>Printer:</b> {touch ? "your phone's printers (AirPrint), or Save to Files as a PDF" : "your computer's printers, or Save as PDF"}
          </p>
          <p className="dialogText">
            <b>Print:</b> {name}
            {note ? ` (${note})` : ""}
          </p>
          <p className="dialogText printDlgHint">{touch ? "Next, pick a printer and tap Print. To keep it as a PDF, tap the Share button there and choose Save to Files." : "Next, choose a printer (or Save as PDF) in the print window."}</p>
        </div>
      </div>
    </Dialog>
  )
}

export default PrintDialog
