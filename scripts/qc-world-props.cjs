/* Build QC prop files for stills: one street spec per time-of-day + space specs. */
const fs = require("fs");
const path = require("path");
const OUT = "C:/Users/Narwal/Desktop/remotion/out/qc";
fs.mkdirSync(OUT, { recursive: true });

function streetSpec(tod) {
  return {
    id: `qc-street-${tod}`,
    title: tod,
    fps: 30,
    width: 1080,
    height: 1920,
    hook: { text: "what if a street was a world?", keywordHighlight: ["world"], t: 0, duration: 2.2 },
    captions: [],
    audio: { ambient: [] },
    scenes: [{
      scene: "street-block",
      kit: "street-block",
      from: 0,
      to: 8,
      look: { timeOfDay: tod },
      street: { crowdCount: 18, vehicleCount: 6, accent: "classic", cameraStyle: "walk-through" },
    }],
    events: [{ t: 4, name: "peak" }],
  };
}

function spaceSpec(subject) {
  return {
    id: `qc-space-${subject}`,
    title: subject,
    fps: 30,
    width: 1080,
    height: 1920,
    hook: { text: "what if the planets moved?", keywordHighlight: ["planets"], t: 0, duration: 2.2 },
    statPanel: {
      title: subject === "moon" ? "THE MOON" : subject === "mars" ? "MARS" : "OUR PLANET",
      unit: "x",
      beats: [
        { t: 2, value: "1", zoom: 1, sub: "BASELINE", bpm: 76 },
        { t: 6, value: "4", zoom: 4, sub: "FOURFOLD", bpm: 104 },
      ],
    },
    captions: [],
    audio: { ambient: [] },
    scenes: [{
      scene: "space",
      kit: "space",
      subject,
      from: 0,
      to: 8,
      look: { timeOfDay: "night" },
    }],
    events: [{ t: 2, name: "beat" }, { t: 6, name: "beat" }],
  };
}

const specs = [
  ...["noon", "afternoon", "golden", "overcast", "dawn", "night"].map((tod) => ({ name: `street-${tod}`, spec: streetSpec(tod) })),
  ...["earth", "moon", "mars"].map((s) => ({ name: `space-${s}`, spec: spaceSpec(s) })),
];

for (const { name, spec } of specs) {
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ spec }, null, 2));
}
console.log("wrote", specs.length, "QC props into", OUT);
