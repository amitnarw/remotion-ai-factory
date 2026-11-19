/**
 * scripts/methods-list.ts — print the three video methods and their state.
 *
 * Usage: npm run method:list
 *
 * A video is made by exactly one method (settings.method, default factory).
 * This lists what each one is, whether it can render today, and how a run
 * selects it. See docs/factory/23-visual-methods.md.
 */
import { listMethods } from "../src/methods";

const rows = listMethods().map((m) => ({
  id: m.id,
  ready: m.available ? "ready" : "not built",
  summary: m.summary,
}));

const w = Math.max(...rows.map((r) => r.id.length), 2);
console.log("video methods\n");
for (const r of rows) {
  console.log(`  ${r.id.padEnd(w)}  ${r.ready.padEnd(10)}  ${r.summary}`);
}
console.log("\nselect one:  --method factory | animation | lemo   (default: factory)");
console.log("lemo style:  --lemo-style auto | forced --style <id>");
console.log("docs:        docs/factory/23-visual-methods.md");
