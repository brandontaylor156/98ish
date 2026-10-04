// Contact pictures: any picture made into a small square JPEG (96 px, about 4-8 KB), so a few
// hundred contacts fit on the device and in the online copy.

export const PICTURE_SIZE = 96

export const shrinkPicture = (src, size = PICTURE_SIZE) =>
  new Promise((resolve) => {
    if (!src) return resolve("")
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas")
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext("2d")
        ctx.fillStyle = "#fff"
        ctx.fillRect(0, 0, size, size)
        // the middle square of the picture
        const side = Math.min(img.naturalWidth, img.naturalHeight)
        ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size)
        resolve(canvas.toDataURL("image/jpeg", 0.85))
      } catch {
        resolve("")
      }
    }
    img.onerror = () => resolve("")
    img.src = src
  })

export const readFile = (file, as = "text") =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    if (as === "text") reader.readAsText(file)
    else reader.readAsDataURL(file)
  })

export const isIos = () => {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1)
}

// The Contact Picker (Chrome on Android): the phone's own contact list, chosen by the person
export const contactPickerSupported = () => typeof navigator !== "undefined" && !!navigator.contacts?.select && typeof window !== "undefined" && "ContactsManager" in window

// -> [contact-like objects] (empty if they picked nobody); throws if the browser refuses
export const pickPhoneContacts = async () => {
  let picked
  try {
    picked = await navigator.contacts.select(["name", "email", "tel", "address", "icon"], { multiple: true })
  } catch (error) {
    // an older picker without addresses or pictures
    if (error?.name !== "TypeError") throw error
    picked = await navigator.contacts.select(["name", "email", "tel"], { multiple: true })
  }
  const out = []
  for (const p of picked || []) {
    const name = String(p.name?.[0] || "").trim()
    const words = name.split(/\s+/).filter(Boolean)
    const a = p.address?.[0]
    let picture = ""
    if (p.icon?.[0]) {
      try {
        picture = await shrinkPicture(await readFile(p.icon[0], "dataURL"))
      } catch {
        picture = ""
      }
    }
    out.push({
      first: words.length > 1 ? words.slice(0, -1).join(" ") : words[0] || "",
      last: words.length > 1 ? words.at(-1) : "",
      emails: (p.email || []).map((value) => ({ label: "other", value })),
      phones: (p.tel || []).map((value) => ({ label: "mobile", value })),
      address: a ? { street: (a.addressLine || []).join("\n"), city: a.city || "", region: a.region || "", postal: a.postalCode || "", country: a.country || "" } : null,
      picture,
    })
  }
  return out
}
