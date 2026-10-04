import React, { useEffect, useRef, useState } from "react"
import { fs } from "../../utils/fs"
import { useFsVersion } from "../../hooks/useFs"
import { programs, launch, explorerWindow, notepadWindow, ieWindow } from "../../utils/programs"
import { openItem } from "../../utils/openItem"
import { iconFor } from "../../utils/fileInfo"
import RunDialog from "./RunDialog"
import { shellAction } from "../../utils/shell"
import { getTour, startTour } from "../../utils/welcome"
import "./StartMenu.css"

const GROUPS = ["Accessories", "Business", "Community", "Games", "Internet", "Entertainment", "System Tools", "Us", "My Projects"]
// a program shows in its group and in any it's `also` in (Photo Puzzle is in Us and Games)
const inGroup = (p, group) => p.group === group || !!p.also?.includes(group)
// the community's pages on 98ish.com, at the bottom of Programs > Community
const COMMUNITY_PAGES = [
  ["98ish.com Home Page", "http://www.98ish.com/"],
  ["Guestbook", "http://www.98ish.com/guestbook"],
  ["Members Directory (and the web ring)", "http://www.98ish.com/members"],
]
const ICON = {
  programs: "/assets/programs.png",
  documents: "/assets/directory_docs.png",
  favorites: "/assets/directory_bookmarks.png",
  settings: "/assets/vaporwave.png",
  find: "/assets/directory_folder_small.png",
  help: "/assets/README.png",
  run: "/assets/executable.png",
  group: "/assets/directory_folder.png",
}

const userName = () => {
  try {
    return localStorage.getItem("98ish.user") || "Guest"
  } catch {
    return "Guest"
  }
}

// The Start menu, Windows 98 style: the banner down the side, cascading submenus that
// open on hover (or tap, and drill down on phones), Find, Run, Log Off and Shut Down.
const StartMenu = ({ dispatch, setResults, closeMenu, onShutDown, onLogOff, mobile }) => {
  useFsVersion()
  const [query, setQuery] = useState("")
  const [run, setRun] = useState(false)
  const [open, setOpen] = useState([]) // indexes of open submenus, one per level
  const [stack, setStack] = useState([]) // phones: the submenus drilled into
  const searchRef = useRef(null)

  useEffect(() => {
    setResults(query ? fs.findAllItemsByQuery(query) : [])
  }, [query])

  const go = (payload) => {
    dispatch({ type: "open_window", payload })
    closeMenu()
  }

  const folderItems = (dir) =>
    dir
      ? dir.content.length
        ? dir.content.map((item) => ({
            label: item.name,
            icon: iconFor(item),
            items: item.isDirectory && item.content.length ? () => folderItems(item) : undefined,
            onClick: () => {
              openItem(item, dispatch)
              closeMenu()
            },
          }))
        : [{ label: "(Empty)", disabled: true }]
      : [{ label: "(Empty)", disabled: true }]

  const programItem = (p) => ({ label: p.name, icon: p.icon, onClick: () => go(launch(p.name)) })

  const menu = [
    { label: "Windows Update", icon: "/assets/program_icons/update.svg", onClick: () => go(launch("Windows Update")) },
    "-",
    {
      label: "Programs",
      key: "P",
      icon: ICON.programs,
      items: () => [
        ...GROUPS.map((group) => ({
          label: group,
          icon: ICON.group,
          items: () => [
            ...programs.filter((p) => inGroup(p, group)).map(programItem),
            ...(group === "Community" ? ["-", ...COMMUNITY_PAGES.map(([label, url]) => ({ label, icon: "/assets/internet_explorer.png", onClick: () => go(ieWindow(url)) }))] : []),
          ],
        })),
        "-",
        { label: "Windows Explorer", icon: "/assets/program_icons/computer_explorer.png", onClick: () => go(explorerWindow(["C:"])) },
      ],
    },
    {
      label: "Documents",
      key: "D",
      icon: ICON.documents,
      items: () => [
        { label: "My Documents", icon: ICON.documents, onClick: () => go(explorerWindow(["C:", "Documents"])) },
        "-",
        ...folderItems(fs.resolve("C:/Documents")),
      ],
    },
    {
      label: "Favorites",
      key: "a",
      icon: ICON.favorites,
      items: () => folderItems(fs.resolve("C:/Bookmarks")),
    },
    {
      label: "Settings",
      key: "S",
      icon: ICON.settings,
      items: () => [
        { label: "Display Properties", icon: "/assets/vaporwave.png", onClick: () => go(launch("Display Properties")) },
        { label: "Date/Time Properties", icon: "/assets/program_icons/datetime.svg", onClick: () => go(launch("Date/Time Properties")) },
        { label: "Keyboard", icon: "/assets/program_icons/keyboard.svg", onClick: () => go(launch("Keyboard Properties")) },
        { label: "Desktop Themes", icon: "/assets/program_icons/themes.svg", onClick: () => go(launch("Desktop Themes")) },
        { label: "Taskbar & Start Menu...", icon: "/assets/start98.png", onClick: () => (closeMenu(), shellAction("taskbar-properties")) },
        { label: "Keyboard Shortcuts", icon: ICON.help, onClick: () => (closeMenu(), shellAction("shortcuts")) },
        { label: "Recycle Bin", icon: fs.recycleBin.content.length ? "/assets/recycle_bin_full.png" : "/assets/recycle_bin_empty.png", onClick: () => go(launch("Recycle Bin")) },
      ],
    },
    {
      label: "Find",
      key: "F",
      icon: ICON.find,
      onClick: () => {
        setOpen([])
        setStack([])
        searchRef.current?.focus()
      },
    },
    {
      label: "Help",
      key: "H",
      icon: ICON.help,
      items: () => [
        { label: "Welcome to 98ish", icon: "/assets/program_icons/welcome.svg", onClick: () => go(launch("Welcome to 98ish")) },
        { label: "Take the Tour", icon: ICON.help, onClick: () => (closeMenu(), startTour(0)) },
        "-",
        {
          label: "Read Me",
          icon: "/assets/note.png",
          onClick: () => {
            const readme = fs.resolve("C:/README")
            go(readme ? notepadWindow(readme) : explorerWindow(["C:"]))
          },
        },
      ],
    },
    { label: "Run...", key: "R", icon: ICON.run, onClick: () => setRun(true) },
    "-",
    {
      label: `Log Off ${userName()}...`,
      key: "L",
      icon: "/assets/log_off.png",
      onClick: () => {
        closeMenu()
        onLogOff()
      },
    },
    {
      label: "Shut Down...",
      key: "u",
      icon: "/assets/shut_down.png",
      onClick: () => {
        closeMenu()
        onShutDown()
      },
    },
  ]

  // keyboard: Escape closes, underlined letters pick
  useEffect(() => {
    const onKey = (e) => {
      // (Escape in the Find box closes the menu too; Run's box is left to its dialog)
      if (e.key === "Escape" && e.target === searchRef.current) return closeMenu()
      if (e.target.closest?.("input, textarea")) return
      if (e.key === "Escape") return closeMenu()
      const hit = menu.find((m) => m !== "-" && m.key?.toLowerCase() === e.key.toLowerCase())
      if (hit) {
        e.preventDefault()
        hit.onClick ? hit.onClick() : setOpen([menu.indexOf(hit)])
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const label = (item) => {
    if (!item.key) return item.label
    const i = item.label.indexOf(item.key)
    if (i < 0) return item.label
    return (
      <>
        {item.label.slice(0, i)}
        <u>{item.key}</u>
        {item.label.slice(i + 1)}
      </>
    )
  }

  // desktop: a list, with the open submenu flying out to its right (moved up if it would
  // run off the bottom of the screen)
  const fit = (el) => {
    if (!el) return
    el.style.transform = ""
    const rect = el.getBoundingClientRect()
    const floor = window.innerHeight - (document.querySelector(".taskbar")?.offsetHeight || 35)
    const over = rect.bottom - floor
    if (over > 0) el.style.transform = `translateY(${-Math.min(over, rect.top)}px)`
  }
  const renderList = (items, depth) => (
    <ul className={depth ? "window smSub" : "smList"} role="menu" ref={depth ? fit : undefined}>
      {items.map((item, i) => {
        if (item === "-") return <li key={i} className="smSep" role="separator" />
        const isOpen = open[depth] === i
        const sub = item.items && isOpen ? item.items() : null
        return (
          <li
            key={i}
            className={(isOpen ? "smItem is-open" : "smItem") + (item.disabled ? " is-disabled" : "") + (depth ? "" : " smTop")}
            role="menuitem"
            aria-haspopup={item.items ? "menu" : undefined}
            aria-expanded={item.items ? isOpen : undefined}
            onMouseEnter={(e) => {
              if (e.nativeEvent.pointerType === "touch") return
              setOpen([...open.slice(0, depth), item.items ? i : undefined])
            }}
            onClick={(e) => {
              e.stopPropagation()
              if (item.disabled) return
              if (item.items) setOpen([...open.slice(0, depth), isOpen ? undefined : i])
              else item.onClick?.()
            }}
          >
            {item.icon ? <img src={item.icon} alt="" draggable="false" /> : <span className="smNoIcon" />}
            <span className="smLabel">{label(item)}</span>
            {item.items && <span className="smArrow">{"\u25B8"}</span>}
            {sub && renderList(sub, depth + 1)}
          </li>
        )
      })}
    </ul>
  )

  // phones: one list at a time, with Back
  const current = stack.length ? stack.at(-1) : null
  const renderMobileList = () => (
    <ul className="smList" role="menu">
      {current && (
        <li className="smItem smBack" role="menuitem" onClick={(e) => (e.stopPropagation(), setStack(stack.slice(0, -1)))}>
          <span className="smArrow">{"\u25C2"}</span>
          <span className="smLabel">{current.label}</span>
        </li>
      )}
      {(current ? current.items : menu).map((item, i) => {
        if (item === "-") return <li key={i} className="smSep" role="separator" />
        return (
          <li
            key={i}
            className={"smItem" + (item.disabled ? " is-disabled" : "") + (current ? "" : " smTop")}
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation()
              if (item.disabled) return
              if (item.items) setStack([...stack, { label: item.label, items: item.items() }])
              else item.onClick?.()
            }}
          >
            {item.icon ? <img src={item.icon} alt="" draggable="false" /> : <span className="smNoIcon" />}
            <span className="smLabel">{label(item)}</span>
            {item.items && <span className="smArrow">{"\u25B8"}</span>}
          </li>
        )
      })}
    </ul>
  )

  return (
    <div className="window startMenu" onClick={(e) => e.stopPropagation()} onMouseLeave={() => !getTour() && setOpen([])}>
      <div className="smBanner" aria-hidden="true">
        <span>
          <b>Windows</b>98ish
        </span>
      </div>
      <div className="smMain">
        <form className="smSearch" onSubmit={(e) => e.preventDefault()} onMouseEnter={() => setOpen([])}>
          <input
            ref={searchRef}
            type="search"
            name="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find files or programs..."
            autoComplete="off"
            aria-label="Find files or programs"
          />
        </form>
        {mobile ? renderMobileList() : renderList(menu, 0)}
      </div>
      {run && (
        <RunDialog
          dispatch={dispatch}
          onDone={() => {
            setRun(false)
            closeMenu()
          }}
          onCancel={() => setRun(false)}
        />
      )}
    </div>
  )
}

export default StartMenu
