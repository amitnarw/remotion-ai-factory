/**
 * WhatIfVideo/audio.tsx — renders every SFX cue and ambient bed from the spec.
 * Frame-exact: trimBefore = t * fps for one-shots; trimBefore + durationInFrames
 * for beds. Sync is arithmetic (frame = t * fps), so picture, caption, timer
 * and audio can never drift.
 * SFX files live in public/sfx/<tag>.wav (built by scripts/setup-sfx.ts).
 */
import * as React from "react";
import { Audio, staticFile } from "remotion";
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
      {/* One-shot SFX pinned to event frames */}
      {events.flatMap((ev) =>
        (ev.sfx ?? []).map((cue, i) => {
          const startFrame = cue.at ?? secToFrame(ev.t, fps);
          return (
            <Audio
              key={`${ev.name}-${i}`}
              src={sfxPath(cue.tag)}
              startFrom={startFrame}
              volume={1}
            />
          );
        })
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
            startFrom={fromFrame}
            durationInFrames={toFrame ? toFrame - fromFrame : undefined}
            volume={vol}
          />
        );
      })}
    </>
  );
};
