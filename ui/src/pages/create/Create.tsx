/**
 * Create: a guided wizard, one decision per screen.
 *
 *   idea -> format -> voice -> captions -> summary   (choose)
 *   writing -> review                                (the plan, &plan=<jobId>)
 *   rendering -> done                                (the video, &job=<jobId>)
 *
 * Every step has its own URL (lib/routes.ts). Back/Next move between the
 * choosing steps and Enter moves on. Choices persist in localStorage.
 */
import { useCallback, useEffect, useState } from "react";
import { planSpec } from "../../api";
import { Button } from "../../components/ui/button";
import { useJobs, refreshJobs, jobScreen } from "../../lib/jobs";
import { navigate, useQuery } from "../../lib/navigation";
import { createStepOf, SETUP_STEPS, type SetupStep } from "../../lib/routes";
import { Stepper, WizardNav } from "./parts";
import { CaptionsStep, FormatStep, IdeaStep, SummaryStep, VoiceStep } from "./SetupSteps";
import { PlanStep } from "./PlanStep";
import { RunStep } from "./RunStep";
import {
  getWizard,
  hasIdea,
  lengthProblem,
  sceneProblem,
  updateWizard,
  useWizard,
  videoSettingsToPayload,
  voiceConfigToAudio,
} from "./wizard";

/** Elements where Enter already means something else. */
const ENTER_OWNERS =
  'button, a, textarea, select, [role="combobox"], [role="listbox"], [role="option"], [role="switch"], [role="radio"], [role="tab"], [role="slider"], input[type="range"], input[type="color"], [contenteditable="true"]';

export default function Create() {
  const query = useQuery();
  const step = createStepOf(query);
  const wizard = useWizard();
  const jobs = useJobs();
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  const go = useCallback((s: SetupStep) => navigate({ tab: "create", step: s }), []);

  const canLeave = (s: string): boolean => {
    if (s === "idea") return hasIdea(wizard);
    if (s === "format") return !lengthProblem(wizard.video) && !sceneProblem(wizard.video);
    return true;
  };

  const write = useCallback(async () => {
    const w = getWizard();
    if (!hasIdea(w)) {
      go("idea");
      return;
    }
    setWriteError(null);
    setWriting(true);
    try {
      const { jobId } = await planSpec({
        premise: w.idea.trim(),
        audio: voiceConfigToAudio(w.voice),
        settings: { ...videoSettingsToPayload(w.video), captions: w.captions },
        // The story gate is on unless it was turned off on the Format step.
        storyGate: w.video.storyGate !== false,
        // Gate 2 likewise: on unless turned off on the Format step.
        shopGate: w.video.shopGate !== false,
        ...(w.channel !== "what-if" ? { channel: w.channel } : {}),
        // Your own story, rewritten into beats or kept word for word.
        ...(w.story.on && w.story.text.trim() ? { script: w.story.text, mode: w.story.mode } : {}),
      });
      refreshJobs();
      navigate({ tab: "create", step: "writing", plan: jobId });
    } catch (e) {
      setWriteError(e instanceof Error ? e.message : String(e));
      // A failed rewrite from the plan screen shows its error on the summary.
      if (step !== "summary") navigate({ tab: "create", step: "summary" });
    } finally {
      setWriting(false);
    }
  }, [go, step]);

  const index = SETUP_STEPS.indexOf(step as SetupStep);
  const next = useCallback(() => {
    if (index < 0) return;
    if (step === "summary") {
      if (!writing) void write();
      return;
    }
    if (!canLeave(step)) return;
    go(SETUP_STEPS[index + 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, step, writing, write, go, wizard]);

  /* Enter moves on from any choosing step (not from buttons, menus or sliders). */
  useEffect(() => {
    if (index < 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.defaultPrevented || e.isComposing) return;
      if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest(ENTER_OWNERS)) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="listbox"]')) return;
      e.preventDefault();
      next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, next]);

  // Clear a stale error once you move away from the summary.
  useEffect(() => {
    if (step !== "summary" && step !== "writing" && step !== "review") setWriteError(null);
  }, [step]);

  const makeAnother = useCallback(() => {
    updateWizard({ idea: "" });
    navigate({ tab: "create", step: "idea" });
  }, []);

  const runningPlan = jobs.active.find((j) => j.kind === "plan");
  const busyAction =
    writeError && runningPlan && /already being written/i.test(writeError) ? (
      <Button variant="secondary" size="sm" onClick={() => navigate(jobScreen(runningPlan))}>
        See that plan
      </Button>
    ) : null;

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Stepper step={step} onJump={go} />

      {step === "idea" ? <IdeaStep onNext={next} /> : null}
      {step === "format" ? <FormatStep /> : null}
      {step === "voice" ? <VoiceStep /> : null}
      {step === "captions" ? <CaptionsStep /> : null}
      {step === "summary" ? (
        <SummaryStep go={go} onWrite={() => void write()} writing={writing} error={writeError} errorAction={busyAction} />
      ) : null}

      {index >= 0 && step !== "summary" ? (
        <WizardNav
          onBack={index > 0 ? () => go(SETUP_STEPS[index - 1]) : undefined}
          onNext={next}
          canNext={canLeave(step)}
          nextLabel={step === "captions" ? "Review choices" : "Next"}
          hint={step === "idea" && !canLeave("idea") ? "Write your idea to continue" : undefined}
        />
      ) : null}

      {(step === "writing" || step === "review") && query.get("plan") ? (
        <PlanStep
          planJobId={query.get("plan")!}
          step={step}
          view={query.get("view")}
          onRewrite={() => void write()}
          rewriting={writing}
        />
      ) : null}

      {(step === "rendering" || step === "done") && query.get("job") ? (
        <RunStep jobId={query.get("job")!} step={step} onMakeAnother={makeAnother} />
      ) : null}
    </div>
  );
}
