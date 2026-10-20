/**
 * scripts/qc-interior.cjs — generates QC spec props for interior world.
 * Render stills with:
 *   npx remotion still out/fresh-bundle WhatIfVideo --props=out/qc/interior-noon.props.json --frame=240 --output=out/qc/stills/interior-noon.png
 */
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "out", "qc");
fs.mkdirSync(path.join(OUT, "stills"), { recursive: true });

function scene(kit, tod, weather, to, cast) {
  return { scene: kit, kit, from: 0, to, look: { timeOfDay: tod, weather }, cast };
}

function baseSpec(id, title, scenes, extra = {}) {
  return {
    spec: {
      id,
      title,
      fps: 30,
      width: 1080,
      height: 1920,
      palette: "pastelDay",
      hook: { text: title, keywordHighlight: [], t: 0, duration: 2.5 },
      events: [
        { t: 0, name: "hook", targets: ["screen"], sfx: [{ tag: "pop_light", at: 0 }] },
        { t: 15, name: "aftermath", targets: ["screen"], sfx: [{ tag: "impact_soft_bodies", at: 15 }] },
      ],
      captions: [
        { text: title, from: 0.2, to: 2.3, keyword: [], style: "serif-italic" },
        { text: "The room tells its story.", from: 2.7, to: 15.9, keyword: [], style: "serif-italic" },
      ],
      heroProp: { style: "none", growth: "multiply", anchor: "plaza-left" },
      worldEvents: [],
      scenes,
      audio: { ambient: [{ tag: "ambient_tense", from: 0, to: 16, vol: 0.3 }] },
      ...extra,
    },
  };
}

const specs = [
  baseSpec("interior-noon", "What if the lamp never went out?", [
    scene("interior", "noon", "none", 16, [
      { asset: "poly_casual_character", zone: "midground", action: "idle", count: 1 },
      { asset: "poly_woman_casual", zone: "background", action: "read", count: 1 },
    ]),
  ]),
  baseSpec("interior-golden", "What if the letter arrived at midnight?", [
    scene("interior", "golden", "none", 16, [
      { asset: "poly_woman_in_dress", zone: "foreground", action: "read", count: 1 },
    ]),
  ]),
  baseSpec("interior-night", "What if the room kept its secrets?", [
    scene("interior", "night", "none", 16, [
      { asset: "poly_man_in_suit", zone: "midground", action: "sit", count: 1 },
    ]),
  ], {
    audio: { ambient: [{ tag: "ambient_tense", from: 0, to: 16, vol: 0.35 }] },
  }),
  baseSpec("interior-rain", "What if it rained on the windowsill?", [
    scene("interior", "overcast", "rain", 16, [
      { asset: "poly_man_in_long_sleeves", zone: "background", action: "look-up", count: 1 },
    ]),
  ], {
    audio: { ambient: [{ tag: "rain_hiss", from: 0, to: 16, vol: 0.4 }] },
    worldEvents: [{ t: 2, name: "rain-start" }],
  }),
];

for (const s of specs) {
  fs.writeFileSync(path.join(OUT, `${s.spec.id}.props.json`), JSON.stringify(s.spec));
}
console.log("QC interior props written:");
for (const s of specs) console.log("  " + s.spec.id);