/**
 * src/generator/library/shopping.ts — the shopping list: matched needs
 * (needs.json) grouped the way gate 2 shows them (docs/factory/15-producer.md
 * §2, "The gates"): what we have, what stands in, what to download, what to
 * build, what is a data change, what is skipped.
 *
 * Pure text, no colour codes, so it reads the same in a terminal, a log and
 * a test. Used by scripts/breakdown.ts; the producer's `needs <run>` command
 * can print the same.
 */
import type { MatchedNeed, NeedStatus, NeedsFile } from "./match";

export const SECTIONS: ReadonlyArray<{ status: NeedStatus; title: string }> = [
  { status: "have", title: "IN STOCK" },
  { status: "close", title: "SUBSTITUTE (in stock, not quite it)" },
  { status: "download", title: "TO DOWNLOAD" },
  { status: "build", title: "TO BUILD (a build request for a developer)" },
  { status: "data", title: "DATA (no code, no download)" },
  { status: "skip", title: "SKIPPED (not a must-have, nothing close)" },
];

/** The needs grouped by status, in the needs' own order. */
export function shoppingList(file: Pick<NeedsFile, "needs">): Record<NeedStatus, MatchedNeed[]> {
  const out = { have: [], close: [], download: [], build: [], data: [], skip: [] } as Record<NeedStatus, MatchedNeed[]>;
  for (const n of file.needs) out[n.status].push(n);
  return out;
}

const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 3)}...`);

function detail(n: MatchedNeed): string[] {
  const lines: string[] = [];
  switch (n.status) {
    case "have":
      lines.push(`use ${n.use?.id}${n.use?.castId ? ` (cast id ${n.use.castId})` : ""}${n.also?.length ? `, with ${n.also.join(", ")}` : ""}`);
      break;
    case "close":
      lines.push(`use ${n.use?.id} meanwhile`);
      if (n.then === "download" && n.download) lines.push(`then download: ${n.download.words.join(", ")} from ${n.download.sources.join(", ")}`);
      if (n.then === "build" && n.build) lines.push(`then build: ${n.build.id}${n.build.design ? ` (design: ${n.build.design})` : ""}`);
      if (n.then === "data") lines.push("then data: a new place in this look");
      break;
    case "download":
      if (n.download) lines.push(`look for: ${n.download.words.join(", ")} in ${n.download.sources.join(", ")}`);
      break;
    case "build":
      if (n.build) {
        lines.push(`request ${n.build.id} (${n.build.kind}): ${n.build.title}`);
        lines.push(`meanwhile: ${n.build.fallback}`);
        if (n.build.design) lines.push(`design: ${n.build.design}`);
      }
      break;
    case "data":
      if (n.data) lines.push(n.data);
      if (n.use) lines.push(`meanwhile: ${n.use.id}`);
      break;
    case "skip":
      if (n.build) lines.push(`would need: ${n.build.id}`);
      break;
  }
  if (n.note) lines.push(`note: ${n.note}`);
  return lines;
}

/** The list as text: a header, then each non-empty section, one need per entry with its details indented. */
export function formatShoppingList(file: NeedsFile, title?: string): string {
  const groups = shoppingList(file);
  const counts = SECTIONS.map((s) => `${groups[s.status].length} ${s.status}`).join(", ");
  const out: string[] = [`Shopping list${title ? `: "${title}"` : ""} (${file.needs.length} needs: ${counts}; inventory ${file.inventory})`];
  for (const s of SECTIONS) {
    const list = groups[s.status];
    if (!list.length) continue;
    out.push("", `${s.title} (${list.length})`);
    for (const n of list) {
      out.push(`  ${pad(n.id, 4)} ${pad(n.kind, 9)} ${n.must ? "must " : "     "}${clip(n.what, 70)}  [${n.beats.join(" ")}]`);
      for (const d of detail(n)) out.push(`       ${d}`);
    }
  }
  if (file.warnings.length) out.push("", "Warnings:", ...file.warnings.map((w) => `  - ${w}`));
  return out.join("\n");
}
