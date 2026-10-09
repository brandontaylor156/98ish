import React, { useEffect, useRef, useState } from "react"
import MoreOptions from "../../shared/MoreOptions"
import { BASIC, hslText, hsvToRgb, parseHex, rgbText, rgbToHsv, textOn, toHex } from "./colorMath"
import { copyText } from "../../../utils/systemClipboard"
import "./ColorPicker.css"

// Color Picker: drag in the square (shade) and the rainbow bar (hue), or type a hex code or
// red/green/blue; copy it as HEX, RGB or HSL. "Pick from Screen" uses the browser's eyedropper
// where there is one (Chrome and Edge on a computer). More options: pick a color from a
// picture (works on iPhones too), the Windows 98 basic colors, and recent colors.

const KEY = "98ish.colorpicker"
const load = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {}
  } catch {
    return {}
  }
}
const save = (data) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    // not remembered in private mode
  }
}

// a drag that reports where it is in the element, 0..1 (pointer capture; no page scroll)
const useDrag = (onMove) => {
  const ref = useRef(null)
  const at = (e) => {
    const r = ref.current.getBoundingClientRect()
    onMove(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)))
  }
  return {
    ref,
    onPointerDown: (e) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture?.(e.pointerId)
      at(e)
    },
    onPointerMove: (e) => {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) at(e)
    },
  }
}

const ColorPicker = () => {
  const saved = load()
  const [hsv, setHsv] = useState(() => rgbToHsv(parseHex(saved.color) || { r: 0, g: 0, b: 128 }))
  const [recent, setRecent] = useState(Array.isArray(saved.recent) ? saved.recent.filter((c) => parseHex(c)).slice(0, 12) : [])
  const [hexText, setHexText] = useState(null) // while typing a hex code
  const [copied, setCopied] = useState(null)
  const [picture, setPicture] = useState(null) // an object URL to pick from
  const [problem, setProblem] = useState(null)
  const fileRef = useRef(null)
  const pictureRef = useRef(null)

  const rgb = hsvToRgb(hsv)
  const hex = toHex(rgb)
  useEffect(() => save({ color: hex, recent }), [hex, recent])
  useEffect(() => () => picture && URL.revokeObjectURL(picture), [picture])

  const setRgb = (next) => setHsv((old) => {
    const h = rgbToHsv(next)
    // keep the hue when the color is gray (it has none)
    return h.s === 0 || h.v === 0 ? { ...h, h: old.h } : h
  })
  const remember = (color) => setRecent((list) => [color, ...list.filter((c) => c !== color)].slice(0, 12))

  const square = useDrag((x, y) => setHsv((o) => ({ ...o, s: x * 100, v: (1 - y) * 100 })))
  const hue = useDrag((x) => setHsv((o) => ({ ...o, h: Math.min(359.9, x * 360) })))

  const copy = (what, text) => {
    copyText(text)
    remember(hex)
    setCopied(what)
    setTimeout(() => setCopied(null), 1500)
  }

  const eyedropper = typeof window !== "undefined" && typeof window.EyeDropper === "function"
  const pickScreen = async () => {
    try {
      const { sRGBHex } = await new window.EyeDropper().open()
      const c = parseHex(sRGBHex)
      if (c) {
        setRgb(c)
        remember(toHex(c))
      }
    } catch {
      // cancelled
    }
  }

  // tap a picture to take the color under your finger
  const pickFromPicture = (e) => {
    const img = pictureRef.current
    if (!img?.naturalWidth) return
    const r = img.getBoundingClientRect()
    const x = Math.floor(((e.clientX - r.left) / r.width) * img.naturalWidth)
    const y = Math.floor(((e.clientY - r.top) / r.height) * img.naturalHeight)
    const canvas = document.createElement("canvas")
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    ctx.drawImage(img, x, y, 1, 1, 0, 0, 1, 1)
    const [R, G, B] = ctx.getImageData(0, 0, 1, 1).data
    setRgb({ r: R, g: G, b: B })
    remember(toHex({ r: R, g: G, b: B }))
  }

  const channel = (name, label) => (
    <label className="cpChan">
      {label}
      <input
        type="number"
        inputMode="numeric"
        pattern="[0-9]*"
        min="0"
        max="255"
        value={rgb[name]}
        onChange={(e) => {
          const v = Math.max(0, Math.min(255, Math.round(Number(e.target.value) || 0)))
          setRgb({ ...rgb, [name]: v })
        }}
        aria-label={label}
      />
    </label>
  )

  return (
    <div className="cpRoot" data-colorpicker="">
      <div className="cpPickers">
        <div className="cpSquare" style={{ background: `hsl(${hsv.h}, 100%, 50%)` }} {...square} data-touch-surface="">
          <div className="cpSquareWhite" />
          <div className="cpSquareBlack" />
          <div className="cpDot" style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%`, borderColor: textOn(rgb) }} />
        </div>
        <div className="cpHue" {...hue} data-touch-surface="" aria-label="Hue">
          <div className="cpHueMark" style={{ left: `${(hsv.h / 360) * 100}%` }} />
        </div>
      </div>

      <div className="cpRow">
        <div className="cpSwatch" style={{ background: hex, color: textOn(rgb) }} data-cp-swatch="">
          {hex}
        </div>
        <div className="cpFields">
          <label className="cpChan cpHex">
            Hex
            <input
              value={hexText ?? hex}
              onChange={(e) => {
                setHexText(e.target.value)
                const c = parseHex(e.target.value)
                if (c) setRgb(c)
              }}
              onBlur={() => setHexText(null)}
              maxLength={7}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck="false"
              aria-label="Hex code"
              data-cp-hex=""
            />
          </label>
          {channel("r", "Red")}
          {channel("g", "Green")}
          {channel("b", "Blue")}
        </div>
      </div>

      <div className="cpCopy">
        <button type="button" onClick={() => copy("hex", hex)}>
          {copied === "hex" ? "Copied" : "Copy HEX"}
        </button>
        <button type="button" onClick={() => copy("rgb", rgbText(rgb))}>
          {copied === "rgb" ? "Copied" : "Copy RGB"}
        </button>
        <button type="button" onClick={() => copy("hsl", hslText(rgb))}>
          {copied === "hsl" ? "Copied" : "Copy HSL"}
        </button>
        {eyedropper && (
          <button type="button" onClick={pickScreen} title="Pick a color anywhere on the screen">
            Pick from Screen
          </button>
        )}
      </div>
      <div className="cpText" data-selectable="">
        {rgbText(rgb)} · {hslText(rgb)}
      </div>

      <MoreOptions id="colorpicker.more" summary="Pick from a picture, basic colors, recent colors">
        <div className="cpMore">
          <div>
            <button type="button" onClick={() => fileRef.current?.click()}>
              Pick from a Picture...
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ""
                if (!f) return
                setProblem(null)
                setPicture(URL.createObjectURL(f))
              }}
            />
          </div>
          {picture && (
            <div className="cpPicture">
              <img ref={pictureRef} src={picture} alt="Tap to pick a color" onPointerDown={pickFromPicture} onError={() => (setPicture(null), setProblem("That picture couldn't be opened."))} draggable="false" />
              <span className="cpHint">Tap the picture to take a color from it.</span>
            </div>
          )}
          {problem && <div className="cpHint">{problem}</div>}
          <fieldset>
            <legend>Basic colors</legend>
            <div className="cpGrid">
              {BASIC.map((c, i) => (
                <button type="button" key={i} className="cpChip" style={{ background: c }} title={c} aria-label={c} onClick={() => setRgb(parseHex(c))} />
              ))}
            </div>
          </fieldset>
          {recent.length > 0 && (
            <fieldset>
              <legend>Recent colors</legend>
              <div className="cpGrid">
                {recent.map((c) => (
                  <button type="button" key={c} className="cpChip" style={{ background: c }} title={c} aria-label={c} onClick={() => setRgb(parseHex(c))} />
                ))}
              </div>
            </fieldset>
          )}
        </div>
      </MoreOptions>
    </div>
  )
}

export default ColorPicker
