/**
 * src/compositions/brand/BrandRoot.tsx — the bumpers as compositions of their
 * own, and a branded WhatIfVideo whose length holds them. Own entry
 * (./index.ts), so it never touches the main Root:
 *
 *   npx remotion bundle src/compositions/brand/index.ts --out-dir out/agentBRAND/bundle
 *   npx remotion still out/agentBRAND/bundle BrandIntro out/agentBRAND/intro.png --frame 30 \
 *     --props '{"brand":{...}}'
 *
 * In the factory's own videos the bumpers play inside WhatIfVideo when the
 * spec carries a brand (WhatIfVideo/index.tsx); the main Root's
 * `specMetadata` makes room for them with `brandedFrames` (status/brand.md).
 */
import * as React from "react";
import { Composition } from "remotion";
import { formatDims, videoSeconds, type ShotSpec } from "../../generator/spec.schema";
import { secToFrame } from "../../generator/timing";
import { WhatIfVideo } from "../WhatIfVideo/index";
import { BrandSchema, brandOf, brandedFrames, INTRO_SECONDS, OUTRO_SECONDS, type Brand } from "./brand";
import { BrandIntro, BrandOutro } from "./Bumpers";

const EXAMPLE: Brand = BrandSchema.parse({
  name: "Action short",
  mark: "bolt",
  colors: { accent: "#ff6a1a", text: "#ffffff", background: "#0d0f14" },
  fonts: { caption: "inter", title: "anton" },
  intro: { seconds: 1.5 },
  outro: { seconds: 3 },
  watermark: true,
});

type BumperProps = { brand: Brand; format?: "9:16" | "16:9" | "1:1" };
const bumperMeta = (which: "intro" | "outro") => ({ props }: { props: BumperProps }) => {
  const brand = BrandSchema.parse(props.brand);
  // A brand without this bumper still previews it at the default length.
  const seconds = which === "intro" ? (brand.intro?.seconds ?? INTRO_SECONDS.default) : (brand.outro?.seconds ?? OUTRO_SECONDS.default);
  return { ...formatDims(props.format ?? "9:16"), fps: 30, durationInFrames: secToFrame(seconds, 30), props: { ...props, brand } };
};

/** WhatIfVideo with room for the spec's bumpers: what Root.tsx's specMetadata does once wired. */
const brandedMeta = ({ props }: { props: { spec: ShotSpec } }) => {
  const spec = props.spec;
  const fps = spec.fps ?? 30;
  const dims = spec.settings ? formatDims(spec.settings.format) : { width: spec.width, height: spec.height };
  return { ...dims, fps, durationInFrames: brandedFrames(secToFrame(videoSeconds(spec), fps), brandOf(spec), fps), props };
};

const Intro: React.FC<BumperProps> = ({ brand }) => <BrandIntro brand={brand} />;
const Outro: React.FC<BumperProps> = ({ brand }) => <BrandOutro brand={brand} />;
const Any = (c: unknown) => c as React.ComponentType<Record<string, unknown>>;

export const BrandRoot: React.FC = () => (
  <>
    <Composition id="BrandIntro" component={Any(Intro)} durationInFrames={45} fps={30} width={1080} height={1920} defaultProps={{ brand: EXAMPLE }} calculateMetadata={bumperMeta("intro") as never} />
    <Composition id="BrandOutro" component={Any(Outro)} durationInFrames={90} fps={30} width={1080} height={1920} defaultProps={{ brand: EXAMPLE }} calculateMetadata={bumperMeta("outro") as never} />
    <Composition
      id="BrandedWhatIfVideo"
      component={Any(WhatIfVideo)}
      durationInFrames={450}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{}}
      calculateMetadata={brandedMeta as never}
    />
  </>
);
