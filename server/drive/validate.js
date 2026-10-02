// What an online drive copy may look like. The client sends its C: drive in the same shape
// it saves to localStorage (see client/src/utils/fs.js serialize), plus its achievements:
//   { drive: { root: [node], bin: [node] }, achievements: { unlocked: { id: time }, progress: { id: [step] } } }
//   node = { k: "d", n: name, t: type, m: meta, c: [node] } | { k: "f", n: name, t: type, x: text, m: meta }
// The client checks backups with the same rules (client/src/utils/driveSnapshot.js).

const MAX_BYTES = 2 * 1024 * 1024 // per account; MongoDB's free tier is 512 MB in all
const MAX_NODES = 20_000
const MAX_DEPTH = 40
const MAX_META = 2_000
const MAX_ACHIEVEMENTS = 200

const BAD_NAME = /[\\/:"<>|\u0000-\u001F\u007F]/
const TYPE = /^[a-z][a-z0-9]{0,31}$/
const ACHIEVEMENT_ID = /^[a-z0-9][a-z0-9-]{0,39}$/

const isPlain = (value) => !!value && typeof value === "object" && !Array.isArray(value)

const nameProblem = (name) => {
  if (typeof name !== "string" || !name || name !== name.trim() || name.length > 64) return true
  if (/^[A-Za-z]:$/.test(name)) return false // a drive letter
  return BAD_NAME.test(name)
}

// Walks every node; returns an error message or null
const checkNodes = (nodes, budget, depth = 0) => {
  if (!Array.isArray(nodes)) return "A folder's contents must be a list."
  if (depth > MAX_DEPTH) return "Folders are nested too deeply."
  for (const node of nodes) {
    if (--budget.nodes < 0) return "There are too many files."
    if (!isPlain(node)) return "A file entry is damaged."
    if (node.k !== "d" && node.k !== "f") return "A file entry is damaged."
    if (nameProblem(node.n)) return "A file name is not valid."
    if (typeof node.t !== "string" || !TYPE.test(node.t)) return `"${node.n}" has an unknown type.`
    if (node.m !== undefined && node.m !== null) {
      if (!isPlain(node.m) || JSON.stringify(node.m).length > MAX_META) return `"${node.n}" is damaged.`
    }
    if (node.k === "f" && typeof node.x !== "string") return `"${node.n}" is damaged.`
    if (node.k === "d") {
      const problem = checkNodes(node.c, budget, depth + 1)
      if (problem) return problem
    }
  }
  return null
}

const validateDrive = (drive) => {
  if (!isPlain(drive) || !Array.isArray(drive.root)) return "There is no drive in it."
  if (drive.bin !== undefined && !Array.isArray(drive.bin)) return "The Recycle Bin is damaged."
  if (drive.root.length > 26) return "There are too many drives."
  const c = drive.root.find((node) => isPlain(node) && node.k === "d" && node.n === "C:")
  if (!c) return "There is no drive C: in it."
  const budget = { nodes: MAX_NODES }
  return checkNodes(drive.root, budget) || checkNodes(drive.bin || [], budget)
}

const validateAchievements = (achievements) => {
  if (achievements === undefined || achievements === null) return null
  if (!isPlain(achievements)) return "The achievements are damaged."
  const { unlocked = {}, progress = {} } = achievements
  if (!isPlain(unlocked) || !isPlain(progress)) return "The achievements are damaged."
  if (Object.keys(unlocked).length > MAX_ACHIEVEMENTS || Object.keys(progress).length > MAX_ACHIEVEMENTS) return "There are too many achievements."
  for (const [id, time] of Object.entries(unlocked)) {
    if (!ACHIEVEMENT_ID.test(id) || typeof time !== "number" || !Number.isFinite(time)) return "The achievements are damaged."
  }
  for (const [id, steps] of Object.entries(progress)) {
    if (!ACHIEVEMENT_ID.test(id) || !Array.isArray(steps) || steps.length > 64) return "The achievements are damaged."
    if (steps.some((s) => typeof s !== "string" || s.length > 40)) return "The achievements are damaged."
  }
  return null
}

// -> { ok: true, snapshot, json, size } | { ok: false, error, status }
const validateSnapshot = (snapshot, maxBytes = MAX_BYTES) => {
  if (!isPlain(snapshot)) return { ok: false, status: 400, error: "That isn't a drive copy." }
  const problem = validateDrive(snapshot.drive) || validateAchievements(snapshot.achievements)
  if (problem) return { ok: false, status: 400, error: problem }
  // keep only what we know about
  const clean = { drive: { root: snapshot.drive.root, bin: snapshot.drive.bin || [] }, achievements: snapshot.achievements || {} }
  const json = JSON.stringify(clean)
  const size = Buffer.byteLength(json)
  if (size > maxBytes) {
    const mb = (n) => (n / 1024 / 1024).toFixed(1)
    return { ok: false, status: 413, error: `Your files take ${mb(size)} MB, but an online copy can hold ${mb(maxBytes)} MB. Delete some pictures or sounds and try again.` }
  }
  return { ok: true, snapshot: clean, json, size }
}

module.exports = { validateSnapshot, validateDrive, validateAchievements, MAX_BYTES }
