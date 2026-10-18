const fs = require("fs");
function replace(p, old, n) {
  let t = fs.readFileSync(p, "utf8");
  if (!t.includes(old)) { console.log("NOT FOUND:", p, "::", old.slice(0, 40)); return false; }
  t = t.replace(old, n);
  fs.writeFileSync(p, t);
  console.log("done:", p, "::", old.slice(0, 40));
  return true;
}

replace("ui/src/pages/Generate.tsx",
  'fix="Press “Make the video” again — if it keeps failing, the log below says which step broke"',
  'fix="Press “Make the video” again. If it keeps failing, the log below says which step broke."');

replace("ui/src/pages/Generate.tsx",
  '{status === "failed" ? "Oh no, something went wrong." : "Your video is being made…"}',
  '{status === "failed" ? "Oh no, something went wrong." : "Your video is being made"}');

replace("ui/src/pages/Generate.tsx",
  'title="Record a sample of this voice (takes ~30s once)"',
  'title="Record a sample of this voice (takes half a minute once)"');

replace("ui/src/pages/Providers.tsx",
  'body="Providers are only needed for the AI-spec pipeline. Everything else — including making story videos — works without them."',
  'body="Sign-in keys are only needed for the extra options. Everything else — including making story videos — works without them."');

replace("ui/src/pages/Videos.tsx",
  'fix="Try again — if the app was restarted, refresh the page first"',
  'fix="Try again. If the app was restarted, refresh the page first."');

replace("ui/src/pages/Videos.tsx",
  'body="Go to Generate, pick a video and press the big yellow button — it will show up here."',
  'body="Go to Generate, pick a video and press the big yellow button. It will show up here."');

console.log("ALL DONE");