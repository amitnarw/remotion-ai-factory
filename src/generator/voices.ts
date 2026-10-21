/**
 * src/generator/voices.ts — TTS voice/engine catalog (server-safe).
 *
 * Shared by the server (/api/voices) and the generator. KittenTTS 2 ships
 * 23 usable preset voices (Bella is banned — she rambles on long lines).
 * VoxCPM2 has no fixed voice list: voices are *designed* from a text
 * description, so we expose a small set of recommended descriptions.
 */

export type TtsEngine = "kitten2" | "voxcpm2";

export const TTS_ENGINES: Array<{ id: TtsEngine; label: string; note: string }> = [
  { id: "kitten2", label: "KittenTTS 2", note: "Fast CPU batch, 23 preset voices, emotion tags, 24 kHz" },
  { id: "voxcpm2", label: "VoxCPM2", note: "Best quality, 48 kHz, voice design from a text description" },
];

export const BANNED_VOICES = new Set(["Bella"]);

export const VOICE_PACE_MEASURED: Record<string, number> = {
  Marcus: 1.73, Diana: 1.84, Rosie: 1.89, Jasper: 1.95, Herbert: 1.94,
  Laurence: 1.94, Bruno: 1.99, Walter: 2.05, Luna: 2.06, Maeve: 2.06,
  Alfred: 2.13, Kiki: 2.18, Victor: 2.37, Dolores: 2.44, Raven: 2.55,
  Elliot: 2.58, Hugo: 2.65, Leo: 2.72, Matthew: 2.88, Willow: 3.13,
  Dante: 3.25, Saoirse: 3.29, Claire: 3.9,
};

export interface VoiceInfo {
  id: string;
  pace: "fast" | "steady" | "slow";
  sample: string | null;
}

export const KNOWN_VOICES: VoiceInfo[] = Object.entries(VOICE_PACE_MEASURED)
  .filter(([id]) => !BANNED_VOICES.has(id))
  .sort((a, b) => a[1] - b[1])
  .map(([id, span]) => ({
    id,
    pace: span < 2.0 ? "fast" : span <= 2.6 ? "steady" : "slow",
    sample: null,
  }));

export const DEFAULT_NARRATOR = "Bruno";
export const DEFAULT_CHARACTER = "Rosie";

/** Recommended voice-design descriptions for VoxCPM2 (no fixed voice list). */
export const VOXCPM_VOICE_DESCRIPTIONS: Array<{ id: string; description: string }> = [
  { id: "narrator-calm", description: "Calm male narrator, mid-30s, steady pace, documentary tone" },
  { id: "narrator-warm", description: "Warm female narrator, gentle and reassuring, storytelling pace" },
  { id: "character-hero", description: "Young adult male, confident and energetic" },
  { id: "character-villain", description: "Deep male voice, slow and deliberate, slightly menacing" },
  { id: "character-child", description: "Young child voice, bright and curious" },
];

export function pickVoice(name: string | undefined, fallback: string): string {
  if (!name) return fallback;
  if (BANNED_VOICES.has(name)) return fallback;
  return VOICE_PACE_MEASURED[name] != null || VOXCPM_VOICE_DESCRIPTIONS.some((v) => v.id === name)
    ? name
    : fallback;
}
