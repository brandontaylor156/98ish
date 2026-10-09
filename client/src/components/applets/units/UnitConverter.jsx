import React, { useEffect, useState } from "react"
import MoreOptions from "../../shared/MoreOptions"
import { CATEGORIES, category, convert, parseNumber, pretty, unit } from "./units"
import { copyText } from "../../../utils/systemClipboard"
import "./UnitConverter.css"

// Unit Converter: a kind (Length, Weight, Temperature...), a number and its unit, the unit
// to change it to, and the answer as you type. More options: the number in every unit of
// that kind. The last choices are remembered (per user, through the storage seam).

const KEY = "98ish.units"
const load = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {}
  } catch {
    return {}
  }
}

const UnitConverter = () => {
  const saved = load()
  const [catId, setCatId] = useState(saved.cat || "length")
  const cat = category(catId)
  const [from, setFrom] = useState(saved.from || cat.from)
  const [to, setTo] = useState(saved.to || cat.to)
  const [text, setText] = useState(saved.value ?? "1")
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ cat: catId, from, to, value: text }))
    } catch {
      // private mode: just not remembered
    }
  }, [catId, from, to, text])

  const pickCategory = (id) => {
    const next = category(id)
    setCatId(id)
    setFrom(next.from)
    setTo(next.to)
  }

  const value = parseNumber(text)
  const fromUnit = unit(cat, from)
  const toUnit = unit(cat, to)
  const result = value === null ? null : convert(cat.id, fromUnit.id, toUnit.id, value)
  const answer = result === null ? "" : pretty(result)

  return (
    <div className="ucRoot" data-units="">
      <label className="ucRow">
        <span>Convert:</span>
        <select value={cat.id} onChange={(e) => pickCategory(e.target.value)} aria-label="Kind of unit">
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="ucBox">
        <legend>From</legend>
        <input className="ucValue" value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" aria-label="Number to convert" data-units-value="" />
        <select value={fromUnit.id} onChange={(e) => setFrom(e.target.value)} aria-label="From unit">
          {cat.units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </fieldset>

      <div className="ucSwap">
        <button type="button" onClick={() => (setFrom(toUnit.id), setTo(fromUnit.id))} title="Swap the units">
          ⇅ Swap
        </button>
      </div>

      <fieldset className="ucBox">
        <legend>To</legend>
        <div className="ucAnswer" data-units-answer="" data-selectable="">
          {value === null ? (text.trim() ? "Type a number" : "") : answer}
        </div>
        <select value={toUnit.id} onChange={(e) => setTo(e.target.value)} aria-label="To unit">
          {cat.units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </fieldset>

      <div className="ucButtons">
        <button
          type="button"
          disabled={!answer}
          onClick={() => {
            copyText(answer.replace(/,/g, ""))
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? "Copied" : "Copy Answer"}
        </button>
      </div>

      <MoreOptions id="units.all" label="Every unit" lessLabel="Fewer" summary={`Your number in every ${cat.name.toLowerCase()} unit`}>
        <table className="ucTable">
          <tbody>
            {cat.units.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td className="ucNum">{value === null ? "" : pretty(convert(cat.id, fromUnit.id, u.id, value))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </MoreOptions>
    </div>
  )
}

export default UnitConverter
