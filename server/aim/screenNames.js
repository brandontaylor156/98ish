// AIM screen names: 3-16 characters, start with a letter, letters/digits/spaces only.
// Like the real service they're case- and space-insensitive: "Cool Dude 98" and
// "cooldude98" are the same account, displayed however the owner first typed it.

const SCREEN_NAME = /^[A-Za-z][A-Za-z0-9 ]{2,15}$/

const normalize = (screenName) => String(screenName || "").replace(/\s+/g, "").toLowerCase()

const validate = (screenName) => {
  const name = String(screenName || "").trim().replace(/\s+/g, " ")
  if (!SCREEN_NAME.test(name)) {
    return {
      error:
        "Screen names must be 3-16 characters, start with a letter, and contain only letters, numbers and spaces.",
    }
  }
  return { screenName: name, key: normalize(name) }
}

module.exports = { normalize, validate }
