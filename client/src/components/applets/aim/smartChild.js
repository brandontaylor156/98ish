// SmarterChild gets smart: on a device where Floppy's brain is downloaded (the on-device
// model, applets/floppy/brain.js), real questions to SmarterChild are answered by it, right
// here: the question and the answer never leave the device (they go into this device's copy
// of the conversation only). His games and commands (trivia, jokes, 8-ball, coin, dice,
// fortune, time, help) and quick hellos stay with the scripted SmarterChild on the server,
// and so does everything when the brain isn't there. The owner's decision, 2026-10-06.

// what the scripted SmarterChild on the server does best (server/aim/bot.js)
const COMMAND = /^(help|menu|commands|what can you do|skip|pass|idk|score|time)\b|\btrivia\b|\bquiz\b|\bjoke\b|\b8 ?ball\b|\bmagic\b|\b(flip|toss)\b.*\bcoin\b|\bcoin flip\b|\bheads or tails\b|\broll\b.*\b(die|dice)\b|\bfortune\b|\bhoroscope\b/
const SMALL_TALK = /^(hi|hey|hello|hiya|sup|yo|wassup|whats up|bye|cya|see ya|gtg|g2g|ttyl|later|thanks|thank you|thx|ty|lol|lmao|rofl|haha|hehe|ok|okay|k|cool|nice)( smarterchild)?$/

const simplify = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

// Should this message go to the scripted SmarterChild? lastBot: his last message (a trivia
// question waiting for its answer goes to the server, which keeps the score)
export const forScript = (text, lastBot = "") => {
  const t = simplify(text)
  if (!t) return true
  if (/^Trivia time!/.test(lastBot || "")) return true
  return COMMAND.test(t) || SMALL_TALK.test(t)
}

const SYSTEM = (name) =>
  `You are SmarterChild, the friendly robot buddy on 98 Messenger, a 2001-style instant messenger. You're chatting with ${name}. ` +
  "Answer what they ask, correctly and helpfully, in one to three short sentences, in a casual IM style with an occasional :-) . " +
  "If you aren't sure, say so honestly. You can't browse the web or see the time. You also know jokes, trivia, a magic 8-ball, coin flips and dice: they can say 'help' to see them."

// the conversation the model sees: his persona, the last few lines, the question
export const smartMessages = ({ name = "there", history = [], text }) => [
  { role: "system", content: SYSTEM(name) },
  ...history
    .filter((m) => !m.system && m.text)
    .slice(-6)
    .map((m) => ({ role: m.mine ? "user" : "assistant", content: String(m.text).slice(0, 400) })),
  { role: "user", content: String(text).slice(0, 500) },
]

// the model's answer as an IM: no thinking tags, no "SmarterChild:" prefix, not too long
export const cleanReply = (raw) => {
  let s = String(raw || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .replace(/^\s*(SmarterChild|Assistant)\s*:\s*/i, "")
    .trim()
  if (s.length > 400) {
    const cut = s.slice(0, 400)
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "))
    s = end > 120 ? cut.slice(0, end + 1) : `${cut.trimEnd()}...`
  }
  return s
}

// Is the brain on this device? (chosen once in Floppy and its files still in the browser)
let downloaded = null
export const brainHere = async () => {
  const { brainChosen, brainBytes, getBrain } = await import("../floppy/brain")
  if (!brainChosen()) return false
  if (getBrain().status === "ready") return true
  if (downloaded === null) downloaded = (await brainBytes()) > 0
  return downloaded
}

// SmarterChild loads the brain for his answer and lets it go after a quiet while, so the
// memory isn't held for nothing (Floppy loads it again on his next question)
const IDLE_MS = 3 * 60_000
const ANSWER_MS = 60_000
let idle = null

export const smartAnswer = async ({ name, history, text, windows }) => {
  const brain = await import("../floppy/brain")
  clearTimeout(idle)
  await brain.loadBrain(windows)
  const answer = await Promise.race([
    brain.generate(smartMessages({ name, history, text }), { max: 140 }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), ANSWER_MS)),
  ])
  const rest = () => (idle = setTimeout(() => (brain.brainBusy() ? rest() : brain.unloadBrain()), IDLE_MS))
  rest()
  return cleanReply(answer)
}
