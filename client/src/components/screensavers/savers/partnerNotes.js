// Love Notes with your partner's own words: when you're paired (Us) and haven't typed your
// own messages, the saver shows lines from the love letters your partner sent you instead of
// the default lines (the owner: "pull your partner's latest love letters", 2026-10-06).
// Only letters that are already open to you count: a sealed letter stays sealed, and an
// "Open when..." letter you haven't opened only shows its title, so nothing gets spoiled.
import { MAX_MESSAGES, MAX_MESSAGE_LENGTH } from "./lovenotesText.js"

// the first sentence (or the first words) of a letter, short enough for a floating line
export const firstLine = (text) => {
  const plain = String(text ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!plain) return ""
  const sentence = (plain.match(/^.+?[.!?♥](?=\s|$)/) || [plain])[0].trim()
  if (sentence.length <= MAX_MESSAGE_LENGTH) return sentence
  const cut = sentence.slice(0, MAX_MESSAGE_LENGTH - 1)
  return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : cut.length).trim()}…`
}

// inbox headers (newest first) -> which letters to read and what to show without reading:
// [{ id, read: true } | { line }]
export const pickLetters = (inbox, now = Date.now(), max = MAX_MESSAGES) => {
  const out = []
  for (const l of inbox || []) {
    if (out.length >= max) break
    if (l.mine || l.locked || (l.unlockAt && l.unlockAt > now)) continue
    if (l.openedAt) out.push({ id: l.id, read: true, title: l.title || "" })
    else if (l.title) out.push({ line: `A letter for you: ${String(l.title).slice(0, MAX_MESSAGE_LENGTH - 18)}` })
  }
  return out
}

// -> up to 10 lines, or null (not paired, no letters, offline: the saver keeps its defaults)
export const loadPartnerLines = async () => {
  try {
    const couple = await import("../../../utils/couple")
    const state = couple.getCouple()
    if (state.status !== "paired") return null
    const list = await couple.coupleApi("GET", "/letters")
    if (!list?.ok) return null
    const picks = pickLetters(list.inbox, couple.serverNow())
    const lines = []
    for (const p of picks) {
      if (p.line) lines.push(p.line)
      else {
        const one = await couple.coupleApi("GET", `/letters/${encodeURIComponent(p.id)}`)
        const line = firstLine(one?.letter?.text) || (p.title ? String(p.title).slice(0, MAX_MESSAGE_LENGTH) : "")
        if (line) lines.push(line)
      }
    }
    return lines.length ? lines : null
  } catch {
    return null
  }
}
