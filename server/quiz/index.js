// Quiz Show: quizzes sent between 98 Messenger accounts, over plain HTTP (live games are
// in live.js, over the network's Socket.io connection). Every request needs a signed-on
// 98 Messenger session (see ../aim/auth.js).
//   GET    /api/quiz/inbox                   challenges you sent and got, newest first
//   POST   /api/quiz/challenges              { to, kind, ... } send a quiz (your answers are its key)
//   GET    /api/quiz/challenges/:id          one challenge (only its two people may read it)
//   POST   /api/quiz/challenges/:id/attempt  { answers } take it (once; scored here)
//   DELETE /api/quiz/challenges/:id          remove it from your inbox
//   GET    /api/quiz/quizzes                 your saved custom quizzes
//   POST   /api/quiz/quizzes                 { id?, title, questions } save one
//   DELETE /api/quiz/quizzes/:id
//   GET    /api/quiz/scores                  how you've done with each person you play with
// Privacy: a challenge is only ever shown to the two people in it, and the sender's answers
// are only shown to the taker after they've answered. Text is plain text. Someone who has
// blocked you in 98 Messenger never gets your quizzes (you aren't told, as with mail).

const crypto = require("crypto")
const express = require("express")
const { limiter } = require("../net/limiter")
const { sessionFrom } = require("../aim/auth")
const { validate, normalize } = require("../aim/screenNames")
const { sharedQuizStore, pairKey } = require("./store")
const { quizContent } = require("./content")
const { createQuizLive } = require("./live")

const MAX_PENDING = 30 // challenges you've sent that haven't been taken yet
const MAX_SAVED = 50 // saved custom quizzes per account
const BODY_LIMIT = "64kb"

const newId = () => crypto.randomBytes(12).toString("hex")
const ID = /^[a-f0-9]{24}$/

const titleOf = (c, content) =>
  c.kind === "custom" ? c.payload.title : c.kind === "compat" ? content.compat.find((q) => q.id === c.payload.quizId)?.title || "Compatibility Quiz" : null

const countOf = (c) => (c.kind === "custom" ? c.payload.questions.length : c.kind === "compat" ? null : c.payload.items.length)

// A line in someone's inbox: never the answers
const summary = (c, me, logic, content) => ({
  id: c.id,
  kind: c.kind,
  kindName: logic.KIND_NAMES[c.kind],
  title: titleOf(c, content),
  from: c.fromName,
  to: c.toName,
  mine: c.from === me,
  status: c.status,
  count: countOf(c) ?? content.compat.find((q) => q.id === c.payload.quizId)?.questions.length ?? 0,
  percent: c.status === "done" ? c.result.percent : null,
  createdAt: c.createdAt,
  doneAt: c.doneAt || null,
})

// The whole challenge for one of its two people. The taker sees the sender's answers only
// once they've answered.
const fullView = (c, me, logic, content) => {
  const view = { ...summary(c, me, logic, content), payload: c.payload }
  if (c.from === me || c.status === "done") view.authorAnswers = c.key
  if (c.status === "done") {
    view.takerAnswers = c.answers
    view.result = c.result
  }
  return view
}

const quizRouter = ({ store: storeOrPromise, aim: initialAim = null, limits = {} } = {}) => {
  let aim = initialAim
  let storePromise = null
  const getStore = () => (storePromise ??= Promise.resolve(storeOrPromise || sharedQuizStore()))

  const requests = limiter(limits.requestsPerMinute ?? 120, 60_000)
  const creates = limiter(limits.sendsPerHour ?? 30, 60 * 60_000)
  const attempts = limiter(limits.attemptsPerHour ?? 60, 60 * 60_000)
  const saves = limiter(limits.savesPerHour ?? 60, 60 * 60_000)

  const notify = (key, event, payload) => aim?.sessions.get(key)?.socket?.emit(event, payload)

  const router = express.Router()

  // Signed on before anything else (even reading the body)
  router.use((request, response, next) => {
    const session = sessionFrom(aim, request)
    if (!session) return response.status(401).json({ ok: false, error: "Sign on to 98 Messenger to send and take quizzes." })
    if (requests(session.key)) return response.status(429).json({ ok: false, error: "Slow down!" })
    request.quizSession = session
    next()
  })

  const handle = (fn) => async (request, response) => {
    try {
      const [store, { logic, content }] = await Promise.all([getStore(), quizContent()])
      await fn({ request, response, session: request.quizSession, me: request.quizSession.key, store, logic, content })
    } catch (error) {
      console.error("[quiz]", error.message)
      response.status(503).json({ ok: false, error: "The quiz server isn't answering. Please try again later." })
    }
  }
  const body = express.json({ limit: BODY_LIMIT })
  const bad = (response, error, status = 400) => response.status(status).json({ ok: false, error })

  // only the two people in a challenge can see it; anyone else gets "not found"
  const readable = (c, me) => c && (c.from === me || c.to === me) && !c.hiddenBy?.includes(me)

  router.get(
    "/inbox",
    handle(async ({ response, me, store, logic, content }) => {
      const list = await store.challengesFor(me)
      response.json({ ok: true, challenges: list.map((c) => summary(c, me, logic, content)) })
    })
  )

  router.post(
    "/challenges",
    body,
    handle(async ({ request, response, session, me, store, logic, content }) => {
      const input = request.body || {}
      const name = validate(String(input.to ?? "").trim())
      if (name.error) return bad(response, "Type the 98 Messenger screen name of who should take it.")
      if (name.key === me) return bad(response, "You can't send a quiz to yourself. Pick someone else!")
      const checked = logic.validateChallenge(input, content)
      if (!checked.ok) return bad(response, checked.error)
      const user = await aim?.store?.find(name.key)
      if (!user) return bad(response, `${name.screenName} isn't a 98 Messenger screen name. Check the spelling and try again.`)
      if (session.user.blocked?.includes(name.key)) return bad(response, `You've blocked ${user.screenName}. Unblock them in 98 Messenger first.`)
      if ((await store.pendingFrom(me)) >= MAX_PENDING) return bad(response, "You have lots of quizzes waiting to be taken. Wait for some answers first.")
      if (creates(me)) return bad(response, "You've sent a lot of quizzes this hour. Take a little break!", 429)
      const blockedByThem = user.blocked?.includes(me)
      const challenge = {
        id: newId(),
        kind: checked.kind,
        from: me,
        fromName: session.user.screenName,
        to: name.key,
        toName: user.screenName,
        payload: checked.payload,
        key: checked.key,
        answers: null,
        result: null,
        status: "waiting",
        hiddenBy: blockedByThem ? [name.key] : [],
        createdAt: Date.now(),
      }
      await store.insertChallenge(challenge)
      if (!blockedByThem) {
        const notice = { id: challenge.id, from: challenge.fromName, kind: challenge.kind, kindName: logic.KIND_NAMES[challenge.kind], count: countOf(challenge) }
        notify(name.key, "quiz:new", notice)
        // for a couple's desktop toast ("your turn!"), even with the Quiz Show closed
        notify(name.key, "couple:quiz", notice)
      }
      response.json({ ok: true, challenge: summary(challenge, me, logic, content) })
    })
  )

  router.get(
    "/challenges/:id",
    handle(async ({ request, response, me, store, logic, content }) => {
      const id = String(request.params.id)
      const c = ID.test(id) ? await store.getChallenge(id) : null
      if (!readable(c, me)) return bad(response, "That quiz is gone.", 404)
      response.json({ ok: true, challenge: fullView(c, me, logic, content) })
    })
  )

  router.post(
    "/challenges/:id/attempt",
    body,
    handle(async ({ request, response, me, store, logic, content }) => {
      const id = String(request.params.id)
      const c = ID.test(id) ? await store.getChallenge(id) : null
      if (!readable(c, me)) return bad(response, "That quiz is gone.", 404)
      if (c.to !== me) return bad(response, "This quiz is for someone else to take.", 403)
      if (c.status === "done") return bad(response, "You've already taken this quiz.", 409)
      if (attempts(me)) return bad(response, "You're answering a lot of quizzes! Wait a little and try again.", 429)
      const checked = logic.validateAttempt(c.kind, c.payload, request.body?.answers, content)
      if (!checked.ok) return bad(response, checked.error)
      const result = logic.scoreChallenge(c.kind, c.payload, c.key, checked.answers, content)
      // only the first answer counts, even if two arrive at once
      const done = await store.updateChallenge(id, { answers: checked.answers, result, status: "done", doneAt: Date.now() }, { status: "waiting" })
      if (!done) return bad(response, "You've already taken this quiz.", 409)
      await store.addScore(c.from, c.to, { mode: c.kind, percent: result.percent })
      const notice = { id, by: c.toName, kind: c.kind, kindName: logic.KIND_NAMES[c.kind], percent: result.percent, correct: result.correct, total: result.total }
      notify(c.from, "quiz:done", notice)
      notify(c.from, "couple:quiz-done", notice)
      response.json({ ok: true, challenge: fullView(done, me, logic, content) })
    })
  )

  router.delete(
    "/challenges/:id",
    handle(async ({ request, response, me, store }) => {
      const id = String(request.params.id)
      const c = ID.test(id) ? await store.getChallenge(id) : null
      if (!readable(c, me)) return bad(response, "That quiz is gone.", 404)
      const other = c.from === me ? c.to : c.from
      // a quiz nobody has taken yet disappears for both when its sender takes it back;
      // otherwise it's gone once both have removed it
      if ((c.from === me && c.status === "waiting") || c.hiddenBy?.includes(other)) await store.removeChallenge(id)
      else await store.updateChallenge(id, { hiddenBy: [...(c.hiddenBy || []), me] })
      response.json({ ok: true })
    })
  )

  router.get(
    "/quizzes",
    handle(async ({ response, me, store }) => {
      const list = await store.listQuizzes(me)
      response.json({ ok: true, quizzes: list.map(({ owner, ...q }) => q) })
    })
  )

  router.post(
    "/quizzes",
    body,
    handle(async ({ request, response, me, store, logic }) => {
      const input = request.body || {}
      const checked = logic.validateCustom(input)
      if (!checked.ok) return bad(response, checked.error)
      const id = typeof input.id === "string" && ID.test(input.id) ? input.id : newId()
      const existing = await store.getQuiz(me, id)
      if (!existing && (await store.countQuizzes(me)) >= MAX_SAVED) return bad(response, `You can keep up to ${MAX_SAVED} quizzes. Delete an old one first.`)
      if (saves(me)) return bad(response, "You're saving very often. Wait a little and try again.", 429)
      // the answers are stored inside each question for the author's own copy
      const questions = checked.questions.map((q, i) => ({ ...q, answer: checked.key[i] }))
      const quiz = { id, title: checked.title, questions, updatedAt: Date.now() }
      await store.saveQuiz(me, quiz)
      response.json({ ok: true, quiz })
    })
  )

  router.delete(
    "/quizzes/:id",
    handle(async ({ request, response, me, store }) => {
      const removed = await store.removeQuiz(me, String(request.params.id))
      response.json({ ok: true, removed })
    })
  )

  router.get(
    "/scores",
    handle(async ({ response, me, store }) => {
      const list = await store.scoresFor(me)
      const scores = await Promise.all(
        list.map(async (s) => {
          const otherKey = s.pair.split("|").find((k) => k !== me) || me
          const user = await aim?.store?.find(otherKey)
          return {
            with: user?.screenName || otherKey,
            games: s.games,
            average: s.games ? Math.round(s.totalPercent / s.games) : 0,
            best: s.best,
            perfect: s.perfect,
            modes: s.modes,
            history: s.history,
            lastAt: s.lastAt,
          }
        })
      )
      response.json({ ok: true, scores: scores.sort((a, b) => b.lastAt - a.lastAt) })
    })
  )

  router.use((error, request, response, next) => {
    if (error?.type === "entity.too.large") return bad(response, "That quiz is too big.", 413)
    if (error?.type === "entity.parse.failed") return bad(response, "That quiz couldn't be read.")
    next(error)
  })

  return Object.assign(router, { useAim: (value) => (aim = value) })
}

module.exports = { quizRouter, createQuizLive, pairKey, normalize }
