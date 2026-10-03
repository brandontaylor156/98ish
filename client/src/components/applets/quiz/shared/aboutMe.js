// "How well do you know me?" questions. `me` is asked of the person answering about
// themself, `them` of the person guessing ({name} becomes the answerer's name). Each has
// a handful of answers to pick from; whoever answers picks the one closest to the truth.

const Q = (id, cat, me, them, options) => ({ id: `am-${id}`, cat, me, them, options })

export const ABOUT_ME_CATEGORIES = {
  favorites: "Favorite things",
  food: "Food & drink",
  habits: "Little habits",
  personality: "Personality",
  dreams: "Dreams & someday",
  past: "Growing up",
  love: "Love & friendship",
  us: "The two of us",
  flirty: "Flirty",
}

export const ABOUT_ME = [
  // ---- favorite things ----
  Q("season", "favorites", "Which season feels most like you?", "Which season feels most like {name}?", ["Spring", "Summer", "Autumn", "Winter"]),
  Q("color", "favorites", "Which color would you paint your dream room?", "Which color would {name} paint their dream room?", ["Soft pink or peach", "Ocean blue or teal", "Forest green or sage", "Sunny yellow or orange", "Classic white or gray", "Deep purple or navy"]),
  Q("time", "favorites", "What's your favorite time of day?", "What's {name}'s favorite time of day?", ["Early morning", "Lazy late morning", "Golden hour", "Late at night"]),
  Q("weather", "favorites", "What's your perfect weather?", "What's {name}'s perfect weather?", ["Warm and sunny", "Cool and crisp", "Rainy and cozy", "Snowy"]),
  Q("animal", "favorites", "Which animal would you pick as a pet if anything were allowed?", "Which animal would {name} pick as a pet if anything were allowed?", ["A dog", "A cat", "Something with feathers", "Something with scales", "A fluffy farm animal"]),
  Q("music", "favorites", "What do you put on when you get to pick the music?", "What does {name} put on when they get to pick the music?", ["Pop hits", "Rock or indie", "Hip-hop or R&B", "Country or folk", "Something chill and instrumental", "Old classics"]),
  Q("movie", "favorites", "Which kind of movie do you reach for first?", "Which kind of movie does {name} reach for first?", ["A comedy", "A romance", "Action or adventure", "Horror or thriller", "Animated", "A documentary"]),
  Q("holiday", "favorites", "Which holiday do you look forward to most?", "Which holiday does {name} look forward to most?", ["My birthday", "Winter holidays", "New Year's Eve", "Halloween", "A summer holiday", "Valentine's Day"]),
  Q("place", "favorites", "Where do you feel most at peace?", "Where does {name} feel most at peace?", ["By the ocean", "In the mountains", "In a busy city", "At home on the couch", "In a garden or park"]),
  Q("flower", "favorites", "Which flower would make you smile the most?", "Which flower would make {name} smile the most?", ["Roses", "Sunflowers", "Tulips", "Daisies", "Lilies", "Flowers? Give me a plant that lives"]),
  Q("game", "favorites", "What kind of game are you most likely to suggest?", "What kind of game is {name} most likely to suggest?", ["A video game", "A board game", "A card game", "A sport outside", "A word or trivia game"]),
  Q("book", "favorites", "What would you read on a long flight?", "What would {name} read on a long flight?", ["A gripping thriller", "A love story", "Fantasy or sci-fi", "Something true: history or a memoir", "A magazine", "Nothing: I'd sleep"]),
  Q("treat", "favorites", "What's your go-to treat after a long day?", "What's {name}'s go-to treat after a long day?", ["Something sweet", "Something salty", "A warm drink", "A long bath or shower", "A nap"]),
  Q("show", "favorites", "What kind of show do you binge?", "What kind of show does {name} binge?", ["Reality TV", "A cozy sitcom", "A crime or mystery series", "A cooking or baking show", "Cartoons or anime", "Nature documentaries"]),

  // ---- food & drink ----
  Q("pizza", "food", "What's your ideal pizza topping?", "What's {name}'s ideal pizza topping?", ["Plain cheese", "Pepperoni", "Veggies galore", "Pineapple (yes, really)", "Meat lover's"]),
  Q("breakfast", "food", "What's your dream breakfast?", "What's {name}'s dream breakfast?", ["Pancakes or waffles", "Eggs and toast", "A smoothie or fruit", "Cereal", "Coffee counts as breakfast"]),
  Q("drink", "food", "What do you order at a cafe?", "What does {name} order at a cafe?", ["Plain black coffee", "Something sweet with whipped cream", "Tea", "Hot chocolate", "An iced drink, any season"]),
  Q("cuisine", "food", "Which cuisine could you eat every week?", "Which cuisine could {name} eat every week?", ["Italian", "Mexican", "Japanese", "Chinese", "Indian", "Classic burgers and fries"]),
  Q("snack", "food", "Movie night: which snack are you grabbing?", "Movie night: which snack is {name} grabbing?", ["Popcorn", "Candy", "Chips", "Chocolate", "Nachos"]),
  Q("dessert", "food", "Pick a dessert:", "Which dessert would {name} pick?", ["Ice cream", "Chocolate cake", "Cheesecake", "Cookies", "Fruit pie", "Anything with caramel"]),
  Q("spicy", "food", "How spicy do you like your food?", "How spicy does {name} like their food?", ["Not at all", "A little kick", "Pretty hot", "Bring the fire"]),
  Q("cook", "food", "What's your relationship with cooking?", "What's {name}'s relationship with cooking?", ["I love it and I'm good at it", "I love it, the results vary", "I can make a few things", "I'm a pro at ordering in"]),
  Q("lastmeal", "food", "If you could only eat one comfort food forever, it would be...", "If {name} could only eat one comfort food forever, it would be...", ["Pasta", "Pizza", "Tacos", "Soup", "Fried chicken", "Rice bowls"]),
  Q("fruit", "food", "Which fruit do you like best?", "Which fruit does {name} like best?", ["Strawberries", "Mango", "Watermelon", "Apples", "Grapes", "Bananas"]),
  Q("veggie", "food", "Which vegetable do you secretly dislike?", "Which vegetable does {name} secretly dislike?", ["Brussels sprouts", "Mushrooms", "Olives", "Celery", "Eggplant", "I like them all"]),

  // ---- little habits ----
  Q("morning", "habits", "How do your mornings usually go?", "How do {name}'s mornings usually go?", ["Up early, ready to go", "Snooze button, three times", "Slow and quiet with a drink", "Rushing out the door"]),
  Q("sleep", "habits", "How do you sleep?", "How does {name} sleep?", ["Curled up on my side", "Flat on my back", "Face down", "Starfish, taking all the room", "Every position in one night"]),
  Q("phone", "habits", "What's the first thing you check on your phone in the morning?", "What's the first thing {name} checks on their phone in the morning?", ["Messages", "Social media", "The weather", "News", "Email", "I don't check it right away"]),
  Q("texter", "habits", "What kind of texter are you?", "What kind of texter is {name}?", ["Instant replies", "Replies in my head, forgets to send", "Long paragraphs", "Voice notes", "Emoji and stickers"]),
  Q("messy", "habits", "How tidy is your space right now?", "How tidy is {name}'s space right now?", ["Spotless", "Organized chaos", "There's a chair of clothes", "Don't ask"]),
  Q("lateness", "habits", "When you're meeting someone, you are...", "When {name} is meeting someone, they are...", ["Early", "Right on time", "Five minutes late", "Fashionably very late"]),
  Q("shower", "habits", "What do you do in the shower?", "What does {name} do in the shower?", ["Sing", "Think deep thoughts", "Plan the day", "Get in and out fast"]),
  Q("weekend", "habits", "How do you spend a free Saturday?", "How does {name} spend a free Saturday?", ["Out and about with friends", "Resting at home", "Running errands", "On a hobby or project", "Outdoors"]),
  Q("shopping", "habits", "What kind of shopper are you?", "What kind of shopper is {name}?", ["In and out with a list", "Browses for hours", "Online only", "Bargain hunter", "Impulse buyer"]),
  Q("photos", "habits", "How many photos are on your phone?", "How many photos are on {name}'s phone?", ["Under 500", "A few thousand", "Over 10,000", "Phone storage is full, send help"]),
  Q("stress", "habits", "What do you do when you're stressed?", "What does {name} do when they're stressed?", ["Talk it out", "Go quiet and think", "Exercise or go for a walk", "Clean everything", "Eat snacks", "Sleep it off"]),
  Q("bed", "habits", "What time do you actually fall asleep?", "What time does {name} actually fall asleep?", ["Before 10 pm", "10 to midnight", "Midnight to 2 am", "After 2 am"]),

  // ---- personality ----
  Q("party", "personality", "At a party, where are you?", "At a party, where is {name}?", ["In the middle of the dance floor", "In a deep talk in the kitchen", "Petting the host's pet", "Already planning to leave", "Helping the host"]),
  Q("introvert", "personality", "After a big social day, you feel...", "After a big social day, {name} feels...", ["Energized", "Happy but tired", "Totally drained", "Depends on the people"]),
  Q("decide", "personality", "How do you make big decisions?", "How does {name} make big decisions?", ["Gut feeling", "Pros and cons list", "Ask everyone I know", "Put it off as long as possible"]),
  Q("superpower", "personality", "Which superpower would you choose?", "Which superpower would {name} choose?", ["Flying", "Invisibility", "Teleporting", "Reading minds", "Stopping time", "Talking to animals"]),
  Q("argue", "personality", "In a disagreement, you usually...", "In a disagreement, {name} usually...", ["Talk it through right away", "Need some time to cool off", "Crack a joke to break the tension", "Avoid it if I can"]),
  Q("cry", "personality", "What's most likely to make you tear up?", "What's most likely to make {name} tear up?", ["A sad movie", "A sweet message", "Animal videos", "A song", "Almost nothing makes me cry"]),
  Q("laugh", "personality", "What makes you laugh the hardest?", "What makes {name} laugh the hardest?", ["Silly puns", "Clever, dry humor", "People falling over", "Inside jokes", "Funny animal videos"]),
  Q("compliment", "personality", "Which compliment would mean the most to you?", "Which compliment would mean the most to {name}?", ["You're so kind", "You're so smart", "You look amazing", "You're so funny", "You're so thoughtful"]),
  Q("fear", "personality", "What scares you most?", "What scares {name} most?", ["Spiders or bugs", "Heights", "Deep water", "The dark", "Public speaking", "Being forgotten"]),
  Q("risk", "personality", "How do you feel about trying new things?", "How does {name} feel about trying new things?", ["Yes to everything!", "Curious but careful", "Only if a friend goes first", "I like what I like"]),
  Q("hero", "personality", "In a group project, you are the...", "In a group project, {name} is the...", ["Leader", "Idea person", "Quiet hard worker", "Peacemaker", "Last-minute hero"]),
  Q("organize", "personality", "How do you plan a trip?", "How does {name} plan a trip?", ["A detailed schedule", "A rough list of ideas", "Book the flight, figure out the rest", "Let someone else plan it"]),
  Q("mood", "personality", "When you're in a bad mood, what helps most?", "When {name} is in a bad mood, what helps most?", ["A hug", "Being left alone for a bit", "Food", "Getting distracted with something fun", "Talking about it"]),

  // ---- dreams & someday ----
  Q("trip", "dreams", "Where would you go on a dream trip?", "Where would {name} go on a dream trip?", ["A tropical beach", "A big European city", "Snowy mountains", "A safari", "Japan", "A road trip with no plan"]),
  Q("money", "dreams", "If you won a lot of money, what would you do first?", "If {name} won a lot of money, what would they do first?", ["Buy a house", "Travel the world", "Pay off everything", "Give to family and friends", "Quit work and start something new"]),
  Q("house", "dreams", "Where would your dream home be?", "Where would {name}'s dream home be?", ["A cottage in the countryside", "A beach house", "A city apartment with a view", "A cabin in the woods", "Close to family, anywhere"]),
  Q("skill", "dreams", "Which skill would you love to learn?", "Which skill would {name} love to learn?", ["A new language", "An instrument", "Cooking like a chef", "Dancing", "Drawing or painting", "Coding"]),
  Q("job", "dreams", "If money didn't matter, what job would you do?", "If money didn't matter, what job would {name} do?", ["Something creative", "Helping people or animals", "Traveling for a living", "Running a little shop or cafe", "Doing nothing, gloriously"]),
  Q("era", "dreams", "Which decade would you visit with a time machine?", "Which decade would {name} visit with a time machine?", ["The 1920s", "The 1960s", "The 1980s", "The 1990s", "100 years in the future"]),
  Q("famous", "dreams", "What would you most like to be known for?", "What would {name} most like to be known for?", ["Being kind", "Being brilliant at my work", "Making people laugh", "Making something beautiful", "Adventures"]),
  Q("retire", "dreams", "Picture yourself at 80. You're probably...", "Picture {name} at 80. They're probably...", ["Gardening", "Traveling", "Spoiling grandkids", "Still working on projects", "Telling the same stories"]),

  Q("bucket", "dreams", "What's at the top of your bucket list?", "What's at the top of {name}'s bucket list?", ["See the northern lights", "Skydive", "Live abroad", "Run a marathon", "Write a book", "Meet a hero"]),
  Q("dreampet", "dreams", "Which dream pet are you getting someday?", "Which dream pet is {name} getting someday?", ["A big fluffy dog", "A tiny dog", "A lazy cat", "A whole farm", "A parrot that talks back"]),
  Q("getaway", "dreams", "Your dream weekend getaway is...", "{name}'s dream weekend getaway is...", ["A spa", "A cabin with no wifi", "A food tour", "A music festival", "A theme park"]),
  Q("cafe", "dreams", "What would you name a little cafe of your own?", "What kind of name would {name} give a little cafe of their own?", ["Something punny", "Something cozy and sweet", "Named after a pet", "Something fancy-sounding", "Our names together"]),

  // ---- growing up ----
  Q("kid", "past", "What were you like as a kid?", "What was {name} like as a kid?", ["Loud and full of energy", "Shy and quiet", "Always reading or drawing", "Always outside", "The class clown"]),
  Q("school", "past", "What was your favorite subject in school?", "What was {name}'s favorite subject in school?", ["Math", "Science", "English or writing", "Art or music", "Gym", "Lunch"]),
  Q("dreamjob", "past", "What did you want to be when you grew up?", "What did {name} want to be when they grew up?", ["Doctor or vet", "Teacher", "Astronaut", "Artist or musician", "Athlete", "Something totally different"]),
  Q("toy", "past", "What kind of toy did you love most?", "What kind of toy did {name} love most?", ["Stuffed animals", "Building blocks", "Video games", "Dolls or action figures", "Anything outside: bikes, balls"]),
  Q("trouble", "past", "How much trouble did you get into as a kid?", "How much trouble did {name} get into as a kid?", ["Angel, never", "A normal amount", "More than I'll admit", "I was the trouble"]),
  Q("cartoon", "past", "Which kind of Saturday-morning cartoon was your favorite?", "Which kind of Saturday-morning cartoon was {name}'s favorite?", ["Superheroes", "Talking animals", "Magic and wizards", "Slapstick chaos", "I was outside instead"]),
  Q("afterschool", "past", "What was your go-to after-school snack?", "What was {name}'s go-to after-school snack?", ["Cereal", "Chips", "Fruit", "Cookies", "Whatever was left over", "Instant noodles"]),
  Q("summers", "past", "What did your summers look like growing up?", "What did {name}'s summers look like growing up?", ["Camp", "Family road trips", "At the pool or beach", "Indoors with games and books", "Working a summer job"]),
  Q("firstcrush", "past", "Your first crush was most likely...", "{name}'s first crush was most likely...", ["A classmate", "A celebrity", "A cartoon character", "An older kid", "Top secret"]),
  Q("walls", "past", "What covered your childhood bedroom walls?", "What covered {name}'s childhood bedroom walls?", ["Band posters", "Movie posters", "My own drawings", "Sports stuff", "Nothing, very tidy", "Glow-in-the-dark stars"]),
  Q("sibling", "past", "In your family, you are the...", "In {name}'s family, they are the...", ["Oldest", "Middle", "Youngest", "Only child", "It's complicated"]),

  // ---- love & friendship ----
  Q("date", "love", "What's your idea of a perfect date?", "What's {name}'s idea of a perfect date?", ["A fancy dinner", "A cozy night in", "An adventure outside", "A concert or show", "Wandering a new place together"]),
  Q("affection", "love", "How do you most like to be shown you're cared for?", "How does {name} most like to be shown they're cared for?", ["Sweet words", "Time together", "Little gifts", "Help with things", "Hugs and closeness"]),
  Q("gift", "love", "Which gift would make you happiest?", "Which gift would make {name} happiest?", ["Something handmade", "A planned experience", "Something I mentioned once", "Flowers", "Something practical I need"]),
  Q("friend", "love", "What kind of friend are you?", "What kind of friend is {name}?", ["The planner", "The listener", "The funny one", "The one who shows up with snacks", "The honest one"]),
  Q("pda", "love", "How do you feel about holding hands in public?", "How does {name} feel about holding hands in public?", ["Love it", "Sometimes", "Prefer to keep it private", "Depends on the place"]),
  Q("anniversary", "love", "How should a special day be celebrated?", "How should a special day be celebrated, according to {name}?", ["A big surprise", "A trip away", "A quiet day together", "A party with everyone", "Low-key, no fuss"]),
  Q("song", "love", "What kind of song would you dedicate to someone you love?", "What kind of song would {name} dedicate to someone they love?", ["A slow love ballad", "Something upbeat to dance to", "A silly song that's 'ours'", "Something old-fashioned", "I'd write my own"]),
  Q("sorry", "love", "How do you say sorry?", "How does {name} say sorry?", ["With words, right away", "With a hug", "With a little gift or treat", "By doing something helpful", "Eventually..."]),
  Q("cheer", "love", "When someone you love is sad, you...", "When someone they love is sad, {name}...", ["Make them laugh", "Listen", "Bring them food", "Plan something fun", "Give them space"]),
  Q("fight", "love", "What is most likely to start a silly squabble with you?", "What is most likely to start a silly squabble with {name}?", ["What to eat", "The thermostat", "Being late", "Chores", "Who's hogging the blanket"]),
  Q("lovestory", "love", "Which love story would you most like to live in?", "Which love story would {name} most like to live in?", ["A sweeping old romance", "A rom-com with a happy mess", "A slow-burn friends-to-lovers", "A fairy tale", "A grand adventure for two"]),
  Q("support", "love", "On a really hard day, what do you need from your person?", "On a really hard day, what does {name} need from their person?", ["A long hug", "Someone to listen", "A distraction", "Their favorite food delivered", "Quiet company"]),
  Q("text", "love", "Which text would make your whole day?", "Which text would make {name}'s whole day?", ["\"I miss you\"", "\"I'm proud of you\"", "\"Dinner's on me tonight\"", "A silly photo", "\"Thinking of you\""]),

  // ---- the two of us ----
  Q("firstlook", "us", "What did you notice first about your sweetheart?", "What did {name} notice first about their sweetheart?", ["Their smile", "Their eyes", "Their laugh", "Their style", "How kind they were", "How funny they were"]),
  Q("knewit", "us", "When did you know you really liked them?", "When did {name} know they really liked their sweetheart?", ["Right away", "After the first long talk", "On a specific date", "When I missed them", "It crept up on me"]),
  Q("lazydinner", "us", "What should the two of you eat on a lazy night?", "What should the two of them eat on a lazy night, according to {name}?", ["Pizza", "Takeout noodles", "Something we cook together", "Breakfast for dinner", "Snacks, only snacks"]),
  Q("nexttrip", "us", "Where should your next trip together be?", "Where should {name}'s next trip with their sweetheart be?", ["A beach", "A big city", "A cabin somewhere quiet", "Somewhere neither of us has been", "A road trip"]),
  Q("binge", "us", "What should the two of you binge-watch next?", "What would {name} pick for the two of them to binge next?", ["A comedy", "A crime mystery", "A reality show", "Something animated", "A documentary series", "A rewatch of an old favorite"]),
  Q("chores", "us", "Which chore would you happily take forever?", "Which chore would {name} happily take forever?", ["Cooking", "Dishes", "Laundry", "Grocery runs", "Taking out the trash", "None, sorry"]),
  Q("genre", "us", "If your love story were a movie, what genre would it be?", "If {name}'s love story were a movie, what genre would it be?", ["Romantic comedy", "Adventure", "Sitcom", "Indie drama", "Musical", "Cartoon"]),
  Q("bestday", "us", "What's your favorite kind of day together?", "What's {name}'s favorite kind of day together?", ["Out exploring", "Staying in all day", "Seeing friends together", "Doing a project side by side", "Eating our way around town"]),
  Q("nickname", "us", "What kind of pet name do you like best?", "What kind of pet name does {name} like best?", ["Something sweet, like honey", "Something silly", "Just my name", "An inside joke", "Something only we understand"]),
  Q("oldgray", "us", "Picture the two of you old and gray. You're...", "Picture {name} and their sweetheart old and gray. They're...", ["Dancing in the kitchen", "Traveling everywhere", "Bickering lovingly", "Surrounded by family", "Gardening side by side"]),
  Q("missmost", "us", "When you're apart, what do you miss most?", "When they're apart, what does {name} miss most?", ["The cuddles", "The talks", "The laughs", "The everyday little things", "Their cooking"]),
  Q("planner", "us", "Who's the planner in your relationship?", "Who's the planner in the relationship, according to {name}?", ["Me, obviously", "Them, obviously", "We take turns", "Neither of us, chaos reigns"]),

  // ---- flirty ----
  Q("kissspot", "flirty", "Where's the best place for a surprise kiss?", "Where's the best place for a surprise kiss, according to {name}?", ["On the forehead", "On the cheek", "On the hand", "Right on the lips", "On the neck"]),
  Q("outfit", "flirty", "Which look on your sweetheart makes you weak in the knees?", "Which look on their sweetheart makes {name} weak in the knees?", ["All dressed up", "Cozy sweatpants", "Fresh out of the shower", "Sporty", "Wearing my clothes"]),
  Q("flirtstyle", "flirty", "What's your flirting style?", "What's {name}'s flirting style?", ["Teasing jokes", "Long eye contact", "Sweet compliments", "Little touches", "Oblivious, honestly"]),
  Q("setting", "flirty", "What's the most romantic setting?", "What's the most romantic setting, according to {name}?", ["Candlelit dinner", "Under the stars", "Dancing in the rain", "A fireplace and a blanket", "A rooftop at sunset"]),
  Q("cuddle", "flirty", "What's your favorite way to cuddle?", "What's {name}'s favorite way to cuddle?", ["Big spoon", "Little spoon", "Head on a chest", "Tangled legs on the couch", "Holding hands is enough"]),
  Q("askout", "flirty", "How do you want to be asked out on a date?", "How does {name} want to be asked out on a date?", ["A handwritten note", "A surprise plan", "A cheesy pickup line", "Simply and directly", "A playlist that says it all"]),
  Q("slowdance", "flirty", "A slow dance in the kitchen. Are you in?", "A slow dance in the kitchen. Is {name} in?", ["Yes, anytime", "Only with music on", "Only if nobody's watching", "After a glass of something", "Only if I lead!"]),
  Q("blush", "flirty", "What makes you blush fastest?", "What makes {name} blush fastest?", ["A compliment out of nowhere", "Being stared at", "A wink", "A flirty text at work", "Hearing 'I love you'"]),
  Q("goodnight", "flirty", "What's the perfect goodnight?", "What's the perfect goodnight, according to {name}?", ["A long kiss", "A sweet text", "Falling asleep on a call", "A back rub", "A cheesy 'sweet dreams'"]),
  Q("cutest", "flirty", "Which of your own features do you think is cutest?", "Which of their own features does {name} think is cutest?", ["My smile", "My eyes", "My laugh", "My hands", "My hair", "All of it"]),
  Q("hidenote", "flirty", "Where would you hide a love note for them?", "Where would {name} hide a love note for their sweetheart?", ["In a coat pocket", "On the bathroom mirror", "In their lunch", "Under their pillow", "In a book they're reading"]),
  Q("pickupline", "flirty", "Would a cheesy pickup line work on you?", "Would a cheesy pickup line work on {name}?", ["Every single time", "If it's really cheesy", "Only from them", "Never, I'm immune", "I'd fire one right back"]),
  Q("spoil", "flirty", "What's the best way to spoil you?", "What's the best way to spoil {name}?", ["Breakfast in bed", "A massage", "A surprise trip", "A shopping spree", "Doing all the chores for a day"]),
  Q("jealous", "flirty", "Be honest: how jealous do you get?", "Be honest: how jealous does {name} get?", ["Not at all", "A tiny bit, it's cute", "More than I'd admit", "Only of their phone"]),
  Q("scent", "flirty", "Which scent on your sweetheart is the best?", "Which scent on their sweetheart does {name} love most?", ["Their perfume or cologne", "Fresh laundry", "Their shampoo", "Just them", "Coffee and cookies"]),
  Q("framed", "flirty", "Which photo of the two of you would you frame?", "Which photo of the two of them would {name} frame?", ["A goofy selfie", "A dressed-up one", "A candid one, mid-laugh", "A travel photo", "A sleepy morning one"]),
  Q("oursong", "flirty", "What's the vibe of your song as a couple?", "What's the vibe of their song as a couple, according to {name}?", ["Slow and dreamy", "Loud and happy", "Old and classic", "A silly inside joke", "We don't have one yet"]),
  Q("firstmove", "flirty", "Who made the first move?", "Who made the first move, according to {name}?", ["I did", "They did", "It was mutual", "Our friends did", "Still arguing about it"]),
]

export const aboutMeById = (id) => ABOUT_ME.find((q) => q.id === id) || null
