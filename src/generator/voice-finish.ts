import { runFfmpeg } from "./ffmpeg";

/**
 * Cinematic voice finish chain for a single voice file.
 * HPF 70 Hz, low-shelf weight, presence lift, gentle 2.5:1 compression,
 * de-ess. Loudness is intentionally left to audio-master.ts (single authority).
 * Returns true when the output file was written successfully.
 */
export function finishVoiceFile(input: string, output: string): boolean {
  const af = [
    "highpass=f=70",
    "equalizer=f=150:width_type=o:width=2:g=3",
    "equalizer=f=3500:width_type=o:width=1:g=1.5",
    "acompressor=threshold=-20dB:ratio=2.5:attack=10:release=100",
    "equalizer=f=7000:width_type=o:width=2:g=-3",
  ].join(",");
  const r = runFfmpeg(["-y", "-i", input, "-af", af, "-ar", "48000", "-ac", "1", output]);
  return r.ok;
}
