/**
 * Generate - the Story Studio wizard. One step at a time, kid-simple.
 *
 *   ?tab=generate&step=1|3&path=ready&story=<slug>&plan=<jobId>&draft=<slug>&job=<renderId>
 *
 * Two paths through the same three steps:
 *   Ready, hand-crafted videos (pick → sound design → make)
 *   New, your topic / your whole story → we draft the storyboard → you review → approve → render.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Download,
  CircleCheck,
  PenLine,
  Wand2,
  RefreshCw,
  ArrowLeft,
  Check,
} from "lucide-react";
import {
  getJob,
  planSpec,
  getJobSpec,
  renderSpec,
  getVoices,
  voiceSample,
  cancelJob,
  Job,
} from "../api";
import type { ShotSpec } from "../../../src/generator/spec.schema";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { ErrorBanner } from "../components/shared";
import { Switch } from "../components/ui/switch";
import { CaptionPanel } from "../components/CaptionPanel";
import type { CaptionStyleInput } from "../../../src/generator/caption-style";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { InfoTip } from "../components/InfoTip";
import { useQuery, setQuery } from "../lib/navigation";
import { cn } from "../lib/utils";

const STEP_LABELS = ["Tell your idea", "Check the plan", "Make the video"];

export default function Generate() {
  const query = useQuery();
  const step = query.get("step") ?? "1";
  const planParam = query.get("plan") ?? undefined;
  const jobParam = query.get("job") ?? undefined;

  /* ---------------- data (once) ---------------- */
  const [genError, setGenError] = useState<string | null>(null);

  /* ---------------- shared job machinery (SSE + polling fallback) ------- */
  const [job, setJob] = useState<Job | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [stage, setStage] = useState<string>("music");
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [etaSec, setEta] = useState<number | null>(null);
  const pollRef = useRef<{ id: string; timer: number } | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) window.clearInterval(pollRef.current.timer);
    pollRef.current = null;
  }, []);

  const adopt = useCallback(
    (fresh: Job) => {
      setJob(fresh);
      setProgress(fresh.progress);
      if (fresh.stage) setStage(fresh.stage);
      setLogs(fresh.logs.slice(-2000));
      setStatus(fresh.status === "done" || fresh.status === "failed" ? fresh.status : "running");
      return fresh.status;
    },
    [],
  );

  const openSSE = useCallback(
    (jobId: string) => {
      stopPolling();
      const es = new EventSource(`${window.location.origin}/api/jobs/${jobId}/events`);
      es.onmessage = (ev: MessageEvent) => {
        try {
          const d = JSON.parse(ev.data) as {
            type: string;
            text?: string;
            progress?: number;
            stage?: string;
            etaSec?: number | null;
            status?: string;
            error?: string;
          };
          if (d.type === "log") setLogs((l) => [...l.slice(-300), d.text ?? ""]);
          else if (d.type === "progress") {
            setProgress(d.progress ?? 0);
            if (d.stage) setStage(d.stage);
            setEta(d.etaSec ?? null);
          } else if (d.type === "done" || d.type === "failed") {
            es.close();
            stopPolling();
            getJob(jobId)
              .then((fresh) => adopt(fresh))
              .catch(() => setStatus(d.type === "done" ? "done" : "failed"));
          }
        } catch {
          /* ignore */
        }
      };
      es.onerror = () => {
        es.close();
        // Polling fallback keeps the UI alive when the stream drops.
        const timer = window.setInterval(async () => {
          try {
            const fresh = await getJob(jobId);
            const st = adopt(fresh);
            if (st === "done" || st === "failed") stopPolling();
          } catch {
            stopPolling();
            setGenError("Lost track of the job, the app restarted. Start again.");
            setStatus("idle");
          }
        }, 2000) as unknown as number;
        stopPolling();
        pollRef.current = { id: jobId, timer };
      };
      // Full sync, the job may have finished before we attached.
      getJob(jobId)
        .then((fresh) => {
          const st = adopt(fresh);
          if (st === "done" || st === "failed") {
            es.close();
            stopPolling();
          }
        })
        .catch(() => {
          /* SSE still drives */
        });
    },
    [adopt, stopPolling],
  );

  /* Attach by URL: render job (step 3), plan job (review), deep-link-proof. */
  useEffect(() => {
    if (step === "3" && jobParam) {
      setStage("script");
      openSSE(jobParam);
    }
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, jobParam, planParam]);

  const running = status === "running";

  return (
    <div className="mx-auto max-w-2xl pb-10">
      {/* Stepper (non-clickable, back buttons below guide the way) */}
      <div className="mb-8 flex items-center justify-center gap-2">
        {([1, 2, 3] as const).map((n, i) => {
          const isCurrent =
            (n === 1 && step === "1") ||
            (n === 2 && (step === "2" || step === "review")) ||
            (n === 3 && step === "3");
          const reached =
            n === 1 || (n === 2 && running) || (typeof step === "string" && step !== "1");
          return (
            <div key={n} className="flex items-center gap-2">
              {i > 0 ? (
                <div className={cn("h-2 w-10 rounded-full sm:w-14", reached ? "bg-primary" : "bg-secondary")} />
              ) : null}
              <div
                className={cn(
                  "flex h-14 items-center gap-2.5 rounded-2xl px-4 font-bold shadow-xl shadow-black/20 transition-all",
                  isCurrent && "scale-105 bg-accent text-accent-foreground shadow-accent/25",
                  !isCurrent && reached && "bg-primary text-primary-foreground cursor-pointer hover:brightness-110",
                  !isCurrent && !reached && "bg-secondary text-secondary-foreground",
                )}
              >
                <span

                 className={cn(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-full text-base",
                    isCurrent ? "bg-accent-foreground text-accent" : "bg-black/20",
                  )}
                >
                  {running && (isCurrent || step === "3") ? <RefreshCw className="h-4 w-4 animate-spin" /> : n}
                </span>
                <span className="hidden text-sm sm:block">{STEP_LABELS[n - 1]}</span>
              </div>
            </div>
          );
        })}
      </div>

      {genError ? <ErrorBanner error={genError} fix="Start again, everything runs locally and re-runs cleanly" /> : null}

      {step === "1" ? (
        <Step1
          setError={setGenError}
        />
      ) : null}

      {step === "review" ? (
        <SpecReview
          planJobId={planParam}
          setError={setGenError}
          onBack={() => setQuery({ step: "1", plan: undefined })}
          onApproved={(jobId) => setQuery({ step: "3", job: jobId, plan: undefined })}
        />
      ) : null}

      {step === "3" ? (
        <Step3OrJob
          running={running}
          status={status}
          job={job}
          logs={logs}
          progress={progress}
          etaSec={etaSec}
          stage={stage}
          onAgain={() => {
            setGenError(null);
            setJob(null);
            setStatus("idle");
            setQuery({ step: "1", job: undefined, plan: undefined });
          }}
        />
      ) : null}
    </div>
  );
}

/* ==================================================================== */
/*  STEP 1, idea entry                                                  */
/* ==================================================================== */

const VOICE_LS_KEY = "vf:voiceConfig";
const VIDEO_LS_KEY = "vf:videoSettings";
const CAPTION_LS_KEY = "vf:captionStyle";

/** The caption look the user last chose (empty = the default preset). */
function loadCaptionStyle(): CaptionStyleInput {
  try {
    const raw = localStorage.getItem(CAPTION_LS_KEY);
    if (raw) return JSON.parse(raw) as CaptionStyleInput;
  } catch { /* ignore */ }
  return {};
}

/** Production settings chosen before writing the plan (sent as spec.settings). */
interface VideoSettingsForm {
  format: "9:16" | "16:9" | "1:1";
  /** Seconds the writer should aim for; blank = automatic. */
  targetDuration: string;
  /** Scenes; blank = automatic. */
  sceneCount: string;
  quality: "draft" | "final";
}

const FORMAT_LABELS: Record<VideoSettingsForm["format"], string> = {
  "9:16": "Vertical 9:16 (Shorts, 15–90s)",
  "16:9": "Landscape 16:9 (long-form, up to 10 min)",
  "1:1": "Square 1:1 (feeds, up to 90s)",
};

function defaultVideoSettings(): VideoSettingsForm {
  return { format: "9:16", targetDuration: "", sceneCount: "", quality: "final" };
}

function loadVideoSettings(): VideoSettingsForm {
  try {
    const raw = localStorage.getItem(VIDEO_LS_KEY);
    if (raw) return { ...defaultVideoSettings(), ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return defaultVideoSettings();
}

/** Turn the form into the settings object the server validates. */
function videoSettingsToPayload(form: VideoSettingsForm): Record<string, unknown> {
  const payload: Record<string, unknown> = { format: form.format, quality: form.quality };
  const dur = Number(form.targetDuration);
  if (form.targetDuration.trim() && dur > 0) {
    const max = form.format === "16:9" ? 600 : 90;
    payload.targetDuration = Math.min(max, Math.max(8, dur));
  }
  const scenes = Number(form.sceneCount);
  if (form.sceneCount.trim() && scenes >= 1) payload.sceneCount = Math.round(scenes);
  return payload;
}

function VideoSettingsPanel({ value, onChange }: { value: VideoSettingsForm; onChange: (v: VideoSettingsForm) => void }) {
  const update = (patch: Partial<VideoSettingsForm>) => {
    const next = { ...value, ...patch };
    onChange(next);
    try { localStorage.setItem(VIDEO_LS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Format</span>
        <Select value={value.format} onValueChange={(v) => update({ format: v as VideoSettingsForm["format"] })}>
          <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(FORMAT_LABELS) as VideoSettingsForm["format"][]).map((f) => (
              <SelectItem key={f} value={f}>{FORMAT_LABELS[f]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Length in seconds (blank = automatic)</span>
          <Input
            type="number"
            min={8}
            max={value.format === "16:9" ? 600 : 90}
            placeholder="auto"
            value={value.targetDuration}
            onChange={(e) => update({ targetDuration: e.target.value })}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Scenes, 1 to 12 (blank = automatic)</span>
          <Input
            type="number"
            min={1}
            max={12}
            placeholder="auto"
            value={value.sceneCount}
            onChange={(e) => update({ sceneCount: e.target.value })}
          />
        </label>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Quality</span>
        <Select value={value.quality} onValueChange={(v) => update({ quality: v as VideoSettingsForm["quality"] })}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="final">Final (full size)</SelectItem>
            <SelectItem value="draft">Draft (half size, faster)</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </Card>
  );
}

/** Narration (the story read aloud) and character voices (dialogue) are independent. */
interface VoiceConfig {
  narrationOn: boolean;
  narrationEngine: "kitten2" | "voxcpm2";
  narrationVoice: string;
  narrationVoiceDesc: string;
  charactersOn: boolean;
  charactersEngine: "kitten2" | "voxcpm2";
  characterVoice: string;
}

function defaultVoiceConfig(): VoiceConfig {
  return {
    narrationOn: false,
    narrationEngine: "voxcpm2",
    narrationVoice: "narrator-calm",
    narrationVoiceDesc: "Calm male narrator, mid-30s, steady pace, documentary tone",
    charactersOn: false,
    charactersEngine: "kitten2",
    characterVoice: "Rosie",
  };
}

/** Reads the current shape, and converts the old single "mode" setting once. */
function loadVoiceConfig(): VoiceConfig {
  try {
    const raw = localStorage.getItem(VOICE_LS_KEY);
    if (!raw) return defaultVoiceConfig();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if ("mode" in parsed) {
      const mode = parsed.mode as string;
      return {
        ...defaultVoiceConfig(),
        narrationOn: mode === "narration" || mode === "both",
        charactersOn: mode === "dialogs" || mode === "both",
        narrationEngine: (parsed.narrationEngine as VoiceConfig["narrationEngine"]) ?? "voxcpm2",
        narrationVoice: (parsed.narrationVoice as string) ?? "narrator-calm",
        narrationVoiceDesc: (parsed.narrationVoiceDesc as string) ?? defaultVoiceConfig().narrationVoiceDesc,
        charactersEngine: (parsed.dialogsEngine as VoiceConfig["charactersEngine"]) ?? "kitten2",
      };
    }
    return { ...defaultVoiceConfig(), ...parsed } as VoiceConfig;
  } catch {
    return defaultVoiceConfig();
  }
}

/** The audio block the server and generator receive. */
function voiceConfigToAudio(cfg: VoiceConfig): unknown {
  return {
    narration: cfg.narrationOn
      ? { enabled: true, engine: cfg.narrationEngine, voice: cfg.narrationVoice }
      : { enabled: false },
    dialogs: cfg.charactersOn
      ? { enabled: true, engine: cfg.charactersEngine, defaultVoice: cfg.characterVoice }
      : { enabled: false },
  };
}

/** Play one sample. Errors are shown, not swallowed. */
async function auditionVoice(engine: "kitten2" | "voxcpm2", voice: string, voiceDesc?: string) {
  try {
    const blob = await voiceSample({ engine, voice, voiceDesc });
    const audio = new Audio(URL.createObjectURL(blob));
    await audio.play();
  } catch (e) {
    toast.error(`Could not play the sample: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function VoiceSettings({ value, onChange }: { value: VoiceConfig; onChange: (c: VoiceConfig) => void }) {
  const [kittenVoices, setKittenVoices] = useState<{ id: string }[]>([]);
  const [voxVoices, setVoxVoices] = useState<{ id: string }[]>([]);
  useEffect(() => {
    getVoices("kitten2").then((r) => setKittenVoices((r.voices ?? []).map((v: any) => ({ id: v.id }))));
    getVoices("voxcpm2").then((r) => setVoxVoices((r.voices ?? []).map((v: any) => ({ id: v.id }))));
  }, []);
  const update = (patch: Partial<VoiceConfig>) => {
    const next = { ...value, ...patch };
    onChange(next);
    try { localStorage.setItem(VOICE_LS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const voicesFor = (engine: VoiceConfig["narrationEngine"]) => (engine === "kitten2" ? kittenVoices : voxVoices);
  return (
    <Card className="p-4 space-y-4">
      <div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="text-sm font-medium">Narration</span>
            <div className="text-xs text-muted-foreground">The story read aloud by one narrator.</div>
          </div>
          <Switch checked={value.narrationOn} onCheckedChange={(on) => update({ narrationOn: on })} aria-label="Narration on or off" />
        </div>
        {value.narrationOn && (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="text-xs text-muted-foreground">Engine</label>
              <Select
                value={value.narrationEngine}
                onValueChange={(v) => update({ narrationEngine: v as VoiceConfig["narrationEngine"], narrationVoice: v === "kitten2" ? "Bruno" : "narrator-calm" })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="kitten2">KittenTTS 2 (fast, presets)</SelectItem>
                  <SelectItem value="voxcpm2">VoxCPM2 (best quality)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Narrator voice</label>
              <div className="flex gap-2">
                <Select value={value.narrationVoice} onValueChange={(v) => update({ narrationVoice: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {voicesFor(value.narrationEngine).map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label="Listen to the narrator voice"
                  onClick={() => auditionVoice(value.narrationEngine, value.narrationVoice)}
                >
                  ▶
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="text-sm font-medium">Character voices</span>
            <div className="text-xs text-muted-foreground">Dialogue lines, spoken by each character's voice.</div>
          </div>
          <Switch checked={value.charactersOn} onCheckedChange={(on) => update({ charactersOn: on })} aria-label="Character voices on or off" />
        </div>
        {value.charactersOn && (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="text-xs text-muted-foreground">Engine</label>
              <Select
                value={value.charactersEngine}
                onValueChange={(v) => update({ charactersEngine: v as VoiceConfig["charactersEngine"], characterVoice: v === "kitten2" ? "Rosie" : "character-hero" })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="kitten2">KittenTTS 2 (fast, 23 voices)</SelectItem>
                  <SelectItem value="voxcpm2">VoxCPM2 (best quality)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Default character voice</label>
              <div className="flex gap-2">
                <Select value={value.characterVoice} onValueChange={(v) => update({ characterVoice: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {voicesFor(value.charactersEngine).map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label="Listen to the character voice"
                  onClick={() => auditionVoice(value.charactersEngine, value.characterVoice)}
                >
                  ▶
                </Button>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">Per-character voices come with the editor (a later phase).</div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function Step1({
  setError,
}: {
  setError: (s: string | null) => void;
}) {
  const [input, setInput] = useState("");
  const [writing, setWriting] = useState(false);
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig>(loadVoiceConfig());
  const [videoSettings, setVideoSettings] = useState<VideoSettingsForm>(loadVideoSettings());
  const [captionStyle, setCaptionStyle] = useState<CaptionStyleInput>(loadCaptionStyle());

  const write = async () => {
    if (input.trim().length < 6) return;
    setError(null);
    setWriting(true);
    try {
      const { jobId } = await planSpec({
        premise: input.trim(),
        audio: voiceConfigToAudio(voiceConfig),
        settings: { ...videoSettingsToPayload(videoSettings), captions: captionStyle },
      });
      setQuery({ step: "review", plan: jobId });
    } catch (e) {
      setError(String(e));
    } finally {
      setWriting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/20 text-primary">
              <PenLine className="h-6 w-6" />
            </span>
            <div>
              <div className="text-lg font-extrabold">Tell your idea</div>
              <div className="text-sm text-muted-foreground">One "what if" question is enough.</div>
            </div>
          </div>
          <Input
            autoFocus
            placeholder="What if money doubled every 3 seconds?"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && input.trim().length >= 6 && !writing) write(); }}
            className="text-lg"
          />
          <div className="flex items-center gap-3">
            <Button variant="amber" size="lg" className="flex-1" disabled={writing || input.trim().length < 6} onClick={write}>
              <Wand2 className={cn("h-5 w-5", writing && "animate-pulse")} />
              {writing ? "Writing the plan…" : "Write the plan"}
            </Button>
            <InfoTip helpId="story-engine" />
          </div>
          <p className="text-xs font-medium text-muted-foreground">
            The AI builds the whole plan from our real model and sound libraries. Every video is a fresh
            composition. Nothing renders until you say yes.
          </p>
          <VideoSettingsPanel value={videoSettings} onChange={setVideoSettings} />
          <CaptionPanel
            value={captionStyle}
            onChange={(next) => {
              setCaptionStyle(next);
              try { localStorage.setItem(CAPTION_LS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
            }}
          />
          <VoiceSettings value={voiceConfig} onChange={setVoiceConfig} />
        </div>
      </Card>
    </div>
  );
}

/* ==================================================================== */
/*  Job stage pills + labels                                            */
/* ==================================================================== */

const ENGINE_STAGES: Record<string, string[]> = {
  plan: ["script", "done"],
  template: ["script", "bundle", "render", "encode"],
  story: ["music", "bundle", "render", "encode"],
  storyboard: ["music", "bundle", "render", "encode"],
};

const STAGE_LABELS: Record<string, string> = {
  script: "writing the plan",
  music: "picking sounds",
  voice: "voices",
  bundle: "building the 3D world",
  render: "filming every frame",
  encode: "saving the video",
  done: "done",
};

const SFX_LABEL: Record<string, string> = {
  whoosh_dissolve: "whoosh",
  rumble_deep: "rumble",
  clothing_flutter: "flutter",
  impact_soft_bodies: "thud",
  scream_distant: "distant shout",
  pop_light: "pop",
  rise_short: "riser",
};

/** Poll the plan job, then show the written plan for approval. */
function SpecReview({
  planJobId,
  setError,
  onBack,
  onApproved,
}: {
  planJobId?: string;
  setError: (s: string | null) => void;
  onBack: () => void;
  onApproved: (jobId: string) => void;
}) {
  const [spec, setSpec] = useState<ShotSpec | null>(null);
  const [specId, setSpecId] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planStage, setPlanStage] = useState<string>("script");
  const [planProgress, setPlanProgress] = useState(0);
  const [approving, setApproving] = useState(false);
const [modelInfo, setModelInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!planJobId) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await getJobSpec(planJobId);
        if (!alive) return;
        if (r.ready && r.spec) {
          setSpec(r.spec);
          setSpecId(r.specId ?? null);
          if (r.provider || r.model) setModelInfo(`${r.provider ?? ""}${r.model ? " / " + r.model : ""}`.trim());
          return; // done polling
        }
        if (r.error) {
          setPlanError(r.error);
          return;
        }
        setPlanStage(r.stage ?? "script");
        setPlanProgress(r.progress ?? 0);
        setTimeout(tick, 2500);
      } catch (e) {
        if (alive) setPlanError(String(e));
      }
    };
    void tick();
    return () => {
      alive = false;
    };
  }, [planJobId]);

  const approve = async () => {
    if (!specId) return;
    setApproving(true);
    setError(null);
    try {
      let audio: unknown;
      try { audio = voiceConfigToAudio(loadVoiceConfig()); } catch { /* ignore */ }
      const { jobId } = await renderSpec(specId, audio);
      onApproved(jobId);
    } catch (e) {
      setError(String(e));
      setApproving(false);
    }
  };

  if (!planJobId) {
    return (
      <div className="space-y-4">
        <ErrorBanner error="No plan is running yet." fix='Write your idea in Step 1 first' />
        <Button variant="secondary" onClick={onBack}>Back</Button>
      </div>
    );
  }

  if (planError) {
    return (
      <div className="space-y-4">
        <ErrorBanner
          error={planError}
          fix="Check the provider settings or try another idea, then write the plan again"
        />
        <Button variant="secondary" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Write it again
        </Button>
      </div>
    );
  }

  if (!spec) {
    return (
      <Card className="p-8 text-center">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
        <div className="font-extrabold">The AI is writing your plan…</div>
        <div className="mt-1 text-sm text-muted-foreground">
          {planStage} {planProgress > 0 ? Math.round(planProgress) + "%" : ""}
        </div>
      </Card>
    );
  }

  const beats = spec.statPanel?.beats ?? [];
  const sounds = Array.from(
    new Set([
      ...(spec.events ?? []).flatMap((e) => (e.sfx ?? []).map((s) => s.tag)),
      ...(spec.audio?.ambient ?? []).map((a) => a.tag),
    ]),
  );
  const heroLabels: Record<string, string> = {
    "coin-stacks": "coin stacks",
    "cash-bundles": "cash bundles",
    "gold-bars": "gold bars",
    "water-puddles": "water puddles",
    "ice-crystals": "ice crystals",
    "orb-pedestal": "glowing orb",
    "bill-columns": "columns of bills",
    none: "no prop (the camera tells it)",
  };
  const kitLabels: Record<string, string> = {
    "street-block": "Dense city block",
    "city-street": "Downtown street",
    park: "City park",
    boardwalk: "Beach boardwalk",
    pier: "Ocean pier",
    interior: "Indoor room",
    space: "Outer space",
    ocean: "Open ocean",
    countryside: "Rolling countryside",
    forest: "Deep forest",
    river: "Winding river",
  };
  const eventLabels: Record<string, string> = {
    "water-vanish": "the water drains away",
    "water-return": "the water comes back",
    "water-rise": "the water rises",
    "rain-start": "rain begins",
    "rain-stop": "the rain stops",
    "lights-out": "the lights go out",
  };
  const todLabels: Record<string, string> = {
    noon: "bright noon",
    afternoon: "calm afternoon",
    golden: "golden hour",
    overcast: "overcast skies",
    dawn: "early dawn",
    night: "at night",
  };
  const weatherLabels: Record<string, string> = {
    rain: "rain",
    snow: "snow",
    storm: "storm",
  };
  const cameraLabels: Record<string, string> = {
    "walk-through": "walking camera",
    "orbit-drift": "slow orbiting camera",
    "steady-push": "steady push-in camera",
    "crane-reveal": "crane rising camera",
    "follow-chase": "chase follow camera",
    "handheld-urgency": "urgent handheld camera",
    "drone-top": "drone top-down camera",
  };
  const subjectLabels: Record<string, string> = {
    earth: "Earth",
    moon: "the Moon",
    mars: "Mars",
  };
  const spaceScene = spec.scenes.find((s) => s.kit === "space");

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="space-y-4">
          <div>
            <div className="text-sm font-extrabold uppercase tracking-wider text-primary">The plan</div>
            {modelInfo && <div className="mt-1 text-xs font-semibold text-muted-foreground">Written by {modelInfo}</div>}
            <div className="mt-1 text-xl font-black leading-snug">{spec.hook.text}</div>
          </div>

          <div className="rounded-2xl bg-input/40 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">The world</div>
              <div className="text-xs font-bold text-muted-foreground">
                {Math.round(spec.scenes.reduce((a, s) => Math.max(a, s.to), 0))}s total
              </div>
            </div>
            <div className="mt-2 space-y-1.5">
              {spec.scenes.map((s, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <Badge variant="muted">Scene {i + 1}</Badge>
                  <div className="min-w-0">
                    <div className="truncate font-extrabold">
                      {kitLabels[s.kit ?? "street-block"] ?? s.kit}
                      {s.look?.timeOfDay ? " " + (todLabels[s.look.timeOfDay] ?? s.look.timeOfDay) : ""}
                      {s.look?.weather && s.look.weather !== "none" && s.look.weather !== "clear"
                        ? " · " + (weatherLabels[s.look.weather] ?? s.look.weather)
                        : ""}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {s.kit === "space" && s.subject
                        ? subjectLabels[s.subject] + " fills the frame"
                        : s.street?.cameraStyle
                          ? cameraLabels[s.street.cameraStyle] ?? s.street.cameraStyle
                          : "the camera keeps moving"}{" "}
                      · {Math.round(s.from)}-{Math.round(s.to)}s
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl bg-input/40 p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Showing the subject</div>
            <div className="mt-1 font-extrabold">
              {spaceScene?.subject
                ? subjectLabels[spaceScene.subject]
                : heroLabels[spec.heroProp?.style ?? "none"]}
            </div>
            <div className="text-sm text-muted-foreground">
              {spaceScene?.subject
                ? "the planet grows with every stat beat"
                : spec.heroProp?.growth === "vanish"
                  ? "shrinks as the story goes"
                  : "grows as the story goes"}
            </div>
          </div>

          {(spec.worldEvents ?? []).length > 0 ? (
            <div className="rounded-2xl bg-input/40 p-4">
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">The world reacts</div>
              <div className="mt-2 space-y-1.5">
                {(spec.worldEvents ?? []).map((e, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <Badge variant="muted">{e.t}s</Badge>
                    <span className="min-w-0 flex-1 truncate font-semibold">
                      {eventLabels[e.name] ?? e.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {beats.length > 0 ? (
            <div className="rounded-2xl bg-input/40 p-4">
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {spec.statPanel?.title}: the beats
              </div>
              <div className="mt-2 space-y-1.5">
                {beats.map((b, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <Badge variant="muted">{b.t}s</Badge>
                    <span className="w-12 shrink-0 text-right font-black">{b.value}{spec.statPanel?.unit ?? "x"}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold">{b.sub}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {spec.captions.length > 0 ? (
            <div className="rounded-2xl bg-input/40 p-4">
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">On-screen text</div>
              <div className="mt-2 space-y-1 text-sm">
                {spec.captions.map((c, i) => (
                  <div key={i} className="truncate opacity-90">
                    <span className="mr-2 text-xs text-muted-foreground">{c.from}s</span>
                    {c.text}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="rounded-2xl bg-input/40 p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Voice</div>
            {(() => {
              const vc = loadVoiceConfig();
              if (!vc.narrationOn && !vc.charactersOn) return <div className="mt-1 text-sm text-muted-foreground">No voices — silent video.</div>;
              const parts: string[] = [];
              if (vc.narrationOn) parts.push(`Narration: ${vc.narrationEngine} (${vc.narrationVoice})`);
              if (vc.charactersOn) parts.push(`Characters: ${vc.charactersEngine} (${vc.characterVoice})`);
              return <div className="mt-1 text-sm font-semibold">{parts.join(" · ")}</div>;
            })()}
            <div className="mt-2 text-xs text-muted-foreground">Change in Step 1 before approving.</div>
          </div>

          <div className="rounded-2xl bg-input/40 p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Sounds</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {sounds.map((s) => (
                <Badge key={s} variant="muted">{SFX_LABEL[s] ?? s}</Badge>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <div className="sticky bottom-0 -mx-4 bg-background/85 px-4 py-3 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" /> Not quite, write again
          </Button>
          <Button variant="amber" size="lg" className="flex-1" disabled={approving} onClick={approve}>
            <Check className={cn("h-5 w-5", approving && "animate-pulse")} />
            {approving ? "Making the video…" : "Looks good, make the video"}
          </Button>
        </div>
      </div>
      <p className="text-xs font-medium text-muted-foreground">
        Nothing has rendered yet. Only when you press the amber button do we make the video.
      </p>
    </div>
  );
}

function Step3OrJob({
  running,
  status,
  job,
  logs,
  progress,
  etaSec,
  stage,
  onAgain,
}: {
  running: boolean;
  status: string;
  job: Job | null;
  logs: string[];
  progress: number;
  etaSec: number | null;
  stage: string;
  onAgain: () => void;
}) {
  if (status === "done" && job?.output?.mp4) {
    return (
      <div className="space-y-5">
        <div className="rounded-3xl bg-success px-6 py-8 text-center text-success-foreground shadow-xl shadow-success/20">
          <CircleCheck className="mx-auto mb-3 h-14 w-14" />
          <h3 className="text-2xl font-extrabold">Your video is ready!</h3>
          <p className="mt-1 text-sm font-bold opacity-80">{job.premise}</p>
        </div>
        <video
          /* eslint-disable-next-line @remotion/warn-native-media-tag -- dashboard, not a composition */
          controls
          className="mx-auto max-h-[65dvh] w-full rounded-3xl bg-black shadow-2xl"
          src={`/media/${job.output.mp4}`}
        />
        <div className="flex flex-wrap justify-center gap-3">
          <Button variant="amber" size="lg" asChild>
            <a href={`/media/${job.output.mp4}`} target="_blank" rel="noreferrer" download>
              <Download className="h-5 w-5" /> Download video
            </a>
          </Button>
          <Button variant="secondary" size="lg" onClick={onAgain}>
            Make another one
          </Button>
          <Button variant="secondary" size="lg" onClick={() => setQuery({ tab: "videos" })}>
            View in Videos
          </Button>
        </div>
      </div>
    );
  }

  if (job && (running || status === "failed")) {
    return <JobPanel job={job} status={status} logs={logs} progress={progress} etaSec={etaSec} stage={stage} />;
  }

  return (
    <div className="space-y-4">
      <Card className="p-8 text-center">
        <div className="mx-auto mb-5 grid h-20 w-20 place-items-center rounded-3xl bg-accent text-accent-foreground shadow-xl shadow-accent/25">
          <Sparkles className="h-10 w-10" />
        </div>
        <h3 className="text-2xl font-extrabold">Pick a story to make</h3>
        <p className="mx-auto mt-2 max-w-sm text-[15px] font-medium text-muted-foreground">
          Start a new story on step 1.
        </p>
      </Card>
      <Button variant="secondary" size="lg" className="w-full" onClick={() => setQuery({ step: "1" })}>
        <ArrowLeft className="h-5 w-5" /> Back
      </Button>
    </div>
  );
}

function JobPanel({
  job,
  status,
  logs,
  progress,
  etaSec,
  stage,
}: {
  job: Job;
  status: string;
  logs: string[];
  progress: number;
  etaSec: number | null;
  stage: string;
}) {
  const stages = ENGINE_STAGES[job.engine ?? "storyboard"] ?? ENGINE_STAGES.storyboard;
  const spanFor = (key: string) => job.timeline?.find((t) => t.stage === key);
  const state = (key: string): "pending" | "current" | "done" => {
    const s = spanFor(key);
    if (!s) return "pending";
    return s.endedAt != null ? "done" : "current";
  };
  const dur = (key: string): number => {
    const s = spanFor(key);
    if (!s) return 0;
    return Math.round(((s.endedAt ?? Date.now()) - s.startedAt) / 1000);
  };
  void stage; // pills drive current-stage display via spans

  return (
    <div className="space-y-4">
      <Card className="p-6 text-center">
        <div
          className={cn(
            "text-7xl font-extrabold tabular-nums",
            status === "failed" ? "text-destructive" : "text-primary",
          )}
        >
          {status === "done" ? 100 : Math.max(progress, 0)}
          <span className="text-2xl text-muted-foreground">%</span>
        </div>
        <p className="mt-2 text-lg font-bold">
          {status === "failed" ? "Oh no, something went wrong." : "Your video is being made"}
          {status === "running" && etaSec != null ? (
            <span className="ml-2 text-muted-foreground">about {Math.round(etaSec)}s left</span>
          ) : null}
        </p>
        <div className="mx-auto mt-5 h-5 w-full max-w-md overflow-hidden rounded-full bg-input">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${Math.max(progress, 6)}%` }}
          />
        </div>
        <div className="mt-5 flex flex-wrap justify-center gap-2.5">
          {stages.map((s, i) => {
            const st = state(s);
            return (
              <div
                key={s}
                className={cn(
                  "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold",
                  st === "done" && "bg-success text-success-foreground",
                  st === "current" && "bg-accent text-accent-foreground",
                  st === "pending" && "bg-input text-muted-foreground",
                )}
              >
                <span className="grid h-5 w-5 place-items-center rounded-full bg-black/25 text-[10px]">
                  {st === "done" ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                {STAGE_LABELS[s] ?? s}
                {st === "done" && dur(s) > 0 ? <span className="opacity-70">{dur(s)}s</span> : null}
              </div>
            );
          })}
        </div>
      </Card>

      {status === "running" ? (
        <div className="flex justify-center">
          <Button variant="destructive" size="sm" onClick={async () => {
            try { await cancelJob(job.id); } catch { /* ignore */ }
            window.location.reload();
          }}>
            Stop this render
          </Button>
        </div>
      ) : null}

      {status === "failed" ? (
        <ErrorBanner
          error={job.error ?? "Something went wrong while making the video."}
          fix="Press “Make the video” again, if it keeps failing, the log below says which step broke"
        />
      ) : null}

      <LogConsole logs={logs} />
    </div>
  );
}

/** Autoscrolling live log (soft dark console). */
function LogConsole({ logs }: { logs: string[] }) {
  if (!logs.length) return null;
  const lines = logs.join("").split(/\r?\n/).filter((l) => l.trim()).slice(-200);
  return (
    <div className="mx-auto max-h-36 max-w-xl overflow-y-auto rounded-2xl bg-black/50 p-4 font-mono text-[11px] leading-relaxed">
      {lines.map((l, i) => (
        <div key={i} className="whitespace-pre-wrap text-foreground/80">
          {l}
        </div>
      ))}
    </div>
  );
}

