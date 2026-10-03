import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import Dialog from "../../shared/Dialog"
import { channelMessages, createRecord, getRecord, mentionsIn, postMessage, recordsOf, userName, userOf } from "./engine.js"
import { change } from "./store.js"
import { Icon } from "./icons.jsx"
import { useAw, ago, avatarColor, initials } from "./ctx.js"
import { RecordChip } from "./Records.jsx"
import { playSystemSound } from "../../../utils/systemSounds"

// Conversations: channels and direct messages, with @mentions (which notify), emoji and
// records attached as chips. Coworkers in the sample workspace answer when mentioned.

const EMOJI = ["🙂", "😀", "😂", "😉", "😎", "🤔", "😮", "😢", "👍", "👏", "🙌", "🎉", "🔥", "✅", "❗", "☕", "🍕", "📦", "🔧", "📈"]

const REPLIES = [
  (me) => `@${me} On it!`,
  (me) => `@${me} Sure thing, I'll take a look this afternoon.`,
  (me) => `@${me} Thanks for the heads up 👍`,
  (me) => `@${me} Good catch. Can we talk at the production meeting?`,
  (me) => `@${me} Done! Let me know if you need anything else.`,
]

// text with @mentions picked out
const MessageText = ({ text }) => {
  const { ws } = useAw()
  const parts = String(text).split(/(@[a-z0-9]+)/gi)
  return (
    <p className="awMsgText">
      {parts.map((p, i) =>
        p.startsWith("@") && userOf(ws, p.slice(1).toLowerCase()) ? (
          <span key={i} className={`awMention ${p.slice(1).toLowerCase() === ws.me ? "is-me" : ""}`} title={userName(ws, p.slice(1).toLowerCase())}>
            {p}
          </span>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        )
      )}
    </p>
  )
}

export const ChatView = ({ channel: wanted, focusMsg }) => {
  const { ws, pickRecord, toast, mobile } = useAw()
  const channels = recordsOf(ws, "conversations").sort((a, b) => (a.kind === b.kind ? a.channel.localeCompare(b.channel) : a.kind === "Channel" ? -1 : 1))
  const [active, setActive] = useState(wanted && getRecord(ws, "conversations", wanted) ? wanted : channels[0]?.id || null)
  const [text, setText] = useState("")
  const [attachments, setAttachments] = useState([])
  const [emoji, setEmoji] = useState(false)
  const [dialog, setDialog] = useState(null)
  const [flash, setFlash] = useState(focusMsg || null)
  const listRef = useRef(null)
  const inputRef = useRef(null)
  const timers = useRef([])

  // a notification can open a channel at a message
  useEffect(() => {
    if (wanted && getRecord(ws, "conversations", wanted)) setActive(wanted)
    if (focusMsg) setFlash(focusMsg)
  }, [wanted, focusMsg])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const chan = active && getRecord(ws, "conversations", active)
  const messages = chan ? channelMessages(ws, active) : []

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const target = flash && list.querySelector(`[data-msg="${flash}"]`)
    if (target) target.scrollIntoView({ block: "center" })
    else list.scrollTop = list.scrollHeight
  }, [active, messages.length, flash])
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 2600)
    return () => clearTimeout(t)
  }, [flash])

  // "@da" at the end of the box -> suggest Dana
  const partial = text.match(/@([a-z0-9]*)$/i)?.[1]
  const suggestions = partial !== undefined ? ws.users.filter((u) => u.handle.startsWith(partial.toLowerCase()) || u.name.toLowerCase().startsWith(partial.toLowerCase())).slice(0, 6) : []

  const mention = (handle) => {
    setText((t) => t.replace(/@([a-z0-9]*)$/i, "") + `@${handle} `)
    inputRef.current?.focus()
  }

  const send = () => {
    if (!chan) return
    const out = change((w) => postMessage(w, active, { text, attachments }))
    if (!out?.ok) return toast(out?.error || "Couldn't send.")
    setText("")
    setAttachments([])
    setEmoji(false)
    if (out.mentioned.length) toast(`Notified ${out.mentioned.map((h) => userName(ws, h)).join(", ")}.`)
    // a coworker who was mentioned (or the person in a direct message) writes back
    const dmWith = chan.kind === "Direct" ? ws.users.find((u) => u.name === chan.channel && u.handle !== ws.me) : null
    const replier = out.mentioned.find((h) => h !== ws.me) || dmWith?.handle
    if (replier) {
      const channelId = active
      timers.current.push(
        setTimeout(() => {
          const line = REPLIES[Math.floor(Math.random() * REPLIES.length)](ws.me)
          const reply = change((w) => postMessage(w, channelId, { from: replier, text: line }))
          if (reply?.ok) {
            playSystemSound("ding")
            toast(`${userName(ws, replier)} mentioned you. See Notifications.`)
          }
        }, 1400 + Math.random() * 900)
      )
    }
  }

  const attach = () =>
    pickRecord({
      title: "Attach a Record",
      okLabel: "Attach",
      onPick: (ref) => setAttachments((a) => (a.includes(ref) ? a : [...a, ref].slice(0, 8))),
    })

  const newChannel = (kind) => setDialog({ kind, name: "", topic: "", who: "" })
  const makeChannel = () => {
    if (dialog.kind === "Direct") {
      const u = userOf(ws, dialog.who)
      if (!u) return
      const existing = channels.find((c) => c.kind === "Direct" && c.channel === u.name)
      if (existing) {
        setActive(existing.id)
        return setDialog(null)
      }
      const out = change((w) => createRecord(w, "conversations", { channel: u.name, kind: "Direct", topic: "Direct message" }))
      if (out.ok) setActive(out.record.id)
    } else {
      const name = dialog.name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "")
      if (!name) return toast("Give the channel a name.")
      const out = change((w) => createRecord(w, "conversations", { channel: name, kind: "Channel", topic: dialog.topic }))
      if (out.ok) setActive(out.record.id)
    }
    setDialog(null)
  }

  return (
    <div className="awChat">
      {mobile ? (
        <div className="awChatPick">
          <select value={active || ""} onChange={(e) => setActive(e.target.value)} aria-label="Conversation">
            {channels.map((c) => (
              <option key={c.id} value={c.id}>{c.kind === "Direct" ? `@ ${c.channel}` : `# ${c.channel}`}</option>
            ))}
          </select>
          <button type="button" className="awBtn" onClick={() => newChannel("Channel")}>+ Channel</button>
          <button type="button" className="awBtn" onClick={() => newChannel("Direct")}>+ DM</button>
        </div>
      ) : (
        <aside className="awChannels">
          <div className="awSubhead">Channels</div>
          {channels.filter((c) => c.kind === "Channel").map((c) => (
            <button type="button" key={c.id} className={`awChannel ${c.id === active ? "is-on" : ""}`} onClick={() => setActive(c.id)}>
              # {c.channel}
            </button>
          ))}
          <button type="button" className="awChannel awChannelAdd" onClick={() => newChannel("Channel")}>+ New Channel</button>
          <div className="awSubhead">Direct Messages</div>
          {channels.filter((c) => c.kind === "Direct").map((c) => (
            <button type="button" key={c.id} className={`awChannel ${c.id === active ? "is-on" : ""}`} onClick={() => setActive(c.id)}>
              @ {c.channel}
            </button>
          ))}
          <button type="button" className="awChannel awChannelAdd" onClick={() => newChannel("Direct")}>+ New Message</button>
        </aside>
      )}
      <section className="awChatMain">
        {chan ? (
          <>
            <header className="awChatHead">
              <b>{chan.kind === "Direct" ? `@ ${chan.channel}` : `# ${chan.channel}`}</b>
              {chan.topic && <span className="awMuted"> — {chan.topic}</span>}
            </header>
            <div className="awMsgs" ref={listRef} role="log" aria-label="Messages">
              {messages.map((m) => (
                <div key={m.id} className={`awMsg ${flash === m.id ? "is-flash" : ""} ${mentionsIn(ws, m.text).includes(ws.me) ? "is-mentioned" : ""}`} data-msg={m.id}>
                  <span className="awAvatar awAvatar--big" style={{ background: avatarColor(m.from) }}>{initials(userName(ws, m.from))}</span>
                  <div className="awMsgBody">
                    <div className="awMsgHead">
                      <b>{userName(ws, m.from)}</b> <span className="awMuted">{ago(m._c)}</span>
                    </div>
                    <MessageText text={m.text} />
                    {m.attachments?.length > 0 && (
                      <div className="awChips">
                        {m.attachments.map((r) => (
                          <RecordChip key={r} refStr={r} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {!messages.length && <div className="awEmpty">No messages yet. Say hello!</div>}
            </div>
            <div className="awCompose">
              {suggestions.length > 0 && (
                <ul className="awSuggest window" role="listbox" aria-label="Mention someone">
                  {suggestions.map((u) => (
                    <li key={u.handle}>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => mention(u.handle)}>
                        <span className="awAvatar" style={{ background: avatarColor(u.handle) }}>{initials(u.name)}</span> @{u.handle} <span className="awMuted">{u.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {emoji && (
                <div className="awEmojiPop window" role="dialog" aria-label="Emoji">
                  {EMOJI.map((e) => (
                    <button
                      type="button"
                      key={e}
                      onClick={() => {
                        setText((t) => t + e)
                        inputRef.current?.focus()
                      }}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              )}
              {attachments.length > 0 && (
                <div className="awChips awAttachRow">
                  {attachments.map((r) => (
                    <RecordChip key={r} refStr={r} onRemove={() => setAttachments((a) => a.filter((x) => x !== r))} />
                  ))}
                </div>
              )}
              <div className="awComposeRow">
                <textarea
                  ref={inputRef}
                  rows={2}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      if (suggestions.length && partial !== undefined && partial.length) return mention(suggestions[0].handle)
                      send()
                    }
                  }}
                  placeholder={`Message ${chan.kind === "Direct" ? chan.channel : "#" + chan.channel} (type @ to mention someone)`}
                  aria-label="Message"
                  maxLength={2000}
                />
                <div className="awComposeBtns">
                  <button type="button" className="awTool" title="Emoji" aria-label="Emoji" onClick={() => setEmoji((v) => !v)}>🙂</button>
                  <button type="button" className="awTool" title="Mention someone" aria-label="Mention" onClick={() => { setText((t) => (t && !t.endsWith(" ") ? t + " @" : t + "@")); inputRef.current?.focus() }}>@</button>
                  <button type="button" className="awTool" title="Attach a record" aria-label="Attach a record" onClick={attach}>
                    <Icon name="link" />
                  </button>
                  <button type="button" className="awBtn awBtnGo" onClick={send} disabled={!text.trim() && !attachments.length}>
                    Send
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="awEmpty">Make a channel to start talking.</div>
        )}
      </section>
      {dialog && (
        <Dialog title={dialog.kind === "Direct" ? "New Message" : "New Channel"} onOk={makeChannel} onCancel={() => setDialog(null)} okDisabled={dialog.kind === "Direct" ? !dialog.who : !dialog.name.trim()}>
          {dialog.kind === "Direct" ? (
            <label className="awPickRow">
              To:
              <select value={dialog.who} onChange={(e) => setDialog({ ...dialog, who: e.target.value })}>
                <option value="">(pick someone)</option>
                {ws.users.filter((u) => u.handle !== ws.me).map((u) => (
                  <option key={u.handle} value={u.handle}>{u.name}</option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label className="awPickRow">
                Name:
                <input type="text" value={dialog.name} onChange={(e) => setDialog({ ...dialog, name: e.target.value })} maxLength={40} placeholder="e.g. second-shift" />
              </label>
              <label className="awPickRow">
                Topic:
                <input type="text" value={dialog.topic} onChange={(e) => setDialog({ ...dialog, topic: e.target.value })} maxLength={100} />
              </label>
            </>
          )}
        </Dialog>
      )}
    </div>
  )
}
