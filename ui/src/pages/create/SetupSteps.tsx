/**
 * The five choosing steps of the Create wizard: idea, format and length,
 * voices, captions and the summary. Each step is one focused decision; the
 * choices live in the wizard store (wizard.ts).
 */
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Captions as CaptionsIcon,
  ExternalLink,
  Lightbulb,
  ListChecks,
  Loader2,
  Mic,
  MicOff,
  Minus,
  Pencil,
  Plus,
  Ratio,
  Users,
  Wand2,
} from "lucide-react";
import { getChannels, getTtsStatus, getVoices, type ChannelInfo, type TtsStatus, type VoicesResponse } from "../../api";
import { Badge } from "../../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "../../components/ui/tooltip";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input, Textarea } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
// (Select removed - voices now shown as an auditionable gallery)
import { ChoiceCard, ErrorBanner } from "../../components/shared";
import { InfoTip } from "../../components/InfoTip";
import { CaptionPanel, POSITION_LABELS, PRESET_LABELS } from "../../components/CaptionPanel";
import { AuditionButton, useVoiceAudition } from "../../components/useVoiceAudition";
import { ENGINE_LABELS, FORMATS, formatSeconds, prettyVoice, type VideoFormat } from "../../lib/format";
import { navigate } from "../../lib/navigation";
import { cn } from "../../lib/utils";
import { resolveCaptionStyle } from "../../../../src/generator/caption-style";
import type { SetupStep } from "../../lib/routes";
import { StepFrame } from "./parts";
import { ReferencesPanel } from "./ReferencesPanel";
import {
  DEFAULT_VOICES,
  MIN_IDEA_LENGTH,
  getWizard,
  hasIdea,
  lengthProblem,
  sceneProblem,
  updateWizard,
  useWizard,
  type OwnStory,
  type VideoSettingsForm,
  type VoiceConfig,
} from "./wizard";

/* ------------------------------------------------------------------ */
/*  1. Idea                                                            */
/* ------------------------------------------------------------------ */

const EXAMPLES = [
  "What if money doubled every 3 seconds?",
  "What if the oceans vanished for 10 seconds?",
  "What if the forest could walk?",
  "What if gravity disappeared for 5 seconds?",
  "What if the sun never set?",
];

/** The channels, read once per page load (they change only with channels/*.json). */
let channelList: Promise<ChannelInfo[]> | null = null;
function useChannels(): ChannelInfo[] {
  const [list, setList] = useState<ChannelInfo[]>([]);
  useEffect(() => {
    let alive = true;
    channelList ??= getChannels().catch(() => {
      channelList = null;
      return [];
    });
    void channelList.then((l) => alive && setList(l));
    return () => {
      alive = false;
    };
  }, []);
  return list;
}

/** The channel's name, or its id while the list loads. */
export function useChannelName(id: string): string {
  return useChannels().find((c) => c.id === id)?.name ?? id;
}

export function IdeaStep({ onNext }: { onNext: () => void }) {
  const w = useWizard();
  const { idea, story, channel } = w;
  const channels = useChannels();
  const current = channels.find((c) => c.id === channel);
  // The ways this channel can use a story of yours.
  const storyModes = (current?.modes ?? ["premise", "adapt"]).filter((m): m is OwnStory["mode"] => m !== "premise");
  const tooShort = !story.on && idea.trim().length > 0 && idea.trim().length < MIN_IDEA_LENGTH;
  const whatIf = channel === "what-if";

  /** A new channel brings its own format, caption look and voices; each can still be changed on its step. */
  const pickChannel = (id: string) => {
    const c = channels.find((x) => x.id === id);
    if (!c) return;
    const modes = c.modes.filter((m): m is OwnStory["mode"] => m !== "premise");
    updateWizard({
      channel: id,
      video: c.formats.default ? { ...w.video, format: c.formats.default } : w.video,
      captions: c.captions ?? w.captions,
      voice: { ...w.voice, narrationOn: !!c.voices.narration?.enabled, charactersOn: !!c.voices.dialogs?.enabled },
      story: { ...story, on: story.on && modes.length > 0, mode: modes.includes(story.mode) ? story.mode : c.scriptMode },
    });
  };

  return (
    <StepFrame
      icon={<Lightbulb />}
      title="What is your video about?"
      description={
        whatIf ? (
          <>Write one &ldquo;what if&rdquo; question. The AI turns it into a story with scenes, voices and sound.</>
        ) : (
          <>Write your idea in one line, or paste a story of your own. The AI makes it into scenes, voices and sound.</>
        )
      }
    >
      <Card className="p-4 sm:p-6">
        <div className="mb-5">
          <div className="mb-2 flex items-center gap-1 text-[15px] font-semibold">
            Channel <InfoTip helpId="channels" />
          </div>
          <Select value={channel} onValueChange={pickChannel} disabled={channels.length === 0}>
            <SelectTrigger className="h-12" aria-label="Channel">
              <SelectValue placeholder="What if" />
            </SelectTrigger>
            <SelectContent>
              {channels.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {current ? <p className="mt-2 text-sm text-muted-foreground">{current.description}</p> : null}
        </div>

        <label htmlFor="idea" className="mb-2 block text-[15px] font-semibold">
          {story.on ? "A title or one line about it (optional)" : "Your idea"}
        </label>
        <Textarea
          id="idea"
          autoFocus
          rows={story.on ? 1 : 3}
          value={idea}
          placeholder={whatIf ? "What if money doubled every 3 seconds?" : "The keeper's last night"}
          onChange={(e) => updateWizard({ idea: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (hasIdea(getWizard())) onNext();
            }
          }}
          className={cn("resize-none bg-input/70 font-semibold leading-snug", story.on ? "min-h-12 text-lg" : "min-h-32 text-xl sm:text-2xl")}
        />
        <p className={cn("mt-2 text-sm", tooShort ? "text-accent" : "text-muted-foreground")} aria-live="polite">
          {tooShort ? "A few more words, please." : "One sentence is enough. You will check the plan before anything is made."}
        </p>

        <div className="mt-5 rounded-2xl bg-input/50 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-1 text-[15px] font-semibold">
                Use my own story <InfoTip helpId="own-story" />
              </div>
              <div className="text-sm text-muted-foreground">
                {storyModes.length ? "Paste a story or a script you wrote. The video is made from it." : "This channel writes every story from an idea."}
              </div>
            </div>
            <Switch
              className="mt-1"
              checked={story.on}
              disabled={storyModes.length === 0}
              onCheckedChange={(on) => updateWizard({ story: { ...story, on, mode: storyModes.includes(story.mode) ? story.mode : current?.scriptMode ?? "adapt" } })}
              aria-label="Use my own story"
            />
          </div>
          {story.on ? (
            <div className="mt-4 space-y-4">
              <Textarea
                rows={10}
                value={story.text}
                aria-label="Your story"
                placeholder={"The keeper had kept the light for forty years.\n\n[A lighthouse on a rocky coast at night]\n\nMARA: Dad, come down."}
                onChange={(e) => updateWizard({ story: { ...story, text: e.target.value } })}
                className="min-h-56 bg-input/70 text-[15px] leading-relaxed"
              />
              <p className="text-sm text-muted-foreground">
                Write a character&rsquo;s name before their line (&ldquo;Ana: Where were you?&rdquo;), what the camera shows in [brackets], and a line of --- between acts.
              </p>
              <div role="radiogroup" aria-label="How to use your story" className="grid gap-3 sm:grid-cols-2">
                {storyModes.includes("adapt") ? (
                  <ChoiceCard
                    selected={story.mode === "adapt"}
                    onSelect={() => updateWizard({ story: { ...story, mode: "adapt" } })}
                    title="Rewrite it into beats"
                    description="The AI keeps your plot and characters, and may cut and rephrase."
                  />
                ) : null}
                {storyModes.includes("as-written") ? (
                  <ChoiceCard
                    selected={story.mode === "as-written"}
                    onSelect={() => updateWizard({ story: { ...story, mode: "as-written" } })}
                    title="Keep my words"
                    description="Every word stays as you wrote it. The AI adds only what each beat shows."
                  />
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      <div className={cn("mt-6", (!whatIf || story.on) && "hidden")}>
        <div className="mb-3 text-sm font-semibold text-muted-foreground">Need a spark? Try one of these</div>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => updateWizard({ idea: ex })}
              className={cn(
                "rounded-full px-4 py-2 text-left text-sm font-medium transition-colors",
                idea === ex ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:brightness-125",
              )}
            >
              {ex}
            </button>
          ))}
        </div>
      </div>
    </StepFrame>
  );
}

/* ------------------------------------------------------------------ */
/*  2. Format and length                                               */
/* ------------------------------------------------------------------ */

/** A filled frame drawn in the format's shape. */
function FrameShape({ format }: { format: VideoFormat }) {
  const size = format === "9:16" ? "h-11 w-[25px]" : format === "16:9" ? "h-[27px] w-12" : "h-9 w-9";
  return (
    <span className="grid h-12 place-items-center">
      <span className={cn("rounded-md bg-current opacity-70", size)} />
    </span>
  );
}

function Chip({ selected, onClick, children, label }: { selected: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "h-10 rounded-full px-4 text-sm font-semibold transition-colors",
        selected ? "bg-primary text-primary-foreground shadow" : "bg-input/80 text-foreground hover:bg-secondary",
      )}
    >
      {children}
    </button>
  );
}

export function FormatStep() {
  const { video } = useWizard();
  const info = FORMATS[video.format];
  const set = (patch: Partial<VideoSettingsForm>) => updateWizard({ video: { ...video, ...patch } });
  const value = Number(video.targetDuration);
  const isPreset = !!video.targetDuration.trim() && info.presets.includes(value);
  const [customOpen, setCustomOpen] = useState(!!video.targetDuration.trim() && !isPreset);
  const lengthError = lengthProblem(video);
  const scenesError = sceneProblem(video);
  const scenesAuto = !video.sceneCount.trim();
  const scenes = scenesAuto ? 4 : Number(video.sceneCount) || 4;

  const changeFormat = (format: VideoFormat) => {
    const next = { ...video, format };
    const dur = Number(video.targetDuration);
    if (video.targetDuration.trim() && dur > FORMATS[format].max) {
      next.targetDuration = "";
      setCustomOpen(false);
    } else if (video.targetDuration.trim() && !FORMATS[format].presets.includes(dur)) {
      setCustomOpen(true);
    }
    updateWizard({ video: next });
  };

  return (
    <StepFrame
      icon={<Ratio />}
      title="Shape and length"
      description="Pick where the video will be watched. You can leave the length to the AI."
      aside={<InfoTip helpId="formats" />}
    >
      <Card className="space-y-7 p-4 sm:p-6">
        <section>
          <h2 className="mb-3 text-base font-semibold">Shape</h2>
          <div role="radiogroup" aria-label="Shape" className="grid grid-cols-3 gap-2 sm:gap-3">
            {(Object.keys(FORMATS) as VideoFormat[]).map((f) => (
              <ChoiceCard
                key={f}
                selected={video.format === f}
                onSelect={() => changeFormat(f)}
                className="items-center p-3 text-center sm:p-4"
                icon={<FrameShape format={f} />}
                title={
                  <span className="block">
                    {FORMATS[f].name}
                    <span className="block text-sm font-medium text-muted-foreground">{f}</span>
                  </span>
                }
                description={<span className="hidden sm:inline">{FORMATS[f].use}</span>}
              />
            ))}
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {info.name} videos: {info.use}, {info.range}.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold">Length</h2>
          <div role="radiogroup" aria-label="Length" className="flex flex-wrap gap-2">
            <Chip
              selected={!video.targetDuration.trim() && !customOpen}
              onClick={() => {
                setCustomOpen(false);
                set({ targetDuration: "" });
              }}
            >
              Automatic
            </Chip>
            {info.presets.map((p) => (
              <Chip
                key={p}
                selected={!customOpen && value === p && !!video.targetDuration.trim()}
                onClick={() => {
                  setCustomOpen(false);
                  set({ targetDuration: String(p) });
                }}
              >
                {formatSeconds(p)}
              </Chip>
            ))}
            <Chip selected={customOpen} onClick={() => setCustomOpen(true)}>
              Custom
            </Chip>
          </div>
          {customOpen ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label htmlFor="custom-length" className="text-sm font-semibold">
                Length in seconds
              </label>
              <Input
                id="custom-length"
                type="number"
                inputMode="numeric"
                min={8}
                max={info.max}
                autoFocus
                placeholder={`8 to ${info.max}`}
                value={video.targetDuration}
                onChange={(e) => set({ targetDuration: e.target.value })}
                className="h-11 w-36"
                aria-invalid={!!lengthError}
              />
              {video.targetDuration.trim() && !lengthError ? (
                <span className="text-sm text-muted-foreground">{formatSeconds(value)}</span>
              ) : null}
            </div>
          ) : null}
          {lengthError ? <p className="mt-2 text-sm font-semibold text-accent">{lengthError}</p> : null}
          {!video.targetDuration.trim() && !customOpen ? (
            <p className="mt-3 text-sm text-muted-foreground">The AI picks a length that fits the story.</p>
          ) : null}
        </section>
      </Card>

      <Card className="mt-4 space-y-6 p-4 sm:p-6">
        <h2 className="text-base font-semibold">Fine-tuning</h2>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[15px] font-semibold">Scenes</div>
            <div className="text-sm text-muted-foreground">How many places the story visits.</div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div role="radiogroup" aria-label="Scenes" className="flex gap-2">
              <Chip selected={scenesAuto} onClick={() => set({ sceneCount: "" })}>
                Automatic
              </Chip>
              <Chip selected={!scenesAuto} onClick={() => set({ sceneCount: String(scenes) })}>
                Choose
              </Chip>
            </div>
            {!scenesAuto ? (
              <div className="flex items-center gap-1 rounded-full bg-input/80 p-1">
                <Button
                  variant="secondary"
                  size="iconSm"
                  aria-label="Fewer scenes"
                  disabled={scenes <= 1}
                  onClick={() => set({ sceneCount: String(Math.max(1, scenes - 1)) })}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="w-8 text-center text-base font-bold tabular-nums" aria-live="polite">
                  {scenes}
                </span>
                <Button
                  variant="secondary"
                  size="iconSm"
                  aria-label="More scenes"
                  disabled={scenes >= 12}
                  onClick={() => set({ sceneCount: String(Math.min(12, scenes + 1)) })}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            ) : null}
          </div>
          {scenesError ? <p className="w-full text-sm font-semibold text-accent">{scenesError}</p> : null}
        </div>

        <div>
          <div className="mb-3 flex items-center gap-1">
            <div className="text-[15px] font-semibold">Quality</div>
            <InfoTip helpId="quality" />
          </div>
          <div role="radiogroup" aria-label="Quality" className="grid grid-cols-2 gap-3">
            <ChoiceCard
              selected={video.quality === "final"}
              onSelect={() => set({ quality: "final" })}
              title="Final"
              description="Full size, for sharing"
            />
            <ChoiceCard
              selected={video.quality === "draft"}
              onSelect={() => set({ quality: "draft" })}
              title="Draft"
              description="Half size, made faster"
            />
          </div>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-2xl bg-input/50 p-4">
          <div>
            <div className="flex items-center gap-1 text-[15px] font-semibold">
              Read the story first <InfoTip helpId="story-check" />
            </div>
            <div className="text-sm text-muted-foreground">
              The AI stops after the story so you can read it before it plans the scenes and the sound.
            </div>
          </div>
          <Switch
            className="mt-1"
            checked={video.storyGate !== false}
            onCheckedChange={(on) => set({ storyGate: on })}
            aria-label="Read the story first"
          />
        </div>

        <div className="flex items-start justify-between gap-4 rounded-2xl bg-input/50 p-4">
          <div>
            <div className="flex items-center gap-1 text-[15px] font-semibold">
              Show me the shopping list <InfoTip helpId="shopping-list" />
            </div>
            <div className="text-sm text-muted-foreground">
              When the story needs something the library does not have, the AI stops so you can choose what to get. Off: it plans with what the library has.
            </div>
          </div>
          <Switch
            className="mt-1"
            checked={video.shopGate !== false}
            onCheckedChange={(on) => set({ shopGate: on })}
            aria-label="Show me the shopping list"
          />
        </div>

        <div className="flex items-start justify-between gap-4 rounded-2xl bg-input/50 p-4">
          <div>
            <div className="flex items-center gap-1 text-[15px] font-semibold">
              AI review pass <InfoTip helpId="review-pass" />
            </div>
            <div className="text-sm text-muted-foreground">
              A second AI points out weak moments. One extra AI call. A story you read and approved is kept; its notes are listed for you.
            </div>
          </div>
          <Switch
            className="mt-1"
            checked={!!video.critic}
            onCheckedChange={(on) => set({ critic: on })}
            aria-label="AI review pass"
          />
        </div>
      </Card>
    </StepFrame>
  );
}

/* ------------------------------------------------------------------ */
/*  3. Voices                                                          */
/* ------------------------------------------------------------------ */

type Engine = "kitten2" | "voxcpm2";

const ENGINE_NOTES: Record<Engine, string> = {
  kitten2: "Fast, 23 voices",
  voxcpm2: "Best quality, slower",
};

function voiceNote(engine: Engine, id: string, data: VoicesResponse | null): string {
  if (!data) return "";
  if (engine === "voxcpm2") return data.descriptions?.find((d) => d.id === id)?.description ?? "";
  const pace = data.voices.find((v) => v.id === id)?.pace;
  return pace ? `${pace.charAt(0).toUpperCase()}${pace.slice(1)} pace` : "";
}

function VoiceCard({
  title,
  description,
  icon,
  on,
  onToggle,
  engine,
  onEngine,
  voice,
  onVoice,
  voiceLabel,
  voices,
  tts,
  audition,
  offText,
  footnote,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  on: boolean;
  onToggle: (on: boolean) => void;
  engine: Engine;
  onEngine: (e: Engine) => void;
  voice: string;
  onVoice: (v: string) => void;
  voiceLabel: string;
  voices: Record<Engine, VoicesResponse | null>;
  tts: TtsStatus | null;
  audition: ReturnType<typeof useVoiceAudition>;
  offText: string;
  footnote?: string;
}) {
  const installed = (e: Engine) => (tts ? tts[e]?.installed : undefined);
  const list = voices[engine]?.voices ?? [];
  const engineReady = installed(engine) !== false;
  return (

    <Card className={cn("flex flex-col p-4 transition-shadow sm:p-5", on && "ring-2 ring-primary/60")}>
      <div className="flex items-start gap-3">
        <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-2xl", on ? "bg-primary text-primary-foreground" : "bg-input text-muted-foreground")}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Switch checked={on} onCheckedChange={onToggle} aria-label={`${title} on or off`} className="mt-1" />
      </div>

      {on ? (
        <div className="mt-5 space-y-4">
          <div>
            <div className="mb-2 text-sm font-semibold">Voice engine</div>
            <div role="radiogroup" aria-label={`${title} engine`} className="grid grid-cols-2 gap-2">
              {(["kitten2", "voxcpm2"] as Engine[]).map((e) => (
                <ChoiceCard
                  key={e}
                  selected={engine === e}
                  onSelect={() => onEngine(e)}
                  className="p-3"
                  title={ENGINE_LABELS[e]}
                  description={ENGINE_NOTES[e]}
                  badge={
                    installed(e) === undefined ? null : installed(e) ? (
                      <Badge variant="success">Ready</Badge>
                    ) : (
                      <Badge variant="muted">Not installed</Badge>
                    )
                  }
                />
              ))}
            </div>
            {!engineReady ? (
              <div className="mt-3 rounded-xl bg-accent/15 p-3 text-sm">
                <div className="font-semibold text-accent">{ENGINE_LABELS[engine]} is not installed yet.</div>
                <div className="mt-0.5 text-muted-foreground">Install it once, then this voice can be used.</div>
                <Button
                  variant="soft"
                  size="sm"
                  className="mt-2"
                  onClick={() => navigate({ tab: "settings", section: "voice" })}
                >
                  <ExternalLink className="h-4 w-4" /> Open Settings, Voice engines
                </Button>
              </div>
            ) : null}
          </div>

           <div>
             <div className="mb-2 text-sm font-semibold">{voiceLabel}</div>
             <div className="flex flex-wrap gap-2">
               {list.map((v) => {
                 const itemState = audition.stateOf(engine, v.id);
                 return (
                   <div
                     key={v.id}
                     className={cn(
                       "flex items-center gap-1.5 rounded-xl border px-2 py-1.5 transition-colors",
                       v.id === voice ? "border-primary bg-primary/10" : "border-border bg-input/40 hover:bg-input/70",
                     )}
                   >
                     <button
                       type="button"
                       onClick={() => onVoice(v.id)}
                       className="text-sm font-medium text-foreground"
                       aria-pressed={v.id === voice}
                     >
                       {prettyVoice(v.id)}
                     </button>
                     {(() => {
                       const meta = voices[engine]?.descriptions?.find((d) => d.id === v.id);
                       const isDraft = (meta?.quality ?? (meta?.tags?.includes("child") || meta?.tags?.includes("elder") ? "draft" : "premium")) === "draft";
                       return isDraft ? (
                         <TooltipProvider>
                           <Tooltip>
                             <TooltipTrigger asChild>
                               <Badge variant="muted" className="cursor-help text-[10px]">Draft</Badge>
                             </TooltipTrigger>
                             <TooltipContent>Design voice, not a real performance. Premium versions need a recorded reference clip.</TooltipContent>
                           </Tooltip>
                         </TooltipProvider>
                       ) : null;
                     })()}
                     <AuditionButton
                       state={itemState}
                       label={`${title}, ${prettyVoice(v.id)}`}
                       disabled={!engineReady || (audition.busy && itemState !== "loading")}
                       onClick={() => audition.toggle(engine, v.id, { sampleUrl: v.sample ?? undefined })}
                       showText={false}
                     />
                   </div>
                 );
               })}
             </div>
             <p className="mt-2 min-h-5 text-sm text-muted-foreground">{voiceNote(engine, voice, voices[engine])}</p>
           </div>
          {footnote ? <p className="text-xs text-muted-foreground">{footnote}</p> : null}
        </div>
      ) : (
        <p className="mt-5 flex items-center gap-2 rounded-xl bg-input/40 p-3 text-sm text-muted-foreground">
          <MicOff className="h-4 w-4 shrink-0" /> {offText}
        </p>
      )}
    </Card>
  );
}

export function VoiceStep() {
  const { voice } = useWizard();
  const [tts, setTts] = useState<TtsStatus | null>(null);
  const [voices, setVoices] = useState<Record<Engine, VoicesResponse | null>>({ kitten2: null, voxcpm2: null });
  const audition = useVoiceAudition();
  const set = (patch: Partial<VoiceConfig>) => updateWizard({ voice: { ...voice, ...patch } });

  useEffect(() => {
    getTtsStatus().then(setTts).catch(() => setTts(null));
    (["kitten2", "voxcpm2"] as Engine[]).forEach((e) =>
      getVoices(e)
        .then((r) => setVoices((v) => ({ ...v, [e]: r })))
        .catch(() => undefined),
    );
  }, []);

  return (
    <StepFrame
      icon={<Mic />}
      title="Who speaks?"
      description="Both are optional. Without voices the video plays with music and sound effects."
      aside={<InfoTip helpId="voices" />}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <VoiceCard
          title="Narration"
          description="One voice tells the story."
          icon={<Mic className="h-5 w-5" />}
          on={voice.narrationOn}
          onToggle={(on) => set({ narrationOn: on })}
          engine={voice.narrationEngine}
          onEngine={(e) => set({ narrationEngine: e, narrationVoice: DEFAULT_VOICES.narration[e] })}
          voice={voice.narrationVoice}
          onVoice={(v) => set({ narrationVoice: v })}
          voiceLabel="Narrator"
          voices={voices}
          tts={tts}
          audition={audition}
          offText="No narrator."
        />
        <VoiceCard
          title="Character voices"
          description="Characters speak their own lines."
          icon={<Users className="h-5 w-5" />}
          on={voice.charactersOn}
          onToggle={(on) => set({ charactersOn: on })}
          engine={voice.charactersEngine}
          onEngine={(e) => set({ charactersEngine: e, characterVoice: DEFAULT_VOICES.characters[e] })}
          voice={voice.characterVoice}
          onVoice={(v) => set({ characterVoice: v })}
          voiceLabel="Starting voice for characters"
          voices={voices}
          tts={tts}
          audition={audition}
          offText="Characters stay silent."
          footnote="Once the plan is written you can give each character a voice of its own."
        />
      </div>
      <ReferencesPanel />
    </StepFrame>
  );
}

/* ------------------------------------------------------------------ */
/*  4. Captions                                                        */
/* ------------------------------------------------------------------ */

export function CaptionsStep() {
  const { captions, video } = useWizard();
  return (
    <StepFrame
      icon={<CaptionsIcon />}
      title="How should the words look?"
      description="Pick a caption look. The preview shows it in your video's shape."
      aside={<InfoTip helpId="captions" />}
    >
      <CaptionPanel value={captions} onChange={(next) => updateWizard({ captions: next })} format={video.format} />
    </StepFrame>
  );
}

/* ------------------------------------------------------------------ */
/*  5. Summary                                                         */
/* ------------------------------------------------------------------ */

export function describeLength(video: VideoSettingsForm): string {
  return video.targetDuration.trim() ? `about ${formatSeconds(Number(video.targetDuration))}` : "automatic length";
}

export function describeVoice(on: boolean, engine: Engine, voice: string): string {
  return on ? `${prettyVoice(voice)} (${ENGINE_LABELS[engine]})` : "Off";
}

function SummaryRow({
  icon,
  label,
  children,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  onChange: () => void;
}) {
  return (
    <div className="flex items-start gap-4 rounded-2xl bg-input/40 p-4">
      <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/20 text-primary [&_svg]:size-5">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="mt-0.5 break-words text-[15px]">{children}</div>
      </div>
      <Button variant="soft" size="sm" onClick={onChange} aria-label={`Change ${label.toLowerCase()}`}>
        <Pencil className="h-4 w-4" /> <span className="hidden sm:inline">Change</span>
      </Button>
    </div>
  );
}

export function SummaryStep({
  go,
  onWrite,
  writing,
  error,
  errorAction,
}: {
  go: (s: SetupStep) => void;
  onWrite: () => void;
  writing: boolean;
  error: string | null;
  errorAction?: React.ReactNode;
}) {
  const wizard = useWizard();
  const { idea, video, voice, captions, story } = wizard;
  const channelName = useChannelName(wizard.channel);
  const info = FORMATS[video.format];
  const look = resolveCaptionStyle(captions);
  const adjusted = Object.keys(captions).some((k) => k !== "preset");
  return (
    <StepFrame
      icon={<ListChecks />}
      title="Ready to write the plan?"
      description="Check your choices. The AI writes a plan first; nothing is made until you approve it."
    >
      {error ? <ErrorBanner error={error} action={errorAction} /> : null}
      <div className="space-y-3">
        <SummaryRow icon={<Lightbulb />} label="Idea" onChange={() => go("idea")}>
          <span className="font-semibold">{idea.trim() || (story.on ? "Your own story" : "No idea yet")}</span>
          <span className="block text-sm text-muted-foreground">
            Channel: {channelName}.
            {story.on
              ? ` Your story (${story.text.trim().split(/\s+/).filter(Boolean).length} words), ${story.mode === "as-written" ? "kept word for word" : "rewritten into beats"}.`
              : ""}
          </span>
        </SummaryRow>
        <SummaryRow icon={<Ratio />} label="Format and length" onChange={() => go("format")}>
          <span className="font-semibold">
            {info.name} {video.format}, {describeLength(video)}
          </span>
          <span className="block text-sm text-muted-foreground">
            Scenes: {video.sceneCount.trim() ? video.sceneCount : "automatic"}. Quality: {video.quality}. Read the story first:{" "}
            {video.storyGate !== false ? "on" : "off"}. Shopping list: {video.shopGate !== false ? "on" : "off"}. AI review pass: {video.critic ? "on" : "off"}.
          </span>
        </SummaryRow>
        <SummaryRow icon={<Mic />} label="Voices" onChange={() => go("voice")}>
          <span className="block">
            <span className="text-muted-foreground">Narration: </span>
            <span className="font-semibold">{describeVoice(voice.narrationOn, voice.narrationEngine, voice.narrationVoice)}</span>
          </span>
          <span className="block">
            <span className="text-muted-foreground">Characters: </span>
            <span className="font-semibold">{describeVoice(voice.charactersOn, voice.charactersEngine, voice.characterVoice)}</span>
          </span>
        </SummaryRow>
        <SummaryRow icon={<CaptionsIcon />} label="Captions" onChange={() => go("captions")}>
          <span className="font-semibold">
            {PRESET_LABELS[captions.preset ?? "reference"]}
            {adjusted ? ", adjusted" : ""}
          </span>
          <span className="block text-sm text-muted-foreground">
            {POSITION_LABELS[look.position]}, {look.size} px{look.uppercase ? ", capital letters" : ""}
          </span>
        </SummaryRow>
      </div>

      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
        <Button variant="secondary" onClick={() => go("captions")}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <span className="hidden text-sm text-muted-foreground sm:ml-auto sm:block">Press Enter to start</span>
        <Button variant="amber" size="lg" onClick={onWrite} disabled={writing || !hasIdea(wizard)}>
          {writing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Wand2 className="h-5 w-5" />}
          {writing ? "Starting..." : "Write the plan"}
        </Button>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        {video.storyGate !== false
          ? "The AI writes the story first and stops so you can read it. You can leave this screen while it runs."
          : "Writing a plan usually takes a minute or two. You can leave this screen while it runs."}
      </p>
    </StepFrame>
  );
}
