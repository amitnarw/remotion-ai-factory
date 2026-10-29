/**
 * src/generator/render/audio.ts — the audio track, rendered once and cached.
 *
 * Renders the WhatIfAudio composition (WhatIfVideo's <CompositionAudio> with
 * no picture) to a 48 kHz WAV. The file is cached as
 * output/<id>/chunks/audio-<key>.wav, keyed by the spec's audio parts and the
 * content of every sound file it plays (plan.ts audioKey), so a caption or
 * shot edit reuses it and a voice or music edit renders it again.
 */
import { existsSync, readdirSync, renameSync, rmSync, statSync } from "fs";
import { join } from "path";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { BrowserPool } from "./browser";

export const AUDIO_COMP_ID = "WhatIfAudio";

export async function renderAudioTrack(opts: {
  dir: string;
  key: string;
  serveUrl: string;
  inputProps: Record<string, unknown>;
  pool: BrowserPool;
  /** The video's length: the audio composition must match it exactly. */
  durationInFrames: number;
  log: (line: string) => void;
}): Promise<{ file: string; reused: boolean; seconds: number }> {
  const t0 = Date.now();
  const file = join(opts.dir, `audio-${opts.key}.wav`);
  if (existsSync(file) && statSync(file).size > 44) {
    opts.log(`[audio] track reused (${opts.key.slice(0, 10)})`);
    return { file, reused: true, seconds: 0 };
  }
  const browser = await opts.pool.get();
  const composition = await selectComposition({
    serveUrl: opts.serveUrl,
    id: AUDIO_COMP_ID,
    inputProps: opts.inputProps,
    puppeteerInstance: browser,
    logLevel: "warn",
  });
  if (composition.durationInFrames !== opts.durationInFrames) {
    throw new Error(`${AUDIO_COMP_ID} is ${composition.durationInFrames} frames but the video is ${opts.durationInFrames}`);
  }
  const tmp = join(opts.dir, `audio-${opts.key}.part.wav`);
  rmSync(tmp, { force: true });
  await renderMedia({
    serveUrl: opts.serveUrl,
    composition,
    inputProps: opts.inputProps,
    codec: "wav",
    outputLocation: tmp,
    puppeteerInstance: browser,
    timeoutInMilliseconds: 180000,
    overwrite: true,
    logLevel: "warn",
  });
  renameSync(tmp, file);
  // Only the current track is kept: the WAV is quick to make and large.
  for (const name of readdirSync(opts.dir)) {
    if (/^audio-[0-9a-f]+\.wav$/.test(name) && name !== `audio-${opts.key}.wav`) rmSync(join(opts.dir, name), { force: true });
  }
  const seconds = (Date.now() - t0) / 1000;
  opts.log(`[audio] track rendered in ${seconds.toFixed(1)}s`);
  return { file, reused: false, seconds };
}
