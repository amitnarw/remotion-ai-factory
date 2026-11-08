/**
 * src/generator/film/recast.ts — is a recast (a character gets another voice)
 * valid for this plan? Pure, so POST /api/plan/:specId/recast can check it
 * before anything is written (recast.test.ts).
 *
 * The name must be a character of the plan's story; the voice must be one the
 * plan's dialogs engine knows: a KittenTTS 2 preset (KNOWN_VOICES, Bella is
 * banned) or a VoxCPM2 preset id (the same lists GET /api/voices offers).
 */
import { KNOWN_VOICES, TTS_ENGINES, VOXCPM_VOICE_DESCRIPTIONS, type TtsEngine } from "../voices";

export interface RecastProblem {
  error: string;
  fix: string;
}

/** The voices a character can be given on this dialogs engine. */
export function voicesFor(engine: TtsEngine): string[] {
  return engine === "voxcpm2" ? VOXCPM_VOICE_DESCRIPTIONS.map((v) => v.id) : KNOWN_VOICES.map((v) => v.id);
}

/** Null when the recast is valid, else what is wrong and how to fix it. */
export function checkRecast(input: {
  characters: Array<{ name: string }>;
  /** The plan's dialogs engine (plan.audio.dialogs.engine); Kitten when unset. */
  engine?: string;
  name: unknown;
  voice: unknown;
}): RecastProblem | null {
  const { name, voice } = input;
  if (typeof name !== "string" || !name.trim() || typeof voice !== "string" || !voice.trim()) {
    return { error: "a character name and a voice are required", fix: 'Send { "name": "<character>", "voice": "<voice>" }' };
  }
  const names = input.characters.map((c) => c.name);
  if (!names.includes(name)) {
    return {
      error: `"${name}" is not a character of this story`,
      fix: names.length ? `Pick one of: ${names.join(", ")}` : "This story has no characters to recast",
    };
  }
  const engine: TtsEngine = input.engine === "voxcpm2" ? "voxcpm2" : "kitten2";
  const known = voicesFor(engine);
  if (!known.includes(voice)) {
    const label = TTS_ENGINES.find((e) => e.id === engine)?.label ?? engine;
    return { error: `"${voice}" is not a ${label} voice (the dialogs engine of this plan)`, fix: `Pick one of: ${known.join(", ")}` };
  }
  return null;
}
