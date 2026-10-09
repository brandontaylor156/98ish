// Unit Converter's units: each category has a base unit; a unit is { id, name, factor } (how
// many base units one of it is), or { to, from } functions for temperature. Pure, tested in
// units.test.js. Exact definitions where there are ones (inch = 2.54 cm, pound = 0.45359237 kg,
// US gallon = 231 cubic inches).

const IN = 0.0254
const FT = 12 * IN
const LB = 0.45359237
const USGAL = 231 * IN ** 3 * 1000 // liters

export const CATEGORIES = [
  {
    id: "length",
    name: "Length",
    units: [
      { id: "mm", name: "Millimeters", factor: 0.001 },
      { id: "cm", name: "Centimeters", factor: 0.01 },
      { id: "m", name: "Meters", factor: 1 },
      { id: "km", name: "Kilometers", factor: 1000 },
      { id: "in", name: "Inches", factor: IN },
      { id: "ft", name: "Feet", factor: FT },
      { id: "yd", name: "Yards", factor: 3 * FT },
      { id: "mi", name: "Miles", factor: 5280 * FT },
      { id: "nmi", name: "Nautical miles", factor: 1852 },
    ],
    from: "ft",
    to: "m",
  },
  {
    id: "weight",
    name: "Weight",
    units: [
      { id: "mg", name: "Milligrams", factor: 0.000001 },
      { id: "g", name: "Grams", factor: 0.001 },
      { id: "kg", name: "Kilograms", factor: 1 },
      { id: "t", name: "Metric tons", factor: 1000 },
      { id: "oz", name: "Ounces", factor: LB / 16 },
      { id: "lb", name: "Pounds", factor: LB },
      { id: "st", name: "Stone", factor: 14 * LB },
      { id: "ton", name: "US tons", factor: 2000 * LB },
    ],
    from: "lb",
    to: "kg",
  },
  {
    id: "temperature",
    name: "Temperature",
    units: [
      { id: "c", name: "Celsius", to: (v) => v, from: (v) => v },
      { id: "f", name: "Fahrenheit", to: (v) => ((v - 32) * 5) / 9, from: (v) => (v * 9) / 5 + 32 },
      { id: "k", name: "Kelvin", to: (v) => v - 273.15, from: (v) => v + 273.15 },
    ],
    from: "f",
    to: "c",
  },
  {
    id: "volume",
    name: "Volume",
    units: [
      { id: "ml", name: "Milliliters", factor: 0.001 },
      { id: "l", name: "Liters", factor: 1 },
      { id: "tsp", name: "Teaspoons (US)", factor: USGAL / 768 },
      { id: "tbsp", name: "Tablespoons (US)", factor: USGAL / 256 },
      { id: "floz", name: "Fluid ounces (US)", factor: USGAL / 128 },
      { id: "cup", name: "Cups (US)", factor: USGAL / 16 },
      { id: "pt", name: "Pints (US)", factor: USGAL / 8 },
      { id: "qt", name: "Quarts (US)", factor: USGAL / 4 },
      { id: "gal", name: "Gallons (US)", factor: USGAL },
      { id: "m3", name: "Cubic meters", factor: 1000 },
    ],
    from: "cup",
    to: "ml",
  },
  {
    id: "area",
    name: "Area",
    units: [
      { id: "cm2", name: "Square centimeters", factor: 0.0001 },
      { id: "m2", name: "Square meters", factor: 1 },
      { id: "ha", name: "Hectares", factor: 10000 },
      { id: "km2", name: "Square kilometers", factor: 1e6 },
      { id: "in2", name: "Square inches", factor: IN ** 2 },
      { id: "ft2", name: "Square feet", factor: FT ** 2 },
      { id: "yd2", name: "Square yards", factor: (3 * FT) ** 2 },
      { id: "ac", name: "Acres", factor: 43560 * FT ** 2 },
      { id: "mi2", name: "Square miles", factor: (5280 * FT) ** 2 },
    ],
    from: "ft2",
    to: "m2",
  },
  {
    id: "speed",
    name: "Speed",
    units: [
      { id: "mps", name: "Meters per second", factor: 1 },
      { id: "kph", name: "Kilometers per hour", factor: 1000 / 3600 },
      { id: "mph", name: "Miles per hour", factor: (5280 * FT) / 3600 },
      { id: "fps", name: "Feet per second", factor: FT },
      { id: "kn", name: "Knots", factor: 1852 / 3600 },
    ],
    from: "mph",
    to: "kph",
  },
  {
    id: "time",
    name: "Time",
    units: [
      { id: "s", name: "Seconds", factor: 1 },
      { id: "min", name: "Minutes", factor: 60 },
      { id: "h", name: "Hours", factor: 3600 },
      { id: "d", name: "Days", factor: 86400 },
      { id: "wk", name: "Weeks", factor: 604800 },
      { id: "yr", name: "Years (365.25 days)", factor: 31557600 },
    ],
    from: "h",
    to: "min",
  },
  {
    id: "data",
    name: "Data",
    units: [
      { id: "b", name: "Bytes", factor: 1 },
      { id: "kb", name: "Kilobytes (1,000)", factor: 1e3 },
      { id: "mb", name: "Megabytes (1,000,000)", factor: 1e6 },
      { id: "gb", name: "Gigabytes", factor: 1e9 },
      { id: "tb", name: "Terabytes", factor: 1e12 },
      { id: "kib", name: "Kibibytes (1,024)", factor: 1024 },
      { id: "mib", name: "Mebibytes", factor: 1024 ** 2 },
      { id: "gib", name: "Gibibytes", factor: 1024 ** 3 },
      { id: "floppy", name: "Floppy disks (1.44 MB)", factor: 1440 * 1024 },
    ],
    from: "gb",
    to: "floppy",
  },
]

export const category = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[0]
export const unit = (cat, id) => cat.units.find((u) => u.id === id) || cat.units[0]

// value in `from` -> value in `to`
export const convert = (catId, fromId, toId, value) => {
  const cat = category(catId)
  const a = unit(cat, fromId)
  const b = unit(cat, toId)
  const base = a.to ? a.to(value) : value * a.factor
  return b.from ? b.from(base) : base / b.factor
}

// a number for people: up to 10 significant digits, no float noise, thousands commas
export const pretty = (n) => {
  if (!Number.isFinite(n)) return ""
  if (n !== 0 && (Math.abs(n) >= 1e15 || Math.abs(n) < 1e-6)) return n.toExponential(6).replace(/\.?0+e/, "e")
  const rounded = Number(n.toPrecision(10))
  return rounded.toLocaleString("en-US", { maximumFractionDigits: 10 })
}

// "1,234.5" / "-3" / "2.5e3" -> number | null
export const parseNumber = (text) => {
  const t = String(text ?? "").replace(/,/g, "").trim()
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null
  return Number(t)
}
