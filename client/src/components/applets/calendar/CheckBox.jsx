import React, { useId } from "react"

// A 98-style check box (98.css draws the box on the label that follows the input)
const CheckBox = ({ checked, onChange, children, label, className = "", style, disabled }) => {
  const id = useId()
  return (
    <span className={`calCB ${className}`} style={style}>
      <input id={id} type="checkbox" checked={!!checked} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>{children}</label>
    </span>
  )
}

export default CheckBox
