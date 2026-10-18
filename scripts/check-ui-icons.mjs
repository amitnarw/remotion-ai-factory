/**
 * scripts/check-ui-icons.mjs — UI language guard: lucide icons ONLY, plain
 * words, no emoji, no symbol glyphs, no long dashes.
 *
 * Fails on: emoji, dingbats, arrows, geometric/misc symbols, variation
 * selectors, en dash, em dash. Allowed: × · typographic quotes, …, → (in copy).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const OFFENDING =
  /[\u{1F000}-\u{1FAFF}\u{2100}-\u{214F}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{3030}\u{303D}\u{2013}\u{2014}]/u;
const ALLOWED = /[×·→"'"'…]/u;

const failures = [];
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) {
      walk(p);
    } else if (/\.(tsx?|ts|mjs|css)$/.test(f)) {
      const lines = readFileSync(p, "utf8").split("\n");
      lines.forEach((line, i) => {
        const body = [...line].filter((ch) => !ALLOWED.test(ch)).join("");
        const m = body.match(OFFENDING);
        if (m) {
          failures.push(`${p}:${i + 1}  [${m[0]}]  ${line.trim().slice(0, 90)}`);
        }
      });
    }
  }
}

walk("ui/src");

if (failures.length > 0) {
  console.error(
    `[icons] ${failures.length} emoji/symbol glyph(s) found in ui/src. Use lucide-react icons or plain words:\n` +
      failures.join("\n"),
  );
  process.exit(1);
}
console.log("[icons] ui/src is icon-clean (lucide only, no dashes)");