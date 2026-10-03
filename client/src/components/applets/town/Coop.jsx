import React, { useEffect, useState } from "react"
import { Icon, Panel } from "./panels"
import { COOP_ACHIEVEMENTS, MAX_PLAYERS } from "./coopRules"
import { useNet } from "../network/NetContext"
import { ConnectionPanel } from "../../shared/online/PlayOnline"
import { useServerStatus } from "../../shared/online/useOnlineRoom"

// Sunny Acres co-op windows: picking (or starting) a co-op town, and the farmers sheet
// inside one (who's here, who did what today, invitations, the town's achievements and
// what everyone's been up to). The town itself is played in Town.jsx (coopClient.js).

const ago = (ms) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 50) return "just now"
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

const Dot = ({ color, on = true }) => <i className={`twDot${on ? "" : " is-off"}`} style={{ background: color }} aria-hidden="true" />

// ---- picking a co-op town ----

export const CoopPanel = ({ onClose, ...props }) => (
  <Panel title="Co-op Town" icon="friends" onClose={onClose} className="twCoopPick">
    <CoopPicker {...props} />
  </Panel>
)

// Not signed on (or not connected): say exactly what to do, with the button that does it
const CoopSignOn = () => {
  const net = useNet()
  const server = useServerStatus()
  if (!server.online) return <ConnectionPanel server={server} />
  return (
    <div className="twEmpty">
      <p>Co-op towns are for 98 Messenger members: sign on to farm a town together, live, with your partner or buddies.</p>
      <button type="button" className="twBtn" onClick={() => net?.openProgram("98 Messenger")}>
        Sign On to 98 Messenger
      </button>
    </div>
  )
}

// the co-op towns I can farm in, and starting one (also a tab in the Friends window)
export const CoopPicker = ({ request, signedIn, couple, onEnter, beforeConvert }) => {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(null) // { kind, from, replace, title, text, ok }
  const paired = couple.status === "paired" && !!couple.partner

  const load = async () => {
    const r = await request("coop:list")
    if (r?.ok) setData(r)
    else setError(r?.error || "Couldn't reach the 98ish server.")
  }
  useEffect(() => {
    if (signedIn) load()
  }, [signedIn])

  const create = async ({ kind, from, replace }) => {
    setBusy(true)
    setConfirm(null)
    // the server copies my town as last saved in the cloud
    if (from === "convert") await beforeConvert?.()
    const r = await request("coop:create", { kind, from, replace })
    setBusy(false)
    if (!r?.ok) return setError(r?.error || "That didn't work.")
    onEnter(r.id)
  }

  if (!signedIn) return <CoopSignOn />

  const coupleTown = data?.towns.find((t) => t.id === data.coupleTown)
  const others = (data?.towns || []).filter((t) => t.id !== data?.coupleTown)
  const ask = (c) => setConfirm(c)

  return (
    <div className="twCoop">
      {confirm ? (
        <div className="twConfirm" role="alertdialog" aria-label={confirm.title}>
          <Icon id={confirm.from === "convert" ? "home" : "heart"} size={34} />
          <div>
            <b>{confirm.title}</b>
            <p>{confirm.text}</p>
          </div>
          <div className="twConfirmBtns">
            <button type="button" className="twBtn twGo" disabled={busy} onClick={() => create(confirm)} data-confirm="yes">
              {confirm.ok}
            </button>
            <button type="button" className="twBtn" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="twCoopIntro">Farm one town together, live: you both plant, harvest and build at the same time, with one Barn and one purse. Your own town stays just as it is.</p>
          {error && <p className="twWhy">{error}</p>}
          {!data && !error && <p className="twEmpty">Looking for your co-op towns...</p>}
          {data && paired && (
            <div className="twCoopTown is-couple" data-town="couple">
              <Icon id="heart" size={30} />
              <div className="twMailText">
                <b>{coupleTown ? coupleTown.name : `A town for you and ${couple.partner}`}</b>
                <small>{coupleTown ? `Level ${coupleTown.level} · ${coupleTown.members.map((m) => m.name).join(", ")}` : "Just the two of you (invite buddies too, if you like)."}</small>
                {coupleTown && (
                  <span className="twCoopRow">
                    <button type="button" className="twLink" onClick={() => ask({ kind: "couple", from: "new", replace: true, title: "Start over?", text: `Your co-op town with ${couple.partner} will be replaced by a brand new one. Everything in it now will be gone.`, ok: "Start over" })}>
                      Start over
                    </button>
                    {data.canConvert && (
                      <button type="button" className="twLink" onClick={() => ask({ kind: "couple", from: "convert", replace: true, title: "Bring your town?", text: `Your co-op town with ${couple.partner} will be replaced by a copy of your own town. Your own town stays just as it is.`, ok: "Copy my town" })}>
                        Bring my town instead
                      </button>
                    )}
                  </span>
                )}
              </div>
              {coupleTown ? (
                <button type="button" className="twBtn twGo" disabled={busy} onClick={() => onEnter(coupleTown.id)} data-enter={coupleTown.id}>
                  Farm here
                </button>
              ) : (
                <span className="twCoopStart">
                  <button type="button" className="twBtn twGo" disabled={busy} onClick={() => create({ kind: "couple", from: "new" })} data-start="couple">
                    Start a co-op town
                  </button>
                  {data.canConvert && (
                    <button
                      type="button"
                      className="twBtn"
                      disabled={busy}
                      data-convert="couple"
                      onClick={() => ask({ kind: "couple", from: "convert", title: "Make your town our co-op town?", text: `Your town (fields, buildings, Barn and level) is copied into a co-op town you and ${couple.partner} farm together. Your own town stays just as it is.`, ok: "Copy my town" })}
                    >
                      Convert my town
                    </button>
                  )}
                </span>
              )}
            </div>
          )}
          {others.map((t) => (
            <div key={t.id} className="twCoopTown" data-town={t.id}>
              <Icon id="friends" size={30} />
              <div className="twMailText">
                <b>{t.name}</b>
                <small>
                  Level {t.level} · {t.members.map((m) => m.name).join(", ")}
                </small>
              </div>
              <button type="button" className="twBtn twGo" disabled={busy} onClick={() => onEnter(t.id)} data-enter={t.id}>
                Farm here
              </button>
            </div>
          ))}
          {data && (
            <div className="twFoot">
              <span>{paired ? "Or a town with buddies (up to 4 farmers)" : "A town for you and up to 3 buddies"}</span>
              <button type="button" className="twBtn" disabled={busy} onClick={() => create({ kind: "group", from: "new" })} data-start="group">
                <Icon id="friends" size={18} /> New buddy town
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---- inside a co-op town: the farmers sheet ----

const STAT_WORDS = [
  ["crops", "crop", "crops", "harvested"],
  ["planted", "field", "fields", "planted"],
  ["animals", "animal good", "animal goods", "collected"],
  ["made", "good", "goods", "made"],
  ["orders", "order", "orders", "delivered"],
  ["built", "thing", "things", "built"],
]
const statLine = (st) =>
  STAT_WORDS.filter(([k]) => st?.[k])
    .map(([k, one, many, verb]) => `${verb} ${st[k]} ${st[k] === 1 ? one : many}`)
    .join(" · ")

export const FarmersPanel = ({ session, net, me, onHome, onQuit, onClose }) => {
  const st = session.st
  const [tab, setTab] = useState("farmers")
  const [name, setName] = useState("")
  const [sent, setSent] = useState({})
  const [msg, setMsg] = useState(null)
  useEffect(() => {
    session.refreshStats()
  }, [])
  const here = new Set(st.players.map((p) => p.name))
  const seats = st.members.length + st.invited.length
  const room = seats < MAX_PLAYERS
  const memberNames = new Set(st.members.map((m) => m.name.toLowerCase()))
  const online = (net?.computers || []).filter((c) => c.user && !c.me && !memberNames.has(String(c.name).toLowerCase()))
  const invite = async (to, label) => {
    setMsg(null)
    const r = await net.invite(to, "town", { roomId: st.id })
    if (r?.ok) {
      setSent((x) => ({ ...x, [label]: true }))
      setMsg(`Invitation sent to ${label}! ♥`)
    } else setMsg(r?.error || "That didn't work.")
  }
  const byName = new Map(st.stats.map((x) => [x.name, x]))
  const canQuit = !!st.you?.canQuit

  return (
    <Panel title={st.town?.name || "Co-op Town"} icon="friends" onClose={onClose} className="twFarmers">
      <div className="twTabs" role="tablist">
        {[
          ["farmers", "Farmers"],
          ["news", "What's new"],
          ["ach", "Achievements"],
        ].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "twTab is-on" : "twTab"} onClick={() => setTab(id)} data-tab={id}>
            {label}
          </button>
        ))}
      </div>
      {tab === "farmers" && (
        <div className="twMail">
          {st.members.map((m) => {
            const stats = byName.get(m.name)
            const today = statLine(stats?.today)
            return (
              <div key={m.name} className="twFarmer" data-farmer={m.name}>
                <Dot color={m.color} on={here.has(m.name)} />
                <div className="twMailText">
                  <b>
                    {m.name}
                    {m.name === me ? " (you)" : ""}
                  </b>
                  <small>{here.has(m.name) ? "Farming now" : "Away"}</small>
                  <small className="twFarmerStats">{today ? `Today: ${today}` : "Nothing yet today."}</small>
                  {stats?.total && statLine(stats.total) && <small className="twFarmerTotal">In all: {statLine(stats.total)}</small>}
                </div>
              </div>
            )
          })}
          {st.invited.map((n) => (
            <div key={n} className="twFarmer is-invited">
              <Dot color="#bbb" on={false} />
              <div className="twMailText">
                <b>{n}</b>
                <small>Invited...</small>
              </div>
            </div>
          ))}
          {room && net && (
            <div className="twInvite">
              <b>Invite a farmer</b>
              {online.slice(0, 6).map((c) => (
                <div key={c.id} className="twInviteRow">
                  <span>{c.name}</span>
                  <button type="button" className="twBtn" disabled={!!sent[c.name]} onClick={() => invite({ id: c.id }, c.name)} data-invite={c.name}>
                    {sent[c.name] ? "Invited" : "Invite"}
                  </button>
                </div>
              ))}
              <form
                className="twInviteRow"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (name.trim()) invite({ screenName: name.trim() }, name.trim())
                }}
              >
                <input className="twInput" value={name} onChange={(e) => setName(e.target.value)} placeholder="Screen name" maxLength={24} aria-label="Screen name to invite" />
                <button type="submit" className="twBtn" disabled={!name.trim()}>
                  Invite
                </button>
              </form>
              {msg && <small className="twHint">{msg}</small>}
            </div>
          )}
          {!room && <p className="twHint">This town has room for {MAX_PLAYERS} farmers.</p>}
          <div className="twFoot">
            <button type="button" className="twBtn twGo" onClick={onHome} data-home="1">
              <Icon id="home" size={18} /> Go home to my town
            </button>
            {canQuit && (
              <button type="button" className="twBtn" onClick={onQuit}>
                Leave for good
              </button>
            )}
          </div>
        </div>
      )}
      {tab === "news" && (
        <div className="twMail twFeedList">
          {!st.feed.length && <p className="twEmpty">Nothing yet. Go plant something!</p>}
          {[...st.feed].reverse().map((f, k) => (
            <div key={`${f.at}-${k}`} className="twFeedRow">
              <Dot color={f.color || "#999"} />
              <span>{f.text}</span>
              <small>{ago(f.at)}</small>
            </div>
          ))}
        </div>
      )}
      {tab === "ach" && (
        <div className="twMail">
          {COOP_ACHIEVEMENTS.map((a) => {
            const got = st.ach.find((x) => x.id === a.id)
            return (
              <div key={a.id} className={`twAch${got ? " is-got" : ""}`} data-ach={a.id}>
                <Icon id={got ? "heart" : "lock"} size={26} />
                <div className="twMailText">
                  <b>{a.name}</b>
                  <small>{a.text}</small>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

// the strip under the top bar: whose town this is and who's here
export const CoopBanner = ({ session, me, onOpen }) => {
  const st = session.st
  const others = st.players.filter((p) => p.name !== me)
  const partners = st.members.filter((m) => m.name !== me).map((m) => m.name)
  const withWho = partners.length ? partners.slice(0, 2).join(" & ") + (partners.length > 2 ? ` +${partners.length - 2}` : "") : "your buddies"
  return (
    <button type="button" className="twCoopBanner" onClick={onOpen} data-coop-banner="1" aria-label="Farmers in this town">
      <Icon id={st.town?.kind === "couple" ? "heart" : "friends"} size={18} />
      <span className="twCoopName">
        You're in <b>{st.town?.name || "a co-op town"}</b> with {withWho}
      </span>
      <span className="twCoopDots">
        {st.players.map((p) => (
          <Dot key={p.pid} color={p.color} />
        ))}
      </span>
      {!others.length && <small className="twCoopAlone">just you right now</small>}
    </button>
  )
}

// the last thing or two that happened, for a few seconds
export const CoopTicker = ({ session, now }) => {
  const recent = session.st.feed.filter((f) => now - f.at < 6000).slice(-2)
  if (!recent.length) return null
  return (
    <div className="twCoopTicker" role="status" aria-live="polite">
      {recent.map((f, k) => (
        <div key={`${f.at}-${k}`} className="twCoopLine">
          <Dot color={f.color || "#999"} /> {f.text}
        </div>
      ))}
    </div>
  )
}
