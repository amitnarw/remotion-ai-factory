/**
 * Video: gravity-5s — "What if gravity disappeared for just 5 seconds?"
 *
 * AGENT-AUTHORED composition. A bespoke story built from the whatif kit:
 * six beats, frame-locked, with a synthesized music bed, catalog SFX and a
 * frame-exact countdown. This file IS the storyboard.
 *
 * Beats:
 *   0.0–2.6   HOOK      tech void — WHAT IF / GRAVITY / VANISHED
 *   2.6–5.0   NORMAL    warm room — morning walk, coffee, light shaft
 *   5.0–7.7   EVENT     gravity off — blob + objects lose the ground
 *   7.7–9.7   PANIC     night city — streets and people airborne
 *   9.7–12.5  APEX/FALL sky — highest point, gravity clocks back in, plummet
 *   12.5–15.0 CATCH     back in the room — land, dust, end card
 */
import * as React from "react";
import {
  Audio,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { GrainVignette } from "../../components/GrainVignette";
import { GradientPresets } from "../../components/GradientMesh";
import { BigType } from "../../components/BigType";
import { CaptionBar } from "../../components/CaptionBar";
import { Blob, PropMug, type BlobPose, type BlobExpression } from "../../components/Blob";
import { Timer } from "../../components/Timer";
import { TechVoid } from "../../scenes/TechVoid";
import { Room } from "../../scenes/Room";
import { CityNight } from "../../scenes/CityNight";
import { Sky } from "../../scenes/Sky";
import {
  breathe,
  entranceStyle,
  exitStyle,
  floatDrift,
  useScenePush,
} from "../../motion";
import { COLORS } from "../../theme";

export const SLUG = "gravity-5s";
export const TITLE = "What if gravity disappeared for just 5 seconds?";
export const FPS = 30;
export const DURATION_FRAMES = 450; // 15s
export const MUSIC = { mood: "dark-tension" as const, seed: 4227 };

const sec = (s: number) => Math.round(s * FPS);

/* ------------------------------------------------------------------ */
/*  Float objects (books, mug) lose the ground during the event        */
/* ------------------------------------------------------------------ */
const FloatProp: React.FC<{
  x: number;
  y: number;
  rise: number;
  from: number;
  seed: number;
  w?: number;
  children: React.ReactNode;
  fps: number;
}> = ({ x, y, rise, from, seed, w = 70, children, fps }) => {
  const frame = useCurrentFrame();
  if (frame < from) return null;
  const s = entranceStyle(frame, fps, {
    from,
    riseFrom: 0,
    scaleFrom: 1,
    config: { stiffness: 42, damping: 12, mass: 0.7, overshootClamping: false },
  });
  const drift = floatDrift(frame, fps, seed, 12);
  const lift = interpolate(frame, [from, from + 70], [0, rise], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y - lift,
        width: w,
        transform: `translate(${drift.x}px, ${drift.y}px) rotate(${drift.rotate}deg)`,
        opacity: s.opacity,
        filter: "drop-shadow(0 10px 16px rgba(4,4,12,0.35))",
      }}
    >
      {children}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Books + mug art                                                    */
/* ------------------------------------------------------------------ */
const BookStack: React.FC = () => (
  <svg viewBox="0 0 100 70" width={100}>
    <rect x={4} y={44} width={92} height={18} rx={5} fill="#7c3aed" />
    <rect x={10} y={26} width={80} height={17} rx={5} fill="#22d3ee" />
    <rect x={16} y={9} width={68} height={16} rx={5} fill="#f59e0b" />
    <rect x={30} y={13} width={26} height={4} rx={2} fill="#7c2d12" opacity={0.6} />
  </svg>
);

const Phone: React.FC = () => (
  <svg viewBox="0 0 60 100" width={58}>
    <rect x={2} y={2} width={56} height={96} rx={12} fill="#0f172a" />
    <rect x={8} y={10} width={44} height={72} rx={6} fill="#4cc9f0" opacity={0.85} />
    <rect x={22} y={86} width={16} height={5} rx={2.5} fill="#334155" />
  </svg>
);

/* ------------------------------------------------------------------ */
/*  Dust puffs on landing                                              */
/* ------------------------------------------------------------------ */
const DustPuffs: React.FC<{ at: number; x: number; y: number; fps: number }> = ({
  at,
  x,
  y,
  fps,
}) => {
  const frame = useCurrentFrame();
  if (frame < at) return null;
  const puffs = [30, 27, 23, 20, 17, 15];
  return puffs.map((size, i) => {
    const delay = i * 3;
    const s = entranceStyle(frame, fps, {
      from: at + sec(0.02) + delay,
      riseFrom: 12 + i * 5,
      scaleFrom: 0.2,
      config: { stiffness: 90, damping: 16, mass: 0.8, overshootClamping: false },
    });
    const ex = exitStyle(frame, {
      from: at + delay + 12,
      durationFrames: 14,
      riseTo: -30,
      scaleTo: 2.0,
    });
    const dir = i % 2 === 0 ? -1 : 1;
    return (
      <div
        key={i}
        style={{
          position: "absolute",
          left: x + dir * (18 + i * 24),
          top: y - 10,
          width: size,
          height: size,
          borderRadius: "50%",
          background: i % 2 === 0 ? "rgba(240,238,255,0.65)" : "rgba(210,190,255,0.6)",
          opacity: Math.min(Number(s.opacity ?? 1), Number(ex?.opacity ?? 1)),
          transform: ex?.transform ?? "",
        }}
      />
    );
  });
};

/* ------------------------------------------------------------------ */
/*  Speed streaks during the plunge                                    */
/* ------------------------------------------------------------------ */
const SpeedStreaks: React.FC<{ from: number }> = ({ from }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < from) return null;
  const fadeOut = exitStyle(frame, { from: sec(12.05), durationFrames: 9, riseTo: 120 });
  const local = Math.max(0, Math.min(1, (frame - from) / (fps * 0.5)));
  const global = local * Number(fadeOut?.opacity ?? 1);
  const strokes = [0, 1, 2, 3, 4, 5, 6];
  return strokes.map((i) => {
    const seedL = (i * 137) % 1040 + 20;
    const speed = 900 + i * 130;
    const y = ((frame / fps) * speed) % 2300 - 400;
    return (
      <div
        key={i}
        style={{
          position: "absolute",
          left: seedL,
          top: y,
          width: i % 3 === 0 ? 5 : 3,
          height: 190 + i * 40,
          borderRadius: 3,
          background: "linear-gradient(180deg, transparent, rgba(255,255,255,0.6), transparent)",
          opacity: global * (0.5 + (i % 2) * 0.25),
        }}
      />
    );
  });
};

/* ------------------------------------------------------------------ */
/*  BEATS                                                              */
/* ------------------------------------------------------------------ */

const HookBeat: React.FC = () => {
  const push = useScenePush(0, 2.7, 1.07);
  return (
    <React.Fragment>
      <div style={{ position: "absolute", inset: 0, opacity: 0.92, ...push }}>
        <GradientPresets.techVoid speed={0.7} />
      </div>
      <div style={{ position: "absolute", inset: 0, ...push }}>
        <TechVoid />
      </div>
      <BigType
        lines={[
          { text: "WHAT IF", size: 98, tilt: -2 },
          { text: "GRAVITY", highlight: ["GRAVITY"], size: 158, tilt: 1.2 },
          { text: "VANISHED?", size: 112, tilt: -1.4 },
        ]}
        from={sec(0.16)}
        to={sec(2.45)}
      />
      <CaptionBar
        cues={[{ text: "For exactly five seconds.", highlight: ["five"], from: 1.7, to: 2.55 }]}
        fps={FPS}
        durationSec={15}
      />
    </React.Fragment>
  );
};

const NormalBeat: React.FC = () => {
  const frame = useCurrentFrame();
  const push = useScenePush(sec(2.6), 2.5, 1.05);
  // Blob walks in from the left, then idles at the rug.
  const walkX = interpolate(frame, [sec(2.6), sec(3.9)], [150, 470], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pose: BlobPose = frame < sec(3.95) ? "walk" : "idle";
  const resettle = exitStyle(frame, { from: sec(4.86), durationFrames: 5, scaleTo: 1.04 });
  return (
    <>
      <div style={{ position: "absolute", inset: 0, opacity: resettle ? resettle.opacity : 1, ...push }}>
        <Room light="day" />
        <Blob
          head="dark"
          body="#2563eb"
          pants="#1e293b"
          pose={pose}
          expression="neutral"
          seed={2}
          walkSpeed={2.4}
          scale={0.92}
          style={{ left: walkX - 110, top: 1470 - 320 * 0.92, opacity: 1 }}
        />
      </div>
      <CaptionBar
        cues={[
          { text: "Just a normal morning.", highlight: ["normal"], from: 2.75, to: 3.7 },
          { text: "Mug. Desk. Down. Ground.", highlight: ["Ground"], from: 3.7, to: 4.8 },
        ]}
        fps={FPS}
        durationSec={15}
      />
    </>
  );
};

const EventBeat: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const push = useScenePush(sec(5.0), 2.7, 1.06);
  // Character loses the ground: springy lift from floor with wobble drift.
  const lift = interpolate(frame, [sec(5.25), sec(6.4)], [0, 520], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const drift = floatDrift(frame, fps, 4, 16);
  const tilt = Math.sin((frame / fps / 2.1) * Math.PI * 2) * 5;
  const expression: BlobExpression =
    frame < sec(5.3) ? "worry" : frame < sec(6.4) ? "wow" : "worry";
  const pose: BlobPose = frame < sec(5.35) ? "idle" : "float";
  return (
    <>
      <div style={{ position: "absolute", inset: 0, ...push }}>
        <Room light={frame < sec(5.25) ? "day" : "night"} />
        <Blob
          head="dark"
          body="#2563eb"
          pants="#1e293b"
          pose={pose}
          expression={expression}
          seed={2}
          scale={0.92}
          style={{
            left: 470 - 110,
            top: 1470 - 320 * 0.92 - lift,
            transform: `translate(${drift.x}px, ${drift.y}px) rotate(${tilt}deg)`,
          }}
        />
        {/* Objects unglued from surfaces — start where they lived */}
        <FloatProp x={150} y={1190} rise={560} from={sec(5.35)} seed={1} fps={fps}>
          <PropMug style={{ position: "static" } as React.CSSProperties} />
        </FloatProp>
        <FloatProp x={330} y={1180} rise={470} from={sec(5.5)} seed={7} fps={fps}>
          <BookStack />
        </FloatProp>
        <FloatProp x={620} y={1240} rise={640} from={sec(5.42)} seed={11} fps={fps}>
          <Phone />
        </FloatProp>
        {/* Rising dust motes */}
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
          const seedY = 1250 + ((i * 97) % 500);
          const y = seedY - interpolate(frame, [sec(5.3 + i * 0.08), sec(7.4)], [0, 420 + i * 30], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: 120 + ((i * 211) % 840),
                top: y,
                width: 7 + (i % 3) * 4,
                height: 7 + (i % 3) * 4,
                borderRadius: "50%",
                background: "rgba(255,255,255,0.5)",
                opacity: breathe(frame, fps, 0.15, 2) + 0.35,
              }}
            />
          );
        })}
      </div>
      <Timer label="GRAVITY" from={5.25} to={10.0} fps={FPS} totalSec={4.8} />
      <CaptionBar
        cues={[
          { text: "The floor just… left.", highlight: ["left"], from: 5.35, to: 6.3 },
          { text: "Unlock. Everything. Up.", highlight: ["Up"], from: 6.4, to: 7.6 },
        ]}
        fps={FPS}
        durationSec={15}
      />
    </>
  );
};

const CityBeat: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const push = useScenePush(sec(7.7), 2.0, 1.06);
  // A parked car loses the ground too.
  const carLift = interpolate(frame, [sec(7.9), sec(8.9)], [0, 260], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const carDrift = floatDrift(frame, fps, 9, 10);
  const blobLift = interpolate(frame, [sec(7.8), sec(9.0)], [640, 940], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const blobDrift = floatDrift(frame, fps, 4, 14);
  return (
    <>
      <div style={{ position: "absolute", inset: 0, ...push }}>
        <CityNight />
        {/* Car silhouette tumbling up */}
        <svg
          viewBox="0 0 220 90"
          style={{
            position: "absolute",
            left: 130,
            top: 1250 - carLift,
            width: 240,
            transform: `translate(${carDrift.x}px, ${carDrift.y}px) rotate(${-8 + carDrift.rotate}deg)`,
            opacity: 0.95,
            filter: "drop-shadow(0 14px 22px rgba(4,4,12,0.5))",
          }}
        >
          <path
            d="M18 62 Q 24 40 54 36 L84 16 Q 96 9 122 10 L150 14 Q 176 20 186 40 Q 208 46 206 62 Q 204 70 190 70 L 30 70 Q 16 70 18 62 Z"
            fill="#0c0722"
          />
          <circle cx={62} cy={70} r={17} fill="#05030f" />
          <circle cx={166} cy={70} r={17} fill="#05030f" />
          <rect x={94} y={20} width={34} height={22} rx={6} fill="#3b1160" opacity={0.9} />
          <circle cx={196} cy={44} r={6} fill="#ffd644" opacity={0.95} />
          <circle cx={22} cy={46} r={5} fill="#ff5d5d" opacity={0.85} />
        </svg>
        {/* Blob silhouette airborne */}
        <Blob
          head="dark"
          body="#2563eb"
          pants="#1e293b"
          pose="float"
          expression="wow"
          seed={2}
          scale={0.78}
          style={{
            left: 640 - 88,
            top: 980 + (1140 - blobLift) - 250,
            transform: `translate(${blobDrift.x}px, ${blobDrift.y}px) rotate(${blobDrift.rotate * 1.4}deg)`,
          }}
        />
      </div>
      <BigType
        lines={[
          { text: "EVERYTHING", size: 96, tilt: -1.8 },
          { text: "LOOSENS", highlight: ["LOOSENS"], size: 118, tilt: 1.4 },
        ]}
        from={sec(8.15)}
        to={sec(9.6)}
        position="lower"
      />
      <CaptionBar
        cues={[
          { text: "Streets. Cars. People.", highlight: ["Cars"], from: 7.9, to: 8.75 },
          { text: "All airborne.", highlight: ["airborne"], from: 8.85, to: 9.6 },
        ]}
        fps={FPS}
        durationSec={15}
      />
    </>
  );
};

const ApexBeat: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const push = useScenePush(sec(9.7), 2.5, 1.07);
  // Drift up to apex; gravity returns at 10.0 → violent fall.
  const gravyOff = frame < sec(10.0);
  const rise = interpolate(frame, [sec(9.7), sec(10.0)], [0, 70], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fall = interpolate(
    frame,
    [sec(10.15), sec(12.3)],
    [0, 2500],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const drift = floatDrift(frame, fps, 4, gravyOff ? 12 : 4);
  const pose: BlobPose = gravyOff ? "float" : "fall";
  const expression: BlobExpression = gravyOff ? "wow" : "worry";
  // Continuous trajectory: drift up to apex, then the same position falls.
  const blobY = 980 - rise - fall;
  return (
    <>
      <div style={{ position: "absolute", inset: 0, ...push }}>
        <Sky />
        <SpeedStreaks from={sec(10.2)} />
        <Blob
          head="dark"
          body="#2563eb"
          pants="#1e293b"
          pose={pose}
          expression={expression}
          seed={2}
          scale={0.9}
          style={{
            left: 470 - 110,
            top: blobY - 250,
            transform: `translate(${drift.x}px, ${drift.y}px) rotate(${drift.rotate}deg) scaleY(${gravyOff ? 1 : 1.07})`,
          }}
        />
      </div>
      <Timer label="GRAVITY" from={5.25} to={10.0} fps={FPS} totalSec={4.8} />
      <CaptionBar
        cues={[
          { text: "Zero ground. Anywhere.", highlight: ["Anywhere"], from: 9.75, to: 10.0 },
          { text: "Aaand… it's BACK.", highlight: ["BACK"], from: 10.35, to: 11.3 },
          { text: "Straight down.", highlight: ["down"], from: 11.5, to: 12.35 },
        ]}
        fps={FPS}
        durationSec={15}
      />
    </>
  );
};

const CatchBeat: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Gravity-on: blob SLAMS down into frame, squash + dust.
  const dropIn = interpolate(frame, [sec(12.35), sec(12.55)], [-900, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const squash = interpolate(
    frame,
    [sec(12.55), sec(12.71)],
    [0.72, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const idleRestore = entranceStyle(frame, fps, {
    from: sec(13.1),
    scaleFrom: 0.97,
    riseFrom: 0,
    config: { stiffness: 80, damping: 16, mass: 0.9, overshootClamping: false },
  });
  const blobTop = 1482 - 320 * 0.95 + dropIn;
  return (
    <React.Fragment>
      <div style={{ position: "absolute", inset: 0 }}>
        <Room light="day" />
        <div
          style={{
            position: "absolute",
            left: 370,
            top: blobTop,
            transform: `scaleY(${squash}) scaleX(${2 - squash})`,
            transformOrigin: "center bottom",
            opacity: frame >= sec(13.1) ? Number(idleRestore.opacity ?? 1) : 1,
          }}
        >
          <Blob
            head="dark"
            body="#2563eb"
            pants="#1e293b"
            pose={frame < sec(13.1) ? "land" : "idle"}
            expression={frame < sec(13.35) ? "wow" : "smile"}
            seed={2}
            scale={0.95}
          />
        </div>
        <PropMug style={{ left: 158, top: 1210 }} />
        <DustPuffs at={sec(12.56)} x={480} y={1464} fps={FPS} />
      </div>
      <BigType
        lines={[{ text: "5 SECONDS.", highlight: ["5"], size: 132, tilt: -1.5 }]}
        from={sec(12.95)}
      />
      <CaptionBar
        cues={[
          { text: "Five seconds. That's all it took.", highlight: ["five", "seconds"], from: 12.7, to: 13.9 },
          { text: "Careful what you wish for.", highlight: ["wish"], from: 13.95, to: 14.85 },
        ]}
        fps={FPS}
        durationSec={15}
      />
    </React.Fragment>
  );
};

/* ------------------------------------------------------------------ */
/*  AUDIO — music bed (synthesized) + catalog SFX cues                 */
/*                                                                     */
/*  CRITICAL RULE: <Audio startFrom={N}> trims the first N frames OF   */
/*  THE FILE — it does not delay playback. One-shot cues are delayed   */
/*  with <Sequence from={frames}> wrapping the <Audio>.                */
/* ------------------------------------------------------------------ */
const SfxCue: React.FC<{
  tag: string;
  at: number;
  volume?: number;
}> = ({ tag, at, volume = 1 }) => (
  <Sequence from={sec(at)} durationInFrames={DURATION_FRAMES}>
    <Audio src={staticFile(`sfx/${tag}.wav`)} volume={volume} />
  </Sequence>
);

const StoryAudio: React.FC = () => (
  <>
    <Audio src={staticFile(`whatif-audio/${SLUG}/music.wav`)} volume={0.2} />
    <Audio src={staticFile("sfx/wind_city.wav")} volume={0.14} />
    <SfxCue tag="rise_short" at={1.1} volume={0.75} />
    <SfxCue tag="whoosh_dissolve" at={4.82} volume={0.8} />
    <SfxCue tag="rumble_deep" at={5.0} volume={0.55} />
    <SfxCue tag="scream_distant" at={8.6} volume={0.45} />
    <SfxCue tag="whoosh_dissolve" at={9.92} volume={0.85} />
    <SfxCue tag="impact_soft_bodies" at={12.5} volume={0.95} />
    <SfxCue tag="pop_light" at={12.95} volume={0.6} />
  </>
);

/* ------------------------------------------------------------------ */
/*  MASTER composition                                                 */
/* ------------------------------------------------------------------ */
export const GravityFiveSeconds: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const flash =
    frame >= sec(4.95) && frame < sec(5.1) ? 0.5 : frame >= sec(9.97) && frame < sec(10.12) ? 0.4 : 0;

  return (
    <div
      style={{
        width: 1080,
        height: 1920,
        position: "relative",
        background: "#05030f",
        overflow: "hidden",
      }}
    >
      {t < 2.6 && <HookBeat />}
      {t >= 2.6 && t < 5.0 && <NormalBeat />}
      {t >= 5.0 && t < 7.7 && <EventBeat />}
      {t >= 7.7 && t < 9.7 && <CityBeat />}
      {t >= 9.7 && t < 12.5 && <ApexBeat />}
      {t >= 12.5 && <CatchBeat />}

      {/* gravity flick transitions */}
      {flash > 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: COLORS.white,
            opacity: flash,
            zIndex: 55,
            pointerEvents: "none",
          }}
        />
      )}

      <StoryAudio />
      <GrainVignette />
    </div>
  );
};

/* Registry entry consumed by videos/registry.ts and the render script. */
export const GRAVITY_5S = {
  slug: SLUG,
  title: TITLE,
  component: GravityFiveSeconds,
  durationInFrames: DURATION_FRAMES,
  fps: FPS,
  music: MUSIC,
};
