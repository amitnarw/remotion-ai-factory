/**
 * scripts/qc-ocean.cjs — generates QC spec props for the ocean world:
 *   out/qc/ocean-noon.props.json / ocean-golden / ocean-night / pier-water
 * Render stills with:
 *   npx remotion still out/fresh-bundle WhatIfVideo --props=out/qc/ocean-noon.props.json --frame=90 --output=out/qc/stills/ocean-noon.png
 */
const fs = require("fs");
const path = require("path");

function oceanSpec(tod) {
  return {
    spec: {
      id: `ocean-qc-${tod}`,
      title: "What If The Ocean Doubled Every 3 Seconds?",
      fps: 30,
      width: 1080,
      height: 1920,
      palette: "pastelDay",
      hook: { text: "What if the ocean doubled every 3 seconds?", keywordHighlight: ["ocean"], t: 0, duration: 2.5 },
      events: [
        { t: 0, name: "hook", targets: ["screen"], sfx: [{ tag: "pop_light", at: 0 }] },
        { t: 15, name: "aftermath", targets: ["screen"], sfx: [{ tag: "impact_soft_bodies", at: 15 }] },
      ],
      captions: [
        { text: "What if the ocean doubled every 3 seconds?", from: 0.2, to: 2.3, keyword: ["ocean"], style: "serif-italic" },
        { text: "It swallows the beach — then the dunes.", from: 2.7, to: 15.9, keyword: [], style: "serif-italic" },
      ],
      heroProp: { style: "none", growth: "multiply", anchor: "plaza-left" },
      timer: { label: "OCEAN SIZE", startT: 2.5, endT: 15, format: "m:ss.ccc", position: "top-left" },
      statPanel: {
        title: "THE OCEAN",
        unit: "x",
        beats: [
          { t: 3, value: 1, zoom: 1, sub: "ONE OCEAN", bpm: 96 },
          { t: 6, value: 2, zoom: 1.1, sub: "TWO OCEANS", bpm: 104 },
          { t: 9, value: 4, zoom: 1.2, sub: "FOUR OCEANS", bpm: 112 },
          { t: 12, value: 8, zoom: 1.3, sub: "EIGHT OCEANS", bpm: 122 },
          { t: 15, value: 16, zoom: 1.4, sub: "SIXTEEN OCEANS", bpm: 132 },
        ],
      },
      worldEvents: [],
      scenes: [{ scene: "ocean", kit: "ocean", from: 0, to: 16, look: { timeOfDay: tod } }],
      audio: { ambient: [{ tag: "wind_city", from: 0, to: 16, vol: 0.4 }] },
    },
  };
}

function pierWaterSpec() {
  const s = oceanSpec("night").spec;
  s.id = "pier-qc-water-return";
  s.title = "What If Water Vanished From Earth?";
  s.hook.text = "What if water vanished from Earth?";
  s.captions = [
    { text: "What if water vanished from Earth?", from: 0.2, to: 2.3, keyword: ["water"], style: "serif-italic" },
    { text: "The basin sits bone dry for an hour.", from: 2.7, to: 7.5, keyword: [], style: "serif-italic" },
    { text: "Then the water snaps back.", from: 7.9, to: 15.9, keyword: ["water"], style: "serif-italic" },
  ];
  s.statPanel = undefined;
  s.timer = { label: "TIME WITHOUT WATER", startT: 2.5, endT: 8, format: "m:ss.ccc", position: "top-left" };
  s.worldEvents = [{ t: 8, name: "water-return" }];
  s.scenes = [
    {
      scene: "pier",
      kit: "pier",
      from: 0,
      to: 16,
      look: { timeOfDay: "night" },
      cast: [
        { asset: "blocky_characters_character_a", file: "assets/characters/blocky-characters/Models/GLB format/character-a.glb", count: 6, action: "panic", zone: "foreground" },
        { asset: "blocky_characters_character_b", file: "assets/characters/blocky-characters/Models/GLB format/character-b.glb", count: 4, action: "kneel", zone: "midground" },
      ],
    },
  ];
  return { spec: s };
}

const outDir = path.join(__dirname, "..", "out", "qc");
fs.mkdirSync(path.join(outDir, "stills"), { recursive: true });
for (const tod of ["noon", "golden", "night", "overcast"]) {
  fs.writeFileSync(path.join(outDir, `ocean-${tod}.props.json`), JSON.stringify(oceanSpec(tod)));
}
fs.writeFileSync(path.join(outDir, "pier-water.props.json"), JSON.stringify(pierWaterSpec()));
console.log("QC props written to out/qc:");
console.log("  ocean-noon / ocean-golden / ocean-night / ocean-overcast / pier-water (.props.json)");
