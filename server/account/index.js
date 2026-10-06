// Deleting a 98 Messenger account: everything the server keeps for it, in one place.
//
// 98 Messenger (server/aim) handles the socket event aim:deleteAccount { screenName, password }:
// the password is checked again (re-authentication, with the same failed-try limits as signing
// on), the account is marked "deleting" (nobody can sign on to it any more, its remembered
// devices are forgotten), every session is signed off, and then the steps below run in order.
// The account record itself goes last, which frees the screen name. Each step is idempotent:
// it deletes what's there and is happy when nothing is, so a deletion that stopped half way
// (a database hiccup) is finished by asking again with the same password; the "deleting" mark
// keeps what the steps need (the couples the account was in) for that second try.
//
// What is kept where, per account, and what deleting does (key = the normalized screen name):
//
//   step        collections                       what happens
//   push        pushsubs, pushprefs, pushinboxes   their devices, settings and held IMs deleted;
//                                                  IMs they sent that wait for someone else deleted
//   messages    imhistory, imclears, imreads       98 Messenger's saved conversations (server/aim/
//                                                  history.js): their copy of every IM and room
//                                                  message goes, their reactions and read receipts
//                                                  go. The other person's copy stays (it's theirs,
//                                                  like mail) without the name: sender/recipient
//                                                  read "(deleted account)" and the conversation
//                                                  gets a new random id, so whoever takes the name
//                                                  later sees none of it. Room lines they wrote
//                                                  stay for the others as "(deleted account)".
//   im media    immedia + bucket objects m/...     pictures and voice messages they sent (server/aim/
//                                                  media.js): deleted, unless someone they sent one
//                                                  to can still see it: then it stays that person's
//                                                  (no longer tied to the account) until it expires
//                                                  (90 days). They lose access to what they got.
//   drive       syncaccounts, syncentries,         every synced file, its contents, the device
//               syncblobs, syncdevices, drives,    sync tokens and the old whole-drive copy deleted;
//               + the online storage bucket        with a bucket (Vercel Blob / S3, server/drive/
//                 (objects u/<HMAC of key>/...)    bucket.js) its objects are deleted first, by
//                                                  the paths in syncblobs (an upload URL issued
//                                                  before the deletion and used after it leaves an
//                                                  object with no record: the weekly tidy deletes
//                                                  it). blobusage holds only daily totals, no account
//   albums      albums, albumitems                 Shared Albums (server/albums): every photo and
//               + bucket objects a/...             video they added is deleted from every album
//                                                  (objects and records), their likes and comments
//                                                  go, and they leave every album (the next member
//                                                  becomes owner; an album left with nobody is
//                                                  deleted with everything in it). The others see
//                                                  "A member deleted their account"
//   contacts    addressbooks                       their Address Book deleted
//   notes       notes                              their own notes (and tombstones) deleted; in
//                                                  notes shared with others they leave: the
//                                                  others keep the note (ownership passes on)
//                                                  and the name is taken off it. Tasks are
//                                                  Calendar to-do events (see calendar)
//   mail        mailmessages                       their whole mailbox (all folders) deleted; mail
//                                                  they sent stays in the recipients' mailboxes
//                                                  (it's theirs, like any e-mail) but no longer
//                                                  carries the name: From/To/Cc read "(deleted
//                                                  account)", so whoever takes the name later
//                                                  isn't mistaken for them and gets no replies
//   puzzles     puzzles                            puzzles they sent or got deleted (their pictures)
//   quiz        quizchallenges, quizsaveds,        challenges they sent or got, their saved
//               quizscores                         quizzes, and scores with anyone deleted
//   homepages   homepages                          their published page deleted
//   guestbook   guestbookentries                   entries they signed while signed on deleted
//                                                  (entries signed as a guest have no account)
//   games       tetrisranks (+ memory)             Tetris Online ranks deleted; co-op towns: they
//                                                  leave every one (a group town nobody's left in,
//                                                  and the couple's town, are deleted)
//   calendar    calendars, calevents,              personal calendar and the couple's Us calendar
//               calcomments, calactivity           deleted; in shared calendars they leave (the
//                                                  longest-standing member becomes owner, a
//                                                  calendar left empty is deleted), and their
//                                                  events, comments and activity lines go, and
//                                                  they're taken off other events' attendees;
//                                                  invitations to or from them are dropped
//   dollhouse   dollhouses                         the couple's Dream House deleted
//   town        towndocs                           their Sunny Acres town, notes and hearts they
//                                                  left in others' towns, gifts waiting from them,
//                                                  and the couple's weekly goals deleted; help
//                                                  and gifts already given read "(deleted account)"
//   couples     couples, coupleitems               every pairing (also pending and ended ones) and
//                                                  everything the couple kept: letters, Our Story,
//                                                  photos, flowers, Our Pet. Couple things are only
//                                                  ever visible to the pair while paired, so once
//                                                  one of them is gone nobody can see them; they
//                                                  are deleted right away (unpairing keeps them 30
//                                                  days in case the two pair again, which can't
//                                                  happen now). The partner gets a neutral notice.
//   gamechat    (memory)                           their lines in game chat history deleted
//   compass     weblog, webreports, webusage       Compass's 7-day relay log (host, bytes, day),
//               (+ memory)                         pages they reported, their daily usage
//                                                  counters (u:<key>), their browsing sessions
//                                                  and the relay's cookie jar for them
//   locations   locations                          Buddy Locator (server/locate): their record (who
//                                                  they share with, their latest position, places,
//                                                  alerts, asks) deleted; the people who could see
//                                                  them are told; they're taken out of everyone
//                                                  else's record (shares with them, their asks,
//                                                  alerts about them). No position history exists
//   pickleball  pbsessions, pbmatches              Pickleball 98 Real Games (server/pbclub): play
//                                                  sessions they host deleted (the invited are
//                                                  told); their RSVPs, invitations and chat lines
//                                                  taken out of others' sessions. In matches they
//                                                  played they become "Deleted player" (a random id
//                                                  not linked to them) so the other players'
//                                                  records and ratings stay; matches with no other
//                                                  account, and unconfirmed ones they logged, deleted
//   shared documents  shareddocs                   Come Over (server/aim/ydocs.js): shared Notepad
//                                                  texts, Paint pictures and Shared with Friends
//                                                  folders only they're in deleted; in shared ones
//                                                  they leave (the next member becomes owner). What
//                                                  they typed or drew stays part of the shared
//                                                  document, as in any shared document. Hangouts
//                                                  (cursors, desktops, follow, handed files) are
//                                                  memory only and end when they sign off
//   vb98 programs  vbapps                          Visual Basic 98 programs sent in a message
//                                                  (server/aim/vbapps.js): they leave every shared
//                                                  program (the next person becomes owner); one
//                                                  nobody else is in is deleted. Shared values they
//                                                  set stay part of the program for the others
//                                                  (a vote, a board). Programs nobody changes for
//                                                  30 days are deleted anyway (TTL)
//   aim         aimusers                          the account (password hash, profile, Buddy
//                                                  List, blocks, remembered devices) deleted; their
//                                                  name taken off everyone's Buddy List and block
//                                                  list; warnings and SmarterChild's memory of
//                                                  them dropped. The screen name is free again.
//
// Kept only in memory and gone when they sign off (nothing to delete): who's online, away
// messages, chat rooms, calls, Come Over hangouts, Network Neighborhood computers and file offers, live games.
// Rate-limit counters keyed by the account forget themselves within their window (an hour at
// most). Copies on someone else's device (an IM they received, a contact card they made, a
// calendar they exported) are theirs and out of reach.
//
//   const eraser = createAccountEraser()
//   eraser.addContext(async (key) => ({ coupleIds: [...] }))   facts the steps need, gathered first
//   eraser.add("mail", async (ctx) => ...)                     ctx = { key, screenName, coupleIds, partners }
//   await eraser.run(ctx) -> { ok, done: [{ name, result }], failed?: name, error? }

const createAccountEraser = ({ log = console } = {}) => {
  const steps = []
  const contexts = []

  const add = (name, run) => {
    if (typeof run === "function") steps.push({ name, run })
    return api
  }
  const addContext = (fn) => {
    if (typeof fn === "function") contexts.push(fn)
    return api
  }

  // what the steps need to know, gathered before anything is deleted; `saved` is what an
  // earlier, unfinished try gathered (merged in, so nothing is missed the second time)
  const context = async (key, screenName, saved = null) => {
    const ctx = { key, screenName, coupleIds: [...(saved?.coupleIds || [])], partners: [...(saved?.partners || [])] }
    for (const fn of contexts) {
      const extra = (await fn(key, ctx)) || {}
      for (const id of extra.coupleIds || []) if (!ctx.coupleIds.includes(id)) ctx.coupleIds.push(id)
      for (const p of extra.partners || []) if (!ctx.partners.some((q) => q.key === p.key)) ctx.partners.push(p)
    }
    return ctx
  }

  const run = async (ctx) => {
    const done = []
    for (const step of steps) {
      try {
        done.push({ name: step.name, result: (await step.run(ctx)) ?? null })
      } catch (error) {
        log.error?.(`[account] deleting ${ctx.key}: the ${step.name} step failed`, error?.message || error)
        return { ok: false, done, failed: step.name, error: error?.message || String(error) }
      }
    }
    return { ok: true, done }
  }

  const api = { add, addContext, context, run, steps: () => steps.map((s) => s.name) }
  return api
}

// how a deleted account appears in what others keep (mail headers, town gifts)
const DELETED_NAME = "(deleted account)"

module.exports = { createAccountEraser, DELETED_NAME }
