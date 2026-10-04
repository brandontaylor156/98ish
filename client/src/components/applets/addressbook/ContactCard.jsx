import React from "react"
import MoreOptions from "../../shared/MoreOptions"
import { addressText, dateText, daysUntil, displayName, initials, mailAddressOf, yearsOn } from "../../../utils/contactsCore"

// A contact's picture, or their initials on a color of their own
const COLORS = ["#1c48a8", "#2a9a3a", "#c02020", "#8040b0", "#008080", "#e07818", "#e0509a", "#8a5a2a"]
export const Avatar = ({ contact, size = 32 }) => {
  if (contact.picture) return <img className="abAvatar" src={contact.picture} alt="" width={size} height={size} draggable="false" style={{ width: size, height: size }} />
  const color = COLORS[Math.abs([...(contact.id || displayName(contact))].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)) % COLORS.length]
  return (
    <span className="abAvatar abInitials" aria-hidden="true" style={{ width: size, height: size, background: color, fontSize: Math.round(size * 0.4) }}>
      {initials(contact)}
    </span>
  )
}

// 98 Messenger presence: online (green), away or idle (yellow), offline (gray)
export const presenceOf = (aim, screenName) => {
  if (!screenName || aim?.status !== "online") return null
  const p = aim.presence?.[String(screenName).replace(/\s+/g, "").toLowerCase()]
  if (!p?.online) return { state: "offline", text: "Offline" }
  if (p.away) return { state: "away", text: "Away" }
  if (p.idleSince) return { state: "away", text: "Idle" }
  return { state: "online", text: "Online now" }
}
export const StatusDot = ({ presence }) => (presence ? <span className={`abDot abDot--${presence.state}`} title={presence.text} aria-label={presence.text} role="img" /> : null)

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

const comingUp = (value, word) => {
  const days = daysUntil(value, today())
  const years = yearsOn(value, today())
  if (days === null) return ""
  const when = days === 0 ? "today" : days === 1 ? "tomorrow" : days < 45 ? `in ${days} days` : ""
  if (!when) return ""
  return word === "birthday" ? (years ? `turns ${years} ${when}` : `birthday ${when}`) : years ? `${years} years ${when}` : `anniversary ${when}`
}

const label = (l) => (l === "iphone" ? "iPhone" : l ? l[0].toUpperCase() + l.slice(1) : "")

// The card: picture, name, how they're doing on 98 Messenger, the buttons to reach them and
// everything you know about them. actions: { im, call, video, mail, invite, edit, remove,
// favorite, add (a buddy who isn't a contact yet) } (missing ones are left out)
export const ContactCard = ({ contact, presence, signedOn, actions, mobile, onBack }) => {
  const address = addressText(contact.address)
  const mail = mailAddressOf(contact)
  const canTalk = !!contact.screenName
  const bday = comingUp(contact.birthday, "birthday")
  const anniv = comingUp(contact.anniversary, "anniversary")
  return (
    <div className={`abCard${mobile ? " abCardPhone" : ""}`}>
      {mobile && onBack && (
        <button type="button" className="abBack" onClick={onBack}>
          &lt; Contacts
        </button>
      )}
      <div className="abCardHead">
        <Avatar contact={contact} size={mobile ? 72 : 56} />
        <div className="abCardName">
          <h2>
            {displayName(contact)}
            {contact.favorite && (
              <span className="abStar" title="Favorite" aria-label="Favorite">
                {"★︎"}
              </span>
            )}
          </h2>
          {contact.nickname && [contact.first, contact.last].some(Boolean) && <p>"{contact.nickname}"</p>}
          {contact.company && <p>{contact.company}</p>}
          {contact.screenName && (
            <p className="abPresence">
              <StatusDot presence={presence} />
              {contact.screenName}
              {presence ? ` - ${presence.text}` : signedOn ? "" : " (98 Messenger)"}
            </p>
          )}
          {actions.add && <p className="abNote">On your Buddy List, not in your Address Book yet.</p>}
        </div>
      </div>
      <div className="abActions">
        {actions.add && (
          <button type="button" className="abDefault" onClick={actions.add}>
            Add to Address Book
          </button>
        )}
        {actions.im && (
          <button type="button" onClick={actions.im} disabled={!canTalk} title={canTalk ? `Send ${contact.screenName} an Instant Message` : "Add their screen name first"}>
            Send IM
          </button>
        )}
        {actions.call && (
          <button type="button" onClick={actions.call} disabled={!canTalk || presence?.state === "offline"} title="Voice call over 98 Messenger">
            Call
          </button>
        )}
        {actions.mail && (
          <button type="button" onClick={actions.mail} disabled={!mail} title={mail ? `Write to ${mail} in 98ish Mail` : "Add their screen name or 98ish Mail address first"}>
            Send Mail
          </button>
        )}
        {actions.edit && (
          <button type="button" onClick={actions.edit}>
            Properties
          </button>
        )}
        {/* the everyday actions above; the rest one tap away (docs/simplicity.md) */}
        {(actions.video || actions.invite || actions.favorite || actions.remove) && (
          <MoreOptions id="addressbook.card" label="More" lessLabel="Less" inline className="abCardMore">
            <div className="abActions">
              {actions.video && (
                <button type="button" onClick={actions.video} disabled={!canTalk || presence?.state === "offline"} title="Video call over 98 Messenger">
                  Video Call
                </button>
              )}
              {actions.invite && (
                <button type="button" onClick={actions.invite} disabled={!canTalk}>
                  Invite to Calendar...
                </button>
              )}
              {actions.favorite && (
                <button type="button" onClick={actions.favorite} aria-pressed={contact.favorite}>
                  {contact.favorite ? "Unfavorite" : "Favorite"}
                </button>
              )}
              {actions.remove && (
                <button type="button" onClick={actions.remove}>
                  Delete
                </button>
              )}
            </div>
          </MoreOptions>
        )}
      </div>
      <dl className="abDetails" data-selectable>
        {contact.phones.map((p, i) => (
          <React.Fragment key={`p${i}`}>
            <dt>{label(p.label)}</dt>
            <dd>
              <a href={`tel:${p.value.replace(/[^\d+*#]/g, "")}`}>{p.value}</a>
            </dd>
          </React.Fragment>
        ))}
        {mail && (
          <>
            <dt>98ish Mail</dt>
            <dd>{mail}</dd>
          </>
        )}
        {contact.emails.map((e, i) => (
          <React.Fragment key={`e${i}`}>
            <dt>E-mail ({label(e.label)})</dt>
            <dd>
              <a href={`mailto:${e.value}`}>{e.value}</a>
            </dd>
          </React.Fragment>
        ))}
        {address && (
          <>
            <dt>Home</dt>
            <dd className="abPre">{address}</dd>
          </>
        )}
        {contact.birthday && (
          <>
            <dt>Birthday</dt>
            <dd>
              {dateText(contact.birthday)}
              {bday && <span className="abSoon"> ({bday})</span>}
            </dd>
          </>
        )}
        {contact.anniversary && (
          <>
            <dt>Anniversary</dt>
            <dd>
              {dateText(contact.anniversary)}
              {anniv && <span className="abSoon"> ({anniv})</span>}
            </dd>
          </>
        )}
        {contact.groups.length > 0 && (
          <>
            <dt>Groups</dt>
            <dd>{contact.groups.join(", ")}</dd>
          </>
        )}
        {contact.notes && (
          <>
            <dt>Notes</dt>
            <dd className="abPre">{contact.notes}</dd>
          </>
        )}
      </dl>
    </div>
  )
}
