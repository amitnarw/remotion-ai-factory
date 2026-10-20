/**
 * scripts/qc-forest.cjs — generates QC spec props for forest world.
 * Render stills with:
 *   npx remotion still out/fresh-bundle WhatIfVideo --props=out/qc/forest-noon.props.json --frame=240 --output=out/qc/stills/forest-noon.png
 */
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "out", "qc");
fs.mkdirSync(path.join(OUT, "stills"), { recursive: true });

function scene(kit, tod, weather, to) {
  return { scene: kit, kit, from: 0, to, look: { timeOfDay: tod, weather } };
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
        { text: "The forest reacts to the story.", from: 2.7, to: 15.9, keyword: [], style: "serif-italic" },
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
  baseSpec("forest-noon", "What if the forest grew overnight?", [
    scene("forest", "noon", "none", 16),
  ]),
  baseSpec("forest-golden", "What if the trees walked at golden hour?", [
    scene("forest", "golden", "none", 16),
  ], {
    audio: { ambient: [{ tag: "wind_city", from: 0, to: 16, vol: 0.3 }] },
  }),
  baseSpec("forest-night", "What if the mist never lifted?", [
    scene("forest", "night", "none", 16),
  ], {
    audio: { ambient: [{ tag: "ambient_tense", from: 0, to: 16, vol: 0.35 }] },
  }),
  baseSpec("forest-rain", "What if it rained on the canopy?", [
    scene("forest", "overcast", "rain", 16),
  ], {
    audio: { ambient: [{ tag: "rain_hiss", from: 0, to: 16, vol: 0.5 }] },
    worldEvents: [{ t: 2, name: "rain-start" }],
  }),
  baseSpec("forest-storm", "What if lightning struck the ancient trees?", [
    scene("forest", "overcast", "storm", 16),
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
console.log("QC forest props written:");
for (const s of specs) console.log("  " + s.spec.id);