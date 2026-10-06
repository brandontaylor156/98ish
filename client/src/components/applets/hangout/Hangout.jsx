import React, { useEffect, useMemo, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import MoreOptions from "../../shared/MoreOptions"
import { helpItem } from "../../../utils/help"
import { keyOf, useAim, useBuddyGroups } from "../aim/AimContext"
import { useHangout, invite, join, leave, allowTouch, follow, act, meKey, clearEnded, shareDoc } from "../../../utils/hangout"
import { useSharedDocs, refreshShared, createShared, deleteShared, ydocTraffic } from "../../../utils/ydoc"
import { openTarget } from "../../../utils/notifications"
import { initials, listNames, MAX_PEOPLE } from "./hangoutCore"
import VisitView from "./VisitView"
import SharedFolder from "./SharedFolder"
import "./Hangout.css"

// Come Over: have up to three friends over on your 98ish. You see each other's pointers (and
// taps on phones), which window each one is using, can visit each other's desktop, follow
// someone's view, hand each other files, and work on the same Notepad text, Paint picture or
// shared folder at once. Baseline: who's here and Invite; Visit and Shared are tabs; the
// rest is under More options. Server: server/aim/hangout.js + ydocs.js.

const ENDED = {
  "host-left": "The host ended the hangout.",
  alone: "Everyone else left.",
  declined: "Nobody could come over this time.",
  lost: "Your connection dropped for too long.",
  blocked: "The hangout ended.",
  server: "98ish restarted. Invite them again.",
  signedoff: "You signed off.",
}

const Person = ({ p, me, onFollow, watching, onVisit }) => (
  <li className="hgPerson" data-person={p.key}>
    <span className="hgDot" style={{ background: p.color }}>
      {initials(p.name)}
    </span>
    <span className="hgPersonName">
      <b>{p.name}</b>
      {p.key === me ? " (you)" : ""}
      {p.away ? <small> · away</small> : null}
      {p.touch ? <small> · lets friends touch their desktop</small> : null}
    </span>
    {p.key !== me && (
      <span className="hgPersonButtons">
        <button type="button" onClick={() => onVisit(p.key)} data-visit={p.key}>
          Visit
        </button>
        <button type="button" onClick={() => onFollow(watching === p.key ? null : p.key)} data-follow={p.key} aria-pressed={watching === p.key}>
          {watching === p.key ? "Unfollow" : "Follow"}
        </button>
      </span>
    )}
  </li>
)

const Hangout = ({ mobile, handoff, dispatch, onClose }) => {
  const aim = useAim()
  const hg = useHangout()
  const docs = useSharedDocs()
  const groups = useBuddyGroups()
  const [tab, setTab] = useState(handoff?.tab || "here")
  const [visiting, setVisiting] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const online = aim?.status === "online"
  const me = meKey()
  const people = hg.state?.people || []
  const others = people.filter((p) => p.key !== me)
  const mine = people.find((p) => p.key === me)
  const watching = mine?.watching || null

  // an invitation (a notification or push) to join
  useEffect(() => {
    if (handoff?.hangout && online) join(handoff.hangout)
    if (handoff?.tab) setTab(handoff.tab)
  }, [handoff?.id, online])
  useEffect(() => {
    if (online) refreshShared()
  }, [online])

  const buddies = useMemo(() => {
    const seen = new Set(people.map((p) => p.key))
    const out = []
    for (const g of groups) if (!g.offline) for (const b of g.buddies) if (b.online && !b.bot && !seen.has(keyOf(b.screenName))) seen.add(keyOf(b.screenName)), out.push(b.screenName)
    return out.sort((a, b) => a.localeCompare(b))
  }, [groups, people])

  const doInvite = async (name) => {
    setBusy(true)
    const res = await invite(name)
    setBusy(false)
    setMsg(res.ok ? `Invited ${name}. They'll see an invitation on their 98ish.` : res.error)
  }

  const hangoutDocs = docs.filter((d) => hg.state?.docs?.includes(d.id) || d.members.length > 1)
  const folder = hangoutDocs.find((d) => d.kind === "folder")
  const newShared = async (kind) => {
    const names = others.map((p) => p.name)
    const res = await createShared(kind, kind === "folder" ? "Shared with Friends" : kind === "paint" ? "Shared picture" : "Shared note", names)
    if (!res.ok) return setMsg(res.error)
    if (hg.id) await shareDoc(res.id)
    if (kind !== "folder") openDoc(res.meta)
  }
  const openDoc = (d) => {
    if (d.kind === "folder") return setTab("shared")
    openTarget({ kind: "program", name: d.kind === "paint" ? "Paint" : "Notepad", extra: { handoff: { id: Date.now(), shared: d.id, title: d.title } } })
  }

  const traffic = (() => {
    const s = hg.stats
    const y = ydocTraffic()
    const secs = Math.max(1, (Date.now() - (s.since || Date.now())) / 1000)
    return { kbps: ((s.sent + s.got) / 1024 / secs).toFixed(2), docs: ((y.sent + y.got) / 1024).toFixed(0) }
  })()

  const menus = [
    {
      label: "Hangout",
      items: [
        { label: "Invite...", disabled: !online, onClick: () => setTab("here") },
        { label: "Leave", disabled: !hg.id, onClick: () => leave() },
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    {
      label: "Share",
      items: [
        { label: "New Shared Note", disabled: !online, onClick: () => newShared("text") },
        { label: "New Shared Picture", disabled: !online, onClick: () => newShared("paint") },
        { label: "Shared with Friends Folder", disabled: !online, onClick: () => (folder ? setTab("shared") : newShared("folder").then(() => setTab("shared"))) },
      ],
    },
    { label: "Help", items: [helpItem({ program: "Come Over" })] },
  ]

  let body
  if (!online) {
    body = <p className="hgNote">Sign on to 98 Messenger to have friends come over. Your buddies need to be signed on too.</p>
  } else if (tab === "visit") {
    const key = visiting || others[0]?.key
    const person = people.find((p) => p.key === key)
    body = person ? (
      <>
        <div className="hgRow">
          {others.map((p) => (
            <button key={p.key} type="button" aria-pressed={p.key === key} onClick={() => setVisiting(p.key)}>
              {p.name}
            </button>
          ))}
        </div>
        <VisitView person={person} snap={hg.desks[key]} cursor={hg.cursors[key]} canTouch={!!person.touch} onAct={(a) => act(key, a)} />
      </>
    ) : (
      <p className="hgNote">Nobody's here yet. Invite a buddy on the Here tab, then visit their desktop.</p>
    )
  } else if (tab === "shared") {
    body = (
      <>
        <h4 className="hgH">Shared things</h4>
        {hangoutDocs.filter((d) => d.kind !== "folder").length ? (
          <ul className="hgList" data-shared-list>
            {hangoutDocs
              .filter((d) => d.kind !== "folder")
              .map((d) => (
                <li key={d.id}>
                  <button type="button" className="hgLink" onClick={() => openDoc(d)} data-open-doc={d.id}>
                    {d.kind === "paint" ? "🖼" : "📝"} {d.title}
                  </button>
                  <small> with {listNames(d.members.filter((m) => m.key !== me).map((m) => m.name)) || "nobody yet"}</small>
                  <button type="button" className="hgSmall" onClick={() => deleteShared(d.id)} title={d.ownerKey === me ? "Delete it for everyone" : "Leave it"}>
                    {d.ownerKey === me ? "Delete" : "Leave"}
                  </button>
                </li>
              ))}
          </ul>
        ) : (
          <p className="hgNote">Nothing shared yet. In Notepad or Paint, File &gt; Share with Friends Here; or Share &gt; New Shared Note.</p>
        )}
        <h4 className="hgH">Shared with Friends folder</h4>
        {folder ? <SharedFolder meta={folder} dispatch={dispatch} /> : (
          <button type="button" onClick={() => newShared("folder")} data-new-folder disabled={!hg.id && !others.length}>
            Make a shared folder
          </button>
        )}
      </>
    )
  } else {
    body = (
      <>
        {hg.id ? (
          <>
            <h4 className="hgH">
              Here now ({people.length} of {MAX_PEOPLE})
            </h4>
            <ul className="hgList" data-here>
              {people.map((p) => (
                <Person key={p.key} p={p} me={me} watching={watching} onFollow={follow} onVisit={(k) => (setVisiting(k), setTab("visit"))} />
              ))}
            </ul>
            {(hg.state?.invited || []).length > 0 && <p className="hgNote">Waiting for {listNames(hg.state.invited.map((i) => i.name))}...</p>}
          </>
        ) : (
          <p className="hgNote">
            Invite a buddy and they come over: you'll see each other's pointers and desktops, and can work on a note, a picture or a folder together.
          </p>
        )}
        {hg.ended && (
          <p className="hgNote" data-ended>
            {ENDED[hg.ended.reason] || "The hangout ended."}{" "}
            <button type="button" className="hgLink" onClick={clearEnded}>
              OK
            </button>
          </p>
        )}
        {people.length < MAX_PEOPLE && (
          <>
            <h4 className="hgH">Invite</h4>
            {buddies.length ? (
              <ul className="hgList hgInviteList">
                {buddies.map((name) => (
                  <li key={name}>
                    <span>{name}</span>
                    <button type="button" disabled={busy} onClick={() => doInvite(name)} data-invite={name}>
                      Invite
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hgNote">None of your buddies are signed on right now.</p>
            )}
          </>
        )}
        {msg && <p className="hgMsg">{msg}</p>}
        {hg.id && (
          <div className="hgRow hgEnd">
            <button type="button" onClick={() => leave()} data-leave>
              {hg.state?.hostKey === me ? "End for Everyone" : "Leave"}
            </button>
          </div>
        )}
        {hg.id && (
          <MoreOptions id="hangout.more" summary={mine?.touch ? "Friends can touch your desktop" : "Friends can look, not touch"}>
            <label className="hgCheck">
              <input type="checkbox" checked={!!mine?.touch} onChange={(e) => allowTouch(e.target.checked)} data-allow-touch />
              Let friends here open and switch windows on my desktop
            </label>
            <p className="hgSmallNote">
              Private programs (98 Messenger, Mail, Notes, Passwords, Photos and others) never show in a visit or a follow. Traffic now: {traffic.kbps} KB/s; shared documents so far {traffic.docs} KB.
            </p>
          </MoreOptions>
        )}
      </>
    )
  }

  return (
    <div className={`hgRoot${mobile ? " is-mobile" : ""}`}>
      <MenuBar menus={menus} />
      <menu role="tablist" className="hgTabs">
        {[
          ["here", "Here"],
          ["visit", "Visit"],
          ["shared", "Shared"],
        ].map(([id, label]) => (
          <li key={id} role="tab" aria-selected={tab === id}>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                setTab(id)
              }}
              data-tab-btn={id}
            >
              {label}
            </a>
          </li>
        ))}
      </menu>
      <div className="window hgPanel" role="tabpanel">
        <div className="hgBody">{body}</div>
      </div>
    </div>
  )
}

export default Hangout
