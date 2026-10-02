import React, { useEffect, useRef, useState } from "react"
import Dialog from "../../shared/Dialog"
import { BASIC_COLORS, hslToRgb, parseColor, rgbToHsl, toHex } from "./paintLogic"

// Edit Colors, as in Windows 98: the basic colors, 16 custom colors (kept in this browser),
// and "Define Custom Colors >>" with a hue/saturation field, a luminosity bar and number
// boxes. onOk(hex).

const CUSTOM_KEY = "98ish.paint.customColors"
const FIELD_W = 160
const FIELD_H = 120

const loadCustom = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(CUSTOM_KEY))
    if (Array.isArray(saved) && saved.length === 16) return saved
  } catch {
    // nothing saved
  }
  return Array(16).fill("#ffffff")
}

let nextCustom = 0

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)))

const EditColors = ({ initial = "#000000", startExpanded = false, onOk, onCancel }) => {
  const [rgb, setRgb] = useState(() => parseColor(initial))
  const [hsl, setHsl] = useState(() => rgbToHsl(parseColor(initial)))
  const [custom, setCustom] = useState(loadCustom)
  const [expanded, setExpanded] = useState(startExpanded)
  const fieldRef = useRef(null)
  const lumRef = useRef(null)
  const hex = toHex(rgb)

  const fromRgb = (next) => {
    setRgb(next)
    setHsl(rgbToHsl(next))
  }
  const fromHsl = (next) => {
    setHsl(next)
    setRgb(hslToRgb(next))
  }

  // the hue (across) / saturation (up) field, at middle luminosity
  useEffect(() => {
    const canvas = fieldRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    const image = ctx.createImageData(FIELD_W, FIELD_H)
    for (let y = 0; y < FIELD_H; y++)
      for (let x = 0; x < FIELD_W; x++) {
        const [r, g, b] = hslToRgb([(x / FIELD_W) * 240, 240 - (y / (FIELD_H - 1)) * 240, 120])
        const i = (y * FIELD_W + x) * 4
        image.data[i] = r
        image.data[i + 1] = g
        image.data[i + 2] = b
        image.data[i + 3] = 255
      }
    ctx.putImageData(image, 0, 0)
  }, [expanded])

  // the luminosity bar for the current hue and saturation
  useEffect(() => {
    const canvas = lumRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    for (let y = 0; y < FIELD_H; y++) {
      ctx.fillStyle = toHex(hslToRgb([hsl[0], hsl[1], 240 - (y / (FIELD_H - 1)) * 240]))
      ctx.fillRect(0, y, canvas.width, 1)
    }
  }, [expanded, hsl[0], hsl[1]])

  const dragOn = (onPoint) => ({
    onPointerDown: (e) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      onPoint(e)
    },
    onPointerMove: (e) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) onPoint(e)
    },
  })

  const pickField = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    // a gray (luminosity 0 or 240) can't show a hue: move to the middle, like Windows does
    const lum = hsl[2] === 0 || hsl[2] === 240 ? 120 : hsl[2]
    fromHsl([Math.min(239, Math.round(x * 240)), Math.round(240 - y * 240), lum])
  }

  const pickLum = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    fromHsl([hsl[0], hsl[1], Math.round(240 - y * 240)])
  }

  const addCustom = () => {
    const next = [...custom]
    next[nextCustom] = hex
    nextCustom = (nextCustom + 1) % 16
    setCustom(next)
    try {
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(next))
    } catch {
      // not remembered
    }
  }

  const swatches = (colors, label) => (
    <div className="pEcGrid" role="listbox" aria-label={label}>
      {colors.map((c, i) => (
        <button
          key={i}
          type="button"
          className={c === hex ? "pEcSwatch is-selected" : "pEcSwatch"}
          style={{ background: c }}
          aria-label={c}
          onClick={() => fromRgb(parseColor(c))}
          onDoubleClick={() => onOk(c)}
        />
      ))}
    </div>
  )

  const number = (label, value, max, onChange) => (
    <label className="pEcNum">
      {label}:
      <input type="number" min="0" max={max} value={value} onChange={(e) => onChange(clamp(e.target.value, 0, max))} />
    </label>
  )

  return (
    <div className={expanded ? "pDlgWide" : "pDlgNarrow"}>
      <Dialog title="Edit Colors" onOk={() => onOk(hex)} onCancel={onCancel}>
        <div className="pEc">
          <div className="pEcLeft">
            <div>Basic colors:</div>
            {swatches(BASIC_COLORS, "Basic colors")}
            <div>Custom colors:</div>
            {swatches(custom, "Custom colors")}
            <button type="button" className="pEcDefine" disabled={expanded} onClick={() => setExpanded(true)}>
              Define Custom Colors &gt;&gt;
            </button>
          </div>
          {expanded && (
            <div className="pEcRight">
              <div className="pEcPickers">
                <div className="pEcField" {...dragOn(pickField)}>
                  <canvas ref={fieldRef} width={FIELD_W} height={FIELD_H} aria-label="Hue and saturation" />
                  <span className="pEcCross" style={{ left: `${(hsl[0] / 240) * 100}%`, top: `${((240 - hsl[1]) / 240) * 100}%` }} />
                </div>
                <div className="pEcLum" {...dragOn(pickLum)}>
                  <canvas ref={lumRef} width={12} height={FIELD_H} aria-label="Luminosity" />
                  <span className="pEcArrow" style={{ top: `${((240 - hsl[2]) / 240) * 100}%` }} />
                </div>
              </div>
              <div className="pEcBottom">
                <div className="pEcPreview">
                  <span style={{ background: hex }} />
                  Color|Solid
                </div>
                <div className="pEcNums">
                  {number("Hue", hsl[0], 239, (v) => fromHsl([v, hsl[1], hsl[2]]))}
                  {number("Red", rgb[0], 255, (v) => fromRgb([v, rgb[1], rgb[2]]))}
                  {number("Sat", hsl[1], 240, (v) => fromHsl([hsl[0], v, hsl[2]]))}
                  {number("Green", rgb[1], 255, (v) => fromRgb([rgb[0], v, rgb[2]]))}
                  {number("Lum", hsl[2], 240, (v) => fromHsl([hsl[0], hsl[1], v]))}
                  {number("Blue", rgb[2], 255, (v) => fromRgb([rgb[0], rgb[1], v]))}
                </div>
              </div>
              <button type="button" onClick={addCustom}>
                Add to Custom Colors
              </button>
            </div>
          )}
        </div>
      </Dialog>
    </div>
  )
}

export default EditColors
