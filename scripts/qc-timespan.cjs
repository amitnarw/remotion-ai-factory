/**
 * scripts/qc-timespan.cjs — generates QC spec props for timeSpan tests.
 */
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "out", "qc");
fs.mkdirSync(path.join(OUT, "stills"), { recursive: true });

function scene(kit, tod, weather, to, timeSpan) {
  const s = { scene: kit, kit, from: 0, to, look: { timeOfDay: tod, weather } };
  if (timeSpan) s.look.timeSpan = timeSpan;
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
        { text: "The world changes through time.", from: 2.7, to: 15.9, keyword: [], style: "serif-italic" },
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
  baseSpec("timespan-dawn-golden", "What if dawn turned to golden hour?", [
    scene("street-block", "dawn", "none", 16, { to: "golden", duration: 16 }),
  ]),
  baseSpec("timespan-noon-night", "What if noon turned to night?", [
    scene("street-block", "noon", "none", 16, { to: "night", duration: 16 }),
  ]),
  baseSpec("timespan-golden-dawn", "What if golden hour turned back to dawn?", [
    scene("street-block", "golden", "none", 16, { to: "dawn", duration: 16 }),
  ]),
];

for (const s of specs) {
  fs.writeFileSync(path.join(OUT, `${s.spec.id}.props.json`), JSON.stringify(s.spec));
}
console.log("QC timeSpan props written:");
for (const s of specs) console.log("  " + s.spec.id);