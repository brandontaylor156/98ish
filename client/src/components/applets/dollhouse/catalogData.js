// Dream House's catalog: every piece of furniture and decor, its size in house units, how
// it hangs (floor, wall, ceiling, or "free": small things that sit on a table or shelf),
// and a few flags. No drawing here (that's art.js) so the server can check houses too.
//   top: the height of its tabletop / shelf (free things can sit on it)
//   low: rugs and blankets: placed behind everything else
//   glow: it lights up at night ([x, y] as fractions of its box, radius, color)
//   pet: it wanders around its room ("walk") or hops ("hop")

export const CATEGORIES = [
  { id: "furniture", label: "Furniture", icon: "🛋" },
  { id: "kitchen", label: "Kitchen", icon: "🍰" },
  { id: "bath", label: "Bath", icon: "🛁" },
  { id: "decor", label: "Decor", icon: "🖼" },
  { id: "lights", label: "Lights", icon: "💡" },
  { id: "plants", label: "Plants", icon: "🌿" },
  { id: "fun", label: "Fun", icon: "🎵" },
  { id: "pets", label: "Pets", icon: "🐱" },
  { id: "garden", label: "Garden", icon: "🌳" },
  { id: "people", label: "People", icon: "🙂" },
]

const warm = "#ffd27a"
const pink = "#ff9ccc"

// [id, name, category, width, height, mount, extras]
const LIST = [
  // furniture
  ["bed", "Heart Bed", "furniture", 150, 84, "floor", { top: 40 }],
  ["bed_single", "Cozy Bed", "furniture", 112, 76, "floor", { top: 36 }],
  ["sofa", "Pink Sofa", "furniture", 150, 70, "floor", { top: 34 }],
  ["sofa_sage", "Sage Sofa", "furniture", 140, 66, "floor", { top: 32 }],
  ["armchair", "Armchair", "furniture", 66, 66, "floor", { top: 30 }],
  ["beanbag", "Beanbag", "furniture", 60, 40, "floor"],
  ["coffee_table", "Coffee Table", "furniture", 90, 34, "floor", { top: 32 }],
  ["dining_table", "Dining Table", "furniture", 120, 56, "floor", { top: 54 }],
  ["chair", "Chair", "furniture", 36, 70, "floor"],
  ["stool", "Stool", "furniture", 30, 40, "floor", { top: 38 }],
  ["desk", "Desk", "furniture", 110, 62, "floor", { top: 60 }],
  ["nightstand", "Nightstand", "furniture", 44, 46, "floor", { top: 44 }],
  ["dresser", "Dresser", "furniture", 90, 68, "floor", { top: 66 }],
  ["wardrobe", "Wardrobe", "furniture", 80, 150, "floor", { top: 148 }],
  ["bookshelf", "Bookshelf", "furniture", 70, 140, "floor", { top: 138 }],
  ["vanity", "Vanity", "furniture", 80, 112, "floor"],
  ["side_table", "Side Table", "furniture", 40, 50, "floor", { top: 48 }],
  ["pouf", "Pouf", "furniture", 40, 28, "floor", { top: 26 }],
  ["wall_shelf", "Wall Shelf", "furniture", 84, 12, "wall", { top: 10 }],
  // kitchen
  ["fridge", "Fridge", "kitchen", 60, 130, "floor", { top: 128 }],
  ["stove", "Stove", "kitchen", 64, 74, "floor", { top: 60 }],
  ["counter_sink", "Sink Counter", "kitchen", 90, 72, "floor", { top: 60 }],
  ["counter", "Counter", "kitchen", 80, 60, "floor", { top: 60 }],
  ["wall_cabinet", "Wall Cabinet", "kitchen", 90, 44, "wall"],
  ["pans", "Hanging Pans", "kitchen", 80, 46, "wall"],
  ["microwave", "Microwave", "kitchen", 46, 28, "free", { top: 28 }],
  ["kettle", "Kettle", "kitchen", 26, 26, "free"],
  ["toaster", "Toaster", "kitchen", 30, 22, "free"],
  ["coffee_maker", "Coffee Maker", "kitchen", 28, 36, "free"],
  ["teapot", "Teapot", "kitchen", 34, 24, "free"],
  ["fruit_bowl", "Fruit Bowl", "kitchen", 38, 20, "free"],
  ["cake", "Strawberry Cake", "kitchen", 36, 34, "free"],
  ["herbs", "Herb Pots", "kitchen", 42, 26, "free"],
  // bath
  ["bathtub", "Bathtub", "bath", 140, 72, "floor", { top: 44 }],
  ["toilet", "Toilet", "bath", 44, 64, "floor"],
  ["bath_sink", "Basin", "bath", 50, 80, "floor", { top: 56 }],
  ["mirror", "Mirror", "bath", 46, 60, "wall"],
  ["towels", "Towel Rack", "bath", 52, 50, "wall"],
  ["duck", "Rubber Duck", "bath", 20, 18, "free"],
  ["bath_mat", "Bath Mat", "bath", 70, 10, "floor", { low: true }],
  ["laundry", "Laundry Basket", "bath", 40, 40, "floor"],
  ["soaps", "Soap & Bottles", "bath", 34, 24, "free"],
  // decor
  ["rug_round", "Round Rug", "decor", 120, 18, "floor", { low: true }],
  ["rug_heart", "Heart Rug", "decor", 100, 22, "floor", { low: true }],
  ["rug_stripe", "Striped Rug", "decor", 130, 18, "floor", { low: true }],
  ["poster_heart", "Heart Poster", "decor", 50, 64, "wall"],
  ["poster_cat", "Cat Poster", "decor", 50, 64, "wall"],
  ["poster_rainbow", "Rainbow Poster", "decor", 50, 64, "wall"],
  ["photo_frame", "Photo of Us", "decor", 44, 40, "wall"],
  ["painting", "Painting", "decor", 80, 56, "wall"],
  ["clock", "Clock", "decor", 40, 40, "wall"],
  ["window_round", "Round Window", "decor", 60, 60, "wall"],
  ["window", "Window", "decor", 70, 90, "wall"],
  ["curtains", "Curtained Window", "decor", 104, 112, "wall"],
  ["garland", "Heart Garland", "decor", 140, 30, "wall"],
  ["balloons", "Balloons", "decor", 50, 110, "free"],
  ["home_sign", "Home Sign", "decor", 74, 40, "wall"],
  ["teddy", "Teddy Bear", "decor", 34, 36, "free"],
  ["cushion", "Heart Cushion", "decor", 30, 24, "free"],
  // lights
  ["floor_lamp", "Floor Lamp", "lights", 40, 130, "floor", { glow: [0.5, 0.12, 150, warm] }],
  ["table_lamp", "Table Lamp", "lights", 30, 42, "free", { glow: [0.5, 0.25, 100, warm] }],
  ["pendant", "Pendant Light", "lights", 40, 64, "ceiling", { glow: [0.5, 0.85, 170, warm] }],
  ["fairy_lights", "Fairy Lights", "lights", 160, 30, "wall", { glow: [0.5, 0.5, 120, "#ffe7a8"] }],
  ["lava_lamp", "Lava Lamp", "lights", 18, 42, "free", { glow: [0.5, 0.5, 70, pink] }],
  ["neon_heart", "Neon Heart", "lights", 56, 50, "wall", { glow: [0.5, 0.5, 110, "#ff5fa8"] }],
  ["candles", "Candles", "lights", 34, 26, "free", { glow: [0.5, 0.2, 70, "#ffc067"] }],
  ["star_mobile", "Star Mobile", "lights", 60, 72, "ceiling", { glow: [0.5, 0.7, 80, "#fff2a8"] }],
  ["lantern", "Lantern", "lights", 22, 36, "free", { glow: [0.5, 0.6, 80, warm] }],
  // plants
  ["monstera", "Monstera", "plants", 60, 92, "floor"],
  ["cactus", "Cactus", "plants", 24, 40, "free"],
  ["succulent", "Succulent", "plants", 26, 20, "free"],
  ["hanging_plant", "Hanging Plant", "plants", 50, 80, "ceiling"],
  ["tulips", "Tulips", "plants", 26, 44, "free"],
  ["sunflower", "Sunflower", "plants", 40, 110, "floor"],
  ["fern", "Fern", "plants", 62, 70, "floor"],
  ["bonsai", "Bonsai", "plants", 40, 36, "free"],
  ["roses", "Roses", "plants", 26, 40, "free"],
  // fun
  ["tv", "TV", "fun", 70, 56, "free", { glow: [0.5, 0.45, 90, "#9fd8ff"] }],
  ["record_player", "Record Player", "fun", 50, 30, "free"],
  ["computer", "98ish PC", "fun", 52, 50, "free", { glow: [0.5, 0.4, 70, "#8fe8e0"] }],
  ["arcade", "Arcade Cabinet", "fun", 52, 120, "floor", { glow: [0.5, 0.3, 90, "#c79bff"] }],
  ["guitar", "Guitar", "fun", 34, 90, "floor"],
  ["piano", "Piano", "fun", 120, 96, "floor", { top: 94 }],
  ["speaker", "Speaker", "fun", 24, 40, "free"],
  ["books", "Book Stack", "fun", 34, 30, "free", { top: 30 }],
  ["globe", "Globe", "fun", 30, 40, "free"],
  ["easel", "Easel", "fun", 62, 110, "floor"],
  ["telescope", "Telescope", "fun", 52, 90, "floor"],
  ["radio", "Radio", "fun", 40, 28, "free"],
  ["yarn", "Yarn Basket", "fun", 36, 26, "free"],
  // pets
  ["cat", "Gray Cat", "pets", 46, 36, "floor", { pet: "walk" }],
  ["cat_ginger", "Ginger Cat", "pets", 46, 36, "floor", { pet: "walk" }],
  ["dog", "Puppy", "pets", 56, 44, "floor", { pet: "walk" }],
  ["bunny", "Bunny", "pets", 30, 32, "floor", { pet: "hop" }],
  ["fishbowl", "Fishbowl", "pets", 36, 34, "free"],
  ["bird_cage", "Bird Cage", "pets", 40, 74, "ceiling"],
  ["cat_tree", "Cat Tree", "pets", 60, 112, "floor", { top: 110 }],
  ["pet_bed", "Pet Bed", "pets", 62, 24, "floor", { low: true }],
  ["food_bowls", "Food Bowls", "pets", 44, 14, "floor"],
  // garden
  ["tree", "Apple Tree", "garden", 130, 200, "floor"],
  ["bush", "Bush", "garden", 70, 46, "floor"],
  ["flower_bed", "Flower Bed", "garden", 100, 40, "floor"],
  ["bench", "Bench", "garden", 100, 52, "floor", { top: 30 }],
  ["swing", "Swing", "garden", 92, 124, "floor"],
  ["fountain", "Fountain", "garden", 80, 72, "floor"],
  ["mailbox", "Mailbox", "garden", 32, 62, "floor"],
  ["picnic", "Picnic Blanket", "garden", 112, 18, "floor", { low: true }],
  ["umbrella_table", "Parasol Table", "garden", 92, 112, "floor"],
  ["birdhouse", "Birdhouse", "garden", 30, 100, "floor"],
  ["lamp_post", "Lamp Post", "garden", 28, 124, "floor", { glow: [0.5, 0.1, 140, warm] }],
  ["fence", "Picket Fence", "garden", 120, 46, "floor"],
  ["pond", "Pond", "garden", 112, 24, "floor", { low: true }],
  ["mushroom", "Mushroom Lamp", "garden", 40, 42, "floor", { glow: [0.5, 0.35, 70, "#ffb3c6"] }],
  // people (the look is per avatar)
  ["avatar", "Person", "people", 44, 98, "floor"],
]

export const ITEMS = LIST.map(([id, name, cat, w, h, mount, extra = {}]) => ({ id, name, cat, w, h, mount, ...extra }))
export const ITEM = Object.fromEntries(ITEMS.map((d) => [d.id, d]))
export const itemDef = (kind) => ITEM[kind] || null

// ---- people ----

export const SKINS = ["#ffe0cc", "#f6cba8", "#e2a77f", "#c68658", "#93603b", "#5f3b25"]
export const HAIR_COLORS = ["#2b2026", "#5a3825", "#8e4b2a", "#e8c071", "#f39ac2", "#b79cf0", "#c9c9d1", "#6aa5e8"]
export const HAIR_STYLES = ["short", "long", "bun", "curly", "ponytail", "bob", "buzz", "pigtails"]
export const OUTFITS = ["tee", "sweater", "dress", "hoodie", "overalls"]
export const CLOTHES = ["#ff8fb8", "#ffb27a", "#ffe17a", "#9be3b5", "#8fd0ff", "#b9a2ff", "#f5f0e8", "#4a4f6e", "#d96b6b", "#6b8f71"]
export const ACCESSORIES = ["none", "glasses", "bow", "flower", "beanie", "headphones", "freckles", "hijab"]

export const DEFAULT_LOOKS = [
  { skin: 1, hair: 1, hairStyle: "long", top: 0, bottom: 7, outfit: "dress", acc: "bow" },
  { skin: 3, hair: 0, hairStyle: "short", top: 4, bottom: 7, outfit: "hoodie", acc: "none" },
]
