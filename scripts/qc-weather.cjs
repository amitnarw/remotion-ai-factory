/**
 * scripts/qc-weather.cjs — generates QC spec props for weather worlds.
 * Render stills with:
 *   npx remotion still out/fresh-bundle WhatIfVideo --props=out/qc/weather-street-rain.props.json --frame=240 --output=out/qc/stills/weather-street-rain.png
 */
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "out", "qc");
fs.mkdirSync(path.join(OUT, "stills"), { recursive: true });

function scene(kit, tod, weather, to) {
  return { scene: kit, kit, from: 0, to, look: { timeOfDay: tod, weather } };
}

function baseSpec(id, title, scenes, extra = {}) {
  const tod = scenes[0].look.timeOfDay;
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
        { text: "The world reacts to the story.", from: 2.7, to: 15.9, keyword: [], style: "serif-italic" },
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
  baseSpec("weather-street-rain", "What if it never stopped raining?", [
    scene("street-block", "overcast", "rain", 16),
  ], {
    audio: { ambient: [{ tag: "rain_hiss", from: 0, to: 16, vol: 0.5 }, { tag: "wind_city", from: 0, to: 16, vol: 0.25 }] },
    worldEvents: [{ t: 2, name: "rain-start" }],
  }),
  baseSpec("weather-street-snow", "What if snow fell in July?", [
    scene("street-block", "overcast", "snow", 16),
  ], {
    audio: { ambient: [{ tag: "wind_city", from: 0, to: 16, vol: 0.35 }] },
  }),
  baseSpec("weather-street-storm", "What if a storm hit the city?", [
    scene("street-block", "overcast", "storm", 16),
  ], {
    audio: { ambient: [{ tag: "ambient_tense", from: 0, to: 16, vol: 0.4 }] },
    events: [
      { t: 0, name: "hook", targets: ["screen"], sfx: [{ tag: "pop_light", at: 0 }] },
      { t: 4, name: "thunder", targets: ["screen"], sfx: [{ tag: "thunder_crack", at: 4 }] },
      { t: 9, name: "thunder2", targets: ["screen"], sfx: [{ tag: "thunder_crack", at: 9 }] },
      { t: 15, name: "aftermath", targets: ["screen"], sfx: [{ tag: "impact_soft_bodies", at: 15 }] },
    ],
  }),
  baseSpec("weather-pier-rain", "What if the sea rose in the rain?", [
    scene("pier", "overcast", "rain", 16),
  ], {
    audio: { ambient: [{ tag: "rain_hiss", from: 0, to: 16, vol: 0.5 }] },
    worldEvents: [{ t: 8, name: "water-return" }],
  }),
  baseSpec("weather-ocean-storm", "What if the ocean turned stormy?", [
    scene("ocean", "overcast", "storm", 16),
  ], {
    statPanel: {
      title: "THE OCEAN",
      unit: "x",
      beats: [
        { t: 3, value: 1, zoom: 1, sub: "ONE OCEAN", bpm: 96 },
        { t: 6, value: 2, zoom: 1.2, sub: "TWO OCEANS", bpm: 110 },
        { t: 9, value: 4, zoom: 1.4, sub: "FOUR OCEANS", bpm: 122 },
        { t: 12, value: 8, zoom: 1.6, sub: "EIGHT OCEANS", bpm: 134 },
        { t: 15, value: 16, zoom: 1.8, sub: "SIXTEEN OCEANS", bpm: 152 },
      ],
    },
  }),
  baseSpec("weather-street-lightsout", "What if the city lost power?", [
    scene("street-block", "night", "none", 16),
  ], {
    audio: { ambient: [{ tag: "ambient_tense", from: 0, to: 16, vol: 0.45 }] },
    worldEvents: [{ t: 5, name: "lights-out" }],
  }),
];

for (const s of specs) {
  fs.writeFileSync(path.join(OUT, `${s.spec.id}.props.json`), JSON.stringify(s.spec));
}
console.log("QC weather props written:");
for (const s of specs) console.log("  " + s.spec.id);
