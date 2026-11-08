/**
 * lib/format.ts, small formatting helpers shared by the screens: lengths,
 * dates, video shapes, voice names and friendlier server messages.
 */

export type VideoFormat = "9:16" | "16:9" | "1:1";

export interface FormatInfo {
  name: string;
  ratio: VideoFormat;
  use: string;
  range: string;
  /** Longest length the server accepts, in seconds. */
  max: number;
  /** Length presets offered on the format screen, in seconds. */
  presets: number[];
}

export const FORMATS: Record<VideoFormat, FormatInfo> = {
  "9:16": { name: "Vertical", ratio: "9:16", use: "Shorts, Reels, TikTok", range: "15 to 90 seconds", max: 90, presets: [15, 30, 45, 60, 90] },
  "16:9": { name: "Landscape", ratio: "16:9", use: "YouTube, long videos", range: "up to 10 minutes", max: 600, presets: [60, 120, 180, 300, 600] },
  "1:1": { name: "Square", ratio: "1:1", use: "Feeds and posts", range: "up to 90 seconds", max: 90, presets: [15, 30, 60, 90] },
};

export const MIN_LENGTH_SEC = 8;

/** 26 s, 1 min 5 s, 10 min. */
export function formatSeconds(value: number | string | undefined | null): string {
  const sec = Number(value);
  if (!Number.isFinite(sec) || sec <= 0) return "";
  const total = Math.round(sec);
  if (total < 60) return `${total} s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}

/** 0:26, 1:05 (a player-style clock). */
export function formatClock(value: number | string | undefined | null): string {
  const sec = Number(value);
  if (!Number.isFinite(sec) || sec <= 0) return "";
  const total = Math.round(sec);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Milliseconds from a number or an ISO date string (reports use both). */
export function timeOf(value: number | string | undefined | null): number {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") return value;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) return asNumber;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

/** 26 Oct 2026 */
export function formatDate(value: number | string | undefined | null): string {
  const t = timeOf(value);
  if (!t) return "";
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** 26 Oct 2026, 14:05 */
export function formatDateTime(value: number | string | undefined | null): string {
  const t = timeOf(value);
  if (!t) return "";
  return new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** The format a pixel size is closest to. */
export function formatFromSize(width: number, height: number): VideoFormat | undefined {
  if (!width || !height) return undefined;
  const r = width / height;
  if (r < 0.8) return "9:16";
  if (r > 1.25) return "16:9";
  return "1:1";
}

/** Videos made by the milestone scripts carry their shape in the id (for example ending in -9x16). */
export function formatFromId(id: string): VideoFormat | undefined {
  const m = /(^|-)(9x16|16x9|1x1)(-|$)/.exec(id);
  if (!m) return undefined;
  return m[2].replace("x", ":") as VideoFormat;
}

/** "narrator-calm" reads as "Narrator calm"; preset names stay as they are. */
import { voiceLabel as voxVoiceLabel } from "../../../src/generator/voices";

export function prettyVoice(id: string | undefined | null): string {
  if (!id) return "";
  const labelled = voxVoiceLabel(id);
  if (labelled && labelled !== id) return labelled;
  if (!id.includes("-")) return id;
  const words = id.split("-").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const ENGINE_LABELS: Record<string, string> = {
  kitten2: "KittenTTS 2",
  voxcpm2: "VoxCPM2",
};

/** En and em dash (char codes, so this file stays dash-free). */
const LONG_DASH = new RegExp(" *[" + String.fromCharCode(0x2013, 0x2014) + "] *", "g");

/** Server messages name the old tabs; point at the new places instead. */
export function friendlyError(message: string): string {
  return message
    .replace(/^Error:\s*/, "")
    // Server messages may carry long dashes; the dashboard writes commas.
    .replace(LONG_DASH, ", ")
    .replace(/Providers\s*\S{1,2}\s*Model roles/g, "Settings, AI models, Model roles")
    .replace(/the Providers tab/gi, "Settings, AI models")
    .replace(/the Setup tab/gi, "Settings, Voice engines")
    .replace(/from Step 1/gi, "from the first step");
}

/** Does this message come from a missing key, provider or model? */
export function isSetupProblem(message: string): "models" | "voice" | null {
  if (/api key|provider|model roles|no model chosen|not reachable/i.test(message)) return "models";
  if (/engine not installed|voice engines/i.test(message)) return "voice";
  return null;
}
