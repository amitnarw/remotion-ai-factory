/**
 * The choices made in the Create wizard: the idea, the format and length,
 * the voices and the caption look. One shared store, saved in localStorage
 * (the same keys as before, plus the idea), so every step and a page reload
 * see the same choices.
 */
import { useSyncExternalStore } from "react";
import type { CaptionStyleInput } from "../../../../src/generator/caption-style";
import { FORMATS, MIN_LENGTH_SEC, type VideoFormat } from "../../lib/format";

const IDEA_LS_KEY = "vf:idea";
const VOICE_LS_KEY = "vf:voiceConfig";
const VIDEO_LS_KEY = "vf:videoSettings";
const CAPTION_LS_KEY = "vf:captionStyle";

/** Production settings chosen before writing the plan (sent as spec.settings). */
export interface VideoSettingsForm {
  format: VideoFormat;
  /** Seconds the writer should aim for; blank = automatic. */
  targetDuration: string;
  /** Scenes; blank = automatic. */
  sceneCount: string;
  quality: "draft" | "final";
  /** One extra AI pass that rewrites weak beats before you review. */
  critic?: boolean;
}

/** Narration (the story read aloud) and character voices (dialogue) are independent. */
export interface VoiceConfig {
  narrationOn: boolean;
  narrationEngine: "kitten2" | "voxcpm2";
  narrationVoice: string;
  narrationVoiceDesc: string;
  charactersOn: boolean;
  charactersEngine: "kitten2" | "voxcpm2";
  characterVoice: string;
}

export interface WizardState {
  idea: string;
  video: VideoSettingsForm;
  voice: VoiceConfig;
  captions: CaptionStyleInput;
}

export const MIN_IDEA_LENGTH = 6;

export function defaultVideoSettings(): VideoSettingsForm {
  return { format: "9:16", targetDuration: "", sceneCount: "", quality: "final" };
}

export function defaultVoiceConfig(): VoiceConfig {
  return {
    narrationOn: false,
    narrationEngine: "voxcpm2",
    narrationVoice: "narrator-calm",
    narrationVoiceDesc: "Calm male narrator, mid-30s, steady pace, documentary tone",
    charactersOn: false,
    charactersEngine: "kitten2",
    characterVoice: "Rosie",
  };
}

/** The voice an engine starts with, for the narrator and for characters. */
export const DEFAULT_VOICES = {
  narration: { kitten2: "Bruno", voxcpm2: "narrator-calm" },
  characters: { kitten2: "Rosie", voxcpm2: "character-hero" },
} as const;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode or full storage: the choice lives for this page only */
  }
}

function loadVideoSettings(): VideoSettingsForm {
  try {
    const raw = read(VIDEO_LS_KEY);
    if (raw) {
      const parsed = { ...defaultVideoSettings(), ...JSON.parse(raw) } as VideoSettingsForm;
      if (!FORMATS[parsed.format]) parsed.format = "9:16";
      return parsed;
    }
  } catch { /* ignore */ }
  return defaultVideoSettings();
}

/** Reads the current shape, and converts the old single "mode" setting once. */
function loadVoiceConfig(): VoiceConfig {
  try {
    const raw = read(VOICE_LS_KEY);
    if (!raw) return defaultVoiceConfig();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if ("mode" in parsed) {
      const mode = parsed.mode as string;
      return {
        ...defaultVoiceConfig(),
        narrationOn: mode === "narration" || mode === "both",
        charactersOn: mode === "dialogs" || mode === "both",
        narrationEngine: (parsed.narrationEngine as VoiceConfig["narrationEngine"]) ?? "voxcpm2",
        narrationVoice: (parsed.narrationVoice as string) ?? "narrator-calm",
        narrationVoiceDesc: (parsed.narrationVoiceDesc as string) ?? defaultVoiceConfig().narrationVoiceDesc,
        charactersEngine: (parsed.dialogsEngine as VoiceConfig["charactersEngine"]) ?? "kitten2",
      };
    }
    return { ...defaultVoiceConfig(), ...parsed } as VoiceConfig;
  } catch {
    return defaultVoiceConfig();
  }
}

/** The caption look the user last chose (empty = the default preset). */
function loadCaptionStyle(): CaptionStyleInput {
  try {
    const raw = read(CAPTION_LS_KEY);
    if (raw) return JSON.parse(raw) as CaptionStyleInput;
  } catch { /* ignore */ }
  return {};
}

let state: WizardState = {
  idea: read(IDEA_LS_KEY) ?? "",
  video: loadVideoSettings(),
  voice: loadVoiceConfig(),
  captions: loadCaptionStyle(),
};
const listeners = new Set<() => void>();

export function getWizard(): WizardState {
  return state;
}

/** Change some choices; each changed part is saved right away. */
export function updateWizard(patch: Partial<WizardState>): void {
  state = { ...state, ...patch };
  if (patch.idea !== undefined) write(IDEA_LS_KEY, patch.idea);
  if (patch.video) write(VIDEO_LS_KEY, JSON.stringify(patch.video));
  if (patch.voice) write(VOICE_LS_KEY, JSON.stringify(patch.voice));
  if (patch.captions) write(CAPTION_LS_KEY, JSON.stringify(patch.captions));
  listeners.forEach((l) => l());
}

export function useWizard(): WizardState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
}

/** The custom length, checked: a message when it is out of range. */
export function lengthProblem(video: VideoSettingsForm): string | null {
  if (!video.targetDuration.trim()) return null;
  const n = Number(video.targetDuration);
  const max = FORMATS[video.format].max;
  if (!Number.isFinite(n) || n < MIN_LENGTH_SEC || n > max) {
    return `Choose a length from ${MIN_LENGTH_SEC} to ${max} seconds for ${FORMATS[video.format].name.toLowerCase()} videos.`;
  }
  return null;
}

export function sceneProblem(video: VideoSettingsForm): string | null {
  if (!video.sceneCount.trim()) return null;
  const n = Number(video.sceneCount);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? null : "Choose from 1 to 12 scenes.";
}

/** Turn the form into the settings object the server validates. */
export function videoSettingsToPayload(form: VideoSettingsForm): Record<string, unknown> {
  const payload: Record<string, unknown> = { format: form.format, quality: form.quality, critic: !!form.critic };
  const dur = Number(form.targetDuration);
  if (form.targetDuration.trim() && dur > 0) {
    const max = FORMATS[form.format].max;
    payload.targetDuration = Math.min(max, Math.max(MIN_LENGTH_SEC, dur));
  }
  const scenes = Number(form.sceneCount);
  if (form.sceneCount.trim() && scenes >= 1) payload.sceneCount = Math.min(12, Math.round(scenes));
  return payload;
}

/** The audio block the server and generator receive. */
export function voiceConfigToAudio(cfg: VoiceConfig): unknown {
  return {
    narration: cfg.narrationOn
      ? { enabled: true, engine: cfg.narrationEngine, voice: cfg.narrationVoice }
      : { enabled: false },
    dialogs: cfg.charactersOn
      ? { enabled: true, engine: cfg.charactersEngine, defaultVoice: cfg.characterVoice }
      : { enabled: false },
  };
}
