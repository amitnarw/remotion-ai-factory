/**
 * src/generator/voices.ts — TTS voice/engine catalog (server-safe).
 *
 * Shared by the server (/api/voices) and the generator. KittenTTS 2 ships
 * 23 usable preset voices (Bella is banned — she rambles on long lines).
 * VoxCPM2 has no fixed voice list: voices are *designed* from a text
 * description (or cloned from a reference clip), so we expose a small set of
 * recommended casting notes. Casting notes stay short — 12 to 22 words — per
 * the official VoxCPM2 voice-design recipe; longer notes muddy the timbre.
 */

export type TtsEngine = "kitten2" | "voxcpm2";

export const TTS_ENGINES: Array<{ id: TtsEngine; label: string; note: string }> = [
  { id: "kitten2", label: "KittenTTS 2", note: "Fast CPU batch, 23 preset voices, emotion tags, 24 kHz" },
  { id: "voxcpm2", label: "VoxCPM2", note: "Best quality, 48 kHz, voice design from a casting note or clone" },
];

// The single line every audition plays so voices are compared apples-to-apples.
// It is real narration, not a casual greeting, with pauses and an arc.
export const AUDITION_TEXT =
  "In the heart of the forest, where sunlight barely reaches the ground, a hidden world begins to stir.";

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
  label?: string;
  gender?: "male" | "female" | "neutral";
  age?: string;
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

/**
 * Recommended casting notes for VoxCPM2 (no fixed voice list). Each is 12-22
 * words: age/gender + timbre + delivery + pacing + role, the official recipe.
 */
export interface VoxcpmVoiceTransform { semitones?: number; tempo?: number; saturation?: number }
export type VoxcpmVoiceQuality = "premium" | "draft";

export const VOXCPM_VOICE_DESCRIPTIONS: Array<{ id: string; description: string; tags: string[]; quality?: VoxcpmVoiceQuality; transform?: VoxcpmVoiceTransform; requiresReference?: boolean; seed?: number; referenceId?: string }> = [
  {
    id: "narrator-calm",
    description: "middle-aged man, medium-low warm baritone, calm confident delivery, measured unhurried pacing with pauses, close-mic documentary narration",
    tags: ["narrator", "documentary", "calm"],
  },
  {
    id: "narrator-warm",
    description: "middle-aged woman, warm rounded mid-low voice, gentle storytelling cadence, sincere and inviting, close-mic nature documentary narration",
    tags: ["narrator", "documentary", "warm"],
  },
  {
    id: "narrator-discovery",
    description: "man in his 40s, confident mid-low baritone, smooth resonant, deliberate pacing, calm suspense, Discovery-style documentary narration",
    tags: ["narrator", "documentary", "authority"],
  },
  {
    id: "narrator-animal-planet",
    description: "man in his 50s, warm deep baritone, slow gentle reverent pacing, patient authoritative, wildlife documentary narration",
    tags: ["narrator", "documentary", "nature"],
  },
  {
    id: "narrator-cinematic",
    description: "man in his 30s, deep low magnetic baritone, slow dramatic weighty delivery, gravity and intensity, cinematic narration",
    tags: ["narrator", "cinematic", "dramatic"],
  },
  {
    id: "narrator-bbc-calm",
    description: "British man, neutral clear articulation, calm measured mid-low baritone, understated authority, polished factual documentary narration",
    tags: ["narrator", "documentary", "british"],
  },
  {
    id: "narrator-science",
    description: "young man in his mid twenties, light bright energetic male voice, clear articulate confident projection, warm natural conversational delivery, modern science explainer narration",
    tags: ["narrator", "explainer", "young", "male"],
    seed: 7,
  },
  {
    id: "narrator-reflection",
    description: "woman, soft mid-range voice, gentle lilting dreamy cadence, introspective poetic, intimate close-mic reflective narration",
    tags: ["narrator", "reflective", "soft"],
  },
  {
    id: "character-hero",
    description: "young man in his early twenties, light bright energetic male voice, natural conversational warmth, confident playful projection, adventure protagonist dialogue",
    tags: ["character", "hero", "energetic", "male"],
    seed: 0,
  },
  {
    id: "character-villain",
    description: "man in his 40s, deep slow controlled baritone, dark resonant, deliberate menacing cadence, quiet intimidation, antagonist dialogue",
    tags: ["character", "villain", "dark"],
  },
  {
    id: "character-child-girl-6",
    description: "little girl, six years old, very high bright light voice, light playful curious delivery, giggly animated, family documentary dialogue",
    tags: ["character", "child", "draft", "female"],
    quality: "draft",
    // FROZEN TIMBRE: cloned from public/voice/references/character-child-girl-6/reference.wav
    // (approved v2 desc-only clip, 341 Hz median F0). Audio-based conditioning, no seed.
    referenceId: "character-child-girl-6",
  },
  {
    id: "character-child-girl-9",
    description: "little girl, nine years old, bright warm girl voice, clear playful curious delivery, natural conversational",
    tags: ["character", "child", "draft", "female"],
    quality: "draft",
    referenceId: "character-child-girl-6",
    transform: { semitones: -2 },
  },
  {
    id: "character-child-boy-8",
    description: "little boy, eight years old, bright clear high voice, eager quick curious delivery, energetic, adventure dialogue",
    tags: ["character", "child", "draft", "male"],
    quality: "draft",
    // FROZEN TIMBRE: cloned from public/voice/references/character-child-boy-8/reference.wav
    // (approved v2 desc-only clip, 256 Hz median F0). Audio-based conditioning, no seed.
    referenceId: "character-child-boy-8",
  },
  {
    id: "character-child-boy-10",
    description: "little boy, ten years old, bright clear kid voice, eager curious delivery, friendly adventurous",
    tags: ["character", "child", "draft", "male"],
    quality: "draft",
    referenceId: "character-child-boy-8",
    transform: { semitones: -1.5 },
  },
  ];
// ELDER and additional child voices intentionally omitted. Design-only
// (pitch-shifted adult base) scored 0/10. They return only as verified-auddlited presets or lawfully sourced reference clones.



export function voxTransform(voice: string | undefined): { semitones?: number; tempo?: number; saturation?: number } | undefined {
  if (!voice) return undefined;
  const preset = VOXCPM_VOICE_DESCRIPTIONS.find((v) => v.id === voice);
  return preset?.transform;
}

export function voicesByQuality(q: "premium" | "draft"): typeof VOXCPM_VOICE_DESCRIPTIONS {
  return VOXCPM_VOICE_DESCRIPTIONS.filter((v) => (v.quality ?? (v.tags.includes("child") || v.tags.includes("elder") ? "draft" : "premium")) === q);
}

export function pickVoice(name: string | undefined, fallback: string): string {
  if (!name) return fallback;
  if (BANNED_VOICES.has(name)) return fallback;
  return VOICE_PACE_MEASURED[name] != null || VOXCPM_VOICE_DESCRIPTIONS.some((v) => v.id === name)
    ? name
    : fallback;
}

/**
 * The VoxCPM description for a voice. An explicit description always wins over
 * the preset, so a user's custom casting note is never silently discarded.
 * A preset id maps to its built-in note; a free-text description passes through.
 */
export function voxDescription(voice: string | undefined, explicit?: string): string | undefined {
  if (explicit && explicit.trim()) return explicit.trim();
  if (voice) {
    const preset = VOXCPM_VOICE_DESCRIPTIONS.find((v) => v.id === voice);
    if (preset) return preset.description;
    if (voice.includes(" ")) return voice;
  }
  return undefined;
}


// ---------------------------------------------------------------------------
// Display metadata (label / gender / age) for every voice on both engines.
// IDs never change - only the human-facing label and structured hints change.
// "verified" marks voices that have been auditioned and approved by the user.
// ---------------------------------------------------------------------------

export type VoiceGender = "male" | "female" | "neutral";
export interface VoiceA3Meta { label: string; gender: VoiceGender; age: string; verified?: boolean }

export const VOXCPM_META: Record<string, VoiceA3Meta> = {
  "narrator-calm":        { label: "Narrator male 1 - middle-aged", gender: "male",   age: "middle-aged", verified: true },
  "narrator-warm":        { label: "Narrator female 1 - middle-aged", gender: "female", age: "middle-aged" },
  "narrator-discovery":   { label: "Narrator male 2 - 40s",          gender: "male",   age: "40s" },
  "narrator-animal-planet":{ label: "Narrator male 3 - 50s",         gender: "male",   age: "50s" },
  "narrator-cinematic":   { label: "Narrator male 4 - 30s",          gender: "male",   age: "30s" },
  "narrator-bbc-calm":    { label: "Narrator male 5 - 40s",          gender: "male",   age: "40s" },
  "narrator-science":     { label: "Narrator male 6 - mid-20s", gender: "male",   age: "mid-20s" },
  "narrator-reflection":  { label: "Narrator female 2 - adult",       gender: "female", age: "adult" },
  "character-hero":       { label: "Male 1 - young",                  gender: "male",   age: "young adult" },
  "character-villain":    { label: "Male 2 - 40s",                   gender: "male",   age: "40s" },
  "character-child-girl-6":{ label: "Child girl 1 - age 6",          gender: "female", age: "child 6" },
  "character-child-girl-9":{ label: "Child girl 2 - age 9",          gender: "female", age: "child 9" },
  "character-child-boy-8": { label: "Child boy 1 - age 8",           gender: "male",   age: "child 8" },
  "character-child-boy-10":{ label: "Child boy 2 - age 10",         gender: "male",   age: "child 10" },
};

export const KITTEN_VOICE_META: Record<string, VoiceA3Meta> = {
  // Male adult (verified by median-F0 check, Octave 2026-11)
  "Marcus":   { label: "Male 1 - adult",   gender: "male",  age: "adult" },
  "Laurence": { label: "Male 2 - adult",   gender: "male",  age: "adult" },
  "Jasper":   { label: "Male 3 - adult",   gender: "male",  age: "adult" },
  "Bruno":    { label: "Male 4 - adult",   gender: "male",  age: "adult" },
  "Victor":   { label: "Male 5 - adult",   gender: "male",  age: "adult" },
  "Elliot":   { label: "Male 6 - adult",   gender: "male",  age: "adult" },
  "Hugo":     { label: "Male 7 - adult",   gender: "male",  age: "adult" },
  "Matthew":  { label: "Male 8 - adult",   gender: "male",  age: "adult" },
  "Dante":    { label: "Male 9 - adult",   gender: "male",  age: "adult" },
  // Male old
  "Walter":   { label: "Male old 1 - senior", gender: "male", age: "senior" },
  "Alfred":   { label: "Male old 2 - senior", gender: "male", age: "senior" },
  "Herbert":  { label: "Male old 3 - senior", gender: "male", age: "senior" },
  // Male young
  "Leo":      { label: "Male young 1 - young adult", gender: "male", age: "young adult" },
  // Female adult
  "Diana":    { label: "Female 1 - adult", gender: "female", age: "adult" },
  "Luna":     { label: "Female 2 - adult", gender: "female", age: "adult" },
  "Maeve":    { label: "Female 3 - adult", gender: "female", age: "adult" },
  "Raven":    { label: "Female 4 - adult", gender: "female", age: "adult" },
  "Willow":   { label: "Female 5 - adult", gender: "female", age: "adult" },
  "Saoirse":  { label: "Female 6 - adult", gender: "female", age: "adult" },
  "Claire":   { label: "Female 7 - adult", gender: "female", age: "adult" },
  // Female young
  "Rosie":    { label: "Female young 1 - young adult", gender: "female", age: "young adult" },
  "Kiki":     { label: "Female young 2 - young adult", gender: "female", age: "young adult" },
  // Female old
  "Dolores":  { label: "Female old 1 - senior", gender: "female", age: "senior" },
};

export function voiceMeta(id: string | undefined | null): VoiceA3Meta | undefined {
  if (!id) return undefined;
  return VOXCPM_META[id] ?? KITTEN_VOICE_META[id];
}

export function voxSeed(voice: string | undefined): number | undefined {
  if (!voice) return undefined;
  const preset = VOXCPM_VOICE_DESCRIPTIONS.find((v) => v.id === voice);
  return preset?.seed;
}

/**
 * Resolved voice-reference directory name (under public/voice/references) for a
 * preset that is cloned from a frozen reference clip. Returns undefined for
 * voices that are plain voice-design presets.
 */
export function voxReferenceId(voice: string | undefined): string | undefined {
  if (!voice) return undefined;
  const preset = VOXCPM_VOICE_DESCRIPTIONS.find((v) => v.id === voice);
  return preset?.referenceId;
}
export function voiceLabel(id: string | undefined | null): string {
  if (!id) return "";
  const m = voiceMeta(id);
  if (m) return m.label;
  if (typeof VOICE_PACE_MEASURED[id] !== "undefined" && id.includes("-") === false) return id;
  return id;
}
