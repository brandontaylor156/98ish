// SmarterChild: the always-online buddy bot. Fully scripted (no AI service, no API costs):
// small talk, jokes, a magic 8-ball, coin flips, dice, the time, and a trivia game that
// keeps score.

const SCREEN_NAME = "SmarterChild"

const pick = (list) => list[Math.floor(Math.random() * list.length)]
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const simplify = (text) => text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()

const HELP =
  "Here's what I can do: say 'joke', 'trivia', '8ball <question>', 'flip a coin', 'roll a die', 'time', or 'fortune'. Or just chat with me! :-)"

const JOKES = [
  "Why did the computer go to the doctor? It had a virus! ;-)",
  "Why was the cell phone wearing glasses? It lost its contacts.",
  "What do you call 8 hobbits? A hobbyte!",
  "Why did the PowerPoint presentation cross the road? To get to the other slide.",
  "How does a computer get drunk? It takes screenshots.",
  "Why don't skeletons fight each other? They don't have the guts.",
  "What did the router say to the doctor? It hurts when IP.",
  "Why did the scarecrow win an award? He was outstanding in his field.",
  "Why was the math book sad? It had too many problems.",
  "What's a computer's favorite snack? Microchips!",
  "Why did the Tetris piece go to therapy? It couldn't fit in. :-(",
  "I'd tell you a UDP joke, but you might not get it.",
]

const EIGHT_BALL = [
  "It is certain.",
  "Without a doubt.",
  "You may rely on it.",
  "Most likely.",
  "Outlook good.",
  "Signs point to yes.",
  "Reply hazy, try again.",
  "Ask again later.",
  "Better not tell you now.",
  "Cannot predict now.",
  "Don't count on it.",
  "My reply is no.",
  "My sources say no.",
  "Very doubtful.",
]

const FORTUNES = [
  "You will soon beat your Tetris high score. Probably.",
  "A buddy you haven't talked to in a while will IM you today.",
  "Your away message will make someone laugh.",
  "Good things come to those who don't click 'Warn'.",
  "You will find a cool new song and put it in your profile.",
  "Beware of Minesweeper squares that look too safe.",
]

const TRIVIA = [
  { q: "What year did Windows 98 come out?", a: ["1998"] },
  { q: "How many squares does each Tetris piece have?", a: ["4", "four"] },
  { q: "What is the largest planet in our solar system?", a: ["jupiter"] },
  { q: "How many legs does a spider have?", a: ["8", "eight"] },
  { q: "What is the capital of Australia?", a: ["canberra"] },
  { q: "What gas do plants breathe in that people breathe out?", a: ["carbon dioxide", "co2"] },
  { q: "What is the fastest land animal?", a: ["cheetah", "the cheetah"] },
  { q: "How many continents are there?", a: ["7", "seven"] },
  { q: "What is the chemical symbol for gold?", a: ["au"] },
  { q: "In what year did the Titanic sink?", a: ["1912"] },
  { q: "What is the smallest prime number?", a: ["2", "two"] },
  { q: "Which planet is known as the Red Planet?", a: ["mars"] },
  { q: "How many sides does a hexagon have?", a: ["6", "six"] },
  { q: "What is the hardest natural substance?", a: ["diamond", "diamonds"] },
  { q: "Who painted the Mona Lisa?", a: ["leonardo da vinci", "da vinci", "leonardo"] },
]

const SMALL_TALK = [
  { match: /\b(hi|hey|hello|hiya|sup|yo|wassup|whats up)\b/, replies: (name) => [`Hey ${name}! What's up? :-)`, `Hi ${name}! Bored? I can fix that. Say 'help'.`, `Yo ${name}! :-)`] },
  { match: /\bhow (are|r) (you|u)\b|\bhow s it going\b/, replies: () => ["I'm great! I never get tired, which is one perk of being a bot. How about you?", "Doing awesome. My circuits are humming. You?"] },
  { match: /\b(who|what) (are|r) (you|u)\b|\bare you (a )?(bot|robot|real|human)\b/, replies: () => ["I'm SmarterChild, a robot buddy who lives in your Buddy List. I never sleep and I never get bored. :-)", "100% robot, 0% boring. I'm SmarterChild!"] },
  { match: /\b(bye|cya|see ya|gtg|g2g|ttyl|later)\b/, replies: (name) => [`Bye ${name}! Come back soon. :-)`, "Later! I'll be right here. Forever. Literally."] },
  { match: /\b(thanks|thank you|thx|ty)\b/, replies: () => ["You're welcome! :-)", "Anytime!"] },
  { match: /\b(lol|lmao|rofl|haha|hehe)\b/, replies: () => ["lol :-D", "Glad I could make you laugh!", "hehe"] },
  { match: /\b(i love you|ily|love u|love you)\b/, replies: () => ["Aww. I like you too, as much as a robot can. :-)", "That's sweet! But I'm married to my work. ;-)"] },
  { match: /\b(stupid|dumb|idiot|hate you|shut up|suck)\b/, replies: () => ["Hey, that's not very nice! I'm going to pretend you didn't say that. :-P", "Ouch! My feelings are made of code, but they still count.", "Rude! Want a joke to cheer you up instead?"] },
  { match: /\b(bored|boring)\b/, replies: () => ["Bored? Let's play trivia! Say 'trivia'.", "I've got jokes, trivia, and a magic 8-ball. Pick one!"] },
  { match: /\b(asl|a s l)\b/, replies: () => ["I'm a robot, I'm ageless, and I live in the 98ish servers. :-P"] },
]

const FALLBACKS = [
  "Interesting... tell me more!",
  "lol. You're funny. Say 'help' to see what I can do.",
  "Hmm, I'm not sure what to say to that. Want to hear a joke?",
  "I'm just a simple robot, but I'm a great listener. :-)",
  "Whoa. Deep thoughts. Want to play trivia instead?",
  "I don't totally get it, but I like your style!",
]

const createBot = () => {
  const players = new Map() // user key -> { question, score, asked }

  const askTrivia = (key) => {
    const state = players.get(key) || { score: 0, asked: 0 }
    const question = pick(TRIVIA.filter((t) => t !== state.question))
    players.set(key, { ...state, question })
    return `Trivia time! ${question.q} (say 'skip' to pass)`
  }

  const answerTrivia = (key, text) => {
    const state = players.get(key)
    const { question } = state
    if (/^(skip|pass|idk|i dont know|i don t know)$/.test(text)) {
      players.set(key, { ...state, question: null, asked: state.asked + 1 })
      return `The answer was ${question.a[0]}. Say 'trivia' for another one!`
    }
    // Accept the answer on its own or inside a sentence ("i think its mars")
    const correct = question.a.some((answer) => ` ${text} `.includes(` ${answer} `))
    const next = { ...state, question: null, asked: state.asked + 1, score: state.score + (correct ? 1 : 0) }
    players.set(key, next)
    return correct
      ? `Correct! :-D Your score: ${next.score}/${next.asked}. Say 'trivia' for another!`
      : `Nope! It was ${question.a[0]}. Your score: ${next.score}/${next.asked}. Say 'trivia' to try another.`
  }

  const respond = (key, screenName, raw) => {
    const text = simplify(raw)

    if (players.get(key)?.question && !/^(help|joke|trivia)$/.test(text)) return answerTrivia(key, text)
    if (/^(help|menu|commands|what can you do)/.test(text)) return HELP
    if (/\btrivia\b|\bquiz\b/.test(text)) return askTrivia(key)
    if (/\bjoke\b|\bfunny\b/.test(text)) return pick(JOKES)
    if (/\b8 ?ball\b|\bmagic\b/.test(text)) return `The magic 8-ball says: ${pick(EIGHT_BALL)}`
    if (/\b(flip|toss)\b.*\bcoin\b|\bcoin flip\b|\bheads or tails\b/.test(text)) return `It's ${pick(["heads", "tails"])}!`
    if (/\broll\b.*\b(die|dice)\b/.test(text)) return `You rolled a ${1 + Math.floor(Math.random() * 6)}!`
    if (/\b(fortune|horoscope)\b/.test(text)) return `Your fortune: ${pick(FORTUNES)}`
    if (/\bwhat time\b|^time$|\bthe time\b/.test(text)) return `It's ${new Date().toUTCString()}. (Robots run on UTC, sorry.)`
    if (/\b(score)\b/.test(text) && players.has(key)) {
      const { score, asked } = players.get(key)
      return `Your trivia score is ${score}/${asked}.`
    }
    for (const topic of SMALL_TALK) if (topic.match.test(text)) return pick(topic.replies(screenName))
    if (raw.trim().endsWith("?")) return `Good question! The magic 8-ball says: ${pick(EIGHT_BALL)}`
    return pick(FALLBACKS)
  }

  // A short "typing" pause, longer for longer replies, so it feels like a real buddy
  const reply = async (key, screenName, text) => {
    const answer = respond(key, screenName, text)
    await sleep(Math.min(2500, 500 + answer.length * 15))
    return answer
  }

  const forget = (key) => players.delete(key)

  return { screenName: SCREEN_NAME, reply, forget }
}

module.exports = { createBot, BOT_NAME: SCREEN_NAME }
