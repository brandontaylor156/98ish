// Address Book: vCard reading/writing with real-world files (iPhone, Google/Android, Outlook
// 2.1 quoted-printable, vCard 4.0) and the contact rules (dates, merging, birthdays).
// Run: node --test client/src/components/applets/addressbook/vcard.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { isVCard, parseVCards, toVCard, toVCards } from "./vcard.js"
import { birthdayEvents, cleanDate, contactForScreenName, daysUntil, displayName, matchesContact, mergeBooks, normalizeContact, yearsOn } from "../../../utils/contactsCore.js"

const JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=="
const fold = (s) => s.match(/.{1,74}/g).join("\r\n ")

// What an iPhone's Share Contact writes (iOS 17), photo folded, labeled items
const IPHONE = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "PRODID:-//Apple Inc.//iPhone OS 17.0//EN",
  "N:Appleseed;Jane;Q.;;",
  "FN:Jane Q. Appleseed",
  "NICKNAME:Janie",
  "ORG:Fruit Stand Co.;",
  "item1.EMAIL;type=INTERNET;type=pref:jane@example.com",
  "item1.X-ABLabel:_$!<Other>!$_",
  "EMAIL;type=INTERNET;type=WORK:jane@work.example",
  "TEL;type=CELL;type=VOICE;type=pref:(555) 010-0100",
  "TEL;type=IPHONE;type=CELL;type=VOICE:+1 555 010 0199",
  "item2.TEL:555-0142",
  "item2.X-ABLabel:Grandma's",
  "item3.ADR;type=HOME;type=pref:;;1 Infinite Loop\\nApt 2;Cupertino;CA;95014;United States",
  "item3.X-ABADR:us",
  "BDAY;X-APPLE-OMIT-YEAR=1604:1604-03-09",
  "item4.X-ABDATE;type=pref:2015-06-20",
  "item4.X-ABLabel:_$!<Anniversary>!$_",
  "NOTE:Likes tulips\\, not roses.\\nCall after 6.",
  "PHOTO;ENCODING=b;TYPE=JPEG:" + fold(JPEG),
  "END:VCARD",
  "",
].join("\r\n")

// Google Contacts' export (what an Android phone shares)
const GOOGLE = `BEGIN:VCARD
VERSION:3.0
FN:Bob Builder
N:Builder;Bob;;;
EMAIL;TYPE=INTERNET;TYPE=HOME:bob@example.org
TEL;TYPE=CELL:+44 7700 900123
BDAY:1988-11-30
CATEGORIES:myContacts,starred,Family
END:VCARD
BEGIN:VCARD
VERSION:3.0
FN:Pizza Place
ORG:Pizza Place
TEL;TYPE=WORK:555-0199
CATEGORIES:myContacts
END:VCARD
`

// Outlook's vCard 2.1: bare types, quoted-printable UTF-8 with a soft line break, a
// multi-line base64 photo that ends with a blank line
const OUTLOOK = [
  "BEGIN:VCARD",
  "VERSION:2.1",
  "N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:M=C3=BCller;J=C3=BCrgen",
  "FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:J=C3=BCrgen M=C3=BCller",
  "TEL;CELL;VOICE:+49 151 2345678",
  "TEL;WORK;FAX:+49 30 1234",
  "EMAIL;PREF;INTERNET:juergen@example.de",
  "ADR;WORK;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:;;Stra=C3=9Fe 1;Berlin;;10115;=",
  "Deutschland",
  "NOTE;ENCODING=QUOTED-PRINTABLE:Line one=0D=0ALine two",
  "BDAY:19750102",
  "PHOTO;TYPE=JPEG;ENCODING=BASE64:",
  " " + JPEG.slice(0, 60),
  " " + JPEG.slice(60),
  "",
  "END:VCARD",
].join("\r\n")

const V4 = `BEGIN:VCARD
VERSION:4.0
FN:Ana Lima
N:Lima;Ana;;;
EMAIL;TYPE=home:ana@example.com
TEL;VALUE=uri;TYPE="voice,cell":tel:+55-11-5555-0100
BDAY:--0704
ANNIVERSARY:20100815
PHOTO:data:image/jpeg;base64,${JPEG}
IMPP:aim:analima98
END:VCARD`

test("iPhone export: names, labels, address, dates without a year, anniversary, photo", () => {
  assert.equal(isVCard(IPHONE), true)
  const [c] = parseVCards(IPHONE)
  assert.equal(c.first, "Jane Q.")
  assert.equal(c.last, "Appleseed")
  assert.equal(c.nickname, "Janie")
  assert.equal(c.company, "Fruit Stand Co.")
  assert.deepEqual(c.emails, [{ label: "other", value: "jane@example.com" }, { label: "work", value: "jane@work.example" }])
  assert.deepEqual(c.phones, [
    { label: "mobile", value: "(555) 010-0100" },
    { label: "iphone", value: "+1 555 010 0199" },
    { label: "grandma's", value: "555-0142" },
  ])
  assert.deepEqual(c.address, { street: "1 Infinite Loop\nApt 2", city: "Cupertino", region: "CA", postal: "95014", country: "United States" })
  assert.equal(c.birthday, "--03-09")
  assert.equal(c.anniversary, "2015-06-20")
  assert.equal(c.notes, "Likes tulips, not roses.\nCall after 6.")
  assert.equal(c.picture, `data:image/jpeg;base64,${JPEG}`)
})

test("Google/Android export: several cards, starred is a favorite, myContacts dropped", () => {
  const cards = parseVCards(GOOGLE)
  assert.equal(cards.length, 2)
  assert.equal(displayName(normalizeContact(cards[0])), "Bob Builder")
  assert.equal(cards[0].favorite, true)
  assert.deepEqual(cards[0].groups, ["Family"])
  assert.equal(cards[0].birthday, "1988-11-30")
  assert.equal(cards[1].first, "Pizza")
  assert.equal(cards[1].company, "Pizza Place")
  assert.deepEqual(cards[1].groups, [])
})

test("Outlook vCard 2.1: quoted-printable UTF-8, soft breaks, bare types, base64 photo", () => {
  const [c] = parseVCards(OUTLOOK)
  assert.equal(c.first, "Jürgen")
  assert.equal(c.last, "Müller")
  assert.deepEqual(c.phones, [
    { label: "mobile", value: "+49 151 2345678" },
    { label: "work fax", value: "+49 30 1234" },
  ])
  assert.equal(c.emails[0].value, "juergen@example.de")
  assert.deepEqual(c.address, { street: "Straße 1", city: "Berlin", region: "", postal: "10115", country: "Deutschland" })
  assert.equal(c.notes, "Line one\nLine two")
  assert.equal(c.birthday, "1975-01-02")
  assert.equal(c.picture, `data:image/jpeg;base64,${JPEG}`)
})

test("vCard 4.0: data URI photo, --MMDD birthday, ANNIVERSARY, aim: screen name", () => {
  const [c] = parseVCards(V4)
  assert.equal(c.birthday, "--07-04")
  assert.equal(c.anniversary, "2010-08-15")
  assert.equal(c.picture, `data:image/jpeg;base64,${JPEG}`)
  assert.equal(c.screenName, "analima98")
  assert.equal(c.phones[0].value, "tel:+55-11-5555-0100")
})

test("junk and empty cards are skipped; text that isn't a vCard gives nothing", () => {
  assert.deepEqual(parseVCards("hello there"), [])
  assert.deepEqual(parseVCards("BEGIN:VCARD\nVERSION:3.0\nEND:VCARD"), [])
  assert.equal(isVCard("Dear diary"), false)
  // no END: the unfinished card is dropped
  assert.equal(parseVCards("BEGIN:VCARD\nFN:Half\n").length, 0)
})

test("round trip: write vCard 3.0 and read it back the same, special characters included", () => {
  const original = normalizeContact({
    first: "Zoë; \"Z\"",
    last: "O'Neil, Jr.",
    nickname: "Zee",
    company: "Acme\\Things",
    screenName: "zoe98",
    mail: "zoe.mail",
    emails: [{ label: "home", value: "zoe@example.com" }, { label: "school", value: "z@uni.example" }],
    phones: [{ label: "mobile", value: "555-0100" }, { label: "work fax", value: "555-0101" }, { label: "Lake house", value: "555-0102" }],
    birthday: "--02-29",
    anniversary: "2012-09-01",
    address: { street: "12 Long Road\nUnit 4", city: "Springfield", region: "OR", postal: "97477", country: "USA" },
    notes: "Line 1\nLine 2, with comma; and semicolon. Long ".repeat(4),
    picture: `data:image/jpeg;base64,${JPEG}`,
    groups: ["Family", "Book club"],
    favorite: true,
  })
  const text = toVCard(original)
  assert.ok(text.split("\r\n").every((line) => line.length <= 75), "lines are folded")
  assert.match(text, /^BEGIN:VCARD\r\nVERSION:3\.0\r\n/)
  const [back] = parseVCards(text)
  const again = normalizeContact({ ...back, id: original.id, updatedAt: original.updatedAt })
  assert.deepEqual(again, { ...original, phones: original.phones.map((p) => ({ ...p, label: p.label.toLowerCase() })) })

  // several at once, deleted ones left out
  const two = toVCards([original, { ...original, id: "zzzzzzzz", first: "Other" }, { id: "gone0000", updatedAt: 1, deleted: true }])
  assert.equal(parseVCards(two).length, 2)
})

test("an iPhone card survives our export and import", () => {
  const first = normalizeContact(parseVCards(IPHONE)[0])
  const second = normalizeContact({ ...parseVCards(toVCard(first))[0], id: first.id, updatedAt: first.updatedAt })
  assert.deepEqual(second, first)
})

test("dates: formats, no-year, impossible dates", () => {
  assert.equal(cleanDate("1990-05-17"), "1990-05-17")
  assert.equal(cleanDate("19900517"), "1990-05-17")
  assert.equal(cleanDate("--0517"), "--05-17")
  assert.equal(cleanDate("1604-05-17"), "--05-17")
  assert.equal(cleanDate("1990-05-17T00:00:00Z"), "1990-05-17")
  assert.equal(cleanDate("1990-02-30"), "")
  assert.equal(cleanDate("May 17"), "")
  assert.equal(cleanDate(""), "")
  assert.equal(daysUntil("1990-05-17", "2026-05-17"), 0)
  assert.equal(daysUntil("1990-05-17", "2026-05-18"), 364)
  assert.equal(daysUntil("--12-31", "2026-12-30"), 1)
  assert.equal(yearsOn("1990-05-17", "2026-05-17"), 36)
  assert.equal(yearsOn("1990-05-17", "2026-05-18"), 37)
  assert.equal(yearsOn("--05-17", "2026-05-17"), null)
})

test("birthdays and anniversaries become yearly all-day events with a reminder", () => {
  const people = [
    normalizeContact({ id: "aaaaaaaa", first: "Jane", birthday: "1990-05-17", anniversary: "--06-20" }),
    normalizeContact({ id: "bbbbbbbb", first: "No dates" }),
    { id: "cccccccc", updatedAt: 1, deleted: true },
  ]
  const events = birthdayEvents(people)
  assert.equal(events.length, 2)
  const [bday, anniv] = events
  assert.equal(bday.title, "Jane's birthday")
  assert.equal(bday.start, "1990-05-17")
  assert.equal(bday.allDay, true)
  assert.deepEqual(bday.repeat, { freq: "yearly", interval: 1 })
  assert.deepEqual(bday.reminders, [0])
  assert.equal(bday.readOnly, true)
  assert.equal(anniv.start, "2000-06-20")
  assert.equal(anniv.title, "Jane's anniversary")
})

test("merging this device's book with the server's", () => {
  const a = normalizeContact({ id: "aaaaaaaa", first: "A", updatedAt: 100 })
  const b = normalizeContact({ id: "bbbbbbbb", first: "B", updatedAt: 100 })
  const offline = normalizeContact({ id: "cccccccc", first: "Made offline", updatedAt: 50 })
  const server = [{ ...a, first: "A (server, newer)", updatedAt: 200 }, { ...b, first: "B (server, older)", updatedAt: 50 }, { id: "dddddddd", updatedAt: 300, deleted: true }]
  const { contacts, dirty } = mergeBooks([a, b, offline], server, ["bbbbbbbb", "cccccccc"])
  const byId = Object.fromEntries(contacts.map((c) => [c.id, c]))
  assert.equal(byId.aaaaaaaa.first, "A (server, newer)")
  assert.equal(byId.bbbbbbbb.first, "B")
  assert.equal(byId.cccccccc.first, "Made offline")
  assert.equal(byId.dddddddd.deleted, true)
  assert.deepEqual(dirty.sort(), ["bbbbbbbb", "cccccccc"])
})

test("finding contacts: words, phone digits, screen names", () => {
  const c = normalizeContact({ first: "Jane", last: "Doe", screenName: "Jane Doe98", phones: [{ label: "mobile", value: "(555) 010-0100" }], groups: ["Family"] })
  assert.equal(matchesContact(c, "jane fam"), true)
  assert.equal(matchesContact(c, "5550100"), true)
  assert.equal(matchesContact(c, "010-0100"), true)
  assert.equal(matchesContact(c, "bob"), false)
  assert.equal(contactForScreenName([c], "janedoe98")?.id, c.id)
  assert.equal(contactForScreenName([c], "someone"), null)
})
