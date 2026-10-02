// The question packs, each its own chunk: loaded when a mode needs them (the server and
// the tests load them the same way).

const LOADERS = {
  aboutMe: () => import("./aboutMe.js").then((m) => m.ABOUT_ME),
  pairs: () => import("./thisOrThat.js").then((m) => m.PAIRS),
  deep: () => import("./deepTalk.js").then((m) => m.DEEP_TALK),
  compat: () => import("./compat.js").then((m) => m.COMPAT_QUIZZES),
  triviaPacks: () => import("./trivia.js").then((m) => m.TRIVIA_PACKS),
  likely: () => import("./likely.js").then((m) => m.LIKELY),
}

const cache = {}
export const loadPack = (name) => (cache[name] ||= LOADERS[name]().catch((error) => {
  delete cache[name]
  throw error
}))

// everything, as { aboutMe, pairs, deep, compat, triviaPacks, trivia, likely }
export const loadAllPacks = async () => {
  const names = Object.keys(LOADERS)
  const values = await Promise.all(names.map(loadPack))
  const all = Object.fromEntries(names.map((n, i) => [n, values[i]]))
  all.trivia = all.triviaPacks.flatMap((p) => p.questions)
  return all
}
