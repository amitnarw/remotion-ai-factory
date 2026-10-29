/**
 * Shared dashboard building blocks: page headers, empty, loading and error
 * states, a segmented control and selectable choice cards. Solid fills, no
 * hairlines, one visible focus ring.
 */
import * as React from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { cn } from "../lib/utils";
import { friendlyError } from "../lib/format";
import { InfoTip } from "./InfoTip";

export function PageHeader({
  title,
  description,
  hintId,
  icon,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  hintId?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight sm:text-3xl">
          {icon ? <span className="text-primary [&_svg]:size-7">{icon}</span> : null}
          {title}
          {hintId ? <InfoTip helpId={hintId} /> : null}
        </h1>
        {description ? <p className="mt-1.5 max-w-2xl text-[15px] text-muted-foreground">{description}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  body: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl bg-card px-6 py-14 text-center shadow-xl shadow-black/20 sm:px-8", className)}>
      {icon ? (
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-primary/20 text-primary [&_svg]:size-7">
          {icon}
        </div>
      ) : null}
      <h2 className="mb-2 text-xl font-bold">{title}</h2>
      <p className="mx-auto max-w-md text-[15px] text-muted-foreground">{body}</p>
      {action ? <div className="mt-7 flex flex-wrap justify-center gap-3">{action}</div> : null}
    </div>
  );
}

/** Spinner plus a short sentence, for screens that are still loading. */
export function LoadingState({ title, body, className }: { title: string; body?: string; className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("rounded-2xl bg-card px-6 py-12 text-center shadow-xl shadow-black/20", className)}
    >
      <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-primary" />
      <div className="text-lg font-semibold">{title}</div>
      {body ? <div className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</div> : null}
    </div>
  );
}

/**
 * Solid red block: the problem, how to fix it, and an optional action.
 * A "How to fix it:" line inside `error` (from the API client) is split out.
 */
export function ErrorBanner({
  error,
  fix,
  action,
  className,
}: {
  error: string;
  fix?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  const [message, ...rest] = friendlyError(error).split(/\n\s*How to fix it:\s*/);
  const howToFix = fix ?? (rest.length ? friendlyError(rest.join(" ")) : undefined);
  return (
    <div
      role="alert"
      className={cn(
        "mb-6 flex flex-col gap-3 rounded-2xl bg-destructive px-5 py-4 text-[15px] text-destructive-foreground shadow-xl shadow-destructive/20 sm:flex-row sm:items-start",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">
        <div className="font-semibold">{message}</div>
        {howToFix ? <div className="mt-1 opacity-90">How to fix it: {howToFix}</div> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

/** A row of mutually exclusive options; one is always selected. */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; icon?: React.ReactNode }>;
  label: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (index + (e.key === "ArrowRight" ? 1 : options.length - 1)) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn("flex w-full gap-1 overflow-x-auto rounded-2xl bg-card p-1.5 shadow-lg shadow-black/20", className)}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex flex-1 shrink-0 items-center justify-center gap-2 rounded-xl text-center font-semibold leading-tight transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
              size === "sm" ? "min-h-9 px-3 py-1.5 text-sm" : "min-h-11 px-3 py-2 text-[15px]",
              active ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A large selectable card (behaves as a radio button). */
export function ChoiceCard({
  selected,
  onSelect,
  title,
  description,
  icon,
  badge,
  className,
  disabled,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "relative flex w-full flex-col items-start gap-1 rounded-2xl p-4 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50",
        selected
          ? "bg-primary/20 ring-2 ring-primary"
          : "bg-input/60 hover:bg-input",
        className,
      )}
    >
      {selected ? (
        <span className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-3.5 w-3.5" />
        </span>
      ) : null}
      {icon ? <span className="mb-1 text-primary">{icon}</span> : null}
      <span className="pr-7 text-[15px] font-semibold leading-snug">{title}</span>
      {description ? <span className="text-sm text-muted-foreground">{description}</span> : null}
      {badge ? <span className="mt-1">{badge}</span> : null}
      {children}
    </button>
  );
}

/** A small label above a control. */
export function FieldLabel({ children, htmlFor, hint }: { children: React.ReactNode; htmlFor?: string; hint?: React.ReactNode }) {
  return (
    <div className="mb-2">
      <label htmlFor={htmlFor} className="text-sm font-semibold text-foreground">
        {children}
      </label>
      {hint ? <div className="text-sm text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

/** A labelled value in a list of facts. */
export function InfoRow({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex items-start gap-3 py-2.5">
      {icon ? <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">{icon}</span> : null}
      <div className="w-28 shrink-0 text-sm text-muted-foreground">{label}</div>
      <div className="min-w-0 flex-1 break-words text-sm font-semibold">{value}</div>
    </div>
  );
}

/** A thin progress bar. */
export function ProgressBar({ value, className, tone = "primary" }: { value: number; className?: string; tone?: "primary" | "destructive" | "success" }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cn("h-2.5 w-full overflow-hidden rounded-full bg-input", className)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500",
          tone === "destructive" ? "bg-destructive" : tone === "success" ? "bg-success" : "bg-primary",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
