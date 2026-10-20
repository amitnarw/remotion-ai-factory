/**
 * scripts/qc-river.cjs — generates QC spec props for river world.
 * Render stills with:
 *   npx remotion still out/fresh-bundle WhatIfVideo --props=out/qc/river-noon.props.json --frame=240 --output=out/qc/stills/river-noon.png
 */
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "out", "qc");
fs.mkdirSync(path.join(OUT, "stills"), { recursive: true });

function scene(kit, tod, weather, to, riverConfig) {
  const s = { scene: kit, kit, from: 0, to, look: { timeOfDay: tod, weather } };
  if (riverConfig) s.riverConfig = riverConfig;
  return s;
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
        { text: "The river tells its story.", from: 2.7, to: 15.9, keyword: [], style: "serif-italic" },
      ],
      heroProp: { style: "none", growth: "multiply", anchor: "plaza-left" },
      worldEvents: [],
      scenes,
      audio: { ambient: [{ tag: "wind_city", from: 0, to: 16, vol: 0.4 }] },
      ...extra,
    },
  };
}

const specs = [
  baseSpec("river-noon", "What if the river changed course?", [
    scene("river", "noon", "none", 16, { hasWaterfall: false, flowDir: "z", length: 200, width: 12 }),
  ]),
  baseSpec("river-golden", "What if the waterfall froze?", [
    scene("river", "golden", "none", 16, { hasWaterfall: true, flowDir: "z", length: 200, width: 12, waterfallHeight: 12 }),
  ]),
  baseSpec("river-night", "What if the river ran dry?", [
    scene("river", "night", "none", 16, { hasWaterfall: false, flowDir: "z", length: 200, width: 12 }),
  ], {
    audio: { ambient: [{ tag: "ambient_tense", from: 0, to: 16, vol: 0.35 }] },
  }),
  baseSpec("river-rain", "What if the river flooded?", [
    scene("river", "overcast", "rain", 16, { hasWaterfall: false, flowDir: "z", length: 200, width: 12 }),
  ], {
    audio: { ambient: [{ tag: "rain_hiss", from: 0, to: 16, vol: 0.5 }] },
    worldEvents: [{ t: 2, name: "rain-start" }],
  }),
  baseSpec("river-waterfall-storm", "What if the dam broke?", [
    scene("river", "overcast", "storm", 16, { hasWaterfall: true, flowDir: "z", length: 200, width: 12, waterfallHeight: 12 }),
  ], {
    audio: { ambient: [{ tag: "ambient_tense", from: 0, to: 16, vol: 0.4 }] },
    events: [
      { t: 0, name: "hook", targets: ["screen"], sfx: [{ tag: "pop_light", at: 0 }] },
      { t: 4, name: "thunder", targets: ["screen"], sfx: [{ tag: "thunder_crack", at: 4 }] },
      { t: 9, name: "thunder2", targets: ["screen"], sfx: [{ tag: "thunder_crack", at: 9 }] },
      { t: 15, name: "aftermath", targets: ["screen"], sfx: [{ tag: "impact_soft_bodies", at: 15 }] },
    ],
  }),
];

for (const s of specs) {
  fs.writeFileSync(path.join(OUT, `${s.spec.id}.props.json`), JSON.stringify(s.spec));
}
console.log("QC river props written:");
for (const s of specs) console.log("  " + s.spec.id);