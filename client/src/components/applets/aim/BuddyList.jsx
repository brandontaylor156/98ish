import React, { useState } from "react"
import { LOBBY, BOT_NAME, keyOf, useAim, useBuddyGroups } from "./AimContext"
import { useOpenGesture } from "../../../hooks/useMediaQuery"
import AimDialog from "./AimDialog"
import MenuBar from "./MenuBar"
import { AwayNote, DoorClosed, DoorOpen, NoIcon } from "./Icons"

const AWAY_PRESETS = [
  "I am away from my computer right now.",
  "brb",
  "Out to lunch. Leave a message!",
  "Playing Tetris. Do not disturb.",
]

const idleMinutes = (since) => Math.max(1, Math.round((Date.now() - since) / 60_000))
const idleLabel = (since) => {
  const minutes = idleMinutes(since)
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}` : String(minutes)
}

const BuddyRow = ({ buddy, selected, onSelect, openGesture, onOpen }) => {
  const icon = buddy.change === "on" ? <DoorOpen /> : buddy.change === "off" ? <DoorClosed /> : buddy.away ? <AwayNote /> : <NoIcon />
  const classes = ["aimBuddy"]
  if (selected) classes.push("is-selected")
  if (!buddy.online) classes.push("is-offline")
  if (buddy.idleSince || buddy.away) classes.push("is-idle")
  if (buddy.change === "on") classes.push("is-arriving")

  return (
    <li
      className={classes.join(" ")}
      onClick={onSelect}
      {...(buddy.online ? openGesture(onOpen) : {})}
      title={buddy.away ? `${buddy.screenName} is away` : undefined}
    >
      {icon}
      <span className="aimBuddyName">{buddy.screenName}</span>
      {buddy.online && buddy.idleSince && <span className="aimBuddyMeta"> ({idleLabel(buddy.idleSince)})</span>}
      {buddy.online && buddy.warning > 0 && <span className="aimBuddyMeta"> ({buddy.warning}%)</span>}
    </li>
  )
}

const BuddyList = () => {
  const aim = useAim()
  const { me, connected } = aim
  const groups = useBuddyGroups()
  const openGesture = useOpenGesture()
  const [tab, setTab] = useState("online")
  const [collapsed, setCollapsed] = useState({ Offline: true })
  const [selected, setSelected] = useState(null) // { group, screenName } or { group }
  const [dialog, setDialog] = useState(null)

  const selectedBuddy = selected?.screenName
  const close = () => setDialog(null)
  const toggle = (name) => setCollapsed((c) => ({ ...c, [name]: !c[name] }))

  // ---- buddy list editing (List Setup) ----

  const addBuddy = async (screenName, groupName) => {
    const name = screenName.trim().replace(/\s+/g, " ")
    if (!name) return
    const already = me.groups.some((g) => g.buddies.some((b) => keyOf(b) === keyOf(name)))
    if (already) return setDialog({ kind: "alert", title: "Add Buddy", text: `${name} is already on your Buddy List.` })
    const groupsNext = me.groups.map((g) => (g.name === groupName ? { ...g, buddies: [...g.buddies, name] } : g))
    const result = await aim.saveGroups(groupsNext)
    if (!result.ok) return setDialog({ kind: "alert", title: "Add Buddy", text: result.error })
    // The server drops names that aren't valid screen names
    if (!result.groups.some((g) => g.buddies.some((b) => keyOf(b) === keyOf(name)))) {
      return setDialog({ kind: "alert", title: "Add Buddy", text: `"${name}" is not a valid screen name.` })
    }
    close()
  }

  const addGroup = async (name) => {
    const groupName = name.trim()
    if (!groupName) return
    if (me.groups.some((g) => g.name.toLowerCase() === groupName.toLowerCase())) {
      return setDialog({ kind: "alert", title: "Add Group", text: `You already have a group named ${groupName}.` })
    }
    await aim.saveGroups([...me.groups, { name: groupName, buddies: [] }])
    close()
  }

  const renameGroup = async (from, to) => {
    const name = to.trim()
    if (!name) return
    await aim.saveGroups(me.groups.map((g) => (g.name === from ? { ...g, name } : g)))
    setSelected({ group: name })
    close()
  }

  const removeSelected = async () => {
    if (selectedBuddy) {
      await aim.saveGroups(
        me.groups.map((g) => (g.name === selected.group ? { ...g, buddies: g.buddies.filter((b) => keyOf(b) !== keyOf(selectedBuddy)) } : g))
      )
    } else if (selected?.group) {
      await aim.saveGroups(me.groups.filter((g) => g.name !== selected.group))
    }
    setSelected(null)
    close()
  }

  // ---- menus ----

  const menus = [
    {
      label: "My AIM",
      items: [
        { label: "Away Message...", onClick: () => setDialog({ kind: "away", text: me.away || AWAY_PRESETS[0] }) },
        { label: "Edit Profile...", onClick: () => setDialog({ kind: "profile", text: me.profile }) },
        "-",
        { label: "Sounds", checked: aim.prefs.sound, onClick: () => aim.setPrefs({ sound: !aim.prefs.sound }) },
        "-",
        { label: "Sign Off", onClick: aim.signOff },
      ],
    },
    {
      label: "People",
      items: [
        { label: "Send Instant Message...", onClick: () => setDialog({ kind: "sendIm", text: selectedBuddy || "" }) },
        { label: "Get Buddy Info...", onClick: () => setDialog({ kind: "getInfo", text: selectedBuddy || "" }) },
        { label: "Add Buddy...", onClick: () => setDialog({ kind: "addBuddy", text: "", group: me.groups[0]?.name }) },
        "-",
        { label: "Join a Chat Room...", onClick: () => setDialog({ kind: "chat", text: LOBBY }) },
        { label: "Block List...", onClick: () => setDialog({ kind: "blockList" }) },
      ],
    },
    {
      label: "Help",
      items: [{ label: "About 98 Messenger...", onClick: () => setDialog({ kind: "about" }) }],
    },
  ]

  // ---- tree ----

  const rows =
    tab === "online"
      ? groups
      : me.groups.map((g) => ({
          name: g.name,
          total: g.buddies.length,
          buddies: g.buddies.map((screenName) => ({ screenName, online: true })),
          setup: true,
        }))

  return (
    <div className="aimBuddyList">
      <MenuBar menus={menus} />

      <div className="aimBanner">
        <img src="/assets/program_icons/aim2.png" alt="" draggable="false" />
        <div className="aimBannerText">
          <div className="aimBannerName">{me.screenName}'s Buddy List</div>
          {me.warning > 0 && <div className="aimBannerWarning">Warning level: {me.warning}%</div>}
          {!connected && <div className="aimBannerWarning">Reconnecting...</div>}
        </div>
      </div>

      {me.away && (
        <div className="aimAwayBar">
          <AwayNote />
          <span className="aimAwayText">You are away: {me.away}</span>
          <button type="button" onClick={() => aim.setAway(null)}>
            I'm Back
          </button>
        </div>
      )}

      <menu role="tablist" className="aimTabs">
        <li role="tab" aria-selected={tab === "online"}>
          <a href="#" onClick={(e) => (e.preventDefault(), setTab("online"), setSelected(null))}>
            Online
          </a>
        </li>
        <li role="tab" aria-selected={tab === "setup"}>
          <a href="#" onClick={(e) => (e.preventDefault(), setTab("setup"), setSelected(null))}>
            List Setup
          </a>
        </li>
      </menu>

      <div className="window aimTabPanel" role="tabpanel">
        <ul className="tree-view aimTree">
          {rows.map((group) => (
              <li key={group.name} className="aimGroup">
                <div
                  className={selected && !selected.screenName && selected.group === group.name ? "aimGroupHeader is-selected" : "aimGroupHeader"}
                  onClick={() => {
                    toggle(group.name)
                    setSelected({ group: group.name })
                  }}
                >
                  <span className="aimTwisty">{collapsed[group.name] ? "+" : "−"}</span>
                  {group.name} {group.setup ? `(${group.total})` : `(${group.online}/${group.total})`}
                </div>
                {!collapsed[group.name] && (
                  <ul>
                    {group.buddies.map((buddy) => (
                      <BuddyRow
                        key={keyOf(buddy.screenName)}
                        buddy={buddy}
                        openGesture={openGesture}
                        selected={selectedBuddy && keyOf(selectedBuddy) === keyOf(buddy.screenName) && selected.group === group.name}
                        onSelect={() => setSelected({ group: group.name, screenName: buddy.screenName })}
                        onOpen={() => aim.openIm(buddy.screenName)}
                      />
                    ))}
                  </ul>
                )}
              </li>
            ))}
        </ul>
      </div>

      {tab === "online" ? (
        <div className="aimToolbar">
          <button type="button" onClick={() => (selectedBuddy ? aim.openIm(selectedBuddy) : setDialog({ kind: "sendIm", text: "" }))}>
            IM
          </button>
          <button type="button" onClick={() => setDialog({ kind: "chat", text: LOBBY })}>
            Chat
          </button>
          <button type="button" onClick={() => (selectedBuddy ? aim.openInfo(selectedBuddy) : setDialog({ kind: "getInfo", text: "" }))}>
            Info
          </button>
          <button
            type="button"
            onClick={() => (me.away ? aim.setAway(null) : setDialog({ kind: "away", text: AWAY_PRESETS[0] }))}
          >
            {me.away ? "Back" : "Away"}
          </button>
        </div>
      ) : (
        <div className="aimToolbar">
          <button
            type="button"
            onClick={() => setDialog({ kind: "addBuddy", text: "", group: selected?.group || me.groups[0]?.name })}
            disabled={!me.groups.length}
          >
            Add Buddy
          </button>
          <button type="button" onClick={() => setDialog({ kind: "addGroup", text: "" })}>
            Add Group
          </button>
          <button type="button" disabled={!selected || !!selectedBuddy} onClick={() => setDialog({ kind: "rename", text: selected.group })}>
            Rename
          </button>
          <button
            type="button"
            disabled={!selected}
            onClick={() =>
              setDialog({
                kind: "confirmDelete",
                text: selectedBuddy
                  ? `Remove ${selectedBuddy} from ${selected.group}?`
                  : `Delete the group ${selected.group} and everyone in it?`,
              })
            }
          >
            Delete
          </button>
        </div>
      )}

      {/* ---- dialogs ---- */}

      {dialog?.kind === "alert" && (
        <AimDialog title={dialog.title} onOk={close}>
          <p className="aimDialogText">{dialog.text}</p>
        </AimDialog>
      )}

      {dialog?.kind === "away" && (
        <AimDialog
          title="Away Message"
          okLabel="I'm Away"
          okDisabled={!dialog.text.trim()}
          onOk={async () => {
            await aim.setAway(dialog.text.trim())
            close()
          }}
          onCancel={close}
        >
          <label className="aimDialogLabel">Choose an away message:</label>
          <select value={AWAY_PRESETS.includes(dialog.text) ? dialog.text : ""} onChange={(e) => setDialog({ ...dialog, text: e.target.value })}>
            {AWAY_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {preset}
              </option>
            ))}
            <option value="">(Custom message)</option>
          </select>
          <textarea rows={4} maxLength={1024} value={dialog.text} onChange={(e) => setDialog({ ...dialog, text: e.target.value })} />
        </AimDialog>
      )}

      {dialog?.kind === "profile" && (
        <AimDialog
          title="Edit Profile"
          onOk={async () => {
            await aim.setProfile(dialog.text)
            close()
          }}
          onCancel={close}
        >
          <label className="aimDialogLabel">Tell your buddies about yourself. They'll see this in Buddy Info.</label>
          <textarea rows={6} maxLength={1024} value={dialog.text} onChange={(e) => setDialog({ ...dialog, text: e.target.value })} />
        </AimDialog>
      )}

      {["sendIm", "getInfo", "chat"].includes(dialog?.kind) && (
        <AimDialog
          title={{ sendIm: "Send Instant Message", getInfo: "Get Buddy Info", chat: "Join a Chat Room" }[dialog.kind]}
          okLabel={{ sendIm: "Send", getInfo: "Get Info", chat: "Go" }[dialog.kind]}
          okDisabled={!dialog.text.trim()}
          onOk={async () => {
            const text = dialog.text.trim()
            if (dialog.kind === "sendIm") aim.openIm(text)
            if (dialog.kind === "getInfo") aim.openInfo(text)
            if (dialog.kind === "chat") {
              const result = await aim.joinRoom(text)
              if (!result.ok) return setDialog({ kind: "alert", title: "Chat", text: result.error })
            }
            close()
          }}
          onCancel={close}
        >
          <label className="aimDialogLabel">{dialog.kind === "chat" ? "Chat room name:" : "Screen name:"}</label>
          <input value={dialog.text} maxLength={dialog.kind === "chat" ? 32 : 16} onChange={(e) => setDialog({ ...dialog, text: e.target.value })} />
        </AimDialog>
      )}

      {dialog?.kind === "addBuddy" && (
        <AimDialog
          title="Add Buddy"
          okLabel="Add"
          okDisabled={!dialog.text.trim() || !dialog.group}
          onOk={() => addBuddy(dialog.text, dialog.group)}
          onCancel={close}
        >
          <label className="aimDialogLabel">Screen name of buddy:</label>
          <input value={dialog.text} maxLength={16} onChange={(e) => setDialog({ ...dialog, text: e.target.value })} />
          <label className="aimDialogLabel">Add to group:</label>
          <select value={dialog.group} onChange={(e) => setDialog({ ...dialog, group: e.target.value })}>
            {me.groups.map((g) => (
              <option key={g.name}>{g.name}</option>
            ))}
          </select>
        </AimDialog>
      )}

      {(dialog?.kind === "addGroup" || dialog?.kind === "rename") && (
        <AimDialog
          title={dialog.kind === "addGroup" ? "Add Group" : "Rename Group"}
          okDisabled={!dialog.text.trim()}
          onOk={() => (dialog.kind === "addGroup" ? addGroup(dialog.text) : renameGroup(selected.group, dialog.text))}
          onCancel={close}
        >
          <label className="aimDialogLabel">Group name:</label>
          <input value={dialog.text} maxLength={32} onChange={(e) => setDialog({ ...dialog, text: e.target.value })} />
        </AimDialog>
      )}

      {dialog?.kind === "confirmDelete" && (
        <AimDialog title="Delete" okLabel="Yes" cancelLabel="No" onOk={removeSelected} onCancel={close}>
          <p className="aimDialogText">{dialog.text}</p>
        </AimDialog>
      )}

      {dialog?.kind === "blockList" && (
        <AimDialog title="Block List" onOk={close}>
          {me.blocked.length === 0 ? (
            <p className="aimDialogText">You haven't blocked anyone. Use the Block button in an IM window.</p>
          ) : (
            <ul className="aimBlockList">
              {me.blocked.map((key) => (
                <li key={key}>
                  <span>{key}</span>
                  <button type="button" onClick={() => aim.block(key, false)}>
                    Unblock
                  </button>
                </li>
              ))}
            </ul>
          )}
        </AimDialog>
      )}

      {dialog?.kind === "about" && (
        <AimDialog title="About 98 Messenger" onOk={close}>
          <div className="aimAbout">
            <img src="/assets/program_icons/aim2.png" alt="" />
            <p className="aimDialogText">
              <b>98 Messenger</b> Version 98ish.0
              <br />
              An homage to the instant messenger we all grew up with. Add buddies, set an away message, and say hi to{" "}
              {BOT_NAME}.
            </p>
          </div>
        </AimDialog>
      )}
    </div>
  )
}

export default BuddyList
