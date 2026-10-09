// My Park: what you can say and do to other people in the park (pure). Canned lines only
// (the server checks the number: server/park LINE_COUNT, compared in park.test.js); the
// longer game chat is the shared GameChat window.

export const CHAT_LINES = ["Hi!", "Good game!", "Nice shot!", "Got next?", "Want to play?", "One more?", "Thanks!", "See you!"]
export const EMOTES = [
  { id: "cheer", label: "Cheer" },
  { id: "pump", label: "Fist pump" },
  { id: "clap", label: "Clap" },
  { id: "wave", label: "Wave" },
]
// an emote -> the athlete's mood (anim.js setMood: kind, variant)
export const EMOTE_MOOD = { cheer: ["cheer", 2], pump: ["cheer", 0], clap: ["cheer", 1], wave: ["wave", 0] }

export const INTRO = ["Walk with the pad.", "Tap Watch at a bench to spectate.", "Put your paddle in a rack to play next."]
