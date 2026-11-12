Done (2026-11-05): the module, its tests and docs are committed (`a994e24`, docs in the commit after it). Wired on 2026-11-11 by the variants agent in `4656df3` (the claims stage, the CLI story gate, the dashboard's "Facts and figures").

# claims: a story's factual claims need support

## Task
A story's factual claims (numbers, dates, records, "scientists say", named real people or events) are found and checked before the story gate. Code finds the sentences with specific figures or factual markers; the critic's model judges each one: supported by common knowledge, speculative (fine in a what-if when framed as one), or needing a source. The result (claim, verdict, suggested rewording) is listed at the story gate and on the dashboard's story review; it never blocks the run.
- **Per channel** (by the profile's id or genre, no schema field): documentary strict (a claim needing a source goes to the writer once to fix); what-if only notes; drama and action skip real-world claims.
- **What-if stays byte-identical** (`prompts.test.ts`, the fixture plans): the check is its own call and stage, and when nothing is flagged nothing changes.

Files owned: `src/generator/pipeline/critic.ts` and its test, `src/generator/pipeline/claims.ts` and its test (new), `src/generator/ai/roles.ts`, `test-fixtures/claims/*` (new); docs: `15-producer.md` §18, this file.

## What is built (`src/generator/pipeline/claims.ts`, design in 15-producer.md §18)
- `claimsPolicy(profile)`: `strict` (documentary), `note` (what-if, any other non-fiction), `skip` (drama, action, fiction), from `id` + `genre`.
- `findClaims(story)`: code only; spoken sentences with a figure, date, record, authority, titled person, named thing or event.
- `judgeClaims(...)`: the **critic** role's model (label `claims`), verdicts `known` / `speculative` (+ `framed`) / `source` / `none` (dropped), a rewording for each flagged one.
- `fixClaims(...)`: strict only; the **writer** (label `writer-claims`) rewrites only the flagged sentences, once; code swaps each sentence in place.
- `claimsStage({ story, profile, models, rewrite, previous })`: the whole stage; `claimsInputs(story, profile)`: its input hash; `claimsWarnings`, `formatClaims` (the gate's lines).
- No new role; `roles.ts` only says in the critic's description that it checks the facts. `critic.ts` and `llm.ts` unchanged (the critic's prompts are byte-identical).

## Committed
- `2cb56d0`: this status file.
- `a994e24`: `claims.ts`, `claims.test.ts`, `test-fixtures/claims/{documentary,what-if,what-if-clean}/*`, `roles.ts` (the critic's description), this file.
- (the docs commit) `15-producer.md` §18, this file.

## Uncommitted
- Nothing of mine.

## Next: the wiring (other owners' files; exact edits)
1. **`src/generator/pipeline/manifest.ts`** (a new stage between `story` and `voice`):
   ```ts
   export const STAGES = ["story", "claims", "voice", "check", "breakdown", "match", "director", "sound", "critic", "assemble"] as const;
   // STAGE_FILES:
   claims: ["story.claims.json"],
   // STAGE_LABELS:
   claims: "the claims check",
   ```
   Old runs get `claims: waiting` from `readRun`'s `??=` (or `skipped` when finished). Re-run `manifest.test.ts`, `resume.test.ts` and `run.test.ts`: any test that lists every stage gains `claims`.
2. **`src/generator/pipeline/run.ts`** (the variants agent):
   - import: `import { claimsInputs, claimsPolicy, claimsStage, type ClaimsCheck } from "./claims";`
   - in `planStages`, right after `let story = told.value; const revised = !!told.facts?.revised;` and before `const voiced = await runStage(run, "voice", …)`:
   ```ts
    // The claims check (15 §18): the story's factual claims, judged by the
    // critic's model; a documentary's that need a source go to the writer once
    // (the voice stage then times the changed story). Drama and action skip it,
    // and so do recorded replies with no claims reply (every set from before it).
    // It adds warnings only when a claim is flagged, and a failure is a warning.
    let claims: ClaimsCheck | null = null;
    const claimsWarn: string[] = [];
    if (claimsPolicy(profile) === "skip" || (process.env.FACTORY_LLM_FIXTURES && !existsSync(join(process.env.FACTORY_LLM_FIXTURES, "claims-1.txt")))) {
      if (run.stages.claims.state !== "skipped") {
        run.stages.claims = { state: "skipped", files: run.stages.claims.files };
        writeRun(run);
      }
    } else {
      try {
        const approved = run.gates.story.on && run.gates.story.state === "approved";
        const before = story;
        const got = await runStage(run, "claims", claimsInputs(story, profile), {
          model: models.critic,
          load: () => {
            const c = load<ClaimsCheck>(id, "story.claims");
            return c ? { check: c, story: before } : null;
          },
          work: async () => {
            stage("claims");
            const r = await claimsStage({ story: before, profile, models, rewrite: !asWritten && !approved, previous: load<ClaimsCheck>(id, "story.claims") });
            save(id, "story.claims", r.check);
            if (r.story !== before) save(id, "story", r.story);
            return { value: { check: r.check, story: r.story }, warnings: r.warnings };
          },
        });
        claims = got.value.check;
        story = got.value.story;
        claimsWarn.push(...got.warnings);
      } catch (e) {
        claimsWarn.push(`the claims check was skipped: ${(e as Error).message.slice(0, 200)}`);
      }
    }
   ```
   - `const warnings: string[] = [...early, ...told.warnings, ...claimsWarn, ...voiced.warnings];`
   - `StoryGateStop`: a fifth constructor parameter `readonly claims?: ClaimsCheck,` and `throw new StoryGateStop(id, story, { … }, check, claims ?? undefined);`
   - `models` already resolves `critic` (no change to `resolveRoleModels`).
   - On a resume after a strict fix, the story stage loads the fixed `story.json`, the claims stage sees a new input hash and runs, and `claimsStage` returns the saved check with no call (`previous.fixed.story` is the fixed story's hash). Its log says "its inputs changed", which is harmless.
3. **`src/generator/generate.ts`** `printStoryGate`, after the `if (check) { … }` block (import `formatClaims` from `./pipeline/claims`):
   ```ts
  if (stop.claims) {
    const lines = formatClaims(stop.claims);
    console.log("");
    console.log(`The claims check (output/${id}/story.claims.json${stop.claims.fixed ? "; the writer reworded the flagged ones once" : "; it changes nothing"}):`);
    for (const l of lines.length ? lines : ["no claims"]) console.log(`  ${l}`);
  }
   ```
4. **`server/index.ts`**, the story gate's response (beside `check`, about line 813):
   ```ts
      let claims: unknown;
      try {
        claims = run?.stages.claims?.state === "done" ? JSON.parse(fs.readFileSync(join(dir, "story.claims.json"), "utf8")) : undefined;
      } catch {
        claims = undefined;
      }
      // in res.json: ...(claims ? { claims } : {}),
   ```
5. **`ui/src/api.ts`** `SpecResponse`: `claims?: import("../../src/generator/pipeline/claims").ClaimsCheck;`
   **`ui/src/pages/create/PlanStep.tsx`**: `StoryGateData` gets `claims?`; `setStoryGate({ …, check: r.check, claims: r.claims })`; beside `<CheckSection>`, `{claims?.claims.length ? <ClaimsSection claims={claims} /> : null}`: a `Section` "Facts and figures" (hint: "Checked by the critic's model, which has no web access. A documentary's flagged claims were reworded once by the writer; elsewhere they are only listed."), one row per claim: a `Badge` (`amber` "Needs a source" for `source`, `amber` "Told as fact" for `speculative` not framed, `muted` "Known" / "What-if" otherwise), the sentence, the beat, and under a flagged one "Suggested: …" (`reword`) or "Changed to: …" (`rewritten`).
6. **`server/progress.ts`** `PLAN_PROGRESS`: `claims: 20` (the `stage("claims")` marker).
7. **Optional, `pipeline/checker.ts`'s owner:** once the claims stage is wired, the checker's own `claims` list repeats it at the gate. Dropping it from `checkerPrompt` changes the checker's recorded replies, so leave it until then.

## Checks (`wt-claims`, `2cb56d0` + my files, the same as `a994e24`)
- `npx tsc --noEmit` 0 errors; `npx eslint src server` clean; `npm test` 844 tests, 843 pass, 0 fail, 1 skipped; `claims.test.ts` 10 of 10; `prompts.test.ts` and `critic.test.ts` pass unchanged (what-if's prompts byte-identical).

## Worktree and outputs
- `wt-claims`: removed (its junctions `node_modules`, `public\assets`, `public\library` first). No renders.

## Findings for others
- The wiring above (items 1-7).
