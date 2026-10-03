import React, { useEffect, useState } from "react"
import * as G from "./game"
import { DECOR, GOODS, itemName, typeName } from "./data"
import { thumbUrl } from "./art"
import { Chip, Icon, Panel, fmtTime } from "./panels"

// Sunny Acres together: the Friends window (visit, mailbox, notes, the couple's goal), the
// gift wrapper, notes for a friend's town, filling a friend's help requests, the cloud
// conflict question and the gift-opening surprise.

const ago = (ms, now) => {
  const s = Math.max(0, now - ms)
  if (s < 60_000) return "just now"
  if (s < 3600_000) return `${Math.floor(s / 60_000)}m ago`
  if (s < 86400_000) return `${Math.floor(s / 3600_000)}h ago`
  return `${Math.floor(s / 86400_000)}d ago`
}
const contents = (g) =>
  g.decor ? typeName(g.decor) : Object.entries(g.goods || {}).map(([k, n]) => `${n} ${itemName(k)}`).join(", ")

const Goods = ({ goods, s }) => (
  <span className="twCost">
    {Object.entries(goods || {}).map(([k, n]) => (
      <Chip key={k} id={k} n={n} have={s ? G.have(s, k) : undefined} />
    ))}
  </span>
)

// ---- Friends ----
// coop: the co-op town picker (Coop.jsx), shown in its own tab
export const FriendsPanel = ({ social, s, couple, tab, setTab, now, onVisit, onOpenGift, onGift, onShowNote, onDeleteNote, onSettings, coop = null }) => {
  const d = social.data || {}
  const unopened = (d.mailbox || []).filter((g) => !g.openedAt)
  const paired = couple.status === "paired"
  const tabs = [
    ...(coop ? [["coop", "Co-op"]] : []),
    ["visit", "Visit"],
    ["mail", `Mailbox${unopened.length ? ` (${unopened.length})` : ""}`],
    ["notes", `Notes${d.notes?.length ? ` (${d.notes.length})` : ""}`],
    ...(paired ? [["us", "Together ♥"]] : []),
  ]
  return (
    <Panel title="Friends" icon="friends" onClose={() => setTab(null)} className="twFriends">
      <div className="twTabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "twTab is-on" : "twTab"} onClick={() => setTab(id)} data-tab={id}>
            {label}
          </button>
        ))}
      </div>
      {tab === "coop" && coop}
      {tab === "visit" && <VisitTab social={social} onVisit={onVisit} onSettings={onSettings} />}
      {tab === "mail" && (
        <div className="twMail">
          {!(d.mailbox || []).length && <p className="twEmpty">Your mailbox is empty.{paired ? ` Maybe ${couple.partner} will send you something!` : ""}</p>}
          {[...(d.mailbox || [])].reverse().map((g) => (
            <div key={g.id} className={`twMailRow${g.openedAt ? " is-open" : ""}`} data-gift={g.id}>
              <Icon id={g.openedAt ? "envelope" : "gift"} size={34} className={g.openedAt ? "" : "twWiggle"} />
              <div className="twMailText">
                <b>From {g.from}</b>
                <small>{g.openedAt ? contents(g) : `Sent ${ago(g.at, now)}`}</small>
                {g.openedAt && g.note && <q>{g.note}</q>}
              </div>
              {!g.openedAt && (
                <button type="button" className="twBtn twGo" onClick={() => onOpenGift(g)}>
                  Open
                </button>
              )}
            </div>
          ))}
          {paired && (
            <div className="twFoot">
              <span>{d.giftsLeft ?? 3} gifts left today</span>
              <button type="button" className="twBtn twGo" onClick={onGift} disabled={d.giftsLeft === 0}>
                <Icon id="gift" size={18} /> Send {couple.partner} a gift
              </button>
            </div>
          )}
        </div>
      )}
      {tab === "notes" && (
        <div className="twMail">
          {!(d.notes || []).length && <p className="twEmpty">When friends visit, they can leave little signs around your town. They'll show up here.</p>}
          {[...(d.notes || [])].reverse().map((n) => (
            <div key={n.id} className="twMailRow" data-note={n.id}>
              <Icon id="note" size={30} />
              <div className="twMailText">
                <b>{n.by}</b>
                <q>{n.text}</q>
                <small>{ago(n.at, now)}</small>
              </div>
              <button type="button" className="twBtn" onClick={() => onShowNote(n)}>
                Show
              </button>
              <button type="button" className="twBtn twTrash" aria-label="Take down this sign" title="Take down this sign" onClick={() => onDeleteNote(n)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      {tab === "us" && paired && <TogetherTab d={d} s={s} couple={couple} now={now} onGift={onGift} />}
    </Panel>
  )
}

const VisitTab = ({ social, onVisit, onSettings }) => {
  const [friends, setFriends] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    let gone = false
    social.call("GET", "/friends").then((r) => {
      if (gone) return
      if (r.ok) setFriends(r.friends)
      else setError(r.error)
    })
    return () => {
      gone = true
    }
  }, [])
  const allow = !!social.data?.allowBuddies
  return (
    <div className="twVisit">
      {error && <p className="twWhy">{error}</p>}
      {!friends && !error && <p className="twEmpty">Looking for your friends...</p>}
      {friends && !friends.length && <p className="twEmpty">Add buddies on 98 Messenger (or pair up with your partner in Us) to visit their towns.</p>}
      {friends?.map((f) => (
        <div key={f.name} className={`twFriend${f.relation === "partner" ? " is-partner" : ""}`} data-friend={f.name}>
          <Icon id={f.relation === "partner" ? "heart" : "people"} size={28} />
          <div className="twMailText">
            <b>
              {f.name} {f.online && <i className="twOnline" title="Online now" />}
            </b>
            <small>
              {f.relation === "partner" ? "Your partner" : "Buddy"}
              {f.level ? ` · Level ${f.level}` : ""}
              {!f.hasTown ? " · no town yet" : !f.canVisit ? " · private town" : ""}
            </small>
          </div>
          <button type="button" className="twBtn twGo" disabled={!f.canVisit} onClick={() => onVisit(f.name)}>
            Visit
          </button>
        </div>
      ))}
      <label className="twCheck">
        <input type="checkbox" checked={allow} onChange={(e) => onSettings({ allowBuddies: e.target.checked })} />
        Let buddies visit my town
      </label>
      <p className="twHint">Your partner can always visit. Buddies can visit when this is on and they're on your Buddy List.</p>
    </div>
  )
}

const TogetherTab = ({ d, s, couple, now, onGift }) => {
  const g = d.goal
  const owned = s.objs.some((o) => o.t === "lovecottage")
  return (
    <div className="twTogether">
      {g ? (
        <div className={`twGoal${g.done ? " is-done" : ""}`}>
          <div className="twGoalHead">
            <Icon id="wheat" size={30} />
            <div>
              <b>Together, harvest {g.target} crops this week</b>
              <small>{g.done ? "You did it! The reward went to you both. ♥" : `Ends in ${fmtTime(g.endsAt - now)}`}</small>
            </div>
          </div>
          <div className="twGoalBar" role="progressbar" aria-valuemin={0} aria-valuemax={g.target} aria-valuenow={Math.min(g.total, g.target)}>
            <span className="twGoalMine" style={{ width: `${Math.min(100, (g.mine / g.target) * 100)}%` }} />
            <span className="twGoalTheirs" style={{ width: `${Math.min(100 - Math.min(100, (g.mine / g.target) * 100), (g.theirs / g.target) * 100)}%` }} />
            <em>
              {Math.min(g.total, g.target)} / {g.target}
            </em>
          </div>
          <div className="twGoalKey">
            <span>
              <i className="twGoalMine" /> You: {g.mine}
            </span>
            <span>
              <i className="twGoalTheirs" /> {couple.partner}: {g.theirs}
            </span>
          </div>
          <div className="twCost">
            Reward for both: <Chip id="coin" n={g.reward.coins} /> <Chip id="xp" n={g.reward.xp} /> <Chip id="clover" n={g.reward.clovers} />
          </div>
        </div>
      ) : (
        <p className="twEmpty">Loading your goal...</p>
      )}
      <div className="twPerk">
        <img className="twThumb" src={thumbUrl("lovecottage")} alt="" />
        <div className="twMailText">
          <b>Couple's Cottage</b>
          <small>{owned ? "It's in your town. ♥" : "Unlocked for you both! Build it free from Shop > Decor."}</small>
        </div>
      </div>
      <div className="twPerk">
        <img className="twThumb" src={thumbUrl("welcome")} alt="" />
        <div className="twMailText">
          <b>Welcome sign</b>
          <small>
            Your towns' signs say {couple.me} ♥ {couple.partner}.
          </small>
        </div>
      </div>
      <div className="twFoot">
        <span>{d.giftsLeft ?? 3} gifts left today</span>
        <button type="button" className="twBtn twGo" onClick={onGift} disabled={d.giftsLeft === 0}>
          <Icon id="gift" size={18} /> Send a gift
        </button>
      </div>
    </div>
  )
}

// ---- wrapping a gift for your partner ----
const GIFT_DECOR = Object.keys(DECOR).filter((t) => !DECOR[t].couple)
export const GiftPanel = ({ s, partner, giftsLeft, onSend, onClose }) => {
  const [mode, setMode] = useState("goods")
  const [picked, setPicked] = useState({})
  const [decor, setDecor] = useState(null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const total = Object.values(picked).reduce((a, b) => a + b, 0)
  const goods = Object.keys(GOODS).filter((g) => s.goods[g])
  const add = (g, n) => {
    const next = Math.max(0, Math.min(G.have(s, g), (picked[g] || 0) + n))
    if (n > 0 && total >= G.MAX_GIFT_ITEMS) return
    setPicked({ ...picked, [g]: next })
  }
  const ready = mode === "goods" ? total > 0 : !!decor && s.coins >= DECOR[decor].cost
  const send = async () => {
    setBusy(true)
    setError(null)
    const r = await onSend(mode === "goods" ? { goods: Object.fromEntries(Object.entries(picked).filter(([, n]) => n > 0)), note } : { decor, note })
    setBusy(false)
    if (r && !r.ok) setError(r.error)
  }
  return (
    <Panel title={`A gift for ${partner}`} icon="gift" onClose={onClose} className="twGiftPanel">
      <div className="twTabs" role="tablist">
        <button type="button" className={mode === "goods" ? "twTab is-on" : "twTab"} onClick={() => setMode("goods")}>
          From my Barn
        </button>
        <button type="button" className={mode === "decor" ? "twTab is-on" : "twTab"} onClick={() => setMode("decor")}>
          A decoration
        </button>
      </div>
      {mode === "goods" ? (
        <>
          <p className="twHint">Pick up to {G.MAX_GIFT_ITEMS} things ({total} picked).</p>
          {!goods.length && <p className="twEmpty">Your Barn is empty. Harvest something first!</p>}
          <div className="twGoods">
            {goods.map((g) => (
              <div key={g} className={`twGiftGood${picked[g] ? " is-on" : ""}`} data-good={g}>
                <button type="button" className="twGood" onClick={() => add(g, 1)} title={`Add ${itemName(g)}`}>
                  <Icon id={g} size={30} />
                  <span>{picked[g] ? `${picked[g]}/${s.goods[g]}` : s.goods[g]}</span>
                </button>
                {picked[g] > 0 && (
                  <button type="button" className="twBtn twMinus" aria-label={`One less ${itemName(g)}`} onClick={() => add(g, -1)}>
                    −
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="twGrid">
          {GIFT_DECOR.map((t) => {
            const d = DECOR[t]
            const locked = d.lvl > s.level
            return (
              <button key={t} type="button" className={`twItem twPick${decor === t ? " is-on" : ""}${locked ? " is-locked" : ""}`} disabled={locked} onClick={() => setDecor(t)} data-type={t}>
                <img className="twThumb" src={thumbUrl(t)} alt="" draggable={false} />
                <div className="twItemName">{d.name}</div>
                {locked ? (
                  <div className="twItemLock">
                    <Icon id="lock" size={16} /> Level {d.lvl}
                  </div>
                ) : (
                  <Chip id="coin" n={d.cost} have={s.coins} />
                )}
              </button>
            )
          })}
        </div>
      )}
      <label className="twNoteField">
        A note (optional)
        <input type="text" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Thinking of you ♥" />
      </label>
      {error && <div className="twWhy">{error}</div>}
      <div className="twFoot">
        <span>{giftsLeft} gifts left today</span>
        <button type="button" className="twBtn twGo" disabled={!ready || busy || giftsLeft === 0} onClick={send}>
          <Icon id="gift" size={18} /> Wrap it up ♥
        </button>
      </div>
    </Panel>
  )
}

// ---- a note for a friend's town ----
const SUGGESTIONS = ["Love your town! ♥", "So cozy here!", "Your fields look amazing!", "Hi neighbor!", "Miss you ♥"]
export const NotePanel = ({ owner, where, onSend, onClose }) => {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const send = async () => {
    setBusy(true)
    const r = await onSend(text)
    setBusy(false)
    if (r && !r.ok) setError(r.error)
  }
  return (
    <Panel title={`A note for ${owner}`} icon="note" onClose={onClose} className="twSmall twNotePanel">
      <p className="twHint">It goes on a little sign {where ? `by the ${where}` : "where you're looking"}.</p>
      <div className="twSuggest">
        {SUGGESTIONS.map((t) => (
          <button key={t} type="button" className="twBtn" onClick={() => setText(t)}>
            {t}
          </button>
        ))}
      </div>
      <label className="twNoteField">
        <input type="text" maxLength={80} value={text} onChange={(e) => setText(e.target.value)} placeholder="Love your bakery!" autoFocus onKeyDown={(e) => e.key === "Enter" && text.trim() && send()} />
      </label>
      {error && <div className="twWhy">{error}</div>}
      <div className="twFoot">
        <span>{80 - text.length} left</span>
        <button type="button" className="twBtn twGo" disabled={!text.trim() || busy} onClick={send}>
          <Icon id="note" size={18} /> Put up the sign
        </button>
      </div>
    </Panel>
  )
}

// ---- a friend's help requests ----
export const HelpRequestsPanel = ({ owner, requests, s, onHelp, onClose }) => {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const help = async (r) => {
    setBusy(r.id)
    setError(null)
    const out = await onHelp(r)
    setBusy(null)
    if (out && !out.ok) setError(out.error)
  }
  return (
    <Panel title={`${owner} needs help`} icon="help" onClose={onClose} className="twHelpReq">
      {!requests.length && <p className="twEmpty">{owner} doesn't need anything right now.</p>}
      {error && <div className="twWhy">{error}</div>}
      {requests.map((r) => {
        const can = Object.entries(r.need).every(([g, n]) => G.have(s, g) >= n)
        const reward = G.helpReward(r.need)
        return (
          <div key={r.id} className={`twOrder twReq${can ? " is-ready" : ""}`} data-request={r.id}>
            <Icon id={r.kind === "car" ? "train" : "heli"} size={30} />
            <div className="twMailText">
              <b>{r.kind === "car" ? "A train car" : "A helicopter order"}</b>
              <Goods goods={r.need} s={s} />
            </div>
            <div className="twReward">
              <small>You get</small>
              <Chip id="coin" n={reward.coins} />
              <Chip id="xp" n={reward.xp} />
            </div>
            <button type="button" className="twBtn twGo" disabled={!can || busy === r.id} onClick={() => help(r)}>
              {busy === r.id ? "Sending..." : "Fill from my Barn"}
            </button>
          </div>
        )
      })}
    </Panel>
  )
}

// ---- which town to keep ----
const describe = (s) => (s ? `Level ${s.level} · ${s.coins} coins · ${s.objs.length} things built` : "")
export const ConflictPanel = ({ local, cloud, onPick }) => {
  const cloudState = G.migrate(cloud.snap)
  const localNewer = (local.t || 0) > cloud.savedAt
  return (
    <Panel title="Two towns!" icon="barn" onClose={() => {}} className="twSmall twConflict">
      <p>Sunny Acres was played on this device and on another one. Which town do you want to keep? The other is kept as a backup on this device.</p>
      <div className="twChoices">
        <button type="button" className="twItem twPick" onClick={() => onPick("local")} data-keep="local">
          <Icon id="home" size={36} />
          <div className="twItemName">This device{localNewer ? " (newest)" : ""}</div>
          <div className="twItemInfo">{describe(local)}</div>
        </button>
        <button type="button" className="twItem twPick" onClick={() => onPick("cloud")} data-keep="cloud">
          <Icon id="xp" size={36} />
          <div className="twItemName">The cloud{localNewer ? "" : " (newest)"}</div>
          <div className="twItemInfo">{describe(cloudState)}</div>
          <small>Saved {new Date(cloud.savedAt).toLocaleString()}</small>
        </button>
      </div>
    </Panel>
  )
}

// ---- opening a gift ----
export const GiftOpening = ({ gift, onDone }) => {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const a = setTimeout(() => setOpen(true), 900)
    return () => clearTimeout(a)
  }, [])
  return (
    <div className="twGiftOpen" onPointerDown={() => open && onDone()} role="dialog" aria-label={`A gift from ${gift.from}`}>
      <div className={`twGiftBox${open ? " is-open" : ""}`}>
        <div className="twHearts" aria-hidden="true">
          {Array.from({ length: 9 }, (_, k) => (
            <i key={k} style={{ "--k": k }} />
          ))}
        </div>
        <div className="twGiftLid" />
        <div className="twGiftBody" />
        {open && (
          <div className="twGiftInside">
            {gift.decor ? (
              <img src={thumbUrl(gift.decor)} width={72} height={72} alt="" />
            ) : (
              Object.entries(gift.goods || {}).map(([k, n]) => (
                <span key={k} className="twGiftItem">
                  <Icon id={k} size={40} />
                  <b>×{n}</b>
                </span>
              ))
            )}
          </div>
        )}
      </div>
      {open && (
        <div className="twGiftCard">
          <b>From {gift.from} ♥</b>
          <span>{contents(gift)}</span>
          {gift.note && <q>{gift.note}</q>}
          {gift.decor && <small>Find it in Shop &gt; Decor to place it.</small>}
          <button type="button" className="twBtn twGo" onClick={onDone} autoFocus>
            Thank you!
          </button>
        </div>
      )}
    </div>
  )
}
