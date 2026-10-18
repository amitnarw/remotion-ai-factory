/**
 * scripts/plan-story.ts — run the Story Studio writer as a job/CLI step.
 *
 * Input: path to a JSON request file { mode, input, seconds, feedback?,
 * provider?, model?, slug? } (written by the server; CLI can pass any path).
 * Output: public/whatif-data/<slug>/storyboard.json + a `[plan] done <slug>`
 * marker line the job runner watches for.
 *
 * Usage: npx tsx scripts/plan-story.ts <request.json>
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { writeStoryboard } from "../src/whatif/story/writer";
import { premiseSlugSafe } from "../src/whatif/storyboard/slug";

/** Inject .env keys (server jobs do the same before spawning). */
{
  const envPath = join(process.cwd(), ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
      }
    }
  }
}

const reqPath = process.argv[2];
if (!reqPath) {
  console.error("[plan] usage: tsx scripts/plan-story.ts <request.json>");
  process.exit(1);
}

interface PlanReqFile {
  mode: "topic" | "story";
  input: string;
  seconds: number;
  feedback?: string;
  provider?: string;
  model?: string;
  slug?: string;
  previous?: unknown;
}

async function main(): Promise<void> {
  const req = JSON.parse(readFileSync(reqPath, "utf8")) as PlanReqFile;
  console.log(`[plan] ${req.mode === "story" ? "directing your story" : "inventing from topic"}: "${req.input.slice(0, 80)}" (${req.seconds}s)`);

  const result = await writeStoryboard(
    {
      mode: req.mode,
      input: req.input,
      seconds: req.seconds,
      feedback: req.feedback,
      provider: req.provider,
      model: req.model,
      previous: (req.previous as never) ?? null,
    },
    (line) => console.log(line),
  );

  const slug =
    req.slug && /^[a-z0-9-]+$/.test(req.slug)
      ? req.slug
      : premiseSlugSafe(result.storyboard.title);
  const dir = join(process.cwd(), "public", "whatif-data", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "storyboard.json"),
    JSON.stringify(
      {
        ...result.storyboard,
        slug,
        createdAt: Date.now(),
        mode: req.mode,
        writer: { provider: result.provider, model: result.model, attempts: result.attempts, doctorIssues: result.doctorIssues },
      },
      null,
      2,
    ),
  );
  console.log(`[plan] storyboard saved → ${slug}`);
  console.log(`[plan] done ${slug}`);
}

main().catch((e) => {
  console.error("[plan] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});