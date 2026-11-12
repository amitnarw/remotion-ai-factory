const fs = require("fs");
const p = "ui/src/pages/Generate.tsx";
let t = fs.readFileSync(p, "utf8");
const old = '                : "Inventing the hook, beats, camera moves and sounds. Usually 1, 2 minutes."}';
const n = '                : "Making your story, usually a minute or two."}';
if (t.includes(old)) {
  t = t.replace(old, n);
  fs.writeFileSync(p, t);
  console.log("done");
} else {
  console.log("not found");
  const idx = t.indexOf("Inventing the hook");
  console.log(JSON.stringify(t.slice(idx - 60, idx + 80)));
}