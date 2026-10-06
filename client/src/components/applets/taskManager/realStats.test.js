import test from "node:test"
import assert from "node:assert/strict"
import { busyFromLag, busyFromLongTasks } from "./realStats.js"

test("busy % from long tasks counts only the part inside the interval", () => {
  assert.equal(busyFromLongTasks([], 0, 1000), 0)
  assert.equal(busyFromLongTasks([{ startTime: 100, duration: 250 }], 0, 1000), 25)
  // a task that started before the interval only counts from its start
  assert.equal(busyFromLongTasks([{ startTime: -100, duration: 200 }, { startTime: 900, duration: 400 }], 0, 1000), 20)
  assert.equal(busyFromLongTasks([{ startTime: 0, duration: 5000 }], 0, 1000), 100)
})

test("busy % from timer lateness", () => {
  assert.equal(busyFromLag([], 100), 0)
  assert.equal(busyFromLag([0, 0, 0, 0], 100), 0)
  // 10 probes, 100 ms of total lateness over ~1 s: about 9 %
  assert.equal(busyFromLag([10, 10, 10, 10, 10, 10, 10, 10, 10, 10], 100), 9)
  assert.equal(busyFromLag([-3, 2], 100), 1)
})
