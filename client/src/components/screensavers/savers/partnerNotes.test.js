import test from "node:test"
import assert from "node:assert/strict"
import { firstLine, pickLetters } from "./partnerNotes.js"

test("firstLine: the first sentence, plain text, short enough to float", () => {
  assert.equal(firstLine("I love you more every day. Also the dog misses you."), "I love you more every day.")
  assert.equal(firstLine("<p>Hey <b>you</b>!</p> More here"), "Hey you !")
  const long = "This is a very long first sentence that keeps going and going well past the eighty character limit for sure"
  const line = firstLine(long)
  assert.ok(line.length <= 80, line)
  assert.ok(line.endsWith("…"))
  assert.equal(firstLine(""), "")
})

test("pickLetters: opened letters are read, unopened ones only show a title, sealed and mine are skipped", () => {
  const now = 1000
  const inbox = [
    { id: "a", openedAt: 5, unlockAt: 0, title: "Happy Monday" },
    { id: "b", openedAt: null, unlockAt: 0, title: "Open when you miss me", delivery: "openwhen" },
    { id: "c", openedAt: null, unlockAt: 5000, title: "Sealed until our anniversary" },
    { id: "d", mine: true, openedAt: 1, unlockAt: 0, title: "Mine" },
    { id: "e", locked: true, unlockAt: 0, title: "Locked" },
  ]
  const picks = pickLetters(inbox, now)
  assert.deepEqual(picks[0], { id: "a", read: true, title: "Happy Monday" })
  assert.equal(picks[1].line, "A letter for you: Open when you miss me")
  assert.equal(picks.length, 2)
})
