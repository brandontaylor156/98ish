import test from 'node:test'
import assert from 'node:assert/strict'
import { noteTitle, releaseNotes } from './releaseNotes.mjs'

test('noteTitle keeps feature merges and drops generic ones', () => {
  assert.equal(noteTitle("Merge Casino 98: Texas Hold'em (with online)"), "Casino 98: Texas Hold'em (with online)")
  assert.equal(noteTitle("Merge branch 'main' into feature"), null)
  assert.equal(noteTitle('Merge remote-tracking branch origin/main'), null)
  assert.equal(noteTitle('Fix a bug'), null)
  assert.equal(noteTitle('Merge x'), null)
})

test('releaseNotes: newest first, unique, within 60 days', () => {
  const notes = releaseNotes()
  assert.ok(Array.isArray(notes))
  const hashes = notes.map((n) => n.hash)
  assert.equal(new Set(hashes).size, hashes.length)
  for (let i = 1; i < notes.length; i++) assert.ok(notes[i - 1].at >= notes[i].at)
})
