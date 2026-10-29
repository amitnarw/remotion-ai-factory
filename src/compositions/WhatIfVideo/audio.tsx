/**
 * WhatIfVideo/audio.tsx — plays the mix the resolver prepared (audio-resolve.ts):
 * one-shot sound effects, scene-cut whooshes, ambience beds and background music,
 * and the narration / dialogue lines.
 *
 * Music and beds duck under speech. Their level drops by DUCK_DEPTH (-8 dB)
 * while a voice line is playing, easing in before it and out after it.
 * Every cue is at the level its gain gives it, so no sound is set by ear.
 */
import * as React from "react";
import { Audio, Sequence, interpolate, staticFile } from "remotion";
import { secToFrame } from "../../generator/timing";
import { ShotSpec } from "../../generator/spec.schema";

interface CompositionAudioProps {
  spec: ShotSpec;
  fps: number;
}

const DUCK_DEPTH = 0.6; // 1 - 0.6 = 0.4 of the level, about -8 dB under speech
const DUCK_ATTACK = 0.2; // seconds before a line the music starts to dip
const DUCK_RELEASE = 0.4; // seconds after a line the music returns
const VOICE_DEFAULT_GAIN = 0.9;

/** Duck factor (1 = full level, 1 - DUCK_DEPTH = fully ducked) at a time in seconds. */
function duckFactor(voices: Array<{ at: number; dur?: number }>): (sec: number) => number {
  const spans = voices.map((v) => {
    const end = v.at + (v.dur ?? 2);
    return { start: v.at, end };
  });
  return (sec: number) => {
    let env = 0;
    for (const s of spans) {
      let e = 0;
      if (sec >= s.start - DUCK_ATTACK && sec < s.start) e = (sec - (s.start - DUCK_ATTACK)) / DUCK_ATTACK;
      else if (sec >= s.start && sec <= s.end) e = 1;
      else if (sec > s.end && sec <= s.end + DUCK_RELEASE) e = 1 - (sec - s.end) / DUCK_RELEASE;
      env = Math.max(env, e);
    }
    return 1 - DUCK_DEPTH * env;
  };
}

/** Local file, or the synthesized fallback in public/sfx. */
function sfxSrc(cue: { tag: string; file?: string }): string {
  return cue.file ? staticFile(cue.file) : staticFile(`sfx/${cue.tag}.wav`);
}

function warmUp(volume: number | ((f: number) => number)): (f: number) => number {
  return (f: number) => {
    if (f < 1) return 0;
    return typeof volume === "function" ? volume(f) : volume;
  };
}

export const CompositionAudio: React.FC<CompositionAudioProps> = ({ spec, fps }) => {
  const events = spec.events ?? [];
  const audio = spec.audio ?? {};
  const ambient = audio.ambient ?? [];
  const voiceFiles = audio.voiceFiles ?? [];
  const music = audio.music ?? [];
  const transitions = audio.transitions ?? [];
  const duration = Math.max(...spec.scenes.map((s) => s.to));
  const duck = duckFactor(voiceFiles);

  return (
    <>
      {events.flatMap((ev, ei) =>
        (ev.sfx ?? []).map((cue, i) => {
          const at = secToFrame((cue.at ?? ev.t) as number, fps);
          const to = cue.to ? secToFrame(cue.to as number, fps) : undefined;
          const seqDuration = to ? Math.max(2, to - at) : undefined;
          const gain = cue.gain ?? 1;
          return (
            <Sequence key={`${ev.name}-${ei}-${i}`} from={Math.max(0, at)} durationInFrames={seqDuration}>
              <Audio
                src={sfxSrc(cue)}
                volume={warmUp((f: number) => {
                  if (!seqDuration) return gain;
                  if (cue.volume === "ramp-up") return interpolate(f, [0, seqDuration], [0.05, 1]) * gain;
                  if (cue.volume === "ramp-down") return interpolate(f, [0, seqDuration], [1, 0.02]) * gain;
                  return gain;
                })}
              />
            </Sequence>
          );
        }),
      )}

      {transitions.map((tr, i) => (
        <Sequence key={`cut-${i}`} from={Math.max(0, secToFrame(tr.t, fps))}>
          <Audio src={tr.file ? staticFile(tr.file) : staticFile("sfx/whoosh_dissolve.wav")} volume={tr.gain ?? 1} />
        </Sequence>
      ))}

      {ambient.map((bed, i) => {
        const fromFrame = secToFrame(bed.from, fps);
        const toFrame = bed.to ? secToFrame(bed.to, fps) : undefined;
        // A library bed is already at its target loudness (gain), so `vol` is a
        // relative trim around the 0.35 default. A synthesized bed keeps `vol` as-is.
        const level = bed.file
          ? (bed.gain ?? 1) * Math.min(2, Math.max(0.25, (bed.vol ?? 0.35) / 0.35))
          : bed.vol ?? 0.35;
        const src = bed.file ? staticFile(bed.file) : staticFile(`sfx/${bed.tag}.wav`);
        // Beds always loop from the start of the file, so they never run out
        // before the scene ends (synthesized beds are 30 s, videos can be longer).
        return (
          <Sequence
            key={`ambient-${i}`}
            from={Math.max(0, fromFrame)}
            durationInFrames={toFrame ? Math.max(2, toFrame - fromFrame) : undefined}
          >
            <Audio
              src={src}
              loop
              loopVolumeCurveBehavior="extend"
              volume={(f: number) => level * duck((fromFrame + f) / fps)}
            />
          </Sequence>
        );
      })}

      {music.map((m, i) => {
        if (!m.file) return null;
        const fromFrame = secToFrame(m.from, fps);
        const end = m.to ?? duration;
        const toFrame = secToFrame(end, fps);
        const fadeIn = m.fadeIn ?? 1;
        const fadeOut = m.fadeOut ?? 1.5;
        const level = m.gain ?? 1;
        return (
          <Sequence key={`music-${i}`} from={Math.max(0, fromFrame)} durationInFrames={Math.max(2, toFrame - fromFrame)}>
            <Audio
              src={staticFile(m.file)}
              loop={m.loop ?? true}
              loopVolumeCurveBehavior="extend"
              volume={(f: number) => {
                const sec = (fromFrame + f) / fps;
                const fade = Math.min(
                  fadeIn > 0 ? Math.min(1, (sec - m.from) / fadeIn) : 1,
                  fadeOut > 0 ? Math.min(1, (end - sec) / fadeOut) : 1,
                );
                return level * Math.max(0, fade) * duck(sec);
              }}
            />
          </Sequence>
        );
      })}

      {voiceFiles.map((vf, i) => {
        const at = secToFrame(vf.at ?? 0, fps);
        return (
          <Sequence key={`voice-${i}`} from={Math.max(0, at)}>
            <Audio src={staticFile(vf.file)} volume={warmUp(vf.gain ?? VOICE_DEFAULT_GAIN)} />
          </Sequence>
        );
      })}
    </>
  );
};
