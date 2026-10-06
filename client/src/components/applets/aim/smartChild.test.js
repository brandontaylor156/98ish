import test from "node:test"
import assert from "node:assert/strict"
import { cleanReply, forScript, smartMessages } from "./smartChild.js"

test("forScript: commands, trivia answers and hellos stay with the scripted SmarterChild", () => {
  for (const t of ["help", "tell me a joke", "trivia", "8ball will it rain?", "flip a coin", "roll a die", "fortune", "time", "hi", "lol", "thanks!"]) assert.equal(forScript(t), true, t)
  assert.equal(forScript("canberra", "Trivia time! What is the capital of Australia? (say 'skip' to pass)"), true)
  for (const t of ["why is the sky blue?", "how do I make pancakes", "what's a good name for a cat"]) assert.equal(forScript(t), false, t)
})

test("smartMessages: persona, the last lines, the question", () => {
  const history = [{ system: true, text: "x" }, ...Array.from({ length: 10 }, (_, i) => ({ mine: i % 2 === 0, text: `m${i}` }))]
  const m = smartMessages({ name: "Brandon", history, text: "why?" })
  assert.equal(m[0].role, "system")
  assert.match(m[0].content, /SmarterChild/)
  assert.match(m[0].content, /Brandon/)
  assert.equal(m.length, 1 + 6 + 1)
  assert.deepEqual(m.at(-1), { role: "user", content: "why?" })
  assert.equal(m[1].content, "m4")
  assert.equal(m[1].role, "user")
})

test("cleanReply: no thinking, no name prefix, not too long", () => {
  assert.equal(cleanReply("<think>hmm</think>\nSmarterChild: Because of Rayleigh scattering! :-)"), "Because of Rayleigh scattering! :-)")
  const long = cleanReply("This is a sentence. ".repeat(40))
  assert.ok(long.length <= 401)
  assert.ok(long.endsWith("."))
})
