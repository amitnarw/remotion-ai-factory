/**
 * Wizard building blocks: the stepper header, the frame each step is drawn
 * in, and the Back / Next bar.
 */
import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  Captions,
  Check,
  FileText,
  Film,
  Lightbulb,
  ListChecks,
  Mic,
  Ratio,
  type LucideIcon,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import { SETUP_STEPS, type CreateStep, type SetupStep } from "../../lib/routes";

const STEPS: Array<{ key: string; label: string; icon: LucideIcon }> = [
  { key: "idea", label: "Idea", icon: Lightbulb },
  { key: "format", label: "Format", icon: Ratio },
  { key: "voice", label: "Voice", icon: Mic },
  { key: "captions", label: "Captions", icon: Captions },
  { key: "summary", label: "Summary", icon: ListChecks },
  { key: "plan", label: "Plan", icon: FileText },
  { key: "video", label: "Video", icon: Film },
];

function indexOfStep(step: CreateStep): number {
  if (step === "writing" || step === "review") return 5;
  if (step === "rendering" || step === "done") return 6;
  return SETUP_STEPS.indexOf(step);
}

/**
 * Where you are in the wizard. While choosing (steps 1 to 5) the earlier
 * steps can be clicked to go back; once a plan exists the Back buttons on
 * the screen lead the way.
 */
export function Stepper({ step, onJump }: { step: CreateStep; onJump: (s: SetupStep) => void }) {
  const current = indexOfStep(step);
  const choosing = current <= 4;
  const label = STEPS[current]?.label ?? "";
  return (
    <nav aria-label="Steps" className="mb-8">
      {/* Phones: a compact counter with segments. */}
      <div className="md:hidden">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium text-muted-foreground">
            Step {current + 1} of {STEPS.length}
          </span>
          <span className="font-semibold">{label}</span>
        </div>
        <div className="mt-2 flex gap-1.5" aria-hidden>
          {STEPS.map((s, i) => (
            <span
              key={s.key}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                i < current ? "bg-primary" : i === current ? "bg-accent" : "bg-secondary",
              )}
            />
          ))}
        </div>
      </div>

      {/* Wider screens: every step by name. */}
      <ol className="hidden items-center md:flex">
        {STEPS.map((s, i) => {
          const done = i < current;
          const isCurrent = i === current;
          const clickable = choosing && done;
          const Icon = s.icon;
          const content = (
            <>
              <span
                className={cn(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold transition-colors",
                  isCurrent && "bg-accent text-accent-foreground shadow-lg shadow-accent/25",
                  done && "bg-primary text-primary-foreground",
                  !done && !isCurrent && "bg-secondary text-muted-foreground",
                )}
              >
                {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </span>
              <span
                className={cn(
                  "text-sm font-semibold",
                  isCurrent ? "text-foreground" : done ? "text-foreground/85" : "text-muted-foreground",
                )}
              >
                {s.label}
              </span>
            </>
          );
          return (
            <React.Fragment key={s.key}>
              {i > 0 ? (
                <li aria-hidden className={cn("mx-2 h-1 min-w-3 flex-1 rounded-full", i <= current ? "bg-primary" : "bg-secondary")} />
              ) : null}
              <li className="shrink-0">
                {clickable ? (
                  <button
                    type="button"
                    onClick={() => onJump(s.key as SetupStep)}
                    className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-secondary/60"
                    aria-label={`Go back to ${s.label}`}
                  >
                    {content}
                  </button>
                ) : (
                  <div className="flex items-center gap-2 py-1 pl-1 pr-2" aria-current={isCurrent ? "step" : undefined}>
                    {content}
                  </div>
                )}
              </li>
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

/** The heading of one step: an icon, one clear question, one line of help. */
export function StepFrame({
  icon,
  title,
  description,
  aside,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-6 flex items-start gap-4">
        <span className="hidden h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/20 text-primary sm:grid [&_svg]:size-6">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          {description ? <p className="mt-1.5 text-[15px] text-muted-foreground">{description}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Back and Next, kept in reach at the bottom of the screen. */
export function WizardNav({
  onBack,
  onNext,
  nextLabel = "Next",
  canNext = true,
  hint,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  canNext?: boolean;
  hint?: string;
}) {
  return (
    <div className="sticky bottom-3 z-20 mt-8">
      <div className="flex items-center gap-3 rounded-2xl bg-card/95 p-2.5 shadow-2xl shadow-black/50 backdrop-blur-md sm:p-3">
        {onBack ? (
          <Button variant="secondary" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        ) : null}
        <div className="ml-auto flex items-center gap-4">
          <span className="hidden text-sm text-muted-foreground sm:block">
            {hint ?? (canNext ? "Press Enter to continue" : "")}
          </span>
          <Button variant="amber" className="min-w-36" onClick={onNext} disabled={!canNext}>
            {nextLabel} <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
