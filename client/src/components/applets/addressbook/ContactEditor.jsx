import React, { useId, useMemo, useState } from "react"
import Panel from "./Panel"
import PictureChooser from "./PictureChooser"
import { Avatar } from "./ContactCard"
import { EMAIL_LABELS, PHONE_LABELS, cleanDate, displayName } from "../../../utils/contactsCore"
import { addGroup } from "../../../utils/contacts"
import MoreOptions from "../../shared/MoreOptions"
import { summarize } from "../../../utils/disclosure"

// A contact's Properties, Windows 98 Address Book style: Name, Phone & E-mail, Home,
// Personal (birthday, anniversary, groups) and Notes tabs. onSave(draft) gets the changed
// contact; nothing is saved until OK.

const TABS = [
  ["name", "Name"],
  ["phone", "Phone & E-mail"],
  ["home", "Home"],
  ["personal", "Personal"],
  ["notes", "Notes"],
]

const Field = ({ label, children, wide }) => {
  const id = useId()
  return (
    <div className={`abField${wide ? " abFieldWide" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {React.cloneElement(children, { id })}
    </div>
  )
}

// a date with an optional year: "1990-05-17" or "--05-17" (no year)
const DateField = ({ label, value, onChange }) => {
  const id = useId()
  const noYear = value.startsWith("--")
  const shown = value ? (noYear ? `2000-${value.slice(2)}` : value) : ""
  return (
    <div className="abField">
      <label htmlFor={id}>{label}</label>
      <span className="abDateRow">
        <input id={id} type="date" value={shown} onChange={(e) => onChange(e.target.value ? (noYear ? `--${e.target.value.slice(5)}` : e.target.value) : "")} />
        <span className="abCheck">
          <input id={`${id}-ny`} type="checkbox" checked={noYear} disabled={!value} onChange={(e) => onChange(e.target.checked ? `--${shown.slice(5)}` : `2000-${value.slice(2)}`)} />
          <label htmlFor={`${id}-ny`}>No year</label>
        </span>
        {value && (
          <button type="button" className="abSmall" onClick={() => onChange("")} aria-label={`Clear ${label}`}>
            Clear
          </button>
        )}
      </span>
    </div>
  )
}

// the Name tab's Phone / E-mail box is the list's first entry
const firstOf = (items, labels, value) => (items.length ? items.map((x, i) => (i === 0 ? { ...x, value } : x)) : value ? [{ label: labels[0], value }] : [])

const ListEditor =({ items, labels, onChange, kind, placeholder, inputMode }) => (
  <div className="abList">
    {items.map((item, i) => (
      <div key={i} className="abListRow">
        <select aria-label={`${kind} ${i + 1} label`} value={labels.includes(item.label) ? item.label : "__custom"} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, label: e.target.value === "__custom" ? x.label : e.target.value } : x)))}>
          {labels.map((l) => (
            <option key={l} value={l}>
              {l === "iphone" ? "iPhone" : l[0].toUpperCase() + l.slice(1)}
            </option>
          ))}
          {!labels.includes(item.label) && <option value="__custom">{item.label}</option>}
        </select>
        <input aria-label={`${kind} ${i + 1}`} value={item.value} placeholder={placeholder} inputMode={inputMode} autoComplete="off" onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
        <button type="button" className="abSmall" aria-label={`Remove ${kind} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
          Remove
        </button>
      </div>
    ))}
    {items.length < 8 && (
      <button type="button" onClick={() => onChange([...items, { label: labels[0], value: "" }])}>
        Add {kind}
      </button>
    )}
  </div>
)

const ContactEditor = ({ initial, isNew, groups, buddies = [], mobile, onSave, onCancel }) => {
  const [draft, setDraft] = useState(() => ({ ...initial, address: { ...initial.address }, phones: initial.phones.map((p) => ({ ...p })), emails: initial.emails.map((e) => ({ ...e })), groups: [...initial.groups] }))
  const [tab, setTab] = useState("name")
  const [choosing, setChoosing] = useState(false)
  const [newGroup, setNewGroup] = useState("")
  const [problem, setProblem] = useState(null)
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const setAddress = (patch) => setDraft((d) => ({ ...d, address: { ...d.address, ...patch } }))
  const listId = useId()
  const allGroups = useMemo(() => [...new Set([...groups, ...draft.groups])], [groups, draft.groups])

  const save = () => {
    const cleaned = { ...draft, phones: draft.phones.filter((p) => p.value.trim()), emails: draft.emails.filter((e) => e.value.trim()) }
    const named = cleaned.first.trim() || cleaned.last.trim() || cleaned.nickname.trim() || cleaned.company.trim() || cleaned.screenName.trim() || cleaned.emails.length || cleaned.phones.length
    if (!named) {
      setTab("name")
      return setProblem("Type a name (or a screen name, phone number or e-mail address) for this contact.")
    }
    for (const [label, value] of [["birthday", cleaned.birthday], ["anniversary", cleaned.anniversary]]) {
      if (value && !cleanDate(value)) {
        setTab("personal")
        return setProblem(`That ${label} isn't a real date.`)
      }
    }
    onSave(cleaned)
  }

  const title = isNew ? "New Contact" : `${displayName(draft)} Properties`
  return (
    <Panel
      title={title}
      mobile={mobile}
      onClose={onCancel}
      className="abEditor"
      footer={
        <>
          <button type="button" className="abDefault" onClick={save}>
            OK
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </>
      }
    >
      <menu role="tablist" className="abTabs">
        {TABS.map(([id, label]) => (
          <li key={id} role="tab" aria-selected={tab === id}>
            <a href="#" onClick={(e) => (e.preventDefault(), setTab(id))}>
              {label}
            </a>
          </li>
        ))}
      </menu>
      <form className="window abTabPanel" role="tabpanel" onSubmit={(e) => (e.preventDefault(), save())}>
        {tab === "name" && (
          <div className="abGrid">
            <div className="abPictureRow">
              <Avatar contact={draft} size={56} />
              <div className="abPictureButtons">
                <button type="button" onClick={() => setChoosing(true)}>
                  {draft.picture ? "Change Picture..." : "Add Picture..."}
                </button>
                {draft.picture && (
                  <button type="button" onClick={() => set({ picture: "" })}>
                    Remove
                  </button>
                )}
              </div>
            </div>
            {/* the baseline (docs/simplicity.md): name, phone, e-mail; the rest under More
                options here and on the other tabs */}
            <Field label="First:">
              <input value={draft.first} maxLength={60} autoComplete="off" onChange={(e) => set({ first: e.target.value })} />
            </Field>
            <Field label="Last:">
              <input value={draft.last} maxLength={60} autoComplete="off" onChange={(e) => set({ last: e.target.value })} />
            </Field>
            <Field label="Phone:">
              <input type="tel" value={draft.phones[0]?.value || ""} maxLength={40} inputMode="tel" placeholder="555-0100" autoComplete="off" onChange={(e) => set({ phones: firstOf(draft.phones, PHONE_LABELS, e.target.value) })} />
            </Field>
            <Field label="E-mail:">
              <input type="email" value={draft.emails[0]?.value || ""} maxLength={120} inputMode="email" placeholder="name@example.com" autoComplete="off" autoCapitalize="off" spellCheck="false" onChange={(e) => set({ emails: firstOf(draft.emails, EMAIL_LABELS, e.target.value) })} />
            </Field>
            <MoreOptions
              id="addressbook.editor"
              className="abMore"
              summary={summarize(draft.nickname && `"${draft.nickname}"`, draft.company, draft.screenName ? `Messenger: ${draft.screenName}` : "No screen name", draft.mail && `Mail: ${draft.mail}`, draft.favorite && "Favorite", draft.phones.length > 1 && `${draft.phones.length} phones`, draft.emails.length > 1 && `${draft.emails.length} e-mails`)}
            >
              <span className="abCheck abFav">
                <input id={`${listId}-fav`} type="checkbox" checked={draft.favorite} onChange={(e) => set({ favorite: e.target.checked })} />
                <label htmlFor={`${listId}-fav`}>Favorite</label>
              </span>
              <Field label="Nickname:">
                <input value={draft.nickname} maxLength={60} autoComplete="off" onChange={(e) => set({ nickname: e.target.value })} />
              </Field>
              <Field label="Company:">
                <input value={draft.company} maxLength={80} autoComplete="off" onChange={(e) => set({ company: e.target.value })} />
              </Field>
              <Field label="Screen name:">
                <input value={draft.screenName} maxLength={32} list={`${listId}-buddies`} autoComplete="off" autoCapitalize="off" spellCheck="false" placeholder="Their 98 Messenger name" onChange={(e) => set({ screenName: e.target.value })} />
              </Field>
              <datalist id={`${listId}-buddies`}>
                {buddies.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
              <Field label="98ish Mail:">
                <input value={draft.mail} maxLength={120} autoComplete="off" autoCapitalize="off" spellCheck="false" placeholder={draft.screenName ? `${draft.screenName} (their screen name)` : "Their screen name"} onChange={(e) => set({ mail: e.target.value })} />
              </Field>
              <p className="abNote">More phone numbers and e-mail addresses, the address, birthday, groups and notes are on the other tabs.</p>
            </MoreOptions>
          </div>
        )}
        {tab === "phone" && (
          <>
            <h4 className="abSubhead">Phone numbers</h4>
            <ListEditor kind="phone" items={draft.phones} labels={PHONE_LABELS} placeholder="555-0100" inputMode="tel" onChange={(phones) => set({ phones })} />
            <h4 className="abSubhead">Other e-mail addresses</h4>
            <ListEditor kind="e-mail" items={draft.emails} labels={EMAIL_LABELS} placeholder="name@example.com" inputMode="email" onChange={(emails) => set({ emails })} />
          </>
        )}
        {tab === "home" && (
          <div className="abGrid">
            <Field label="Street:" wide>
              <textarea rows={2} value={draft.address.street} maxLength={200} onChange={(e) => setAddress({ street: e.target.value })} />
            </Field>
            <Field label="City:">
              <input value={draft.address.city} maxLength={80} onChange={(e) => setAddress({ city: e.target.value })} />
            </Field>
            <Field label="State/Province:">
              <input value={draft.address.region} maxLength={80} onChange={(e) => setAddress({ region: e.target.value })} />
            </Field>
            <Field label="Zip Code:">
              <input value={draft.address.postal} maxLength={20} onChange={(e) => setAddress({ postal: e.target.value })} />
            </Field>
            <Field label="Country:">
              <input value={draft.address.country} maxLength={80} onChange={(e) => setAddress({ country: e.target.value })} />
            </Field>
          </div>
        )}
        {tab === "personal" && (
          <>
            <div className="abGrid">
              <DateField label="Birthday:" value={draft.birthday} onChange={(birthday) => set({ birthday })} />
              <DateField label="Anniversary:" value={draft.anniversary} onChange={(anniversary) => set({ anniversary })} />
            </div>
            <p className="abNote">Birthdays and anniversaries show on the Birthdays calendar in Calendar every year, with a reminder on the day.</p>
            <h4 className="abSubhead">Groups</h4>
            <div className="abGroupChecks">
              {allGroups.map((g) => (
                <span key={g} className="abCheck">
                  <input id={`${listId}-g-${g}`} type="checkbox" checked={draft.groups.includes(g)} onChange={(e) => set({ groups: e.target.checked ? [...draft.groups, g] : draft.groups.filter((x) => x !== g) })} />
                  <label htmlFor={`${listId}-g-${g}`}>{g}</label>
                </span>
              ))}
            </div>
            <div className="abListRow">
              <input aria-label="New group name" placeholder="New group" maxLength={30} value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
              <button
                type="button"
                disabled={!newGroup.trim()}
                onClick={() => {
                  const name = newGroup.trim()
                  addGroup(name)
                  set({ groups: [...new Set([...draft.groups, allGroups.find((g) => g.toLowerCase() === name.toLowerCase()) || name])] })
                  setNewGroup("")
                }}
              >
                Add Group
              </button>
            </div>
          </>
        )}
        {tab === "notes" && (
          <Field label="Notes:" wide>
            <textarea className="abNotes" value={draft.notes} maxLength={4000} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        )}
        {problem && (
          <p className="abError" role="alert">
            {problem}
          </p>
        )}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
      {choosing && <PictureChooser mobile={mobile} onPick={(picture) => (set({ picture }), setChoosing(false))} onCancel={() => setChoosing(false)} />}
    </Panel>
  )
}

export default ContactEditor
