/**
 * src/generator/film/fields.ts — what each editable thing has, and its choices.
 *
 * Read from the pipeline's own schemas (scenes and shots from DirectorSchema,
 * music moods and sound names from the sound designer), so the editor's
 * Inspector and the "Ask AI" prompt follow the schema when it grows.
 */
import { DirectorSchema } from "../pipeline/director";
import { soundVocabulary } from "../pipeline/sound";
import { MOODS } from "../pipeline/writer";

export interface FieldInfo {
  kind: "enum" | "text" | "number" | "list" | "other";
  options?: string[];
}

type AnyZod = { def?: { type?: string; innerType?: AnyZod; element?: AnyZod }; options?: unknown; shape?: Record<string, AnyZod>; element?: AnyZod };

function unwrap(t: AnyZod): AnyZod {
  let x = t;
  for (let i = 0; i < 6 && ["default", "optional", "nullable", "prefault", "catch"].includes(x.def?.type ?? ""); i++) x = x.def!.innerType!;
  return x;
}

function info(t: AnyZod): FieldInfo {
  const x = unwrap(t);
  const type = x.def?.type;
  if (type === "enum" && Array.isArray(x.options)) return { kind: "enum", options: x.options.map(String) };
  if (type === "string") return { kind: "text" };
  if (type === "number") return { kind: "number" };
  if (type === "array") return { kind: "list" };
  return { kind: "other" };
}

function fieldsOf(obj: AnyZod, skip: string[]): Record<string, FieldInfo> {
  const shape = unwrap(obj).shape ?? {};
  return Object.fromEntries(Object.entries(shape).filter(([k]) => !skip.includes(k)).map(([k, v]) => [k, info(v)]));
}

const director = DirectorSchema as unknown as AnyZod;

/** Scene fields (kit, time, weather, camera, ...): every scene starts at a beat. */
export function sceneFields(): Record<string, FieldInfo> {
  const scenes = unwrap(director.shape!.scenes);
  return fieldsOf(scenes.element ?? scenes.def!.element!, ["start"]);
}

/** Shot fields (size, angle, move, ...): each shot belongs to a beat. */
export function shotFields(): Record<string, FieldInfo> {
  const shots = unwrap(director.shape!.shots);
  return fieldsOf(shots.element ?? shots.def!.element!, ["beat"]);
}

export const BEAT_FIELDS: Record<string, FieldInfo> = {
  say: { kind: "text" },
  see: { kind: "text" },
  stress: { kind: "text" },
  pace: { kind: "enum", options: ["quick", "normal", "linger"] },
};

export function soundChoices(): { moods: string[]; sounds: string[] } {
  return { moods: [...MOODS], sounds: soundVocabulary() };
}

/** Everything the editor UI needs to draw its Inspector forms. */
export function editorFields() {
  return { beat: BEAT_FIELDS, scene: sceneFields(), shot: shotFields(), sound: soundChoices() };
}
