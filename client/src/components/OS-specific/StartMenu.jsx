import React, { useEffect, useRef, useState } from "react"
import { fs } from "../../utils/fs"
import { useFsVersion } from "../../hooks/useFs"
import { programs, launch, explorerWindow, notepadWindow, ieWindow } from "../../utils/programs"
import { openItem } from "../../utils/openItem"
import { iconFor } from "../../utils/fileInfo"
import RunDialog from "./RunDialog"
import { shellAction } from "../../utils/shell"
import { getTour, startTour } from "../../utils/welcome"
import { currentUserName } from "../../utils/users"
import { useSettings } from "../../utils/settings"
import { navigate } from "../../utils/startNav"
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

const userName = currentUserName

// The Start menu, Windows 98 style: the banner down the side, cascading submenus that
// open on hover (or tap, and drill down on phones), Find, Run, Log Off and Shut Down.
// The search box finds everything (programs, settings, files and their words, contacts,
// events, messages, mail, photos): App shows the results (SearchPanel) beside the menu, or
// over the whole screen on phones.
const StartMenu = ({ dispatch, onQuery, onSearchKey, onSearchFocus, closeMenu, onShutDown, onLogOff, onLock, mobile }) => {
  useFsVersion()
  const [query, setQuery] = useState("")
  const [run, setRun] = useState(false)
  const [open, setOpen] = useState([]) // indexes of open submenus, one per level
  const [stack, setStack] = useState([]) // phones: the submenus drilled into
  const [path, setPath] = useState([]) // the item the arrow keys are on (utils/startNav.js)
  const searchRef = useRef(null)
  const rootRef = useRef(null)
  // Add/Remove Programs can take programs out of the Start menu
  const { hiddenStart = [] } = useSettings()

  useEffect(() => {
    onQuery?.(query)
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
            ...programs.filter((p) => inGroup(p, group) && !hiddenStart.includes(p.name)).map(programItem),
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
        { label: "Control Panel", icon: "/assets/program_icons/cpl/control.svg", onClick: () => go(launch("Control Panel")) },
        "-",
        { label: "Display Properties", icon: "/assets/vaporwave.png", onClick: () => go(launch("Display Properties")) },
        { label: "Date/Time Properties", icon: "/assets/program_icons/datetime.svg", onClick: () => go(launch("Date/Time Properties")) },
        { label: "Keyboard", icon: "/assets/program_icons/keyboard.svg", onClick: () => go(launch("Keyboard Properties")) },
        { label: "Passwords and Users", icon: "/assets/program_icons/passwords.svg", onClick: () => go(launch("Passwords")) },
        { label: "Desktop Themes", icon: "/assets/program_icons/themes.svg", onClick: () => go(launch("Desktop Themes")) },
        { label: "Taskbar & Start Menu...", icon: "/assets/start98.png", onClick: () => (closeMenu(), shellAction("taskbar-properties")) },
        { label: "Notifications...", icon: "/assets/program_icons/winpopup.svg", onClick: () => (closeMenu(), shellAction("notification-settings")) },
        { label: "Keyboard Shortcuts", icon: ICON.help, onClick: () => (closeMenu(), shellAction("shortcuts")) },
        { label: "Recycle Bin", icon: fs.recycleBin.content.length ? "/assets/recycle_bin_full.png" : "/assets/recycle_bin_empty.png", onClick: () => go(launch("Recycle Bin")) },
      ],
    },
    {
      label: "Find",
      key: "F",
      icon: ICON.find,
      items: () => [
        { label: "Files or Folders...", icon: "/assets/program_icons/find.svg", onClick: () => go(launch("Find")) },
        { label: "People...", icon: "/assets/program_icons/addressbook.svg", onClick: () => go(launch("Address Book", { handoff: { id: Date.now(), find: true } })) },
        {
          label: "Everything (search box)",
          icon: ICON.find,
          onClick: () => {
            setOpen([])
            setStack([])
            searchRef.current?.focus()
          },
        },
      ],
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
      label: "Lock Computer...",
      key: "k",
      icon: "/assets/program_icons/passwords.svg",
      onClick: () => {
        closeMenu()
        onLock?.()
      },
    },
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

  // ---- keyboard: arrows move (utils/startNav.js), Enter runs, Escape backs out, the
  // underlined letters pick ----

  // the items of the menu `prefix` opens, for startNav (phones: the list on screen)
  const listAt = (prefix) => {
    let items = mobile && stack.length ? stack.at(-1).items : menu
    for (const i of prefix) {
      const item = items[i]
      items = item && item !== "-" && item.items ? item.items() : []
    }
    return items
  }
  const itemsAt = (prefix) => listAt(prefix).map((item) => (item === "-" ? "-" : { label: item.label, disabled: item.disabled, sub: !!item.items }))
  const backToStart = () => document.querySelector(".startButton")?.focus({ preventScroll: true })

  const applyNav = (r) => {
    const item = r.path.length ? listAt(r.path.slice(0, -1))[r.path.at(-1)] : null
    if (r.close) {
      closeMenu()
      return backToStart()
    }
    if (r.activate) return item?.onClick?.()
    if (mobile) {
      // phones show one list at a time: going into a submenu shows it, Left/Escape go back
      if (r.path.length > 1) {
        const parent = listAt([])[r.path[0]]
        setStack([...stack, { label: parent.label, items: parent.items() }])
        return setPath([r.path[1]])
      }
      return setPath(r.path)
    }
    setPath(r.path)
    setOpen(r.path.slice(0, -1))
  }

  useEffect(() => {
    const onKey = (e) => {
      // (Escape in the Find box closes the menu too; Down goes from it into the menu; Run's
      // box is left to its dialog)
      if (e.key === "Escape" && e.target === searchRef.current) return closeMenu(), backToStart()
      if (e.key === "ArrowDown" && e.target === searchRef.current) {
        e.preventDefault()
        return applyNav(navigate([], "ArrowDown", itemsAt))
      }
      if (e.target.closest?.("input, textarea, .dialog")) return
      if (e.ctrlKey || e.altKey || e.metaKey) return
      if (mobile && stack.length && (e.key === "ArrowLeft" || e.key === "Escape")) {
        e.preventDefault()
        setStack(stack.slice(0, -1))
        return setPath([])
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", " ", "Home", "End", "Escape"].includes(e.key)) {
        e.preventDefault()
        return applyNav(navigate(path, e.key, itemsAt))
      }
      // the underlined letters of the top menu, as before; inside a submenu, first letters
      if (path.length <= 1 && !(mobile && stack.length)) {
        const hit = menu.find((m) => m !== "-" && m.key?.toLowerCase() === e.key.toLowerCase())
        if (hit) {
          e.preventDefault()
          const i = menu.indexOf(hit)
          if (hit.onClick) return hit.onClick()
          return applyNav(navigate([i], "ArrowRight", itemsAt))
        }
      }
      if (e.key.length === 1) {
        const r = navigate(path, e.key, itemsAt)
        if (r.path.join() !== path.join()) {
          e.preventDefault()
          applyNav(r)
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  // the highlighted item takes the focus, so screen readers say it
  useEffect(() => {
    if (!path.length) return
    rootRef.current?.querySelector(`[data-path="${path.join("-")}"]`)?.focus({ preventScroll: true })
  }, [path.join("-"), stack.length])

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
  const renderList = (items, depth, prefix = [], title = "Start menu") => (
    <ul className={depth ? "window smSub" : "smList"} role="menu" aria-label={title} ref={depth ? fit : undefined}>
      {items.map((item, i) => {
        if (item === "-") return <li key={i} className="smSep" role="separator" />
        const isOpen = open[depth] === i
        const sub = item.items && isOpen ? item.items() : null
        const here = [...prefix, i]
        const isFocus = path.length === depth + 1 && path.join("-") === here.join("-")
        return (
          <li
            key={i}
            className={(isOpen ? "smItem is-open" : "smItem") + (isFocus ? " is-focus" : "") + (item.disabled ? " is-disabled" : "") + (depth ? "" : " smTop")}
            role="menuitem"
            tabIndex={-1}
            data-path={here.join("-")}
            aria-disabled={item.disabled || undefined}
            aria-haspopup={item.items ? "menu" : undefined}
            aria-expanded={item.items ? isOpen : undefined}
            onMouseEnter={(e) => {
              if (e.nativeEvent.pointerType === "touch") return
              setOpen([...open.slice(0, depth), item.items ? i : undefined])
              setPath(here)
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
            {item.items && <span className="smArrow" aria-hidden="true">{"\u25B8"}</span>}
            {sub && renderList(sub, depth + 1, here, item.label)}
          </li>
        )
      })}
    </ul>
  )

  // phones: one list at a time, with Back
  const current = stack.length ? stack.at(-1) : null
  const renderMobileList = () => (
    <ul className="smList" role="menu" aria-label={current ? current.label : "Start menu"}>
      {current && (
        <li className="smItem smBack" role="menuitem" tabIndex={-1} aria-label={`Back from ${current.label}`} onClick={(e) => (e.stopPropagation(), setStack(stack.slice(0, -1)), setPath([]))}>
          <span className="smArrow" aria-hidden="true">{"\u25C2"}</span>
          <span className="smLabel">{current.label}</span>
        </li>
      )}
      {(current ? current.items : menu).map((item, i) => {
        if (item === "-") return <li key={i} className="smSep" role="separator" />
        return (
          <li
            key={i}
            className={"smItem" + (item.disabled ? " is-disabled" : "") + (current ? "" : " smTop") + (path.length === 1 && path[0] === i ? " is-focus" : "")}
            role="menuitem"
            tabIndex={-1}
            data-path={String(i)}
            aria-disabled={item.disabled || undefined}
            aria-haspopup={item.items ? "menu" : undefined}
            onClick={(e) => {
              e.stopPropagation()
              if (item.disabled) return
              if (item.items) setStack([...stack, { label: item.label, items: item.items() }]), setPath([])
              else item.onClick?.()
            }}
          >
            {item.icon ? <img src={item.icon} alt="" draggable="false" /> : <span className="smNoIcon" />}
            <span className="smLabel">{label(item)}</span>
            {item.items && <span className="smArrow" aria-hidden="true">{"\u25B8"}</span>}
          </li>
        )
      })}
    </ul>
  )

  return (
    <div className="window startMenu" ref={rootRef} onClick={(e) => e.stopPropagation()} onMouseLeave={() => !getTour() && (setOpen([]), setPath([]))}>
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
            onKeyDown={(e) => onSearchKey?.(e)}
            onFocus={() => {
              onSearchFocus?.(true)
              // get the indexes ready while the first letter is being typed
              import("../../utils/search").then((m) => m.warmUp()).catch(() => {})
            }}
            onBlur={() => onSearchFocus?.(false)}
            placeholder="Find files or programs..."
            autoComplete="off"
            aria-label="Find files or programs"
            aria-controls="srResults"
          />
          <button
            type="button"
            className="smSearchCancel"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              setQuery("")
              onSearchFocus?.(false)
              searchRef.current?.blur()
            }}
          >
            Cancel
          </button>
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
