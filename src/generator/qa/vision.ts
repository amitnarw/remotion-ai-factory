/**
 * src/generator/qa/vision.ts — the photographer's questions to a vision model.
 *
 * Built on the research in 08-phase3-research.md §4:
 *   - yes/no questions, not 1-10 scores (models rank well but score badly);
 *   - the model never sees the plan, the narration or what we hope for: a
 *     judge that knows the intent passes most failing frames;
 *   - some questions expect "no" ("is any sea water visible?" after the oceans
 *     vanish), so a model that says yes to everything fails;
 *   - temperature 0 (set in llm.ts when images are sent).
 * Size, position and exposure are measured by code (photographer.ts); the model
 * only answers what code can't: is the thing there, is the world in the state
 * the story says.
 */
import { z } from "zod";
import { KIT_SUBJECTS } from "../camera/subjects";
import { callRole, type RoleModel } from "../pipeline/llm";
import type { ShotSpec, SpecShot } from "../spec.schema";

export interface VisionQuestion {
  id: string;
  question: string;
  /** The answer a good frame gives. */
  want: boolean;
}

const VisionSchema = z.object({ answers: z.array(z.object({ id: z.string(), yes: z.boolean() })) });

/** The scene and world state on screen at time t. */
function stateAt(spec: ShotSpec, t: number) {
  const scene = spec.scenes.find((s) => t >= s.from && t < s.to) ?? spec.scenes[spec.scenes.length - 1];
  const happened = (name: string) => (spec.worldEvents ?? []).filter((e) => e.name === name && e.t <= t).map((e) => e.t);
  const last = (name: string) => Math.max(Number.NEGATIVE_INFINITY, ...happened(name));
  return { scene, waterGone: last("water-vanish") > last("water-return"), lightsOut: happened("lights-out").length > 0 };
}

/** Neutral questions about one shot's middle frame. */
export function visionQuestions(spec: ShotSpec, shot: SpecShot): VisionQuestion[] {
  const t = (shot.from + shot.to) / 2;
  const { scene, waterGone, lightsOut } = stateAt(spec, t);
  const kit = scene?.kit ?? "";
  const qs: VisionQuestion[] = [];
  const what = KIT_SUBJECTS[kit]?.[shot.subject];
  if (what && shot.subject !== "scene") qs.push({ id: "subject", question: `Is ${what} clearly visible?`, want: true });
  qs.push({ id: "blocked", question: "Does one object very close to the camera cover a large part of the picture?", want: false });
  qs.push({ id: "dark", question: "Is the picture so dark that it is hard to tell what it shows?", want: false });
  if ((kit === "ocean" || kit === "river") && waterGone) qs.push({ id: "water", question: "Is there any sea or river water visible?", want: false });
  if (kit === "ocean" && !waterGone) qs.push({ id: "water", question: "Is there sea water visible?", want: true });
  if (lightsOut && kit !== "space") qs.push({ id: "lights", question: "Are there lit windows or lit street lamps?", want: false });
  if (scene?.look?.weather === "rain" || scene?.look?.weather === "storm") qs.push({ id: "rain", question: "Is it raining?", want: true });
  return qs;
}

/**
 * Ask the vision model about one still. Returns one problem per wrong answer
 * (and one if the reply can't be read). Fixtures replay "vision-<beat>-<n>.txt".
 */
export async function askVision(input: {
  png: Buffer;
  beat: string;
  questions: VisionQuestion[];
  model: RoleModel;
}): Promise<string[]> {
  if (input.questions.length === 0) return [];
  const list = input.questions.map((q) => `${q.id}: ${q.question}`).join("\n");
  try {
    const result = await callRole({
      role: "vision",
      label: `vision-${input.beat}`,
      system: "You look at frames from a stylised low-poly 3D animation and answer questions about what is visible. Answer each with yes or no. Judge only what you can see.",
      prompt: `Questions:\n${list}\n\nJSON shape: { "answers": [{ "id": "${input.questions[0].id}", "yes": true }] } with one answer per question.`,
      schema: VisionSchema,
      models: { vision: input.model, writer: input.model },
      images: [input.png.toString("base64")],
      maxAttempts: 2,
    });
    const byId = new Map(result.value.answers.map((a) => [a.id, a.yes]));
    return input.questions
      .filter((q) => byId.has(q.id) && byId.get(q.id) !== q.want)
      .map((q) => `vision: "${q.question}" answered ${byId.get(q.id) ? "yes" : "no"}`);
  } catch (e) {
    return [`vision check failed: ${(e as Error).message.slice(0, 160)}`];
  }
}
