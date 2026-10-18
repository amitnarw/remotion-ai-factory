/**
 * src/whatif/storyboard/video.tsx — the generic storyboard renderer.
 *
 * ONE component renders ANY approved storyboard: beats → scenes, camera moves,
 * blob performance, BigType text, burned-in captions, continuous ambience,
 * placed SFX cues, synthesized music and KittenTTS narration/dialogue. No
 * per-video code is ever written again — every story is purely data.
 *
 * Registered per slug via generated wrappers (scripts/storyboard-codegen.ts).
 */
import * as React from "react";
import { Audio, Sequence, staticFile, useVideoConfig, getInputProps } from "remotion";
import { GrainVignette } from "../components/GrainVignette";
import { BigType, type BigTypeLine } from "../components/BigType";
import { CaptionBar, type CaptionCue } from "../components/CaptionBar";
import { Blob, PropMug } from "../components/Blob";
import { TechVoid } from "../scenes/TechVoid";
import { Room } from "../scenes/Room";
import { CityNight } from "../scenes/CityNight";
import { Sky } from "../scenes/Sky";
import { CameraShot } from "./camera";
import { type Storyboard } from "./schema";
import type { SfxInputProps } from "../audio/use-sfx";

/* Per-role mix levels (tuned against the reference mix). */
const SFX_VOLUME: Record<string, number> = {
  rumble_deep: 1.0,
  scream_distant: 0.95,
  impact_soft_bodies: 0.9,
  whoosh_dissolve: 0.85,
  rise_short: 0.9,
  pop_light: 0.6,
  clothing_flutter: 0.5,
};

const GROUND_Y = 1470; // shared ground line across kit scenes (design px)

/** Scale beats to hit the target duration EXACTLY (LLMs drift by ±0.5s). */
function rebudget(sb: Storyboard): Array<{ beat: Storyboard["beats"][number]; startSec: number; durSec: number }> {
  const rawSum = sb.beats.reduce((a, b) => a + b.seconds, 0) || 1;
  const k = sb.targetSeconds / rawSum;
  let t = 0;
  return sb.beats.map((beat) => {
    const durSec = beat.seconds * k;
    const out = { beat, startSec: t, durSec };
    t += durSec;
    return out;
  });
}

/** Per-speaker volume balance — narration reads over everything. */
const VOICE_VOLUME = { narrator: 1.15, character: 1.05 } as const;

export const StoryboardVideo: React.FC<{
  storyboard: Storyboard;
  /** Slug — locates the synthesized music + voice files. */
  slug: string;
}> = ({ storyboard: sb, slug }) => {
  const { fps } = useVideoConfig();
  const inputProps = getInputProps() as unknown as SfxInputProps & {
    /** VO-driven final beat durations (seconds) — set by scripts/render-storyboard.ts. */
    beatTiming?: number[];
  };
  /** Sound-design-aware SFX file (falls back to the synth default). */
  const sfxFile = (role: string): string =>
    inputProps.sfxFileMap?.[role] ?? `sfx/${role}.wav`;

  const timings = React.useMemo<{ beat: Storyboard["beats"][number]; startSec: number; durSec: number }[]>(() => {
    if (inputProps.beatTiming?.length === sb.beats.length) {
      let t = 0;
      return sb.beats.map((beat, i) => {
        const out = { beat, startSec: t, durSec: inputProps.beatTiming![i] };
        t += out.durSec;
        return out;
      });
    }
    return rebudget(sb);
  }, [sb, inputProps.beatTiming]);

  /* Captions — one CaptionBar for the whole film (burned-in captions are a
     proven retention win). Narrator + character lines appear while spoken. */
  const cues: CaptionCue[] = React.useMemo(() => {
    const out: CaptionCue[] = [];
    for (const { beat, startSec, durSec } of timings) {
      const line = beat.narration ?? beat.dialogue;
      if (!line || sb.voice.mode === "silent") continue;
      const words = line.trim().split(/\s+/);
      const estDur = Math.min(durSec - 0.2, Math.max(1.0, words.length / 2.4 + 0.45));
      const speaker = beat.dialogue && !beat.narration ? "blob" : undefined;
      out.push({
        text: speaker ? `— ${line}` : line,
        from: startSec + 0.15,
        to: Math.min(startSec + durSec - 0.05, startSec + 0.15 + estDur),
      });
    }
    return out;
  }, [timings, sb.voice.mode]);

  return (
    <div style={{ flex: 1, background: "#000" }}>
      {/* Continuous ambience bed */}
      {sb.ambience !== "none" ? (
        <Audio
          src={staticFile(sfxFile(sb.ambience === "ambient_tense" ? "ambient_tense" : "wind_city"))}
          volume={sb.ambience === "ambient_tense" ? 0.22 : 0.14}
        />
      ) : null}
      {/* Music bed */}
      <Audio src={staticFile(`whatif-audio/${slug}/music.wav`)} volume={0.2} />

      {/* Narration / dialogue, beat-locked */}
      {timings.map(({ beat, startSec }, i) => {
        if (sb.voice.mode === "silent") return null;
        const isNarrator = Boolean(beat.narration);
        const line = beat.narration ?? beat.dialogue;
        if (!line) return null;
        // In "narrator" mode even dialogue-flavored lines are narrated;
        // in "character" mode everything is the blob; "both" splits by line.
        const speaker =
          sb.voice.mode === "character" ? "character" : sb.voice.mode === "narrator" ? "narrator" : isNarrator ? "narrator" : "character";
        const file = `whatif-audio/${slug}/voice/beat-${i}-${speaker === "narrator" ? "n" : "c"}.wav`;
        return (
          <Sequence key={`vo-${i}`} from={Math.round((startSec + 0.1) * fps)}>
            <Audio src={staticFile(file)} volume={VOICE_VOLUME[speaker as "narrator" | "character"]} />
          </Sequence>
        );
      })}

      {/* Beats */}
      {timings.map(({ beat, startSec, durSec }, i) => {
        const from = Math.round(startSec * fps);
        const len = Math.max(1, Math.round(durSec * fps));
        const isHook = i === 0;
        return (
          <Sequence key={`beat-${i}`} from={from} durationInFrames={len}>
            <CameraShot beat={beat} durationInFrames={len}>
              <BeatScene beat={beat} />
            </CameraShot>

            {/* On-screen big text — always upper third when a spoken caption
                occupies the bottom (second line vanishes at "lower" otherwise) */}
            {beat.text ? (
              <BigType
                lines={beat.text.lines.map(
                  (text): BigTypeLine => ({
                    text,
                    highlight: beat.text?.highlight ? [beat.text.highlight] : undefined,
                  }),
                )}
                from={8}
                to={len - 12}
                size={isHook ? 150 : 108}
                position={beat.narration || beat.dialogue ? "hook" : "lower"}
              />
            ) : null}

            {/* One-shot SFX, role-resolved through the sound-design map */}
            {(beat.sfx ?? []).map((cue, s) => (
              <Sequence key={`sfx-${s}`} from={Math.round(cue.at * fps)}>
                <Audio src={staticFile(sfxFile(cue.role))} volume={SFX_VOLUME[cue.role] ?? 0.85} />
              </Sequence>
            ))}
          </Sequence>
        );
      })}

      <CaptionBar cues={cues} fps={fps} durationSec={sb.targetSeconds} />
      <GrainVignette />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  One beat's visual                                                  */
/* ------------------------------------------------------------------ */
const BeatScene: React.FC<{ beat: Storyboard["beats"][number] }> = ({ beat }) => {
  const set =
    beat.scene === "tech-void" ? (
      <TechVoid />
    ) : beat.scene === "room" ? (
      <Room light="day" />
    ) : beat.scene === "city-night" ? (
      <CityNight />
    ) : (
      <Sky />
    );

  const scale = beat.shot.size === "ecu" || beat.shot.size === "cu" ? 1.15 : 1.0;

  return (
    <div style={{ flex: 1, position: "relative", width: "100%", height: "100%" }}>
      <div style={{ position: "absolute", inset: 0 }}>{set}</div>

      {/* The blob actor */}
      {beat.character ? (
        <Blob
          head="dark"
          body="#7c3aed"
          pants="#1e293b"
          pose={beat.character.pose}
          expression={beat.character.expression}
          seed={7}
          walkSpeed={2.4}
          scale={scale}
          style={{
            position: "absolute",
            left: 540 - 110 * scale,
            top: GROUND_Y - 320 * scale,
          }}
        />
      ) : null}

      {/* Planted props (the mug — callback details) */}
      {beat.props?.includes("mug") ? (
        <PropMug
          style={{
            position: "absolute",
            left: 540 - 110 * scale + 170 * scale,
            top: GROUND_Y - 64 * scale,
            transform: `scale(${scale})`,
          }}
        />
      ) : null}
    </div>
  );
};
