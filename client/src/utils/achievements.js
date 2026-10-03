import { useEffect, useState } from "react"
import { playSystemSound } from "./systemSounds"

// Achievements: little secrets around 98ish. Anywhere in the app, `unlock("id")` marks one
// as found (once) and pops up a toast; `progress("id", step, total)` counts distinct steps
// (each Paint tool used...) and unlocks when all are done. Kept in this browser.

const KEY = "98ish.achievements"
const PROGRESS_KEY = "98ish.achievements.progress"

export const ACHIEVEMENTS = [
  { id: "bsod", title: "Fatal Exception", text: "Crashed 98ish so hard it turned blue.", hint: "Some processes in Task Manager really shouldn't be ended." },
  { id: "dos-mode", title: "Real Mode", text: "Restarted in MS-DOS mode.", hint: "Look closely at the Shut Down options." },
  { id: "dos-ver", title: "Version Control", text: "Asked MS-DOS which version this is.", hint: "MS-DOS knows which version of Windows it belongs to. Just ask." },
  { id: "dos-tree", title: "Family Tree", text: "Drew the whole drive as a tree.", hint: "There's a DOS command that draws your folders." },
  { id: "xyzzy", title: "Magic Word", text: "Said the magic word at the C:\\> prompt.", hint: "An old adventure-game magic word works in MS-DOS. Five letters, two of them Y." },
  { id: "notepad-log", title: "Dear Diary", text: "Found Notepad's .LOG trick.", hint: "Start a Notepad file with a certain four-character word, save it, and open it again." },
  { id: "hidden-file", title: "Spelunker", text: "Found the file nobody was supposed to find.", hint: "Something is hiding in a temporary folder deep inside C:\\." },
  { id: "recycle", title: "Taking Out the Trash", text: "Emptied the Recycle Bin.", hint: "Delete something, then make it gone for good." },
  { id: "wallpaper", title: "Interior Decorator", text: "Put your own picture on the desktop.", hint: "Display Properties and Paint can both change the wallpaper." },
  { id: "updates", title: "Fully Patched", text: "Installed every Windows Update.", hint: "Windows Update has a few critical things for you. All of them." },
  { id: "smarterchild", title: "Robot Friend", text: "Chatted with SmarterChild.", hint: "Somebody on 98 Messenger is always online." },
  { id: "guestbook", title: "Sign Here", text: "Signed the 98ish guestbook.", hint: "A homepage on the Web Ring would love to hear from you." },
  { id: "full-song", title: "Encore", text: "Listened to a whole song in Media Player.", hint: "Play something in My Music all the way to the end." },
  { id: "paint-tools", title: "Renaissance Pixel", text: "Used every tool in Paint.", hint: "Paint has sixteen tools. Try them all." },
  { id: "solitaire", title: "Bouncing Cards", text: "Won a game of Solitaire.", hint: "Get all four suits home in Solitaire." },
  { id: "freecell", title: "Free at Last", text: "Won a game of FreeCell.", hint: "Almost every FreeCell deal can be won." },
  { id: "mine-expert", title: "Bomb Squad", text: "Cleared an Expert Minesweeper field.", hint: "Game > Expert in Minesweeper. Good luck." },
  { id: "ten-windows", title: "Multitasker", text: "Had 10 windows open at once.", hint: "How many windows can one desktop hold?" },
  { id: "konami", title: "Thirty Lives", text: "Entered the famous code on the desktop.", hint: "Up, up, down, down... on the bare desktop." },
  { id: "theme", title: "New Look", text: "Applied a desktop theme.", hint: "Settings in the Start menu has a whole new look for you." },
  { id: "switcher", title: "Juggler", text: "Switched windows from the keyboard.", hint: "Hold Alt and press Q (see Keyboard Shortcuts)." },
  { id: "blockten-combo", title: "Triple Threat", text: "Cleared three lines with one piece in Block Ten.", hint: "In Block Ten, fill three rows or columns at once." },
  { id: "blockten-1000", title: "Four Digits", text: "Scored 1,000 points in one game of Block Ten.", hint: "Keep a Block Ten game going long enough to reach four digits." },
  { id: "sociable", title: "Sociable", text: "Sent a chat message in 3 different games.", hint: "Every game has a chat button in its title bar. Say hi in a few of them." },
  { id: "tetris-battle", title: "Battle Tested", text: "Won a Battle in Tetris Online.", hint: "Tetris has a multiplayer side. Top out an opponent three times." },
  { id: "tetris-tst", title: "Triple Twist", text: "Pulled off a T-spin triple in Tetris.", hint: "Spin a T piece into a slot three rows deep." },
  { id: "tetris-sprint", title: "Sub-Two", text: "Cleared 40 lines in Tetris in under 2 minutes.", hint: "Try Sprint 40L in Tetris, and hurry." },
  { id: "quick-launch", title: "Launch Pad", text: "Added a program to Quick Launch.", hint: "Drag a desktop icon onto the little icons next to Start." },
  { id: "town-order", title: "Special Delivery", text: "Filled your first helicopter order in Sunny Acres.", hint: "Sunny Acres (in Games) has a farmer waiting for some Cow Feed." },
  { id: "town-mayor", title: "Mayor of Sunny Acres", text: "Grew Sunny Acres to level 10.", hint: "Keep filling orders in Sunny Acres until your town reaches level 10." },
  { id: "town-neighbor", title: "Good Neighbor", text: "Filled 5 friends' help requests in Sunny Acres.", hint: "Visit a friend's Sunny Acres and help with what they need. Five times." },
  { id: "town-gift", title: "Gift Giver", text: "Sent a gift from your Sunny Acres.", hint: "Your partner's mailbox in Sunny Acres is waiting for something." },
  { id: "town-together", title: "Together We Grow", text: "Finished a weekly goal with your partner in Sunny Acres.", hint: "Sunny Acres has a goal for two. Harvest together." },
  { id: "town-coop", title: "Neighbors in One Town", text: "Earned a co-op achievement in a shared Sunny Acres town.", hint: "Farm a co-op town in Sunny Acres with someone, at the same time." },
  { id: "puzzle-solved", title: "Piece by Piece", text: "Finished a jigsaw in Photo Puzzle.", hint: "Photo Puzzle (in Games) can cut any picture into pieces. Put one back together." },
  { id: "dollhouse-30", title: "Interior Designer", text: "Placed 30 things in Dream House.", hint: "Dream House (in Games) has a whole catalog of furniture. Fill it up!" },
  { id: "dollhouse-home", title: "Home Sweet Home", text: "Furnished every room of your Dream House.", hint: "Put at least three things in every room of Dream House, garden and attic too." },
  { id: "doodle-pair", title: "Picasso Pair", text: "Saved a drawing made with someone in Doodle Together.", hint: "Invite someone to Doodle Together, draw something together, and save it." },
  { id: "quiz-mind-reader", title: "Mind Reader", text: "Scored 100% on How Well Do You Know Me.", hint: "In the Lovebirds Quiz Show, guess every one of someone's answers." },
  { id: "quiz-deep-diver", title: "Deep Diver", text: "Talked through 20 Deep Talk cards.", hint: "Draw Deep Talk cards in the Lovebirds Quiz Show. Twenty of them." },
  { id: "quiz-master", title: "Quiz Master", text: "Won 10 quizzes in the Lovebirds Quiz Show.", hint: "Win ten games in the Lovebirds Quiz Show." },
  { id: "two-hearts", title: "Two Hearts", text: "Paired up with your partner in Us.", hint: "Us (Programs > Us) is better with two." },
  { id: "sealed-kiss", title: "Sealed with a Kiss", text: "Sent your first love letter.", hint: "Love Letters has stationery, envelopes and a wax seal waiting." },
  { id: "first-letter", title: "Special Delivery", text: "Opened your first love letter.", hint: "Someone could write you a letter. You'd only have to open it." },
  { id: "first-moment", title: "Our First Moment", text: "Added a moment to Our Story.", hint: "Every story needs a first page. Our Story is waiting." },
  { id: "pet-family", title: "New Family", text: "Adopted a pet with your partner.", hint: "Our Pet (Programs > Us) has four little ones waiting for a home." },
  { id: "pet-well-fed", title: "Well Fed", text: "Kept your pet fed 7 days in a row.", hint: "A pet that eats every day for a week is a happy pet." },
  { id: "pet-bff", title: "Best Friends Forever", text: "Maxed out your pet's bond.", hint: "Look after your pet together, day after day, until the bond can't grow any more." },
  { id: "pickleball-win", title: "Dink Responsibly", text: "Won a game of Pickleball 98.", hint: "Pickleball 98 (in Games): win a game to 11. Stay out of the kitchen!" },
  { id: "pickleball-pro", title: "Pickleball Pro", text: "Beat the Pro opponents in Pickleball 98.", hint: "Set Pickleball 98 to Pro (or Legend) and win a game." },
  { id: "pickleball-online", title: "Net Gain", text: "Won an online match of Pickleball 98.", hint: "Pickleball 98: Play Online and win a match against a real person." },
  { id: "pickleball-champion", title: "Kitchen King", text: "Won the Pickleball 98 World Tour.", hint: "Pickleball 98: win all eight World Tour matches, final included." },
  { id: "shred-encore", title: "Encore!", text: "Played a song all the way through in Shred 98.", hint: "Shred 98 (in Games): finish any song without getting booed off." },
  { id: "shred-five", title: "Five-Star Show", text: "Earned five stars on a song in Shred 98.", hint: "In Shred 98, nail a song well enough for all five stars. Star power helps." },
  { id: "shred-fc", title: "Full Combo", text: "Played every note of a song in Shred 98 without a miss.", hint: "Every note, no misses, one Shred 98 song. Any difficulty." },
  { id: "shred-expert", title: "Six-String Expert", text: "Finished a song on Expert in Shred 98.", hint: "Shred 98 has an Expert difficulty. Survive a song on it." },
  { id: "appward-power", title: "Power User", text: "Opened 20 different apps in Appward 98.", hint: "Appward 98 (Programs > Business) has dozens of business apps. Open twenty of them." },
  { id: "appward-builder", title: "Builder", text: "Made your own app with Appward 98's App Creator.", hint: "Appward 98 can build a brand-new app for you. Look under Development." },
  { id: "green-thumb", title: "Green Thumb", text: "Watered your flowers on 3 different days.", hint: "Flowers from someone special need water every day." },
  { id: "wordduel-daily", title: "Word of the Day", text: "Solved the daily word in Word Duel.", hint: "Word Duel (in Games) has a new daily word every day. Solve one." },
  { id: "wordduel-two", title: "Lucky Guess", text: "Solved a Word Duel word in two guesses.", hint: "In Word Duel, get the word on your second try (or your first!)." },
  { id: "wordduel-absurd", title: "Cornered", text: "Beat Word Duel's Absurd mode.", hint: "Word Duel's Absurd mode changes the word to dodge you. Pin it down anyway." },
  { id: "hexlands-win", title: "Island Founder", text: "Won a game of Hexlands against the computer.", hint: "Hexlands (in Games): settle, trade and build your way to 10 points before the computer does." },
  { id: "hexlands-patrol", title: "On Patrol", text: "Took Largest Patrol in Hexlands.", hint: "In Hexlands, play three Ranger cards before anyone else." },
  { id: "hexlands-online", title: "Harbor Master", text: "Won an online game of Hexlands.", hint: "Play Hexlands online against at least one other person and win." },
  { id: "monsterduel-tutorial", title: "Apprentice Duelist", text: "Finished the Monster Duel tutorial.", hint: "Monster Duel (in Games) has a tutorial duel under Help. Play it to the end." },
  { id: "monsterduel-win", title: "It's Time to Duel", text: "Won a duel in Monster Duel.", hint: "Beat the computer (or anyone) in Monster Duel." },
  { id: "monsterduel-hard", title: "Champion of the Table", text: "Beat a Hard computer opponent in Monster Duel.", hint: "In Monster Duel, beat one of the Hard opponents." },
  { id: "monsterduel-online", title: "Card Shark", text: "Won an online duel in Monster Duel.", hint: "Play Monster Duel online and win a duel." },
  { id: "monsterduel-ultra", title: "Shiny!", text: "Pulled an Ultra Rare card from a Monster Duel pack.", hint: "Open card packs in Monster Duel until something sparkles." },
  { id: "wordduel-online", title: "Duelist", text: "Won an online game of Word Duel.", hint: "Play Word Duel online against someone (or a room of computer players) and win." },
  { id: "lastcard-win", title: "Empty Handed", text: "Won a game of Last Card against the computer.", hint: "Last Card (in Games): get rid of all your cards before the computer players do." },
  { id: "lastcard-crowd", title: "Full Table", text: "Beat five or more computer players at Last Card.", hint: "Play Last Card against a big table of computer players, and win." },
  { id: "lastcard-catch", title: "Gotcha!", text: "Caught someone who forgot to call Last Card.", hint: "When a Last Card player forgets to call on their last card, be quick." },
  { id: "lastcard-online", title: "Card Shark", text: "Won an online game of Last Card.", hint: "Play Last Card online with other people, and win." },
]

export const achievementById = (id) => ACHIEVEMENTS.find((a) => a.id === id) || null

const readJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback
  } catch {
    return fallback
  }
}

const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage full or blocked: remembered for this visit only
  }
}

let unlocked = null // { [id]: time unlocked }
const all = () => (unlocked ||= readJson(KEY, {}))

const listeners = new Set()
const toastListeners = new Set()

export const isUnlocked = (id) => !!all()[id]

export const unlock = (id) => {
  const a = achievementById(id)
  if (!a || isUnlocked(id)) return false
  unlocked = { ...all(), [id]: Date.now() }
  writeJson(KEY, unlocked)
  listeners.forEach((fn) => fn(unlocked))
  toastListeners.forEach((fn) => fn(a))
  playSystemSound("tada")
  return true
}

// one more distinct step toward an achievement (say, a Paint tool); unlocks at `total`
export const progress = (id, step, total) => {
  if (isUnlocked(id)) return
  const saved = readJson(PROGRESS_KEY, {})
  const steps = new Set(saved[id] || [])
  if (steps.has(step)) return
  steps.add(step)
  writeJson(PROGRESS_KEY, { ...saved, [id]: [...steps] })
  if (steps.size >= total) unlock(id)
}

// for tests and "start over"
export const resetAchievements = () => {
  unlocked = {}
  writeJson(KEY, {})
  writeJson(PROGRESS_KEY, {})
  listeners.forEach((fn) => fn(unlocked))
}

// { unlocked: { id: time }, list: ACHIEVEMENTS, count }
export const useAchievements = () => {
  const [value, setValue] = useState(all)
  useEffect(() => {
    listeners.add(setValue)
    setValue(all())
    return () => listeners.delete(setValue)
  }, [])
  return { unlocked: value, list: ACHIEVEMENTS, count: Object.keys(value).filter((id) => achievementById(id)).length }
}

// the toast listens here (one at a time)
export const onUnlock = (fn) => {
  toastListeners.add(fn)
  return () => toastListeners.delete(fn)
}
