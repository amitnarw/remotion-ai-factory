/**
 * src/whatif/audio/voices.ts — the voice-cast catalog (server-safe).
 *
 * Voice ids come from the local KittenTTS engine (probed live: speech-span
 * benchmark on a 7-word line). Bella is BANNED — she rambles (20s takes for
 * one line). Pace labels from measured span: fast < 2.0s, steady 2.0–2.6,
 * slow > 2.6.
 */
export const BANNED_VOICES = new Set(["Bella"]);

export const VOICE_PACE_MEASURED: Record<string, number> = {
  Marcus: 1.73,
  Diana: 1.84,
  Rosie: 1.89,
  Jasper: 1.95,
  Herbert: 1.94,
  Laurence: 1.94,
  Bruno: 1.99,
  Walter: 2.05,
  Luna: 2.06,
  Maeve: 2.06,
  Alfred: 2.13,
  Kiki: 2.18,
  Victor: 2.37,
  Dolores: 2.44,
  Raven: 2.55,
  Elliot: 2.58,
  Hugo: 2.65,
  Leo: 2.72,
  Matthew: 2.88,
  Willow: 3.13,
  Dante: 3.25,
  Saoirse: 3.29,
  Claire: 3.9,
};

export const KNOWN_VOICES: Array<{ id: string; pace: "fast" | "steady" | "slow" }> =
  Object.entries(VOICE_PACE_MEASURED)
    .filter(([id]) => !BANNED_VOICES.has(id))
    .sort((a, b) => a[1] - b[1])
    .map(([id, span]) => ({
      id,
      pace: span < 2.0 ? ("fast" as const) : span <= 2.6 ? ("steady" as const) : ("slow" as const),
    }));

export const DEFAULT_NARRATOR = "Bruno";
export const DEFAULT_CHARACTER = "Rosie";

/** Render-time guard: pick a safe voice (used by the voice stage). */
export function pickVoice(name: string | undefined, fallback: string): string {
  return name && !BANNED_VOICES.has(name) && VOICE_PACE_MEASURED[name] != null
    ? name
    : fallback;
}

export const SAMPLE_TEXT = "Hey there! This is my real voice. Let's make something amazing together.";