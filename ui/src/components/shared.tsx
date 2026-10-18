/**
 * Shared dashboard building blocks: PageHeader, EmptyState, ErrorBanner,
 * SoundPlayer (CC0/synth audition) — all dark-theme native.
 */
import * as React from "react";
import { Play, Square, AlertTriangle } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { InfoTip } from "./InfoTip";

export function PageHeader({
  title,
  hintId,
  children,
}: {
  title: string;
  hintId?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
        {title}
        {hintId ? <InfoTip helpId={hintId} /> : null}
      </h2>
      {children}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 px-8 py-14 text-center">
      {icon ? <div className="mx-auto mb-4 text-muted-foreground [&_svg]:size-10">{icon}</div> : null}
      <h3 className="mb-1 font-semibold text-lg">{title}</h3>
      <p className="mx-auto max-w-sm text-sm text-muted-foreground">{body}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Errors always state the problem AND the exact fix. */
export function ErrorBanner({ error, fix }: { error: string; fix?: string }) {
  return (
    <div
      role="alert"
      className="mb-4 flex gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div className="min-w-0 whitespace-pre-wrap">
        <div className="font-medium">{error}</div>
        {fix ? <div className="mt-1 text-muted-foreground">→ Fix: {fix}</div> : null}
      </div>
    </div>
  );
}

/** One-shot audition button for an SFX variant URL. */
export function SoundPlayer({
  url,
  className,
  title,
}: {
  url: string;
  className?: string;
  title?: string;
}) {
  const [audio] = React.useState(() => {
    if (typeof Audio === "undefined") return null;
    const el = new Audio();
    el.preload = "none";
    return el;
  });
  const [playing, setPlaying] = React.useState(false);
  React.useEffect(() => {
    if (audio) audio.src = url;
    setPlaying(false);
  }, [url, audio]);
  React.useEffect(() => {
    if (!audio) return;
    const onEnd = () => setPlaying(false);
    audio.addEventListener("ended", onEnd);
    return () => audio.removeEventListener("ended", onEnd);
  }, [audio]);

  const toggle = () => {
    if (!audio) return;
    if (playing) {
      audio.pause();
      audio.currentTime = 0;
      setPlaying(false);
    } else {
      void audio.play().catch(() => setPlaying(false));
      setPlaying(true);
    }
  };
  return (
    <Button
      variant={playing ? "amber" : "secondary"}
      size="sm"
      onClick={toggle}
      title={title ?? "Audition this sound"}
      className={cn("gap-1 px-2", className)}
      aria-label={title ?? "Audition"}
    >
      {playing ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
    </Button>
  );
}

/** Small KV chip row used across pages. */
export function MetaRow({ items }: { items: Array<{ label: string; value?: React.ReactNode }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {items
        .filter((i) => i.value !== undefined && i.value !== null && i.value !== "")
        .map((i) => (
          <span key={i.label} className="inline-flex items-center gap-1">
            <span className="text-muted-foreground/60">{i.label}</span>
            {i.value}
          </span>
        ))}
    </div>
  );
}
