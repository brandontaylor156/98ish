import React, { useEffect, useMemo, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import MoreOptions from "../../shared/MoreOptions"
import { Select } from "../../shared/select/Combo"
import { helpItem } from "../../../utils/help"
import { useNet } from "../network/NetContext"
import { useAim } from "../aim/AimContext"
import { fs, readContent, writeAndSave, FILE_TYPE } from "../../../utils/fs"
import { DOS_GAMES, FLASH_DEMO, gameById } from "./catalog"
import DosPlayer from "./DosPlayer"
import FlashPlayer from "./FlashPlayer"
import "./LanParty.css"

// LAN Party 98: DOS classics (shareware DOOM and Heretic) alone or on a "LAN" with friends,
// and the Shockwave Arcade for Flash movies. The LAN is DOSBox's IPX network carried over
// WebRTC by js-dos; our server only passes the host's peer id under a code (server/lanparty).

const MAX_SWF_BYTES = 20 * 1024 * 1024
const FLASH_FOLDER = ["Games", "Flash"]

const ensureFolder = (parts) => {
  let dir = fs.root
  for (const part of parts) {
    let next = dir.getItem(part)
    if (!next || !next.isDirectory) next = fs.createDirectoryIn(dir, part)
    dir = next
  }
  return dir
}

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^;,]*/, "data:application/x-shockwave-flash"))
    r.onerror = () => reject(new Error("That file couldn't be read."))
    r.readAsDataURL(file)
  })

const HostDialog = ({ game, onStart, onCancel }) => {
  const [nodes, setNodes] = useState(2)
  const [deathmatch, setDeathmatch] = useState(true)
  const [skill, setSkill] = useState(3)
  return (
    <Dialog title={`Play ${game.short} with Friends`} okLabel="Host Game" onOk={() => onStart({ nodes, deathmatch, skill })} onCancel={onCancel}>
      <div className="lpForm">
        <p>You host; friends join with a code. Everyone needs LAN Party 98 open.</p>
        <label htmlFor="lp-nodes">
          Players
          <Select id="lp-nodes" value={nodes} onChange={(e) => setNodes(Number(e.target.value))}>
            {[2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </label>
        <div className="lpRadios" role="radiogroup" aria-label="Kind of game">
          <input id="lp-dm" type="radio" name="lp-kind" checked={deathmatch} onChange={() => setDeathmatch(true)} />
          <label htmlFor="lp-dm">Deathmatch (everyone against everyone)</label>
          <input id="lp-coop" type="radio" name="lp-kind" checked={!deathmatch} onChange={() => setDeathmatch(false)} />
          <label htmlFor="lp-coop">Co-op (together through the levels)</label>
        </div>
        <MoreOptions id="lanparty.host" summary={`Skill ${skill}`}>
          <label htmlFor="lp-skill">
            Skill
            <Select id="lp-skill" value={skill} onChange={(e) => setSkill(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                  {n === 3 ? " (normal)" : n === 5 ? " (nightmare)" : ""}
                </option>
              ))}
            </Select>
          </label>
        </MoreOptions>
      </div>
    </Dialog>
  )
}

const InviteDialog = ({ code, game, buddies, onSend, onCancel }) => {
  const [who, setWho] = useState(buddies[0] || "")
  return (
    <Dialog title="Invite a Buddy" okLabel="Send IM" okDisabled={!who} onOk={() => onSend(who)} onCancel={onCancel}>
      <div className="lpForm">
        <label htmlFor="lp-buddy">
          To
          <Select id="lp-buddy" value={who} onChange={(e) => setWho(e.target.value)}>
            {buddies.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
        </label>
        <p data-selectable>
          "Join my {game.short} LAN game in LAN Party 98! Code: {code}"
        </p>
      </div>
    </Dialog>
  )
}

const LanParty = ({ handoff, onClose }) => {
  const net = useNet()
  const aim = useAim()
  const [view, setView] = useState(null) // null | { kind: "dos", game, mode, opts, peer, code } | { kind: "flash", src, name }
  const [dialog, setDialog] = useState(null)
  const [error, setError] = useState("")
  const [code, setCode] = useState("")
  const [hosted, setHosted] = useState(null) // { code, count }
  const [friends, setFriends] = useState([])
  const [busy, setBusy] = useState(false)

  const online = !!net?.socket?.connected
  const buddies = useMemo(() => [...new Set((aim?.me?.groups || []).flatMap((g) => g.buddies || []))].filter((b) => !/smarterchild/i.test(b)), [aim?.me?.groups])

  // friends' LAN games (refreshed while the shelf is showing)
  useEffect(() => {
    if (view || !net?.request) return
    let dead = false
    const look = () =>
      net
        .request("lan:list", {})
        .then((r) => !dead && r?.ok && setFriends(r.games || []))
        .catch(() => {})
    look()
    const t = setInterval(look, 8000)
    return () => {
      dead = true
      clearInterval(t)
    }
  }, [view, online])

  // the host hears who's coming; a joiner hears when the host's game ends
  useEffect(() => {
    const s = net?.socket
    if (!s) return
    const joined = (d) => setHosted((h) => (h && d?.code === h.code ? { ...h, count: d.count, last: `${d.name} joined` } : h))
    const left = (d) => setHosted((h) => (h && d?.code === h.code ? { ...h, count: d.count, last: `${d.name} left` } : h))
    const ended = (d) => setView((v) => (v?.code && v.code === d?.code && v.mode === "join" ? (setError("The host ended the LAN game."), null) : v))
    s.on("lan:joined", joined)
    s.on("lan:left", left)
    s.on("lan:end", ended)
    return () => {
      s.off("lan:joined", joined)
      s.off("lan:left", left)
      s.off("lan:end", ended)
    }
  }, [net?.socket])

  // a file or a game handed over (My Computer, a .swf, DOOM.EXE)
  useEffect(() => {
    if (!handoff?.id) return
    if (handoff.flash) setView({ kind: "flash", src: handoff.flash, name: handoff.name || "Flash movie" })
    else if (handoff.game && gameById(handoff.game)) setView({ kind: "dos", game: gameById(handoff.game), mode: "play" })
    else if (handoff.join) setCode(String(handoff.join))
  }, [handoff?.id])

  const leave = () => {
    if (view?.mode === "host") net?.request?.("lan:stop", {}).catch(() => {})
    if (view?.mode === "join" && view.code) net?.request?.("lan:leave", { code: view.code }).catch(() => {})
    setHosted(null)
    setView(null)
  }
  useEffect(() => () => net?.request?.("lan:stop", {}).catch(() => {}), [])

  const play = (game) => setView({ kind: "dos", game, mode: "play" })
  const host = (game, opts) => {
    setDialog(null)
    setView({ kind: "dos", game, mode: "host", opts })
  }
  const onHostNet = async (peerId) => {
    const r = await net.request("lan:host", { game: view.game.id, nodes: view.opts.nodes, deathmatch: view.opts.deathmatch, peerId }).catch(() => null)
    if (r?.ok) setHosted({ code: r.code, count: 1 })
    else setError(r?.error || "Couldn't publish the game. Check the connection.")
  }
  const join = async (c = code) => {
    const clean = String(c || "").trim().toUpperCase()
    if (!clean) return
    setBusy(true)
    const r = await net?.request?.("lan:join", { code: clean }).catch(() => null)
    setBusy(false)
    if (!r?.ok) return setError(r?.error || "Couldn't reach the LAN game. Check the connection.")
    const game = gameById(r.game.game)
    setView({ kind: "dos", game, mode: "join", opts: { nodes: r.game.nodes, deathmatch: r.game.deathmatch }, peer: r.game.peerId, code: r.game.code })
  }
  const openSwf = () => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".swf,application/x-shockwave-flash"
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      if (!/\.swf$/i.test(file.name)) return setError("That isn't a Flash movie (.swf).")
      if (file.size > MAX_SWF_BYTES) return setError("That movie is too big (Flash movies up to 20 MB).")
      try {
        const url = await readFileAsDataUrl(file)
        const dir = ensureFolder(FLASH_FOLDER)
        const name = file.name.replace(/[\\/:"<>|]/g, "_")
        let item = dir.getItem(name)
        const created = !item
        if (!item) item = fs.createFileIn(dir, name, FILE_TYPE.swf, "")
        const saved = await writeAndSave(item, url, { created })
        setView({ kind: "flash", src: url, name: file.name })
        if (!saved) setError("Drive C: is full, so the movie plays but isn't kept.")
      } catch (e) {
        setError(e.message)
      }
    }
    input.click()
  }
  const myFlash = () => {
    const dir = fs.root.getItem(FLASH_FOLDER[0])?.getItem(FLASH_FOLDER[1])
    return (dir?.content || []).filter((f) => f.type === FILE_TYPE.swf)
  }
  const playItem = async (item) => setView({ kind: "flash", src: await readContent(item), name: item.name })

  const menus = [
    {
      label: "Game",
      items: [
        ...DOS_GAMES.map((g) => ({ label: `Play ${g.short}`, onClick: () => play(g) })),
        "-",
        { label: "Shockwave Arcade Demo", onClick: () => setView({ kind: "flash", src: FLASH_DEMO.url, name: FLASH_DEMO.name }) },
        { label: "Open a Flash Movie (.swf)...", onClick: openSwf },
        "-",
        { label: view ? "Back to the Games" : "Exit", onClick: view ? leave : onClose },
      ],
    },
    { label: "Help", items: [helpItem({ program: "LAN Party 98" })] },
  ]

  const title = view?.kind === "dos" ? view.game.short : view?.name

  return (
    <div className="lpRoot">
      <MenuBar menus={menus} />
      {view ? (
        <div className="lpStage">
          <div className="lpBar">
            <button type="button" onClick={leave} data-lp-back>
              « Games
            </button>
            <b>{title}</b>
            {view.mode === "host" && (
              <span className="lpCode" data-lp-code={hosted?.code || ""}>
                {hosted ? (
                  <>
                    Code <b data-selectable>{hosted.code}</b> · {hosted.count}/{view.opts.nodes}
                  </>
                ) : (
                  "Setting up the LAN..."
                )}
              </span>
            )}
            {view.mode === "host" && hosted && buddies.length > 0 && (
              <button type="button" onClick={() => setDialog({ kind: "invite" })}>
                Invite...
              </button>
            )}
            {view.mode === "join" && <span className="lpCode">LAN game {view.code}</span>}
          </div>
          {view.mode === "host" && hosted && hosted.count < view.opts.nodes && <div className="lpHint">The game starts when {view.opts.nodes} players have joined. {hosted.last || ""}</div>}
          {view.kind === "dos" ? (
            <DosPlayer key={`${view.game.id}-${view.mode}-${view.peer || ""}`} game={view.game} mode={view.mode} opts={view.opts} peer={view.peer} onNet={view.mode === "host" ? onHostNet : undefined} onError={setError} />
          ) : (
            <FlashPlayer key={view.src.slice(0, 64)} src={view.src} onError={setError} />
          )}
        </div>
      ) : (
        <div className="lpShelf">
          {DOS_GAMES.map((g) => (
            <div className="lpCard" key={g.id} data-game={g.id}>
              <div className="lpCardText">
                <b>{g.name}</b>
                <small>
                  {g.by}, {g.year}. {g.blurb}
                </small>
              </div>
              <div className="lpCardButtons">
                <button type="button" className="lpPrimary" onClick={() => play(g)} data-lp-play={g.id}>
                  Play
                </button>
                <button type="button" onClick={() => setDialog({ kind: "host", game: g })} disabled={!online} data-lp-host={g.id} title={online ? "" : "Connect to the network first"}>
                  With Friends...
                </button>
              </div>
            </div>
          ))}
          <div className="lpCard" data-game="flash">
            <div className="lpCardText">
              <b>Shockwave Arcade</b>
              <small>Flash movies and games (.swf) from drive C:, played by Ruffle.</small>
            </div>
            <div className="lpCardButtons">
              <button type="button" onClick={() => setView({ kind: "flash", src: FLASH_DEMO.url, name: FLASH_DEMO.name })} data-lp-flash>
                Demo
              </button>
              <button type="button" onClick={openSwf}>
                Open .swf...
              </button>
            </div>
          </div>
          {myFlash().length > 0 && (
            <ul className="lpList" aria-label="Flash movies on drive C:">
              {myFlash().map((f) => (
                <li key={f.name}>
                  <button type="button" onClick={() => playItem(f)}>
                    {f.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <fieldset className="lpJoin">
            <legend>Join a friend's LAN game</legend>
            {friends.filter((g) => g.host !== aim?.me?.screenName).length > 0 && (
              <ul className="lpList">
                {friends
                  .filter((g) => g.host !== aim?.me?.screenName)
                  .map((g) => (
                    <li key={g.code}>
                      <button type="button" onClick={() => join(g.code)} data-lp-friend={g.code}>
                        {g.host}'s {gameById(g.game)?.short || g.game} · {g.count}/{g.nodes}
                      </button>
                    </li>
                  ))}
              </ul>
            )}
            <div className="lpJoinRow">
              <input id="lp-code" type="text" placeholder="Code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} aria-label="Game code" />
              <button type="button" onClick={() => join()} disabled={!code.trim() || busy || !online} data-lp-join>
                Join
              </button>
            </div>
            {!online && <small>Connect to the network to play with friends.</small>}
          </fieldset>
        </div>
      )}
      {dialog?.kind === "host" && <HostDialog game={dialog.game} onStart={(opts) => host(dialog.game, opts)} onCancel={() => setDialog(null)} />}
      {dialog?.kind === "invite" && hosted && view?.game && (
        <InviteDialog
          code={hosted.code}
          game={view.game}
          buddies={buddies}
          onCancel={() => setDialog(null)}
          onSend={async (who) => {
            setDialog(null)
            const r = await aim?.sendIm?.(who, `Join my ${view.game.short} LAN game in LAN Party 98! Code: ${hosted.code}`)
            if (r?.ok === false) setError(r.error || "The invite didn't go through.")
          }}
        />
      )}
      {error && (
        <Dialog title="LAN Party 98" onOk={() => setError("")} onCancel={() => setError("")}>
          <p>{error}</p>
        </Dialog>
      )}
    </div>
  )
}

export default LanParty
