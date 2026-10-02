// Compatibility quizzes: each answer leans toward one category; your result is the
// category you lean to most. Take one, then send it to someone to see a combined result.
// All wording here is original.

const O = (cat, text) => ({ cat, text })

const LOVE_NOTES = {
  id: "love-notes",
  title: "Love Notes",
  blurb: "How do you most like to feel cared for? Five little languages of love.",
  color: "#ff8fb1",
  categories: {
    words: { name: "Sweet Talker", short: "Words", blurb: "Kind words land deep with you. A sincere compliment or a note in your pocket can make your whole week.", tip: "Tell them what you admire about them, out loud and in writing. Specific beats general." },
    time: { name: "Time Keeper", short: "Time", blurb: "Undivided attention is your love language. Phones down, eyes up, and you feel treasured.", tip: "Plan time together with no distractions, even just a 20-minute walk." },
    gifts: { name: "Thoughtful Gifter", short: "Gifts", blurb: "It really is the thought that counts: a small surprise that shows they were thinking of you means the world.", tip: "Little tokens that say 'I saw this and thought of you' go a long way." },
    help: { name: "Helping Hand", short: "Help", blurb: "Actions speak loudest. When someone lightens your load, you feel seen and loved.", tip: "Take a chore off their plate without being asked." },
    touch: { name: "Cuddle Bug", short: "Touch", blurb: "A hug, a hand to hold, a head on your shoulder: closeness is how you feel safe and loved.", tip: "Reach for their hand, give long hugs, sit close." },
  },
  questions: [
    { q: "It's your birthday. What would make it feel special?", options: [O("words", "A heartfelt card that says exactly what I mean to them"), O("time", "A whole day together, phones away"), O("gifts", "A present they clearly thought hard about")] },
    { q: "You've had an exhausting week. What helps most?", options: [O("help", "Coming home to find the chores already done"), O("words", "Hearing \"I'm so proud of how hard you worked\""), O("time", "An evening together doing nothing in particular")] },
    { q: "You're about to walk into a nerve-wracking interview. What do you want?", options: [O("touch", "A long hug before I go in"), O("time", "Them nearby, ready to hang out after"), O("words", "A pep talk")] },
    { q: "What would make a regular Tuesday feel lovely?", options: [O("gifts", "My favorite snack left on my desk"), O("help", "Them handling an errand I was dreading"), O("words", "A sweet text out of nowhere")] },
    { q: "Which would you most like to find when you get home?", options: [O("words", "A note on the mirror"), O("touch", "Them waiting with open arms"), O("gifts", "A small surprise, wrapped up")] },
    { q: "You're sick in bed. What feels most caring?", options: [O("help", "Soup, medicine and tissues, brought without asking"), O("touch", "Them sitting close, stroking my hair"), O("words", "Hearing that they hate seeing me sick and I'll be okay")] },
    { q: "Pick an anniversary plan:", options: [O("time", "A weekend away, just the two of us"), O("help", "They take care of every detail so I can relax"), O("gifts", "A keepsake that marks the day")] },
    { q: "A night in. What makes it perfect?", options: [O("touch", "Cuddled up under one blanket"), O("gifts", "They picked up my favorite treat on the way"), O("time", "Their full attention, no screens")] },
    { q: "It's moving day. What do you appreciate most?", options: [O("help", "They carried the heavy boxes and built the bed frame"), O("time", "They spent the whole day by my side"), O("touch", "The hug and back rub when it's all over")] },
    { q: "You're stressed about a deadline. What helps?", options: [O("gifts", "A care package with tea and snacks"), O("touch", "A shoulder rub while I work"), O("help", "They take over dinner and the dishes")] },
    { q: "Which memory would you treasure most?", options: [O("time", "That long walk where we talked for hours"), O("words", "The time they told me exactly why they love me"), O("gifts", "The little souvenir they brought back for me")] },
    { q: "They've been away for a week. What are you looking forward to?", options: [O("gifts", "The postcard or souvenir they picked out"), O("time", "A whole day together once they're back"), O("help", "They fixed that leaky faucet before they left")] },
    { q: "What would you love on a lazy Sunday?", options: [O("touch", "Staying tangled up in bed a little longer"), O("help", "They make breakfast and clean up after"), O("gifts", "Fresh flowers or pastries brought home")] },
    { q: "After a disagreement, what helps you feel close again?", options: [O("words", "A sincere \"I'm sorry, and I love you\""), O("help", "A kind gesture, like making my coffee"), O("touch", "A long hug")] },
    { q: "At a party where you don't know anyone, what helps?", options: [O("time", "Them staying by my side all night"), O("touch", "Them holding my hand"), O("words", "Them introducing me proudly")] },
  ],
}

const DATE_NIGHT = {
  id: "date-night",
  title: "Date-Night Personality",
  blurb: "Candlelit dinner or zip line at dusk? Find your date-night type.",
  color: "#ffb86b",
  categories: {
    cozy: { name: "Blanket Fort Royalty", short: "Cozy", blurb: "Soft lights, comfy clothes, a movie and a snack plate. Your best nights happen at home.", tip: "Build a blanket fort, pick a movie marathon theme, make hot cocoa." },
    adventure: { name: "Thrill Seeker", short: "Adventure", blurb: "You want a story to tell afterward: a hike, a ride, something a little wild.", tip: "Try something neither of you has done: climbing, kayaking, a night hike." },
    foodie: { name: "Tasting-Menu Dreamer", short: "Foodie", blurb: "The way to your heart is a great meal, whether it's a fancy dinner or the perfect food truck.", tip: "Take a cooking class or do a three-stop dessert crawl." },
    culture: { name: "Gallery Wanderer", short: "Culture", blurb: "Museums, live music, old bookstores: you love dates that spark a good conversation.", tip: "Catch a small concert, a play or a late night at a museum." },
    social: { name: "Party Planner", short: "Social", blurb: "The more the merrier! Double dates, game nights and karaoke with friends light you up.", tip: "Host a game night or go to trivia night with friends." },
  },
  questions: [
    { q: "It's Friday at 7 pm. You'd most like to be...", options: [O("cozy", "In pajamas with takeout"), O("foodie", "At a new restaurant everyone's talking about"), O("adventure", "On the way to a surprise destination"), O("social", "At a friend's house party"), O("culture", "In line for a concert")] },
    { q: "Pick a dessert date:", options: [O("foodie", "A fancy pastry shop"), O("cozy", "Baking cookies at home"), O("social", "An ice cream run with the whole crew"), O("culture", "Cake at a cafe after a show"), O("adventure", "S'mores at a campfire")] },
    { q: "Your ideal weekend trip:", options: [O("adventure", "A cabin near hiking trails"), O("culture", "A city with great museums"), O("cozy", "A bed and breakfast with a fireplace"), O("foodie", "A town famous for its food"), O("social", "A group house with friends")] },
    { q: "Which photo would you post after a great date?", options: [O("social", "A group selfie"), O("foodie", "The beautiful plate of food"), O("cozy", "Two mugs and a blanket"), O("adventure", "The view from the top"), O("culture", "The ticket stubs")] },
    { q: "A rainy evening. What's the plan?", options: [O("culture", "An indie movie at a little theater"), O("cozy", "Puzzles and tea"), O("foodie", "Make homemade pasta together"), O("social", "Board games with friends"), O("adventure", "Dance in the rain, then dry off")] },
    { q: "Which gift would you love most on a date?", options: [O("adventure", "Tickets for a hot-air balloon ride"), O("foodie", "A reservation somewhere special"), O("culture", "A book they think you'll love"), O("cozy", "The softest blanket ever"), O("social", "A party in your honor")] },
    { q: "What's the best part of a date for you?", options: [O("cozy", "Feeling totally relaxed"), O("adventure", "The rush of doing something new"), O("culture", "Talking about what we saw"), O("social", "Laughing with everyone"), O("foodie", "That first amazing bite")] },
    { q: "Pick a summer date:", options: [O("social", "A beach volleyball game"), O("adventure", "Cliff jumping into a lake"), O("foodie", "A farmers market and picnic"), O("cozy", "A hammock for two"), O("culture", "An outdoor concert")] },
    { q: "Which sounds most romantic?", options: [O("culture", "Slow dancing to live jazz"), O("foodie", "A candlelit dinner"), O("cozy", "Falling asleep on the couch together"), O("adventure", "Watching the sunrise after a night hike"), O("social", "A toast with friends")] },
    { q: "A date-night movie choice:", options: [O("adventure", "Big action blockbuster"), O("cozy", "A comfort rewatch"), O("culture", "A classic film"), O("social", "Whatever the group votes for"), O("foodie", "A food documentary, with snacks to match")] },
    { q: "How dressed up do you like to get?", options: [O("foodie", "Dressed up for a nice dinner"), O("cozy", "Sweatpants, obviously"), O("social", "Something fun, maybe a theme"), O("adventure", "Clothes I don't mind getting muddy"), O("culture", "Smart casual")] },
    { q: "A winter date:", options: [O("social", "Ice skating with friends"), O("culture", "A holiday market and lights"), O("adventure", "A day on the slopes"), O("foodie", "A fondue night"), O("cozy", "Fireplace and hot cocoa")] },
  ],
}

const TRAVEL = {
  id: "travel-style",
  title: "Travel Style",
  blurb: "Itinerary spreadsheets or no plans at all? Find out what kind of traveler you are.",
  color: "#7ec8ff",
  categories: {
    planner: { name: "Itinerary Ace", short: "Planner", blurb: "You've got the tickets, the backup plan and the restaurant reservations. Trips run smoothly with you.", tip: "Plan the big things, then leave one afternoon free for surprises." },
    free: { name: "Free Spirit", short: "Spontaneous", blurb: "You'd rather wander and see what happens. Some of your best memories weren't planned at all.", tip: "Pick a town on the map and just go." },
    relax: { name: "Beach Lounger", short: "Relaxing", blurb: "Vacation means resting: a good book, a pool, a nap in the sun. No alarms, please.", tip: "Book a place with a view and a hammock." },
    thrill: { name: "Trailblazer", short: "Adventure", blurb: "You travel for adrenaline: hikes, dives, zip lines and views you have to earn.", tip: "Plan a trip around one big challenge, like a summit or a dive." },
    culture: { name: "Culture Collector", short: "Culture", blurb: "History, art, local food and language: you want to really get to know a place.", tip: "Take a local cooking class or a walking tour with a guide." },
  },
  questions: [
    { q: "The first morning of a trip, you...", options: [O("planner", "Follow the schedule I made"), O("relax", "Sleep in, then breakfast by the pool"), O("thrill", "Head out early for a big hike"), O("culture", "Find a local bakery and a museum"), O("free", "Walk out the door and see where I end up")] },
    { q: "What's in your carry-on?", options: [O("culture", "A phrasebook"), O("planner", "Printed confirmations, just in case"), O("relax", "Sunscreen and a novel"), O("free", "Not much, I pack light"), O("thrill", "Hiking snacks and a water bottle")] },
    { q: "Pick a souvenir:", options: [O("thrill", "A photo from the top of a mountain"), O("culture", "Handmade crafts from a local market"), O("free", "A story nobody believes"), O("planner", "A neatly organized photo album"), O("relax", "A tan")] },
    { q: "Your flight is delayed six hours. You...", options: [O("planner", "Already have a backup plan"), O("free", "Make friends at the gate"), O("relax", "Nap. Finally."), O("culture", "Explore the airport's food from around the world"), O("thrill", "Go for a run around the terminal")] },
    { q: "Where would you stay?", options: [O("relax", "A resort with a spa"), O("free", "Wherever has a room tonight"), O("culture", "A guesthouse run by a local family"), O("thrill", "A tent under the stars"), O("planner", "The hotel with the best reviews, booked months ago")] },
    { q: "How do you find a place to eat?", options: [O("culture", "Ask a local where they eat"), O("planner", "My list of top-rated spots"), O("thrill", "Whatever's at the end of the trail"), O("relax", "Room service"), O("free", "Follow my nose")] },
    { q: "Your dream trip lasts...", options: [O("free", "As long as it feels right"), O("thrill", "As long as it takes to reach the summit"), O("planner", "Exactly ten days, all mapped out"), O("relax", "Two lazy weeks"), O("culture", "A month, so I can really live there")] },
    { q: "A free afternoon on vacation:", options: [O("thrill", "Rent a kayak"), O("relax", "Pool, drink, repeat"), O("culture", "Visit a historic site"), O("free", "Hop on a random bus"), O("planner", "Get ahead on tomorrow's plan")] },
    { q: "Pick a travel buddy trait:", options: [O("planner", "Always on time"), O("culture", "Curious about everything"), O("relax", "Happy to do nothing"), O("thrill", "Up for anything scary"), O("free", "Easygoing when plans change")] },
    { q: "Which photo would you frame?", options: [O("relax", "My toes in the sand"), O("thrill", "Us at the top of a waterfall"), O("free", "A blurry, perfect night out"), O("culture", "An ancient doorway"), O("planner", "Every landmark on the list, checked")] },
    { q: "How do you get around a new city?", options: [O("free", "Walk and get a little lost"), O("planner", "Transit pass bought in advance"), O("thrill", "Rent a bike or scooter"), O("culture", "A walking tour"), O("relax", "Taxi, please")] },
    { q: "The last night of a trip, you...", options: [O("culture", "Go back to my favorite local spot"), O("relax", "Watch one more sunset"), O("planner", "Pack neatly and set three alarms"), O("free", "Stay out until sunrise"), O("thrill", "Squeeze in one last adventure")] },
  ],
}

export const COMPAT_QUIZZES = [LOVE_NOTES, DATE_NIGHT, TRAVEL]
export const compatById = (id) => COMPAT_QUIZZES.find((q) => q.id === id) || null
