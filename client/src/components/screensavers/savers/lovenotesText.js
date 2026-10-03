// Love Notes' messages: kept apart from the saver so its Settings can load without it

export const MAX_MESSAGES = 10
export const MAX_MESSAGE_LENGTH = 80
export const DEFAULT_MESSAGES = "You are my favorite person\nThinking of you\nHave the best day\nYou make my heart happy"

// the typed text -> up to 10 trimmed lines of at most 80 characters (defaults if empty)
export const parseMessages = (text) => {
  const lines = String(text ?? "")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, " ").slice(0, MAX_MESSAGE_LENGTH).trim())
    .filter(Boolean)
    .slice(0, MAX_MESSAGES)
  return lines.length ? lines : DEFAULT_MESSAGES.split("\n")
}
