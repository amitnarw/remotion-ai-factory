/**
 * CaptionPanel — choose the caption look: a preset, then position, font, size,
 * colours, box and animation. The live preview is the same Captions component
 * the video uses, so what you see here is what renders.
 */
import { Player } from "@remotion/player";
import { CaptionPreview } from "../../../src/compositions/hud/CaptionPreview";
import {
  CAPTION_ANIMATIONS,
  CAPTION_BACKGROUNDS,
  CAPTION_FONTS,
  CAPTION_POSITIONS,
  CAPTION_PRESET_NAMES,
  resolveCaptionStyle,
  type CaptionStyleInput,
} from "../../../src/generator/caption-style";
import { Card } from "./ui/card";
import { Switch } from "./ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

const PRESET_LABELS: Record<(typeof CAPTION_PRESET_NAMES)[number], string> = {
  reference: "Reference serif",
  "bold-pop": "Bold pop",
  clean: "Clean",
  documentary: "Documentary serif",
  neon: "Neon",
  minimal: "Minimal pill",
};
const POSITION_LABELS: Record<(typeof CAPTION_POSITIONS)[number], string> = {
  top: "Top", upper: "Upper third", middle: "Middle", lower: "Lower third", bottom: "Bottom",
};
const FONT_LABELS: Record<(typeof CAPTION_FONTS)[number], string> = {
  inter: "Inter", "archivo-black": "Archivo Black", serif: "Serif (Georgia)",
};
const ANIMATION_LABELS: Record<(typeof CAPTION_ANIMATIONS)[number], string> = {
  none: "None", fade: "Fade in", pop: "Pop", "slide-up": "Slide up", "word-reveal": "Word by word",
};
const BACKGROUND_LABELS: Record<(typeof CAPTION_BACKGROUNDS)[number], string> = {
  none: "None", box: "Box", pill: "Pill",
};

const SAMPLE_TEXT = "YOUR MONEY IS DOUBLING NOW";
const SAMPLE_KEYWORD = ["MONEY"];

export function CaptionPanel({
  value,
  onChange,
}: {
  value: CaptionStyleInput;
  onChange: (next: CaptionStyleInput) => void;
}) {
  const look = resolveCaptionStyle(value);
  const set = (patch: CaptionStyleInput) => onChange({ ...value, ...patch });

  return (
    <Card className="p-4 space-y-4">
      <div>
        <span className="text-sm font-medium">Captions</span>
        <div className="text-xs text-muted-foreground">
          Pick a look, then adjust it. Changes apply to the next plan you write.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Look">
            <Select value={value.preset ?? "reference"} onValueChange={(p) => onChange({ preset: p as CaptionStyleInput["preset"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CAPTION_PRESET_NAMES.map((p) => (
                  <SelectItem key={p} value={p}>{PRESET_LABELS[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Position">
            <Select value={look.position} onValueChange={(v) => set({ position: v as CaptionStyleInput["position"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CAPTION_POSITIONS.map((p) => (
                  <SelectItem key={p} value={p}>{POSITION_LABELS[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Font">
            <Select value={look.font} onValueChange={(v) => set({ font: v as CaptionStyleInput["font"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CAPTION_FONTS.map((f) => (
                  <SelectItem key={f} value={f}>{FONT_LABELS[f]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Entry animation">
            <Select value={look.animation} onValueChange={(v) => set({ animation: v as CaptionStyleInput["animation"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CAPTION_ANIMATIONS.map((a) => (
                  <SelectItem key={a} value={a}>{ANIMATION_LABELS[a]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={`Size: ${look.size}px`}>
            <input type="range" min={24} max={96} value={look.size} aria-label="Caption size"
              onChange={(e) => set({ size: Number(e.target.value) })} className="w-full" />
          </Field>
          <Field label={`Up / down: ${look.offsetPct > 0 ? "+" : ""}${look.offsetPct}%`}>
            <input type="range" min={-20} max={20} value={look.offsetPct} aria-label="Caption nudge"
              onChange={(e) => set({ offsetPct: Number(e.target.value) })} className="w-full" />
          </Field>
          <Field label="Text colour">
            <input type="color" value={look.color} aria-label="Text colour"
              onChange={(e) => set({ color: e.target.value })} className="h-9 w-16 cursor-pointer rounded" />
          </Field>
          <Field label="Keyword colour">
            <input type="color" value={look.highlight} aria-label="Keyword colour"
              onChange={(e) => set({ highlight: e.target.value })} className="h-9 w-16 cursor-pointer rounded" />
          </Field>
          <Field label="Background">
            <Select value={look.background} onValueChange={(v) => set({ background: v as CaptionStyleInput["background"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CAPTION_BACKGROUNDS.map((b) => (
                  <SelectItem key={b} value={b}>{BACKGROUND_LABELS[b]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Uppercase">
            <Switch checked={look.uppercase} onCheckedChange={(on) => set({ uppercase: on })} aria-label="Uppercase captions" />
          </Field>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Word-by-word timing is estimated until voice timing lands (Phase 2): each caption's time is shared evenly across its words.
          </p>
        </div>

        <div className="flex flex-col items-center gap-2">
          <div className="w-[200px] overflow-hidden rounded-xl bg-black" style={{ aspectRatio: "9 / 16" }}>
            <Player
              component={CaptionPreview}
              inputProps={{ style: value, text: SAMPLE_TEXT, keyword: SAMPLE_KEYWORD }}
              compositionWidth={1080}
              compositionHeight={1920}
              fps={30}
              durationInFrames={300}
              loop
              autoPlay
              controls={false}
              style={{ width: "100%", height: "100%" }}
            />
          </div>
          <span className="text-xs text-muted-foreground">Live preview</span>
        </div>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
