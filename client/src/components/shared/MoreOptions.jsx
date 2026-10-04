import React, { useId } from "react"
import { useDisclosure } from "../../utils/disclosure"
import "./Simple.css"

// "More options »": the everyday controls stay in view and the rest waits behind this
// (docs/simplicity.md). Closed, it shows a one-line summary of what's set inside ("On this
// device · Doesn't repeat · 15 min reminder"); open, its contents. Whether it was left open
// is remembered per `id` and per user. A Win98 "Advanced »" button on a computer, a full-width
// row on a phone (.os-mobile).
//   id         where it's remembered ("calendar.event"); none: not remembered
//   summary    the line shown while closed
//   label      "More options" (closed) / lessLabel "Fewer options" (open)
//   forceOpen  open whatever was remembered (a problem inside needs seeing)
//   inline     a toggle without the group box (a toolbar, a short row)
const MoreOptions = ({ id, summary, label = "More options", lessLabel = "Fewer options", defaultOpen = false, forceOpen = false, className = "", inline = false, onToggle, children }) => {
  const [remembered, setOpen] = useDisclosure(id, defaultOpen)
  const open = remembered || forceOpen
  const uid = useId()
  const bodyId = `more-${uid}`
  const summaryId = `more-sum-${uid}`
  const toggle = () => {
    setOpen(!open)
    onToggle?.(!open)
  }
  return (
    <div className={`moreOpts${open ? " is-open" : ""}${inline ? " moreOpts--inline" : ""} ${className}`} data-more={id || undefined}>
      <div className="moreOpts-head">
        <button type="button" className="moreOpts-toggle" aria-expanded={open} aria-controls={bodyId} aria-describedby={!open && summary ? summaryId : undefined} onClick={toggle}>
          <span className="moreOpts-label">{open ? lessLabel : label}</span>
          <span className="moreOpts-chevron" aria-hidden="true">
            {open ? "«" : "»"}
          </span>
        </button>
        {!open && summary ? (
          // tapping the summary opens it too (it's what people look at)
          <span id={summaryId} className="moreOpts-summary" onClick={toggle}>
            {summary}
          </span>
        ) : null}
      </div>
      <div id={bodyId} className="moreOpts-body" role="group" aria-label={label} hidden={!open}>
        {children}
      </div>
    </div>
  )
}

export default MoreOptions
