/**
 * Shared dashboard building blocks, solid, borderless, kid-simple.
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
    <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
      <h2 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
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
    <div className="rounded-3xl bg-card px-8 py-16 text-center shadow-xl shadow-black/20">
      {icon ? (
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-primary/20 text-primary [&_svg]:size-8">
          {icon}
        </div>
      ) : null}
      <h3 className="mb-2 text-xl font-bold">{title}</h3>
      <p className="mx-auto max-w-sm text-[15px] font-medium text-muted-foreground">{body}</p>
      {action ? <div className="mt-7 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Solid red block: problem + exact fix. No hairlines. */
export function ErrorBanner({ error, fix }: { error: string; fix?: string }) {
  return (
    <div
      role="alert"
      className="mb-6 flex gap-3 rounded-2xl bg-destructive px-5 py-4 text-[15px] font-medium text-destructive-foreground shadow-xl shadow-destructive/20"
    >
      <AlertTriangle className="mt-1 h-5 w-5 shrink-0" />
      <div className="min-w-0 whitespace-pre-wrap">
        <div>{error}</div>
        {fix ? <div className="mt-1 opacity-80">Fix: {fix}</div> : null}
      </div>
    </div>
  );
}

/** Round solid audition button for an SFX variant URL. */
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
      variant={playing ? "amber" : "soft"}
      size="iconSm"
      onClick={toggle}
      title={title ?? "Audition this sound"}
      className={cn("shrink-0", className)}
      aria-label={title ?? "Audition"}
    >
      {playing ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
    </Button>
  );
}

/** Small muted key/value row. */
export function MetaRow({ items }: { items: Array<{ label: string; value?: React.ReactNode }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-muted-foreground">
      {items
        .filter((i) => i.value !== undefined && i.value !== null && i.value !== "")
        .map((i) => (
          <span key={i.label} className="inline-flex items-center gap-1.5">
            <span className="text-muted-foreground/60">{i.label}</span>
            {i.value}
          </span>
        ))}
    </div>
  );
}