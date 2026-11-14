/**
 * Plan step: the AI writes the plan (writing), then you check it (review).
 *
 *   ?tab=create&step=writing&plan=<jobId>
 *   ?tab=create&step=review&plan=<jobId>&view=story|scenes|sound|settings
 *
 * Writing moves on to review by itself when the plan is ready. With "Read the
 * story first" on, the plan job stops after the story (the story gate): the
 * review shows the story alone, and Approve starts a second plan job that
 * resumes the run. When the library is missing something the story needs,
 * it stops again at the shopping list (gate 2, ShoppingStep.tsx), and your
 * choices start a third that gets what you approved and plans the rest. Then
 * the review shows one part of the plan at a time; nothing renders until you
 * approve. A plan that stopped on the way (a crash, a server restart) can
 * resume from the step it stopped at.
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  BookOpen,
  Camera,
  Captions as CaptionsIcon,
  ChevronDown,
  Check,
  Clapperboard,
  Clock,
  Eye,
  Loader2,
  MessageSquareText,
  Play,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  Square,
  TriangleAlert,
  UserRound,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";
import { cancelJob, getJob, getJobSpec, getRun, renderSpec, resumeRun, type RunStatus, type SpecResponse } from "../../api";
import type { ShotSpec } from "../../../../src/generator/spec.schema";
import type { WriterStory } from "../../../../src/generator/pipeline/writer";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../../components/ui/alert-dialog";
import { ErrorBanner, InfoRow, ProgressBar, SegmentedControl } from "../../components/shared";
import { InfoTip } from "../../components/InfoTip";
import { StorySection } from "../../components/StorySection";
import { ProducerChat } from "../../components/ProducerChat";
import { PRESET_LABELS } from "../../components/CaptionPanel";
import { ENGINE_LABELS, FORMATS, formatSeconds, isSetupProblem, prettyVoice, type VideoFormat } from "../../lib/format";
import { navigate, setQuery } from "../../lib/navigation";
import { refreshJobs } from "../../lib/jobs";
import { cn } from "../../lib/utils";
import { useWizard } from "./wizard";
import { ShoppingGateView, type ShopGateData } from "./ShoppingStep";

/* ------------------------------------------------------------------ */
/*  Labels                                                             */
/* ------------------------------------------------------------------ */

const PLAN_STAGES: Array<{ key: string; label: string; note: string }> = [
  { key: "writer", label: "Writing the story", note: "Beats, lines and characters" },
  { key: "voice", label: "Timing the voices", note: "Each line is measured" },
  { key: "check", label: "Checking the story", note: "A second reading; it changes nothing" },
  // Not a pipeline stage: the story gate, shown when "Read the story first" is on.
  { key: "gate", label: "You read the story", note: "The AI stops here until you approve it" },
  { key: "breakdown", label: "Listing what it needs", note: "Places, characters, props, actions and sounds" },
  { key: "match", label: "Checking the library", note: "What the factory already has" },
  // Gate 2: the AI stops here only when the library is missing something.
  { key: "shop", label: "Your shopping list", note: "You choose what to get, if the library lacks something" },
  { key: "director", label: "Directing the camera", note: "Scenes, shots and moves" },
  { key: "sound", label: "Designing the sound", note: "Music, ambience and effects" },
  { key: "critic", label: "Reviewing the story", note: "A second look at weak moments" },
  { key: "assemble", label: "Putting it together", note: "The plan you will check" },
];

const SFX_LABEL: Record<string, string> = {
  whoosh_dissolve: "whoosh",
  rumble_deep: "rumble",
  clothing_flutter: "flutter",
  impact_soft_bodies: "thud",
  scream_distant: "distant shout",
  pop_light: "pop",
  rise_short: "riser",
};
const HERO_LABELS: Record<string, string> = {
  "coin-stacks": "Coin stacks",
  "cash-bundles": "Cash bundles",
  "gold-bars": "Gold bars",
  "water-puddles": "Water puddles",
  "ice-crystals": "Ice crystals",
  "orb-pedestal": "A glowing orb",
  "bill-columns": "Columns of bills",
  none: "No prop (the camera tells it)",
};
const KIT_LABELS: Record<string, string> = {
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
const EVENT_LABELS: Record<string, string> = {
  "water-vanish": "The water drains away",
  "water-return": "The water comes back",
  "water-rise": "The water rises",
  "rain-start": "Rain begins",
  "rain-stop": "The rain stops",
  "lights-out": "The lights go out",
  "gravity-off": "Gravity switches off",
  "gravity-on": "Gravity comes back",
  "ground-break": "The ground breaks apart",
  "snow-start": "Snow begins",
  "snow-stop": "The snow stops",
};
/** How a real place reacts at each counter step (statPanel.react). */
const REACT_LABELS: Record<string, string> = {
  lift: "things float up",
  crack: "the ground cracks, then breaks",
  confetti: "confetti bursts",
  money: "banknotes and coins rain down",
  water: "the streets flood (or drain)",
  snow: "snow falls and settles",
  dark: "the power fails",
};
const TOD_LABELS: Record<string, string> = {
  noon: "bright noon",
  afternoon: "calm afternoon",
  golden: "golden hour",
  overcast: "overcast sky",
  dawn: "early dawn",
  night: "at night",
};
const WEATHER_LABELS: Record<string, string> = { rain: "rain", snow: "snow", storm: "storm" };
const CAMERA_LABELS: Record<string, string> = {
  "walk-through": "Walking camera",
  "orbit-drift": "Slow orbiting camera",
  "steady-push": "Steady push-in",
  "crane-reveal": "Crane rising",
  "follow-chase": "Chase camera",
  "handheld-urgency": "Urgent handheld",
  "drone-top": "Drone, top-down",
};
const SUBJECT_LABELS: Record<string, string> = { earth: "Earth", moon: "the Moon", mars: "Mars" };
const SIZE_LABELS: Record<string, string> = {
  ECU: "Extreme close-up",
  CU: "Close-up",
  MS: "Medium shot",
  FS: "Full shot",
  WS: "Wide shot",
  EWS: "Extreme wide",
};
const pretty = (v: string) => {
  const s = v.replace(/[_-]/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

type ReviewView = "story" | "scenes" | "sound" | "settings";
const VIEWS: Array<{ value: ReviewView; label: string; icon: ReactNode }> = [
  { value: "story", label: "Story", icon: <BookOpen /> },
  { value: "scenes", label: "Scenes and shots", icon: <Camera /> },
  { value: "sound", label: "Sound", icon: <Volume2 /> },
  { value: "settings", label: "Settings", icon: <Settings2 /> },
];

/* ------------------------------------------------------------------ */
/*  The step                                                           */
/* ------------------------------------------------------------------ */

export function PlanStep({
  planJobId,
  step,
  view,
  onRewrite,
  rewriting,
}: {
  planJobId: string;
  step: "writing" | "review";
  view: string | null;
  onRewrite: () => void;
  rewriting: boolean;
}) {
  const wizard = useWizard();
  const [spec, setSpec] = useState<ShotSpec | null>(null);
  const [specId, setSpecId] = useState<string | null>(null);
  const [storyGate, setStoryGate] = useState<StoryGateData | null>(null);
  const [shopGate, setShopGate] = useState<ShopGateData | null>(null);
  const [notes, setNotes] = useState<SpecResponse["notes"]>(undefined);
  const [needs, setNeeds] = useState<SpecResponse["needs"]>(undefined);
  const [ready, setReady] = useState<boolean | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [stage, setStage] = useState("script");
  const [progress, setProgress] = useState(0);
  const [modelInfo, setModelInfo] = useState<string | null>(null);
  /** Bumped when the producer changed the run: the story or the plan is read again. */
  const [reloads, setReloads] = useState(0);
  const reload = () => setReloads((n) => n + 1);
  const [meta, setMeta] = useState<{
    premise: string;
    createdAt: number;
    status: string;
    runId?: string;
    resume?: boolean;
    storyGate?: boolean;
  } | null>(null);

  /* Poll the plan job until it is written. */
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    setSpec(null);
    setSpecId(null);
    setStoryGate(null);
    setShopGate(null);
    setNotes(undefined);
    setNeeds(undefined);
    setReady(null);
    setPlanError(null);
    setStage("script");
    setProgress(0);
    const readMeta = () =>
      getJob(planJobId)
        .then((j) => {
          if (alive) setMeta({ premise: j.premise, createdAt: j.createdAt, status: j.status, runId: j.runId, resume: j.resume, storyGate: j.storyGate });
        })
        .catch(() => undefined);
    void readMeta();
    const tick = async () => {
      try {
        const r = await getJobSpec(planJobId);
        if (!alive) return;
        if (r.ready && r.gate === "story" && r.story && r.runId) {
          setStoryGate({ runId: r.runId, story: r.story, length: r.length, approved: !!r.approved, check: r.check, claims: r.claims });
          setReady(true);
          return;
        }
        if (r.ready && r.gate === "shop" && r.shopping && r.runId) {
          setShopGate({ runId: r.runId, shopping: r.shopping });
          setReady(true);
          return;
        }
        if (r.ready && r.spec) {
          setSpec(r.spec);
          setSpecId(r.specId ?? null);
          setNotes(r.notes);
          setNeeds(r.needs);
          setReady(true);
          if (r.provider || r.model) setModelInfo(`${r.provider ?? ""}${r.model ? ` (${r.model})` : ""}`.trim());
          return;
        }
        if (r.error) {
          setPlanError(r.error);
          return;
        }
        setReady(false);
        setStage(r.stage ?? "script");
        setProgress(r.progress ?? 0);
        timer = window.setTimeout(tick, 2500);
      } catch (e) {
        if (!alive) return;
        setPlanError(e instanceof Error ? e.message : String(e));
        // The run id arrives once the job has started: read it again for "Resume".
        void readMeta();
      }
    };
    void tick();
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [planJobId, reloads]);

  /* Keep the URL step in line with the job: writing <-> review. */
  useEffect(() => {
    if (ready === true && step === "writing") navigate({ tab: "create", step: "review", plan: planJobId }, { replace: true });
    if (ready === false && step === "review") navigate({ tab: "create", step: "writing", plan: planJobId }, { replace: true });
  }, [ready, step, planJobId]);

  if (planError && meta?.status === "cancelled") {
    return (
      <Card className="p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-input text-muted-foreground">
            <Square className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">You stopped writing this plan</h1>
            <p className="mt-1 break-words text-[15px] text-muted-foreground">{meta.premise}</p>
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Button variant="secondary" onClick={() => navigate({ tab: "create", step: "summary" })}>
            <ArrowLeft className="h-4 w-4" /> Change my choices
          </Button>
          <Button variant="amber" className="sm:ml-auto" onClick={onRewrite} disabled={rewriting}>
            <RefreshCw className={cn("h-4 w-4", rewriting && "animate-spin")} /> Write it again
          </Button>
        </div>
      </Card>
    );
  }

  if (planError) {
    const setup = isSetupProblem(planError);
    return (
      <div className="space-y-4">
        <ErrorBanner
          error={planError}
          action={
            setup ? (
              <Button variant="secondary" size="sm" onClick={() => navigate({ tab: "settings", section: setup })}>
                Open settings
              </Button>
            ) : null
          }
        />
        <Card className="p-5 sm:p-6">
          <h1 className="text-xl font-semibold">The plan could not be written</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            Your choices are kept. Try again, or change the idea or the settings first.
            {meta?.runId ? " Or resume it: the steps that finished are kept." : ""}
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Button variant="secondary" onClick={() => navigate({ tab: "create", step: "summary" })}>
              <ArrowLeft className="h-4 w-4" /> Change my choices
            </Button>
            {meta?.runId ? <ResumeButton runId={meta.runId} /> : null}
            <Button variant="amber" className="sm:ml-auto" onClick={onRewrite} disabled={rewriting}>
              <RefreshCw className={cn("h-4 w-4", rewriting && "animate-spin")} /> Try again
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (storyGate) {
    return <StoryGateView data={storyGate} onRewrite={onRewrite} rewriting={rewriting} onChanged={reload} />;
  }

  if (shopGate) {
    return <ShoppingGateView data={shopGate} />;
  }

  if (!spec) {
    // The story gate in the list: ahead for a new plan, passed for a resumed one.
    const gate = meta?.resume ? "passed" : (meta?.storyGate ?? wizard.video.storyGate) === false ? "off" : "ahead";
    return (
      <WritingCard
        planJobId={planJobId}
        stage={stage}
        progress={progress}
        withCritic={!!wizard.video.critic || stage === "critic"}
        gate={gate}
        premise={meta?.premise}
        startedAt={meta?.createdAt}
      />
    );
  }

  return (
    <Review
      spec={spec}
      specId={specId}
      onSpec={setSpec}
      notes={notes}
      needs={needs}
      modelInfo={modelInfo}
      planJobId={planJobId}
      view={(VIEWS.some((v) => v.value === view) ? view : "story") as ReviewView}
      onChanged={reload}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Resume and the story gate                                          */
/* ------------------------------------------------------------------ */

interface StoryGateData {
  runId: string;
  story: WriterStory;
  length?: { duration: number; target: number; revised: boolean };
  approved: boolean;
  check?: SpecResponse["check"];
  claims?: SpecResponse["claims"];
}

/** A plan that stopped can resume from the step it stopped at (the finished steps are kept). */
function ResumeButton({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    getRun(runId)
      .then((r) => alive && setRun(r))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [runId]);
  if (!run || run.complete) return null;
  const resume = async () => {
    setBusy(true);
    try {
      const { jobId } = await resumeRun(runId);
      refreshJobs();
      navigate({ tab: "create", step: "writing", plan: jobId });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Button variant="secondary" onClick={resume} disabled={busy}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
      {run.waitsForStory ? "Read the story" : run.waitsForShopping ? "Go on with what the library has" : `Resume from ${run.nextLabel ?? "where it stopped"}`}
    </Button>
  );
}

/**
 * Gate 1: the story the AI wrote, alone. Approve starts a new plan job that
 * resumes the run: the story and its timing are kept, and the director,
 * sound and the rest are planned around it.
 */
function StoryGateView({ data, onRewrite, rewriting, onChanged }: { data: StoryGateData; onRewrite: () => void; rewriting: boolean; onChanged: () => void }) {
  const { story, length, check, claims } = data;
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spoken = story.beats.filter((b) => b.say.trim() || b.lines.length).length;

  const approve = async () => {
    setApproving(true);
    setError(null);
    try {
      const { jobId } = await resumeRun(data.runId);
      refreshJobs();
      toast.success("Story approved. The AI plans the scenes and the sound now");
      navigate({ tab: "create", step: "writing", plan: jobId });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setApproving(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="violet">Your story</Badge>
          {length?.duration ? <Badge variant="muted">About {formatSeconds(Math.round(length.duration))}</Badge> : null}
          <Badge variant="muted">
            {story.beats.length} {story.beats.length === 1 ? "beat" : "beats"}
          </Badge>
          {data.approved ? <Badge variant="muted">Approved</Badge> : null}
          <InfoTip helpId="story-review" className="ml-auto" />
        </div>
        <h1 className="mt-3 text-2xl font-bold leading-snug tracking-tight sm:text-3xl">{story.hook}</h1>
        {story.title && story.title !== story.hook ? <p className="mt-1 text-[15px] text-muted-foreground">{story.title}</p> : null}
        <p className="mt-3 text-sm text-muted-foreground">
          Read the story. The scenes, the camera and the sound are planned after you approve it.
          {length?.revised && length.target ? ` The writer changed it once to fit about ${formatSeconds(length.target)}.` : ""}
        </p>
      </Card>

      <Card className="space-y-8 p-5 sm:p-6">
        {story.characters.length > 0 ? (
          <Section title="Characters">
            <div className="space-y-2">
              {story.characters.map((c) => (
                <div key={c.name} className="flex items-center gap-3 rounded-xl bg-input/50 p-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/20 text-primary">
                    <UserRound className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {pretty(c.gender)}, {c.age}
                      {c.look ? `: ${c.look}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {check && (check.lost?.length || check.notes.length || check.claims.length) ? <CheckSection check={check} /> : null}
        {claims?.claims.length ? <ClaimsSection claims={claims} /> : null}

        <Section title="The story, beat by beat" hint={`${spoken} of ${story.beats.length} beats are spoken. What each beat shows is in grey.`}>
          <ol className="space-y-2">
            {story.beats.map((b, i) => (
              <li key={b.id} className="flex gap-3 rounded-xl bg-input/40 p-3">
                <span className="w-7 shrink-0 pt-0.5 text-sm font-bold tabular-nums text-muted-foreground">{i + 1}</span>
                <div className="min-w-0 space-y-1">
                  {b.say.trim() ? <p className="text-[15px]">{b.say}</p> : null}
                  {b.lines.map((l, k) => (
                    <p key={k} className="text-[15px]">
                      <span className="font-semibold">{l.who}: </span>
                      {l.text}
                    </p>
                  ))}
                  <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                    <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span className="min-w-0">{b.see}</span>
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Section>
      </Card>

      <ProducerChat runId={data.runId} onChanged={onChanged} />

      {error ? <ErrorBanner error={error} /> : null}

      <div className="sticky bottom-3 z-20">
        <div className="flex items-center gap-2 rounded-2xl bg-card/95 p-2.5 shadow-2xl shadow-black/50 backdrop-blur-md sm:gap-3 sm:p-3">
          <Button
            variant="secondary"
            className="px-4 sm:px-6"
            aria-label="Back to your choices"
            onClick={() => navigate({ tab: "create", step: "summary" })}
          >
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Back</span>
          </Button>
          <Button variant="secondary" className="px-4 sm:px-6" aria-label="Write the story again" disabled={rewriting || approving} onClick={onRewrite}>
            <RefreshCw className={cn("h-4 w-4", rewriting && "animate-spin")} /> <span className="hidden sm:inline">Write it again</span>
          </Button>
          <Button variant="amber" className="flex-1 px-4 sm:ml-auto sm:flex-none sm:px-6" disabled={approving} onClick={approve}>
            {approving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
            {approving ? "Starting..." : (
              <>
                <span className="sm:hidden">Approve</span>
                <span className="hidden sm:inline">Approve the story and plan the rest</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The story checker's reading: the plot points lost from your own story first, then its notes and the facts it claims. It changed nothing. */
function CheckSection({ check }: { check: NonNullable<SpecResponse["check"]> }) {
  const toCheck = check.claims.filter((c) => c.status === "check").length;
  return (
    <Section title="The story checker's notes" hint="A second AI read the story. It changes nothing: edit the story or write it again if you agree.">
      <div className="space-y-2">
        {check.lost?.length ? (
          <div className="rounded-xl bg-accent/15 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-accent">
              <TriangleAlert className="h-4 w-4" /> Lost from your story
            </div>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[15px]">
              {check.lost.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {check.notes.map((n, i) => (
          <div key={i} className="flex gap-3 rounded-xl bg-input/40 p-3 text-[15px]">
            <Badge variant="muted" className="shrink-0">
              {n.beat}
            </Badge>
            <span className="min-w-0">{n.note}</span>
          </div>
        ))}
        {check.claims.length ? (
          <div className="rounded-xl bg-input/40 p-3">
            <div className="text-sm font-semibold">
              Facts it states{toCheck ? `: ${toCheck} to check before you approve` : ""}
            </div>
            <ul className="mt-1 space-y-1 text-[15px]">
              {check.claims.map((c, i) => (
                <li key={i} className="flex gap-2">
                  <Badge variant={c.status === "check" ? "amber" : "muted"} className="shrink-0">
                    {c.status === "check" ? "Check" : "Known"}
                  </Badge>
                  <span className="min-w-0">
                    {c.claim} <span className="text-sm text-muted-foreground">({c.beat})</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Section>
  );
}

/** The claims check's rows: each factual claim with its verdict, and the rewording of a flagged one. */
function ClaimsSection({ claims }: { claims: NonNullable<SpecResponse["claims"]> }) {
  const badge = (c: (typeof claims.claims)[number]): { label: string; variant: "amber" | "muted" } => {
    if (c.verdict === "source") return { label: "Needs a source", variant: "amber" };
    if (c.verdict === "speculative" && !c.framed) return { label: "Told as fact", variant: "amber" };
    return { label: c.verdict === "known" ? "Known" : "What-if", variant: "muted" };
  };
  return (
    <Section
      title="Facts and figures"
      hint="Checked by the critic's model, which has no web access. A documentary's flagged claims were reworded once by the writer; elsewhere they are only listed."
    >
      <ul className="space-y-2">
        {claims.claims.map((c) => {
          const b = badge(c);
          return (
            <li key={c.id} className="flex gap-3 rounded-xl bg-input/40 p-3 text-[15px]">
              <Badge variant={b.variant} className="shrink-0">
                {b.label}
              </Badge>
              <div className="min-w-0">
                <div>
                  {c.sentence} <span className="text-sm text-muted-foreground">({c.beat})</span>
                </div>
                {c.flagged && c.rewritten ? (
                  <div className="mt-1 text-sm text-muted-foreground">Changed to: {c.rewritten}</div>
                ) : c.flagged && c.reword ? (
                  <div className="mt-1 text-sm text-muted-foreground">Suggested: {c.reword}</div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  Writing                                                            */
/* ------------------------------------------------------------------ */

function useElapsed(since?: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return since ? Math.max(0, Math.round((now - since) / 1000)) : 0;
}

function WritingCard({
  planJobId,
  stage,
  progress,
  withCritic,
  gate,
  premise,
  startedAt,
}: {
  planJobId: string;
  stage: string;
  progress: number;
  withCritic: boolean;
  /** The story gate: still ahead (a new plan), passed (a resumed one), or off. */
  gate: "ahead" | "passed" | "off";
  premise?: string;
  startedAt?: number;
}) {
  const stages = PLAN_STAGES.filter((s) => (s.key !== "critic" || withCritic) && (s.key !== "gate" || gate !== "off"));
  const current = stages.findIndex((s) => s.key === stage);
  const elapsed = useElapsed(startedAt);
  const [stopping, setStopping] = useState(false);

  const stop = async () => {
    setStopping(true);
    try {
      await cancelJob(planJobId);
    } catch {
      /* already finished or gone */
    }
    refreshJobs();
    navigate({ tab: "create", step: "summary" });
  };

  return (
    <Card className="p-5 sm:p-8" aria-live="polite">
      <div className="flex items-start gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/20 text-primary">
          <Loader2 className="h-6 w-6 animate-spin" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Writing your plan</h1>
          {premise ? <p className="mt-1 break-words text-[15px] text-muted-foreground">{premise}</p> : null}
        </div>
      </div>

      <div className="mt-6 flex items-end justify-between gap-3">
        <div className="text-4xl font-bold tabular-nums">
          {Math.max(0, Math.round(progress))}
          <span className="text-xl text-muted-foreground">%</span>
        </div>
        {startedAt ? (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" /> {formatSeconds(elapsed) || "0 s"} so far
          </div>
        ) : null}
      </div>
      <ProgressBar value={Math.max(progress, 4)} className="mt-3 h-3" />

      <ol className="mt-6 space-y-2">
        {stages.map((s, i) => {
          const state = current < 0 ? "pending" : i < current ? "done" : i === current ? "current" : "pending";
          return (
            <li
              key={s.key}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5",
                state === "current" ? "bg-primary/15" : "bg-input/30",
              )}
            >
              <span
                className={cn(
                  "grid h-7 w-7 shrink-0 place-items-center rounded-full",
                  state === "done" && "bg-success text-success-foreground",
                  state === "current" && "bg-accent text-accent-foreground",
                  state === "pending" && "bg-secondary text-muted-foreground",
                )}
              >
                {state === "done" ? (
                  <Check className="h-4 w-4" />
                ) : state === "current" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <span className="text-xs font-bold">{i + 1}</span>
                )}
              </span>
              <div className="min-w-0">
                <div className={cn("text-[15px] font-semibold", state === "pending" && "text-muted-foreground")}>{s.label}</div>
                <div className="text-xs text-muted-foreground">{s.note}</div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <p className="text-sm text-muted-foreground">
          This usually takes a minute or two. You can leave this screen; a message appears when the{" "}
          {gate === "ahead" ? "story" : "plan"} is ready.
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="secondary" className="shrink-0 sm:ml-auto" disabled={stopping}>
              <Square className="h-4 w-4" /> Stop writing
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Stop writing this plan?</AlertDialogTitle>
              <AlertDialogDescription>
                The AI stops now and the plan is thrown away. Your choices are kept, so you can start again.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep writing</AlertDialogCancel>
              <AlertDialogAction onClick={stop}>Stop</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Review                                                             */
/* ------------------------------------------------------------------ */

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Review({
  spec,
  specId,
  onSpec,
  notes,
  needs,
  modelInfo,
  planJobId,
  view,
  onChanged,
}: {
  spec: ShotSpec;
  specId: string | null;
  onSpec: (s: ShotSpec) => void;
  notes: SpecResponse["notes"];
  needs: SpecResponse["needs"];
  modelInfo: string | null;
  planJobId: string;
  view: ReviewView;
  /** The producer changed the plan: read it again. */
  onChanged: () => void;
}) {
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const length = Math.round(spec.scenes.reduce((a, s) => Math.max(a, s.to), 0));
  const format = (spec.settings?.format ?? "9:16") as VideoFormat;

  const approve = async () => {
    if (!specId) return;
    setApproving(true);
    setError(null);
    try {
      // The plan's own voices (with any recast), as every render button sends.
      const { jobId } = await renderSpec(specId);
      refreshJobs();
      toast.success("The video is being made");
      navigate({ tab: "create", step: "rendering", job: jobId });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setApproving(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="violet">Your plan</Badge>
          <Badge variant="muted">
            {FORMATS[format]?.name ?? "Vertical"} {format}
          </Badge>
          <Badge variant="muted">{formatSeconds(length)}</Badge>
          <Badge variant="muted">
            {spec.scenes.length} {spec.scenes.length === 1 ? "scene" : "scenes"}
          </Badge>
          <InfoTip helpId="plan-review" className="ml-auto" />
        </div>
        <h1 className="mt-3 text-2xl font-bold leading-snug tracking-tight sm:text-3xl">{spec.hook.text}</h1>
        {spec.story?.title && spec.story.title !== spec.hook.text ? (
          <p className="mt-1 text-[15px] text-muted-foreground">{spec.story.title}</p>
        ) : null}
        <p className="mt-3 text-sm text-muted-foreground">
          Check each part below. Nothing is made until you approve.
        </p>
      </Card>

      <SegmentedControl
        label="Part of the plan"
        className="grid grid-cols-2 sm:flex"
        value={view}
        onChange={(v) => setQuery({ view: v === "story" ? undefined : v })}
        options={VIEWS}
      />

      <Card className="p-5 sm:p-6" role="tabpanel" aria-label={VIEWS.find((v) => v.value === view)?.label}>
        {view === "story" ? <StoryView spec={spec} specId={specId} onSpec={onSpec} notes={notes} needs={needs} /> : null}
        {view === "scenes" ? <ScenesView spec={spec} /> : null}
        {view === "sound" ? <SoundView spec={spec} /> : null}
        {view === "settings" ? <SettingsView spec={spec} modelInfo={modelInfo} length={length} /> : null}
      </Card>

      {specId ? <ProducerChat runId={specId} busy={approving} onChanged={onChanged} /> : null}

      {error ? <ErrorBanner error={error} /> : null}

      <div className="sticky bottom-3 z-20">
        <div className="flex items-center gap-2 rounded-2xl bg-card/95 p-2.5 shadow-2xl shadow-black/50 backdrop-blur-md sm:gap-3 sm:p-3">
          <Button
            variant="secondary"
            className="px-4 sm:px-6"
            aria-label="Back to your choices"
            onClick={() => navigate({ tab: "create", step: "summary" })}
          >
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Back</span>
          </Button>
          <Button
            variant="secondary"
            className="px-4 sm:px-6"
            aria-label="Open in editor"
            disabled={!specId || approving}
            onClick={() => specId && navigate({ tab: "editor", film: specId, from: "plan", plan: planJobId })}
          >
            <SlidersHorizontal className="h-4 w-4" /> <span className="hidden sm:inline">Open in editor</span>
          </Button>
          <Button variant="amber" className="flex-1 px-4 sm:ml-auto sm:flex-none sm:px-6" disabled={!specId || approving} onClick={approve}>
            {approving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Clapperboard className="h-5 w-5" />}
            {approving ? "Starting..." : (
              <>
                <span className="sm:hidden">Approve</span>
                <span className="hidden sm:inline">Approve and make the video</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The words on screen, folded: a plan can have dozens of them. */
function CaptionList({ captions }: { captions: ShotSpec["captions"] }) {
  const [open, setOpen] = useState(false);
  return (
    <Section title="Words on screen" hint={`${captions.length} captions, shown in time with the voice.`}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-xl bg-input/40 px-3 py-2.5 text-left text-sm font-semibold hover:bg-input/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <CaptionsIcon className="h-4 w-4 text-primary" />
          <span className="flex-1">{open ? "Hide the captions" : `Show all ${captions.length} captions`}</span>
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ol className="mt-2 space-y-1.5 text-[15px]">
            {captions.map((c, i) => (
              <li key={i} className="flex gap-3 rounded-xl bg-input/40 px-3 py-2">
                <span className="w-14 shrink-0 text-sm tabular-nums text-muted-foreground">{c.from.toFixed(1)} s</span>
                <span className="min-w-0 break-words">{c.text}</span>
              </li>
            ))}
          </ol>
        </CollapsibleContent>
      </Collapsible>
    </Section>
  );
}

/** How each group of needs reads on the review (gate 2, the shopping list, acted on them before the director). */
const NEED_GROUPS: Record<NonNullable<SpecResponse["needs"]>[number]["status"], { label: string; hint: string }> = {
  have: { label: "In the library", hint: "Used as it is." },
  close: { label: "A stand-in for now", hint: "Something close is used; the real thing can come later." },
  download: { label: "To find and download", hint: "Not in the library yet." },
  build: { label: "Needs new code", hint: "A developer would have to build it; the plan goes on without it." },
  data: { label: "A small data change", hint: "No code and no download, only a new entry." },
  skip: { label: "Left out", hint: "Not a must-have, and nothing close." },
};

/** What the story needs and what the library has for it, read-only. */
function NeedsList({ needs }: { needs: NonNullable<SpecResponse["needs"]> }) {
  const count = needs.reduce((n, g) => n + g.items.length, 0);
  return (
    <Section title="This story needs" hint={`${count} things, checked against the library. What was downloaded, and the build requests, are on the Assets page.`}>
      <div className="space-y-4">
        {needs.map((g) => (
          <div key={g.status}>
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="text-sm font-semibold">{NEED_GROUPS[g.status].label}</span>
              <span className="text-xs text-muted-foreground">{NEED_GROUPS[g.status].hint}</span>
            </div>
            <ol className="space-y-1.5 text-[15px]">
              {g.items.map((n) => (
                <li key={n.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-xl bg-input/40 px-3 py-2">
                  <span className="w-20 shrink-0 text-sm text-muted-foreground">{pretty(n.kind)}</span>
                  <span className="min-w-0 flex-1">
                    {n.what}
                    {n.must ? <span className="ml-2 text-xs font-semibold text-accent">must</span> : null}
                  </span>
                  {n.use ? <span className="text-sm text-muted-foreground">{n.use}</span> : null}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </Section>
  );
}

function StoryView({
  spec,
  specId,
  onSpec,
  notes,
  needs,
}: {
  spec: ShotSpec;
  specId: string | null;
  onSpec: (s: ShotSpec) => void;
  notes: SpecResponse["notes"];
  needs: SpecResponse["needs"];
}) {
  const beats = spec.statPanel?.beats ?? [];
  const beatNumber = (id: string) => (spec.story?.beats.findIndex((b) => b.id === id) ?? -1) + 1;
  return (
    <div className="space-y-8">
      {spec.story && spec.story.beats.length > 0 ? (
        <StorySection spec={spec} specId={specId} onSpec={onSpec} />
      ) : (
        <p className="text-[15px] text-muted-foreground">This plan has no written story; it is told by the pictures and the words on screen.</p>
      )}

      {needs?.length ? <NeedsList needs={needs} /> : null}

      {notes?.length ? (
        <Section
          title="The review pass's notes"
          hint="You approved the story, so it was kept as it is. If you agree with a note, change that line in the editor."
        >
          <ol className="space-y-1.5 text-[15px]">
            {notes.map((n, i) => (
              <li key={i} className="flex gap-3 rounded-xl bg-input/40 px-3 py-2">
                <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="font-semibold">{beatNumber(n.beat) ? `Beat ${beatNumber(n.beat)}: ` : ""}</span>
                  {n.problem}
                  {n.fix ? <span className="block text-sm text-muted-foreground">Suggested: {n.fix}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {spec.captions.length > 0 ? (
        <CaptionList captions={spec.captions} />
      ) : null}

      {beats.length > 0 ? (
        <Section title={spec.statPanel?.title ? `On-screen numbers: ${spec.statPanel.title}` : "On-screen numbers"}>
          <ol className="space-y-1.5 text-[15px]">
            {beats.map((b, i) => (
              <li key={i} className="flex items-center gap-3 rounded-xl bg-input/40 px-3 py-2">
                <span className="w-14 shrink-0 text-sm tabular-nums text-muted-foreground">{Number(b.t).toFixed(1)} s</span>
                <span className="min-w-16 shrink-0 font-bold tabular-nums">
                  {b.value}
                  {spec.statPanel?.unit ?? "x"}
                </span>
                <span className="min-w-0 truncate">{b.sub}</span>
              </li>
            ))}
          </ol>
          {spec.statPanel?.react ? (
            <p className="mt-2 text-[15px] text-muted-foreground">
              In a real place, at each step {REACT_LABELS[spec.statPanel.react] ?? spec.statPanel.react}.
            </p>
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}

function ScenesView({ spec }: { spec: ShotSpec }) {
  const spaceScene = spec.scenes.find((s) => s.kit === "space");
  const shots = spec.shots ?? [];
  return (
    <div className="space-y-8">
      <Section title="Scenes" hint="Where the story takes place, in order.">
        <ol className="space-y-2">
          {spec.scenes.map((s, i) => (
            <li key={i} className="flex items-start gap-3 rounded-xl bg-input/40 p-3">
              <Badge variant="muted" className="mt-0.5 shrink-0">
                Scene {i + 1}
              </Badge>
              <div className="min-w-0">
                <div className="font-semibold">
                  {KIT_LABELS[s.kit ?? "street-block"] ?? s.kit}
                  {s.look?.timeOfDay ? `, ${TOD_LABELS[s.look.timeOfDay] ?? s.look.timeOfDay}` : ""}
                  {s.look?.weather && s.look.weather !== "none" && s.look.weather !== "clear"
                    ? `, ${WEATHER_LABELS[s.look.weather] ?? s.look.weather}`
                    : ""}
                </div>
                <div className="text-sm text-muted-foreground">
                  {s.kit === "space" && s.subject
                    ? `${SUBJECT_LABELS[s.subject] ?? s.subject} fills the frame`
                    : s.street?.cameraStyle
                      ? CAMERA_LABELS[s.street.cameraStyle] ?? s.street.cameraStyle
                      : "The camera keeps moving"}
                  , {Math.round(s.from)} to {Math.round(s.to)} s
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="The subject" hint="What the camera keeps coming back to.">
        <div className="space-y-2">
          {spec.heroProp?.style && spec.heroProp.style !== "none" ? (
            <div className="rounded-xl bg-input/40 p-3">
              <div className="font-semibold">{HERO_LABELS[spec.heroProp.style] ?? pretty(spec.heroProp.style)}</div>
              <div className="text-sm text-muted-foreground">
                {spec.heroProp.growth === "vanish" ? "It shrinks as the story goes on" : "It grows as the story goes on"}
              </div>
            </div>
          ) : null}
          {spaceScene?.subject ? (
            <div className="rounded-xl bg-input/40 p-3">
              <div className="font-semibold">{SUBJECT_LABELS[spaceScene.subject] ?? pretty(spaceScene.subject)}</div>
              <div className="text-sm text-muted-foreground">Seen from space, it grows with every step of the story</div>
            </div>
          ) : null}
          {!spaceScene?.subject && (!spec.heroProp?.style || spec.heroProp.style === "none") ? (
            <div className="rounded-xl bg-input/40 p-3 text-[15px]">No prop: the camera tells the story.</div>
          ) : null}
        </div>
      </Section>

      {shots.length > 0 ? (
        <Section title="Camera shots" hint={`${shots.length} shots, each one filming a moment of the story.`}>
          <ol className="space-y-1.5">
            {shots.map((sh, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-input/40 px-3 py-2 text-[15px]">
                <span className="w-24 shrink-0 text-sm tabular-nums text-muted-foreground">
                  {sh.from.toFixed(1)} to {sh.to.toFixed(1)} s
                </span>
                <span className="font-semibold">{SIZE_LABELS[sh.size] ?? sh.size}</span>
                <span className="text-muted-foreground">
                  {pretty(sh.subject)}, {pretty(sh.move)}
                  {sh.energy && sh.energy !== "normal" ? `, ${sh.energy}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {(spec.worldEvents ?? []).length > 0 ? (
        <Section title="The world reacts">
          <ol className="space-y-1.5">
            {(spec.worldEvents ?? []).map((e, i) => (
              <li key={i} className="flex items-center gap-3 rounded-xl bg-input/40 px-3 py-2 text-[15px]">
                <span className="w-14 shrink-0 text-sm tabular-nums text-muted-foreground">{Number(e.t).toFixed(1)} s</span>
                <span className="font-semibold">{EVENT_LABELS[e.name] ?? e.name}</span>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}
    </div>
  );
}

function SoundView({ spec }: { spec: ShotSpec }) {
  const narration = spec.audio?.narration;
  const dialogs = spec.audio?.dialogs;
  const music = (spec.audio?.music ?? []).filter((m) => m.mood);
  const ambient = Array.from(new Set((spec.audio?.ambient ?? []).map((a) => a.tag)));
  const effects = Array.from(new Set((spec.events ?? []).flatMap((e) => (e.sfx ?? []).map((s) => s.tag))));
  return (
    <div className="space-y-8">
      <Section title="Voices">
        <div className="space-y-2">
          <div className="rounded-xl bg-input/40 p-3 text-[15px]">
            <span className="text-muted-foreground">Narration: </span>
            <span className="font-semibold">
              {narration?.enabled
                ? `${prettyVoice(narration.voice) || "default voice"} (${ENGINE_LABELS[narration.engine] ?? narration.engine})`
                : "Off"}
            </span>
          </div>
          <div className="rounded-xl bg-input/40 p-3 text-[15px]">
            <span className="text-muted-foreground">Characters: </span>
            <span className="font-semibold">
              {dialogs?.enabled ? `${ENGINE_LABELS[dialogs.engine] ?? dialogs.engine}, see the Story part for each voice` : "Off"}
            </span>
          </div>
        </div>
      </Section>
      <Section title="Music">
        {music.length ? (
          <div className="flex flex-wrap gap-2">
            {music.map((m, i) => (
              <Badge key={i} variant="secondary">
                {pretty(m.mood ?? "")} from {Math.round(m.from)} s
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">The music is chosen when the video is made.</p>
        )}
      </Section>
      <Section title="Ambience">
        {ambient.length ? (
          <div className="flex flex-wrap gap-2">
            {ambient.map((a) => (
              <Badge key={a} variant="secondary">
                {SFX_LABEL[a] ?? pretty(a)}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No background ambience.</p>
        )}
      </Section>
      <Section title="Sound effects">
        {effects.length ? (
          <div className="flex flex-wrap gap-2">
            {effects.map((s) => (
              <Badge key={s} variant="secondary">
                {SFX_LABEL[s] ?? pretty(s)}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No sound effects.</p>
        )}
      </Section>
    </div>
  );
}

function SettingsView({ spec, modelInfo, length }: { spec: ShotSpec; modelInfo: string | null; length: number }) {
  const s = spec.settings;
  const format = (s?.format ?? "9:16") as VideoFormat;
  return (
    <div>
      <div>
        <InfoRow label="Format" value={`${FORMATS[format]?.name ?? ""} ${format}`} />
        <InfoRow label="Length" value={`${formatSeconds(length)}${s?.targetDuration ? ` (you asked for ${formatSeconds(s.targetDuration)})` : ""}`} />
        <InfoRow label="Scenes" value={`${spec.scenes.length}${s?.sceneCount ? "" : " (chosen by the AI)"}`} />
        <InfoRow label="Quality" value={s?.quality === "draft" ? "Draft (half size, faster)" : "Final (full size)"} />
        <InfoRow label="Captions" value={PRESET_LABELS[s?.captions?.preset ?? "reference"]} />
        <InfoRow label="AI review pass" value={s?.critic ? "On" : "Off"} />
        <InfoRow label="Written by" value={modelInfo ?? undefined} />
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        To change these, go Back, change your choices and write the plan again. Small changes are quicker in the editor.
      </p>
    </div>
  );
}
