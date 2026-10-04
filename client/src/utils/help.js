// Opening 98ish Help from anywhere (a program's Help menu, a "?" button, F1, Floppy, DOS):
//
//   openHelp("tetris")                 a topic (ids in applets/help/topics/)
//   openHelp({ program: "Notepad" })   the topic for a program (its `programs` list)
//   openHelp({ query: "room code" })   the Search tab, searching
//   openHelp()                         the Contents and the Home page
//
// It only sends an event; the desktop (App.jsx) opens the Help window, which loads the topics.
// helpItem(...) is the "Help Topics" menu item programs put first in their Help menu.

export const HELP_EVENT = "98ish:help"

export const helpTarget = (what) => (typeof what === "string" ? { topic: what } : what && typeof what === "object" ? { ...what } : {})

export const openHelp = (what) => window.dispatchEvent(new CustomEvent(HELP_EVENT, { detail: helpTarget(what) }))

// the window payload's extra fields for a target (programs.js launch("98ish Help", ...))
export const helpHandoff = (what) => ({ handoff: { id: Date.now() + Math.random(), ...helpTarget(what) } })

// (f1: false for programs that use F1 themselves: Appward, Shred 98)
export const helpItem = (what, { f1 = true } = {}) => ({ label: f1 ? "Help Topics F1" : "Help Topics", onClick: () => openHelp(what) })
