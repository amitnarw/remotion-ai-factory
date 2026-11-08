/**
 * CaptionPanel: choose the caption look. A gallery of presets first; the
 * finer options (position, font, size, colours, box, animation) stay folded
 * under "Adjust the look". The live preview is the same Captions component
 * the video uses, so what you see here is what renders.
 */
import { useState } from "react";
import { Player } from "@remotion/player";
import { ChevronDown, RotateCcw, SlidersHorizontal } from "lucide-react";
import { CaptionPreview } from "../../../src/compositions/hud/CaptionPreview";
import {
  CAPTION_ANIMATIONS,
  CAPTION_BACKGROUNDS,
  CAPTION_FONTS,
  CAPTION_POSITIONS,
  CAPTION_PRESET_NAMES,
  FONT_STACKS,
  hexToRgba,
  resolveCaptionStyle,
  type CaptionStyleInput,
} from "../../../src/generator/caption-style";
import { Card } from "./ui/card";
import { Switch } from "./ui/switch";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Check } from "lucide-react";
import { cn } from "../lib/utils";
import type { VideoFormat } from "../lib/format";

export const PRESET_LABELS: Record<(typeof CAPTION_PRESET_NAMES)[number], string> = {
  reference: "Classic serif",
  "bold-pop": "Bold pop",
  clean: "Clean",
  documentary: "Documentary",
  neon: "Neon",
  minimal: "Minimal pill",
};
const PRESET_NOTES: Record<(typeof CAPTION_PRESET_NAMES)[number], string> = {
  reference: "Soft italic serif, gold keyword",
  "bold-pop": "Big capitals that pop in",
  clean: "Simple and easy to read",
  documentary: "Calm serif for stories",
  neon: "Loud, word by word",
  minimal: "Small text on a pill",
};
export const POSITION_LABELS: Record<(typeof CAPTION_POSITIONS)[number], string> = {
  top: "Top", upper: "Upper third", middle: "Middle", lower: "Lower third", bottom: "Bottom",
};
const FONT_LABELS: Record<(typeof CAPTION_FONTS)[number], string> = {
  inter: "Inter",
  montserrat: "Montserrat",
  poppins: "Poppins",
  "bebas-neue": "Bebas Neue",
  anton: "Anton",
  oswald: "Oswald",
  "playfair-display": "Playfair Display",
  merriweather: "Merriweather",
  lora: "Lora",
  nunito: "Nunito",
  "roboto-condensed": "Roboto Condensed",
  "archivo-black": "Archivo Black",
  serif: "Serif (Georgia)",
};
const ANIMATION_LABELS: Record<(typeof CAPTION_ANIMATIONS)[number], string> = {
  none: "None", fade: "Fade in", pop: "Pop", "slide-up": "Slide up", "word-reveal": "Word by word",
};
const BACKGROUND_LABELS: Record<(typeof CAPTION_BACKGROUNDS)[number], string> = {
  none: "None", box: "Box", pill: "Pill",
};

const SAMPLE_TEXT = "YOUR MONEY IS DOUBLING NOW";
const SAMPLE_KEYWORD = ["MONEY"];

const PREVIEW_DIMS: Record<VideoFormat, { w: number; h: number; box: string }> = {
  "9:16": { w: 1080, h: 1920, box: "w-[150px] sm:w-[210px]" },
  "1:1": { w: 1080, h: 1080, box: "w-[200px] sm:w-[260px]" },
  "16:9": { w: 1920, h: 1080, box: "w-[280px] sm:w-[340px]" },
};

/** A small, static picture of one preset (no player per tile). */
function PresetSwatch({ preset }: { preset: (typeof CAPTION_PRESET_NAMES)[number] }) {
  const look = resolveCaptionStyle({ preset });
  const word = (w: string) => (look.uppercase ? w.toUpperCase() : w);
  const textStyle = {
    fontFamily: FONT_STACKS[look.font],
    fontWeight: look.weight,
    fontStyle: look.italic ? "italic" : "normal",
    color: look.color,
    textShadow: look.shadow ? "0 2px 6px rgba(0,0,0,0.7)" : undefined,
  } as const;
  return (
    <div className="grid h-20 place-items-center rounded-xl bg-[linear-gradient(170deg,#334155_0%,#0f172a_100%)] px-2">
      <span
        className="rounded-lg px-2 py-0.5 text-center text-[17px] leading-tight"
        style={{
          ...textStyle,
          background: look.background !== "none" ? hexToRgba(look.backgroundColor, look.backgroundOpacity) : undefined,
          borderRadius: look.background === "pill" ? 999 : 8,
        }}
      >
        {word("Your")} <span style={{ color: look.highlight }}>{word("money")}</span>
      </span>
    </div>
  );
}

export function CaptionPanel({
  value,
  onChange,
  format = "9:16",
}: {
  value: CaptionStyleInput;
  onChange: (next: CaptionStyleInput) => void;
  format?: VideoFormat;
}) {
  const look = resolveCaptionStyle(value);
  const set = (patch: CaptionStyleInput) => onChange({ ...value, ...patch });
  const current = value.preset ?? "reference";
  const customized = Object.keys(value).some((k) => k !== "preset");
  const [open, setOpen] = useState(false);
  const dims = PREVIEW_DIMS[format];

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto]">
      {/* Live preview: first on phones, on the right on wider screens. */}
      <div className="order-first flex flex-col items-center gap-2 md:order-last">
        <div className="md:sticky md:top-6">
          <div
            className={cn("overflow-hidden rounded-2xl bg-black shadow-2xl shadow-black/40", dims.box)}
            style={{ aspectRatio: `${dims.w} / ${dims.h}` }}
          >
            <Player
              component={CaptionPreview}
              inputProps={{ style: value, text: SAMPLE_TEXT, keyword: SAMPLE_KEYWORD }}
              compositionWidth={dims.w}
              compositionHeight={dims.h}
              fps={30}
              durationInFrames={300}
              loop
              autoPlay
              controls={false}
              className="vf-player"
              style={{ width: "100%", height: "100%" }}
            />
          </div>
          <div className="mt-2 text-center text-xs font-medium text-muted-foreground">Live preview ({format})</div>
        </div>
      </div>

      <div className="min-w-0 space-y-4">
        <div role="radiogroup" aria-label="Caption look" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {CAPTION_PRESET_NAMES.map((p) => {
            const selected = current === p;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange({ preset: p })}
                className={cn(
                  "relative rounded-2xl p-2 text-left transition-all",
                  selected ? "bg-primary/20 ring-2 ring-primary" : "bg-input/60 hover:bg-input",
                )}
              >
                {selected ? (
                  <span className="absolute right-3 top-3 z-10 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" />
                  </span>
                ) : null}
                <PresetSwatch preset={p} />
                <div className="px-1 pb-0.5 pt-2">
                  <div className="text-sm font-semibold">{PRESET_LABELS[p]}</div>
                  <div className="truncate text-xs text-muted-foreground">{PRESET_NOTES[p]}</div>
                </div>
              </button>
            );
          })}
        </div>

        <Collapsible open={open} onOpenChange={setOpen}>
          <Card className="overflow-hidden">
            <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
              <span className="flex-1">
                <span className="block text-[15px] font-semibold">Adjust the look</span>
                <span className="block text-xs text-muted-foreground">
                  {customized ? "Your changes are applied on top of the look." : "Position, font, size, colours and animation."}
                </span>
              </span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="grid grid-cols-1 gap-4 px-4 pb-4 pt-1 sm:grid-cols-2">
                <Field label="Position">
                  <Select value={look.position} onValueChange={(v) => set({ position: v as CaptionStyleInput["position"] })}>
                    <SelectTrigger aria-label="Caption position"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CAPTION_POSITIONS.map((p) => (
                        <SelectItem key={p} value={p}>{POSITION_LABELS[p]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Font">
                  <Select value={look.font} onValueChange={(v) => set({ font: v as CaptionStyleInput["font"] })}>
                    <SelectTrigger aria-label="Caption font"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CAPTION_FONTS.map((f) => (
                        <SelectItem key={f} value={f}>{FONT_LABELS[f]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Entry animation">
                  <Select value={look.animation} onValueChange={(v) => set({ animation: v as CaptionStyleInput["animation"] })}>
                    <SelectTrigger aria-label="Caption animation"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CAPTION_ANIMATIONS.map((a) => (
                        <SelectItem key={a} value={a}>{ANIMATION_LABELS[a]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Background">
                  <Select value={look.background} onValueChange={(v) => set({ background: v as CaptionStyleInput["background"] })}>
                    <SelectTrigger aria-label="Caption background"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CAPTION_BACKGROUNDS.map((b) => (
                        <SelectItem key={b} value={b}>{BACKGROUND_LABELS[b]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={`Size: ${look.size} px`}>
                  <input type="range" min={24} max={96} value={look.size} aria-label="Caption size"
                    onChange={(e) => set({ size: Number(e.target.value) })} className="h-10 w-full" />
                </Field>
                <Field label={`Move up or down: ${look.offsetPct > 0 ? "+" : ""}${look.offsetPct}%`}>
                  <input type="range" min={-20} max={20} value={look.offsetPct} aria-label="Move the captions up or down"
                    onChange={(e) => set({ offsetPct: Number(e.target.value) })} className="h-10 w-full" />
                </Field>
                <div className="flex flex-wrap items-end gap-6 sm:col-span-2">
                  <Field label="Text colour">
                    <input type="color" value={look.color} aria-label="Text colour"
                      onChange={(e) => set({ color: e.target.value })} className="h-10 w-16 cursor-pointer rounded-lg bg-input p-1" />
                  </Field>
                  <Field label="Keyword colour">
                    <input type="color" value={look.highlight} aria-label="Keyword colour"
                      onChange={(e) => set({ highlight: e.target.value })} className="h-10 w-16 cursor-pointer rounded-lg bg-input p-1" />
                  </Field>
                  <Field label="Capital letters">
                    <div className="flex h-10 items-center">
                      <Switch checked={look.uppercase} onCheckedChange={(on) => set({ uppercase: on })} aria-label="Captions in capital letters" />
                    </div>
                  </Field>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
                  <p className="text-xs text-muted-foreground">
                    Word-by-word timing is estimated until the voice is measured: each caption's time is shared evenly across its words.
                  </p>
                  <Button variant="secondary" size="sm" disabled={!customized} onClick={() => onChange({ preset: current })}>
                    <RotateCcw className="h-4 w-4" /> Reset to {PRESET_LABELS[current]}
                  </Button>
                </div>
              </div>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
