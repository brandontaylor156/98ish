// The motion-capture takes in Pickleball 98's motion-matching database (tools/build-motion.mjs).
// file: in the sources folder; ranges: [from, to] source frames (100STYLE: its Frame_Cuts.csv
// start/stop, leaving out the calibration T-poses; CMU: whole takes at 120 fps); tags: what
// the motion is for (the game searches some tags in some situations).
//
// 100STYLE (Mason, Starke, Komura 2022; CC BY 4.0; https://zenodo.org/records/8127870):
//   <Style>_<FW|BW|SW|SR|FR|BR|ID|TR1>.bvh: walk forward, backward, sideways walk, sideways run,
//   run forward, run backward, idle, transitions (starts, stops, turns, direction changes)
// CMU Graphics Lab Motion Capture Database (http://mocap.cs.cmu.edu, free for all uses):
//   102: basketball (defensive slides, pivots, drives), 127: running, stops, side steps,
//   104: starts and stops, 16: run and sudden stop, 137/141: standing and waiting

const cut = (style, kind, a, b) => ({ name: `${style}_${kind}`, file: `${style}_${kind}.bvh`, ranges: [[a, b]] })
const S = (style, cuts, tags) =>
  Object.entries(cuts).map(([k, [a, b]]) => ({ ...cut(style, k, a, b), tags: [...tags, k] }))

function cmuTakes(list, tags) {
  return list.map((t) => ({ name: "cmu" + t, file: t + ".amc", ranges: [[0, 1e9]], tags: ["cmu", ...tags] }))
}
// (portions of each take keep the database near ten minutes: ~1 MB to download)
export const TAKES = [
  // Neutral: relaxed walking, jogging, turning, standing (between points)
  // Frame_Cuts.csv: Neutral,338,5481,380,8235,357,4227,327,7445,655,1555,340,3066,354,5730,304,6775
  ...S("Neutral", { FW: [327, 2727], BW: [380, 2380], SW: [354, 2754], SR: [340, 1740], FR: [357, 2157], BR: [338, 1338], ID: [655, 1555], TR1: [304, 4704] }, ["neutral"]),
  // BentKnees: the same moves in an athletic, knees-bent posture (rallies)
  // BentKnees,414,5116,409,7712,403,4650,456,8007,623,1533,422,2538,438,5486,401,7582
  ...S("BentKnees", { FW: [456, 2456], BW: [409, 2409], SW: [438, 3438], SR: [422, 2538], FR: [403, 2403], BR: [414, 2414], ID: [623, 1533], TR1: [401, 5401] }, ["ready"]),
  // Rushed: brisk walking (Neutral's walks top out near 1.2 m/s; a player walking back into
  // place between points goes about 1.5; BigSteps was looked at: exaggerated strides)
  // Rushed,546,3059,489,3514,399,2724,343,3265,917,1413,329,1673,362,2476,428,6927
  ...S("Rushed", { FW: [343, 3265], TR1: [428, 3428] }, ["neutral"]),
  // StartStop: runs and side runs broken by sudden stops and starts (both)
  // StartStop,427,8412,431,15946,425,7131,537,17738,815,1431,557,10291,654,9873,617,14986
  ...S("StartStop", { FR: [425, 3425], SR: [557, 3557] }, ["neutral", "ready", "stop"]),
  // CMU 69: walking and turning (turn in place, turn and walk off, walk backwards / sideways
  // and turn): a player turning round to walk back to place, or toward the partner
  ...cmuTakes(["69_06", "69_09", "69_12", "69_13", "69_15", "69_17", "69_19", "69_20", "69_24", "69_28", "69_31", "69_34", "69_36", "69_39", "69_41", "69_42", "69_48", "69_51", "69_59"], ["neutral", "ready"]),
  // CMU: fast running, cutting, starts and stops (100STYLE's runs are jogs, under 2 m/s)
  ...cmuTakes(["102_01", "102_02", "102_03", "102_04", "102_05", "102_06", "102_07", "102_08", "102_10", "102_13", "102_14", "102_16", "102_17", "102_18", "102_19", "102_30", "102_31", "102_32", "102_33"], ["neutral", "ready", "fast"]),
  ...cmuTakes(["127_03", "127_04", "127_05", "127_06", "127_09", "127_10", "127_11", "127_12", "127_13", "127_14", "127_17", "127_18", "127_19", "127_20", "128_02", "128_03", "128_05", "128_07", "143_02"], ["neutral", "ready", "fast"]),
  ...cmuTakes(["104_06", "104_09", "104_53", "104_56", "16_08", "16_57", "16_35", "16_41", "16_43", "16_51", "16_53", "16_55", "09_01", "09_02", "09_03", "09_05", "35_17", "35_22"], ["neutral", "ready", "fast"]),
  // CMU 79: gestures the game plays by name for celebrations and frustration (mm/gesture.js;
  // never searched: their tag isn't in any search mask)
  ...cmuTakes(["79_69", "79_74"], ["gesture"]),
].map((t) => (t.name.endsWith("_ID") ? { ...t, tags: [...t.tags, "idle"] } : t))

// Looked at and left out for now (tools/build-motion.mjs --dump + filmstrips): 100STYLE
// WideLegs / LegsApart (exaggerated stances), Lunge, CrossOver; CMU 102 (basketball
// defensive slides: lower than a pickleball ready position), 127/104/16 (runs and stops),
// 137/141/140/69 (standing, turning in place). They stay listed in EXTRA for later rounds.
// gestures (CMU): celebrations, frustration, a high five, waves, a shrug
export const GESTURES = [
  ...cmuTakes(["79_69", "79_74", "79_94", "20_11", "21_11", "141_16", "141_21", "18_01"], ["gesture"]),
]
const cmu = (list, tags) => list.map((t) => ({ name: "cmu" + t, file: t + ".amc", ranges: [[0, 1e9]], tags: ["cmu", ...tags] }))
export const EXTRA = [
  ...cmu(["102_22", "102_23", "102_24", "102_25", "102_26", "102_27", "102_28"], ["defense"]),
  ...cmu(["102_01", "102_02", "102_03", "102_04", "102_05", "102_06", "102_07", "102_08", "102_10", "102_13", "102_14", "102_16", "102_17", "102_18", "102_19", "102_29", "102_30", "102_31", "102_32", "102_33"], ["court"]),
  ...cmu(["127_03", "127_04", "127_05", "127_06", "127_09", "127_10", "127_11", "127_12", "127_13", "127_14", "127_17", "127_18", "127_19", "127_20", "128_02", "128_03", "128_05", "128_07", "143_01", "143_02"], ["run"]),
  ...cmu(["104_06", "104_09", "104_53", "104_56", "16_08", "16_57", "16_35", "16_41", "16_43", "16_51", "16_53", "16_55", "09_01", "09_02", "09_03", "09_05", "35_17", "35_22"], ["run"]),
  ...cmu(["137_28", "141_20", "140_06", "69_16", "69_18"], ["stand"]),
]
