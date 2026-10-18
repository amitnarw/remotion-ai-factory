/**
 * WhatIfVideo/audio.tsx — renders every SFX cue and ambient bed from the spec.
 * Frame-exact: cues are delayed with <Sequence from={frame}> and play the file
 * from its beginning; ambient beds slice the SOURCE with startFrom (that's
 * trimming semantics). Sync is arithmetic (frame = t * fps), so picture,
 * caption, timer and audio can never drift.
 * SFX files live in public/sfx/<tag>.wav (built by scripts/setup-sfx.ts).
 *
 * CRITICAL: <Audio startFrom={N}> skips the first N frames OF THE FILE —
 * it does NOT delay playback. Delaying a one-shot = wrap in <Sequence from>.
 */
import * as React from "react";
import { Audio, Sequence, interpolate, staticFile } from "remotion";
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
      {/* One-shot SFX pinned to event frames via Sequence (delay semantics).
          cue.at / cue.to are SECONDS — convert with secToFrame. */}
      {events.flatMap((ev, ei) =>
        (ev.sfx ?? []).map((cue, i) => {
          const at = secToFrame((cue.at ?? ev.t) as number, fps);
          const to = cue.to ? secToFrame(cue.to as number, fps) : undefined;
          const seqDuration = to ? Math.max(2, to - at) : undefined;
          return (
            <Sequence
              key={`${ev.name}-${ei}-${i}`}
              from={Math.max(0, at)}
              durationInFrames={seqDuration}
            >
              <Audio
                src={sfxPath(cue.tag)}
                volume={(f: number) => {
                  if (!seqDuration) return cue.volume === "ramp-down" ? 1 : 1;
                  if (cue.volume === "ramp-up") {
                    return interpolate(f, [0, seqDuration], [0.05, 1]);
                  }
                  if (cue.volume === "ramp-down") {
                    return interpolate(f, [0, seqDuration], [1, 0.02]);
                  }
                  return 1;
                }}
              />
            </Sequence>
          );
        }),
      )}

      {/* Ambient beds — these SLICE the source (trim semantics intended). */}
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
