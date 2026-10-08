// node --test client/src/utils/inputGuard.test.js
import { test } from "node:test"
import assert from "node:assert/strict"
import { INPUT_RESET, boxOnScreen, layerStuck, onInputReset, pendingSwallowers, swallowNextClick } from "./inputGuard.js"

const view = { left: 0, top: 0, right: 390, bottom: 844 }
const rect = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h })

test("a dialog counts as on screen with at least 24 x 24 px showing", () => {
  assert.equal(boxOnScreen(rect(35, 250, 320, 300), view), true)
  assert.equal(boxOnScreen(rect(380, 250, 320, 300), view), false, "10 px of it at the right edge")
  assert.equal(boxOnScreen(rect(366, 820, 320, 300), view), true, "a 24 x 24 corner is enough to drag it back")
  assert.equal(boxOnScreen(rect(-400, 250, 320, 300), view), false, "off to the left")
  assert.equal(boxOnScreen(rect(35, 250, 0, 0), view), false, "never drawn")
  assert.equal(boxOnScreen(null, view), false)
})

test("a layer is stuck when it covers the screen and none of its dialogs can be seen", () => {
  const whole = rect(0, 0, 390, 844)
  assert.equal(layerStuck(whole, [rect(35, 250, 320, 300)], view), false, "its dialog is there to answer")
  assert.equal(layerStuck(whole, [], view), true, "nothing inside: every tap went nowhere")
  assert.equal(layerStuck(whole, [rect(900, 250, 320, 300)], view), true, "its dialog is off screen (left behind by a turn)")
  assert.equal(layerStuck(whole, [rect(900, 0, 10, 10), rect(20, 20, 200, 100)], view), false, "one of two dialogs is on screen")
  assert.equal(layerStuck(rect(0, 0, 100, 100), [], view), false, "a small layer isn't in the way of the whole screen")
  assert.equal(layerStuck(rect(0, 1000, 390, 844), [], view), false, "a layer off screen isn't in the way")
})

class FakeWindow extends EventTarget {}
globalThis.CustomEvent ||= class extends Event {
  constructor(type, init) {
    super(type, init)
    this.detail = init?.detail
  }
}

test("onInputReset hears the reset with its reason, until unsubscribed", () => {
  const win = new FakeWindow()
  const heard = []
  const off = onInputReset((why) => heard.push(why), win)
  win.dispatchEvent(new CustomEvent(INPUT_RESET, { detail: "orientationchange" }))
  off()
  win.dispatchEvent(new CustomEvent(INPUT_RESET, { detail: "page visible" }))
  assert.deepEqual(heard, ["orientationchange"])
})

test("a swallowed click is swallowed once, and a swallower never outlives its time or a release", async () => {
  const win = new FakeWindow()
  // (a swallowed click is cancelled: dispatchEvent returns false)
  let clicks = 0
  const click = () => win.dispatchEvent(new Event("click", { cancelable: true })) && clicks++
  swallowNextClick(50, win)
  click()
  click()
  assert.equal(clicks, 1, "only the first click after the tap was swallowed")
  const release = swallowNextClick(50, win)
  assert.equal(pendingSwallowers(), 1)
  release()
  assert.equal(pendingSwallowers(), 0)
  click()
  assert.equal(clicks, 2, "a released swallower lets the next click through")
  swallowNextClick(20, win)
  await new Promise((r) => setTimeout(r, 40))
  click()
  assert.equal(clicks, 3, "a timed-out swallower lets clicks through")
  assert.equal(pendingSwallowers(), 0)
})
