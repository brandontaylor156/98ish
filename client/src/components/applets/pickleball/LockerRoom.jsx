import React, { useEffect, useId, useMemo, useRef, useState } from "react"
import { CHARACTERS } from "./looks.js"
import { BODIES, BOTTOMS, BUILDS, DESIGNS, GLASSES, HAIR_COLORS, HAIR_COLOR_NAMES, HAIR_STYLES, HATS, HEIGHT, KIT_COLORS, PLAYS, PRO_STYLES, SKIN_TONES, SOCKS, THEMES, TOPS, applyTheme, characterLook, defaultStyleFor, randomLook, themeById, validateLook } from "./locker.js"

// Pickleball 98's Locker Room: dress any player (yours, or the computer's) over the 3D
// viewer, which you can turn by dragging. Tabs: Body (skin, hair, height, build, which hand
// plays and the pro style: one- or two-handed backhand), Kit (a
// theme and its style, kit colors, top, bottom, socks), Gear (hat, glasses, wristbands,
// gloves, shoes) and Paddle. Saved per user profile with the rest of the game's settings
// (prefs.looks, the localStorage seam); online, your look goes with you.

const TABS = [
  ["body", "Body"],
  ["kit", "Kit"],
  ["gear", "Gear"],
  ["paddle", "Paddle"],
]

// a row of color swatches, plus "Other..." (any color)
const Swatches = ({ label, value, colors = KIT_COLORS, names, onChange, name }) => (
  <fieldset className="pkSwatches" data-field={name}>
    <legend>{label}</legend>
    <div className="pkSwatchRow" role="radiogroup" aria-label={label}>
      {colors.map((c, i) => (
        <button type="button" key={c} role="radio" aria-checked={value === c} aria-label={names ? names[i] : c} title={names ? names[i] : c} className={`pkSwatchBtn${value === c ? " is-on" : ""}`} style={{ "--c": c }} onClick={() => onChange(c)} />
      ))}
      <label className="pkSwatchOther" title="Other color...">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${label}: other color`} />
        <span>Other...</span>
      </label>
    </div>
  </fieldset>
)

// a 98-style checkbox (the box is drawn by the label that follows the input)
const Check = ({ checked, onChange, name, children }) => {
  const id = useId()
  return (
    <div className="pkLockerCheck">
      <input id={id} type="checkbox" checked={checked} data-field={name} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>{children}</label>
    </div>
  )
}

const Pick = ({ label, value, options, onChange, name }) => (
  <label className="pkField pkLockerField">
    <span>{label}</span>
    <select value={value} data-field={name} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  </label>
)

export const LockerRoom = ({ prefs, setPrefs, engine, onBack, initial }) => {
  const [who, setWho] = useState(initial || prefs.character)
  const saved = (id) => (prefs.looks?.[id] ? validateLook(prefs.looks[id], characterLook(id)) : characterLook(id, id === prefs.character ? prefs.outfit : "home"))
  const [look, setLook] = useState(() => saved(initial || prefs.character))
  const [tab, setTab] = useState("body")
  const [dirty, setDirty] = useState(false)
  const [pose, setPose] = useState("ready")
  const kit = useMemo(() => [look.shirt, look.trim === look.shirt ? look.bottomColor : look.trim], [look.shirt, look.trim, look.bottomColor])
  const set = (patch) => {
    setLook((l) => validateLook({ ...l, ...patch }, l))
    setDirty(true)
  }
  // a single piece changes just that piece (the kit keeps its theme, so "Auto by venue" leaves
  // a beach kit you tuned alone at the beach)
  const setPiece = (patch) => set(patch)
  // the viewer follows the draft (a moment after the last change: a new kit is built each time)
  useEffect(() => {
    const t = setTimeout(() => engine()?.showcase(look), 90)
    return () => clearTimeout(t)
  }, [look])
  useEffect(() => engine()?.showcasePose(pose), [pose])
  useEffect(() => () => engine()?.showcasePose("ready"), [])
  const pickWho = (id) => {
    setWho(id)
    setLook(saved(id))
    setDirty(false)
  }
  const save = () => {
    setPrefs({ looks: { ...(prefs.looks || {}), [who]: validateLook(look) } })
    setDirty(false)
    onBack()
  }
  const resetLook = () => {
    setLook(characterLook(who, who === prefs.character ? prefs.outfit : "home"))
    setDirty(true)
  }
  const surprise = () => {
    // (a surprise kit; the player still plays with the same hand and style)
    setLook({ ...randomLook(Math.random, look), plays: look.plays, backhand: look.backhand })
    setDirty(true)
  }
  const theme = themeById(look.theme)
  const setTheme = (id) => {
    if (id === "custom") return set({ theme: "custom", style: "" })
    setLook((l) => applyTheme(l, id, defaultStyleFor(id, l.body), id === "classic" ? null : kit))
    setDirty(true)
  }
  const setStyle = (id) => {
    setLook((l) => applyTheme(l, l.theme, id, kit))
    setDirty(true)
  }
  const setKit = (i, c) => {
    const next = i === 0 ? [c, kit[1]] : [kit[0], c]
    if (theme) {
      setLook((l) => applyTheme(l, l.theme, l.style, next))
      setDirty(true)
    } else setPiece(i === 0 ? { shirt: c } : { trim: c })
  }

  const setClassicTrim = (c) => {
    setLook((l) => applyTheme(l, "classic", l.style, [c, c]))
    setDirty(true)
  }

  // drag the viewer to turn the player
  const drag = useRef(null)
  const onDown = (e) => {
    drag.current = { x: e.clientX }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onMove = (e) => {
    if (!drag.current) return
    const dx = e.clientX - drag.current.x
    drag.current.x = e.clientX
    engine()?.showcaseTurn(dx * 0.012)
  }
  const onUp = () => {
    drag.current = null
  }

  const people = CHARACTERS.filter((c) => !c.boss || prefs.looks?.[c.id] || c.id === prefs.character)
  return (
    <div className="pkPlayers pkLocker">
      <div className="pkLockerTurn" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} aria-hidden="true" />
      <div className="pkPanel2 window pkPlayersPanel">
        <div className="title-bar">
          <div className="title-bar-text">Locker Room</div>
          <div className="title-bar-controls">
            <button aria-label="Close" onClick={onBack} />
          </div>
        </div>
        <div className="window-body pkPanelBody pkLockerBody">
          <div className="pkLockerTop">
            <label className="pkField pkLockerField">
              <span>Dressing</span>
              <select value={who} data-field="who" onChange={(e) => pickWho(e.target.value)}>
                {people.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nick}
                    {c.id === prefs.character ? " (you)" : prefs.looks?.[c.id] ? " (custom)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="pkLockerView" role="group" aria-label="Viewer">
              <button type="button" aria-label="Turn left" title="Turn left" onClick={() => engine()?.showcaseTurn(-0.6)}>
                {"<"}
              </button>
              <select value={pose} aria-label="Viewer pose" data-field="pose" onChange={(e) => setPose(e.target.value)}>
                <option value="ready">Ready (swings)</option>
                <option value="run">Jogging</option>
                <option value="still">Standing</option>
              </select>
              <button type="button" aria-label="Turn right" title="Turn right" onClick={() => engine()?.showcaseTurn(0.6)}>
                {">"}
              </button>
            </div>
          </div>
          <menu role="tablist" className="pkLockerTabs">
            {TABS.map(([id, label]) => (
              <li role="tab" key={id} aria-selected={tab === id}>
                <a
                  href="#"
                  data-tab={id}
                  onClick={(e) => {
                    e.preventDefault()
                    setTab(id)
                  }}
                >
                  {label}
                </a>
              </li>
            ))}
          </menu>
          <div className="window pkLockerSheet" role="tabpanel">
            <div className="window-body">
              {tab === "body" && (
                <>
                  <Pick label="Body" name="body" value={look.body} options={BODIES} onChange={(v) => set({ body: v })} />
                  <Swatches label="Skin" name="skin" value={look.skin} colors={SKIN_TONES} names={SKIN_TONES.map((_, i) => `Skin tone ${i + 1}`)} onChange={(c) => set({ skin: c })} />
                  <Pick label="Hair" name="hair" value={look.hair} options={HAIR_STYLES} onChange={(v) => set({ hair: v })} />
                  <Swatches label="Hair color" name="hairColor" value={look.hairColor} colors={HAIR_COLORS} names={HAIR_COLOR_NAMES} onChange={(c) => set({ hairColor: c })} />
                  {look.body === "m" && (
                    <Check checked={look.beard} name="beard" onChange={(v) => set({ beard: v })}>
                    Beard
                  </Check>
                  )}
                  <label className="pkField pkLockerField">
                    <span>Height</span>
                    <input type="range" min={HEIGHT.min * 100} max={HEIGHT.max * 100} step="1" value={Math.round(look.height * 100)} data-field="height" onChange={(e) => set({ height: Number(e.target.value) / 100 })} aria-valuetext={`${Math.round(look.height * 100)} percent`} />
                  </label>
                  <Pick label="Build" name="build" value={look.build} options={BUILDS} onChange={(v) => set({ build: v })} />
                  <Pick label="Plays" name="plays" value={look.plays} options={PLAYS} onChange={(v) => set({ plays: v })} />
                  <Pick label="Pro style" name="backhand" value={look.backhand} options={PRO_STYLES} onChange={(v) => set({ backhand: v })} />
                </>
              )}
              {tab === "kit" && (
                <>
                  <Pick label="Theme" name="theme" value={look.theme} options={[...THEMES, { id: "custom", name: "My own kit" }]} onChange={setTheme} />
                  {theme && <Pick label="Style" name="style" value={look.style} options={theme.styles} onChange={setStyle} />}
                  <Swatches label={theme?.id === "classic" ? "Trim color" : "Main color"} name="c1" value={theme?.id === "classic" ? look.trim : kit[0]} onChange={(c) => (theme?.id === "classic" ? setClassicTrim(c) : setKit(0, c))} />
                  {theme?.id !== "classic" && <Swatches label="Second color" name="c2" value={kit[1]} onChange={(c) => setKit(1, c)} />}
                  <Pick label="Top" name="shirtStyle" value={look.shirtStyle} options={TOPS} onChange={(v) => setPiece({ shirtStyle: v, bottom: v === "onepiece" ? "swim" : look.bottom })} />
                  {look.shirtStyle !== "onepiece" && <Pick label="Bottom" name="bottom" value={look.bottom} options={BOTTOMS} onChange={(v) => setPiece({ bottom: v })} />}
                  <Swatches label={look.shirtStyle === "onepiece" ? "Trim" : "Bottom color"} name="bottomColor" value={look.shirtStyle === "onepiece" ? look.trim : look.bottomColor} onChange={(c) => setPiece(look.shirtStyle === "onepiece" ? { trim: c } : { bottomColor: c })} />
                  <Pick label="Socks" name="sockStyle" value={look.sockStyle} options={SOCKS} onChange={(v) => setPiece({ sockStyle: v })} />
                  {look.sockStyle !== "none" && <Swatches label="Sock color" name="socks" value={look.socks} onChange={(c) => setPiece({ socks: c })} />}
                </>
              )}
              {tab === "gear" && (
                <>
                  <Pick label="Hat" name="hat" value={look.hat} options={HATS} onChange={(v) => setPiece({ hat: v })} />
                  {look.hat !== "none" && <Swatches label="Hat color" name="hatColor" value={look.hatColor} onChange={(c) => setPiece({ hatColor: c })} />}
                  <Pick label="Glasses" name="glasses" value={look.glasses} options={GLASSES} onChange={(v) => setPiece({ glasses: v })} />
                  <Check checked={look.wristbands} name="wristbands" onChange={(v) => setPiece({ wristbands: v })}>
                    Wristbands
                  </Check>
                  {look.wristbands && <Swatches label="Wristband color" name="wristColor" value={look.wristColor} onChange={(c) => setPiece({ wristColor: c })} />}
                  <Check checked={look.gloves} name="gloves" onChange={(v) => setPiece({ gloves: v })}>
                    Gloves
                  </Check>
                  {look.gloves && <Swatches label="Glove color" name="gloveColor" value={look.gloveColor} onChange={(c) => setPiece({ gloveColor: c })} />}
                  <Swatches label="Shoes" name="shoes" value={look.shoes} onChange={(c) => setPiece({ shoes: c })} />
                  <Swatches label="Shoe stripe" name="shoeAccent" value={look.shoeAccent} onChange={(c) => setPiece({ shoeAccent: c })} />
                </>
              )}
              {tab === "paddle" && (
                <>
                  <Pick label="Design" name="paddleDesign" value={look.paddleDesign} options={DESIGNS} onChange={(v) => set({ paddleDesign: v })} />
                  <Swatches label="Face" name="paddle" value={look.paddle} onChange={(c) => set({ paddle: c })} />
                  <Swatches label="Edge and print" name="paddleEdge" value={look.paddleEdge} onChange={(c) => set({ paddleEdge: c })} />
                </>
              )}
            </div>
          </div>
          <fieldset className="pkLockerOptions">
            <legend>In matches</legend>
            <Check checked={!!prefs.autoVenue} name="autoVenue" onChange={(v) => setPrefs({ autoVenue: v })}>
                    Auto by venue (beach kit at the beach, winter kit in the snow)
                  </Check>
            <label className="pkField pkLockerField">
              <span>Computer players</span>
              <select value={prefs.aiLooks || "own"} data-field="aiLooks" onChange={(e) => setPrefs({ aiLooks: e.target.value })}>
                <option value="own">Their own kits</option>
                <option value="random">Random kits</option>
              </select>
            </label>
          </fieldset>
          <p className="pkLockerHint">Drag the player to turn them around.</p>
          <div className="pkRow">
            <button type="button" className="pkPrimary" onClick={save} data-action="save">
              Save
            </button>
            <button type="button" onClick={surprise} data-action="surprise">
              Surprise me
            </button>
            <button type="button" onClick={resetLook} data-action="reset">
              Reset
            </button>
            <button type="button" onClick={onBack}>
              {dirty ? "Cancel" : "Close"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
