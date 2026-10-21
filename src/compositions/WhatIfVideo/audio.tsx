/**
 * WhatIfVideo/audio.tsx — renders every SFX cue, ambient bed, and voice track.
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

function warmUp(volume: number | ((f: number) => number)): (f: number) => number {
  return (f: number) => {
    if (f < 1) return 0;
    return typeof volume === "function" ? volume(f) : volume;
  };
}

export const CompositionAudio: React.FC<CompositionAudioProps> = ({ spec, fps }) => {
  const events = spec.events ?? [];
  const ambient = spec.audio?.ambient ?? [];
  const voiceFiles = (spec.audio as any)?.voiceFiles ?? [];

  return (
    <>
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
                volume={warmUp((f: number) => {
                  if (!seqDuration) return cue.volume === "ramp-down" ? 1 : 1;
                  if (cue.volume === "ramp-up") {
                    return interpolate(f, [0, seqDuration], [0.05, 1]);
                  }
                  if (cue.volume === "ramp-down") {
                    return interpolate(f, [0, seqDuration], [1, 0.02]);
                  }
                  return 1;
                })}
              />
            </Sequence>
          );
        }),
      )}

      {ambient.map((bed, i) => {
        const fromFrame = secToFrame(bed.from, fps);
        const toFrame = bed.to ? secToFrame(bed.to, fps) : undefined;
        const vol = bed.vol ?? 0.35;
        return (
          <Sequence key={`ambient-${i}`} from={Math.max(0, fromFrame)}>
            <Audio
              src={sfxPath(bed.tag)}
              startFrom={Math.max(0, fromFrame)}
              durationInFrames={toFrame ? Math.max(2, toFrame - fromFrame) : undefined}
              volume={vol}
            />
          </Sequence>
        );
      })}

      {voiceFiles.map((vf: any, i: number) => {
        const at = secToFrame(vf.at ?? 0, fps);
        return (
          <Sequence key={`voice-${i}`} from={Math.max(0, at)}>
            <Audio src={staticFile(vf.file)} volume={warmUp(0.9)} />
          </Sequence>
        );
      })}
    </>
  );
};