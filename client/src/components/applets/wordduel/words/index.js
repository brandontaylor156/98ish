// Word Duel's word lists, one file per word length (w4.js ... w7.js, see their headers for
// where the words come from). The window loads only the length it needs; the server loads
// them all (server/arcade/games/wordduel.js).

export const LENGTHS = [4, 5, 6, 7]

const LOADERS = {
  4: () => import("./w4.js"),
  5: () => import("./w5.js"),
  6: () => import("./w6.js"),
  7: () => import("./w7.js"),
}

const split = (text, n) => {
  const out = []
  for (let i = 0; i + n <= text.length; i += n) out.push(text.slice(i, i + n))
  return out
}

// One length's lists: answers (an array, alphabetical) and every word you may guess (a Set)
export const wordsFrom = (n, mod) => {
  const answers = split(mod.ANSWERS, n)
  const valid = new Set(answers)
  for (const w of split(mod.GUESSES, n)) valid.add(w)
  return { length: n, answers, valid }
}

const cache = new Map()
export const loadWords = (n) => {
  if (!LOADERS[n]) return Promise.reject(new Error(`No ${n}-letter words`))
  if (!cache.has(n)) cache.set(n, LOADERS[n]().then((mod) => wordsFrom(n, mod)))
  return cache.get(n)
}

// The dictionary the rules use: lists by length (only the ones loaded so far)
export const makeDict = (lists) => {
  const byLength = new Map(lists.map((l) => [l.length, l]))
  return {
    answers: (n) => byLength.get(n)?.answers || [],
    isWord: (w) => !!byLength.get(w.length)?.valid.has(w),
    has: (n) => byLength.has(n),
  }
}
