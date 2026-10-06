import React from "react"
import { Select } from "../../shared/select/Combo"

// One player slot: you, a buddy from your Buddy List, or a guest (typed name; guests are in
// your record but not the ratings).
//   value: { k, name } | { g } | null; people: [{ k, name }] (you first)

export const GUEST = "__guest__"

const PlayerPicker = ({ label, value, people, taken = [], onChange, id }) => {
  const selected = value?.k ? value.k : value?.g !== undefined ? GUEST : ""
  return (
    <div className="pbPick">
      <Select
        id={id}
        aria-label={label}
        value={selected}
        onChange={(e) => {
          const v = e.target.value
          if (v === GUEST) onChange({ g: "" })
          else if (!v) onChange(null)
          else onChange(people.find((p) => p.k === v) || null)
        }}
      >
        <option value="">{label}...</option>
        {people.map((p) => (
          <option key={p.k} value={p.k} disabled={taken.includes(p.k) && p.k !== value?.k}>
            {p.name}
          </option>
        ))}
        <option value={GUEST}>A guest (not on 98 Messenger)</option>
      </Select>
      {value?.g !== undefined && <input type="text" maxLength={24} placeholder="Guest's name" value={value.g} aria-label={`${label}: guest's name`} onChange={(e) => onChange({ g: e.target.value })} />}
    </div>
  )
}

export const toPlayer = (v) => (v?.k ? { k: v.k } : v?.g !== undefined ? { g: String(v.g).trim() } : null)
export const nameOf = (v) => (v?.k ? v.name || v.k : v?.g || "Guest")
// a rotation id ("k:alice" / "g:Ray") -> a picker value
export const fromPid = (id, names = {}) => (id?.startsWith("k:") ? { k: id.slice(2), name: names[id.slice(2)] || id.slice(2) } : { g: String(id || "").slice(2) })

export default PlayerPicker
