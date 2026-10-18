const fs = require("fs");

// fix help.ts comment dashes
let p = "ui/src/lib/help.ts";
let t = fs.readFileSync(p, "utf8");
const old1 = "* global Help dialog lists all of it — one file";
const n1 = "* global Help dialog lists all of it - one file";
if (t.includes(old1)) {
  t = t.replace(old1, n1);
  fs.writeFileSync(p, t);
  console.log("done:", p);
} else {
  console.log("NOT FOUND old1 in", p);
}

// fix Generate.tsx file header comment
p = "ui/src/pages/Generate.tsx";
t = fs.readFileSync(p, "utf8");
const old2 = "* Generate, the Story Studio wizard. One step at a time, kid-simple.";
const n2 = "/* Generate - the Story Studio wizard. One step at a time, kid-simple. */";
if (t.includes(old2)) {
  t = t.replace(old2, n2);
  fs.writeFileSync(p, t);
  console.log("done:", p);
} else {
  console.log("NOT FOUND old2 in", p);
}