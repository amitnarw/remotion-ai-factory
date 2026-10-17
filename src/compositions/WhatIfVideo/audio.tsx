/**
 * WhatIfVideo/audio.tsx — renders every SFX cue and ambient bed from the spec.
 * Frame-exact: trimBefore = t * fps for one-shots; trimBefore + durationInFrames
 * for beds. Sync is arithmetic (frame = t * fps), so picture, caption, timer
 * and audio can never drift.
 * SFX files live in public/sfx/<tag>.wav (built by scripts/setup-sfx.ts).
 */
import * as React from "react";
import { Audio, interpolate, staticFile } from "remotion";
import { secToFrame } from "../../generator/timing";
import { ShotSpec } from "../../generator/spec.schema";

interface CompositionAudioProps {
  spec: ShotSpec;
  fps: number;
}

function sfxPath(tag: string): string {
  return staticFile(`sfx/${tag}.wav`);
}

export const CompositionAudio: React.FC<CompositionAudioProps> = ({
  spec,
  fps,
}) => {
  const events = spec.events ?? [];
  const ambient = spec.audio?.ambient ?? [];

  return (
    <>
      {/* One-shot SFX pinned to event frames.
          CRITICAL: cue.at / cue.to are SECONDS — convert with secToFrame.
          (Passing seconds as frames used to cram EVERY cue into the first
          0.13s of the video → one mushed blast, then silence.) */}
      {events.flatMap((ev, ei) =>
        (ev.sfx ?? []).map((cue, i) => {
          const startFrame = secToFrame((cue.at ?? ev.t) as number, fps);
          const endFrame = cue.to ? secToFrame(cue.to as number, fps) : undefined;
          const duration = endFrame
            ? Math.max(2, endFrame - startFrame)
            : undefined;
          return (
            <Audio
              key={`${ev.name}-${ei}-${i}`}
              src={sfxPath(cue.tag)}
              startFrom={Math.max(0, startFrame)}
              durationInFrames={duration}
              volume={(f: number) => {
                // Per-cue envelope: ramp-up / ramp-down / hold.
                if (!duration) return 1;
                if (cue.volume === "ramp-up") {
                  return interpolate(f, [0, duration], [0.05, 1]);
                }
                if (cue.volume === "ramp-down") {
                  return interpolate(f, [0, duration], [1, 0.02]);
                }
                return 1;
              }}
            />
          );
        }),
      )}

      {/* Ambient beds */}
      {ambient.map((bed, i) => {
        const fromFrame = secToFrame(bed.from, fps);
        const toFrame = bed.to ? secToFrame(bed.to, fps) : undefined;
        const vol = bed.vol ?? 0.3;
        return (
          <Audio
            key={`ambient-${i}`}
            src={sfxPath(bed.tag)}
            startFrom={Math.max(0, fromFrame)}
            durationInFrames={toFrame ? Math.max(2, toFrame - fromFrame) : undefined}
            volume={vol}
          />
        );
      })}
    </>
  );
};
