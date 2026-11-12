/**
 * VariantsPanel: other versions of a finished video (15-producer.md §17).
 *
 * One run, several versions: other hooks the writer proposes, other endings
 * (the last beat) and other shapes. The story, the plan and the voices of the
 * unchanged lines are reused; only what differs is voiced and rendered again,
 * and the chunked render reuses every chunk that stays the same.
 *
 * Shown on the done screen and in the library's video page. It starts the
 * job (POST /api/runs/:runId/variants), follows it here, then lists the
 * versions from output/<run>/variants/variants.json.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Download, Layers, Loader2, Ratio } from "lucide-react";
import { getJob, getVariants, makeVariants, type Job, type VariantFormat, type VariantInfo, type VariantsResponse } from "../api";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { ErrorBanner, ProgressBar, SegmentedControl } from "./shared";
import { FORMATS, formatSeconds } from "../lib/format";
import { refreshJobs } from "../lib/jobs";
import { cn } from "../lib/utils";

// A dashboard component (not a Remotion composition): native media elements are right here.
/* eslint-disable @remotion/warn-native-media-tag */

const ALL_FORMATS: VariantFormat[] = ["9:16", "16:9", "1:1"];
const DIFFERS: Record<VariantInfo["differs"][number], string> = { hook: "Hook", ending: "Ending", format: "Shape" };

export function VariantsPanel({ runId, className }: { runId: string; className?: string }) {
  const [data, setData] = useState<VariantsResponse | null>(null);
  const [absent, setAbsent] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hooks, setHooks] = useState("1");
  const [endings, setEndings] = useState("1");
  const [formats, setFormats] = useState<VariantFormat[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const fresh = await getVariants(runId);
      setData(fresh);
      setLoadError(null);
      if (fresh.jobId) setJobId((j) => j ?? fresh.jobId!);
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      // Not a planned run (an old or template video): no variants to offer.
      if (/No finished plan|bad run id|HTTP 404/.test(text)) setAbsent(true);
      else setLoadError(text);
    }
  }, [runId]);

  useEffect(() => {
    setData(null);
    setAbsent(false);
    setJobId(null);
    setJob(null);
    void load();
  }, [load]);

  /* Follow the running job until it ends, then read the list again. */
  useEffect(() => {
    if (!jobId) return;
    const stop = () => {
      if (timer.current !== null) window.clearInterval(timer.current);
      timer.current = null;
    };
    const tick = async () => {
      try {
        const fresh = await getJob(jobId);
        setJob(fresh);
        if (fresh.status !== "running" && fresh.status !== "queued") {
          stop();
          if (fresh.status === "failed") setError(fresh.error ?? "The variants could not be made.");
          setJobId(null);
          refreshJobs();
          void load();
        }
      } catch {
        stop();
        setJobId(null);
        void load();
      }
    };
    void tick();
    timer.current = window.setInterval(() => void tick(), 2000);
    return stop;
  }, [jobId, load]);

  if (absent) return null;
  if (loadError) return <ErrorBanner error={loadError} className={className} />;
  if (!data) return null;

  const own = data.current.format;
  const asWritten = data.current.asWritten;
  const chosen = Array.from(new Set([own, ...formats]));
  const nHooks = asWritten ? 1 : Number(hooks);
  const nEndings = asWritten ? 1 : Number(endings);
  const count = nHooks * nEndings * chosen.length - 1;
  const running = !!jobId;
  const tooLong = (f: VariantFormat) => data.current.durationSec > FORMATS[f].max;

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const { jobId: id } = await makeVariants(runId, { hooks: nHooks, endings: nEndings, formats: chosen });
      setJob(null);
      setJobId(id);
      refreshJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  const toggle = (f: VariantFormat) => setFormats((fs) => (fs.includes(f) ? fs.filter((x) => x !== f) : [...fs, f]));
  const pct = Math.max(3, Math.min(100, Math.round(job?.progress ?? 0)));

  return (
    <Card className={cn("space-y-5 p-4 sm:p-6", className)}>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/20 text-primary">
          <Layers className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-bold tracking-tight">Variants</h2>
          <p className="text-sm text-muted-foreground">
            More versions of this video to test: other opening lines, other endings, other shapes. The story, the plan and the
            voices of the lines that stay are reused, so only what differs is voiced and filmed again.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <section>
          <h3 className="mb-2 text-sm font-semibold">Hooks (the opening line)</h3>
          <SegmentedControl
            label="Hooks"
            size="sm"
            value={asWritten ? "1" : hooks}
            onChange={(v) => !asWritten && setHooks(v)}
            options={["1", "2", "3", "4"].map((v) => ({ value: v, label: v === "1" ? "Only this one" : v }))}
          />
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold">Endings (the last beat)</h3>
          <SegmentedControl
            label="Endings"
            size="sm"
            value={asWritten ? "1" : endings}
            onChange={(v) => !asWritten && setEndings(v)}
            options={["1", "2", "3"].map((v) => ({ value: v, label: v === "1" ? "Only this one" : v }))}
          />
        </section>
      </div>
      {asWritten ? (
        <p className="text-sm text-muted-foreground">This story is your script as written, so its hook and ending stay your own words. Other shapes can still be made.</p>
      ) : (
        <p className="text-sm text-muted-foreground">The counts include the one you have. The writer proposes the others.</p>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold">Shapes</h3>
        <div role="group" aria-label="Shapes" className="flex flex-wrap gap-2">
          {ALL_FORMATS.map((f) => {
            const isOwn = f === own;
            const on = isOwn || formats.includes(f);
            const disabled = isOwn || (!on && tooLong(f));
            return (
              <button
                key={f}
                type="button"
                role="checkbox"
                aria-checked={on}
                disabled={disabled}
                title={isOwn ? "The shape of this video" : tooLong(f) ? `${FORMATS[f].name} videos are at most ${formatSeconds(FORMATS[f].max)}` : undefined}
                onClick={() => toggle(f)}
                className={cn(
                  "inline-flex min-h-10 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed",
                  on ? "bg-primary/20 text-foreground ring-2 ring-primary" : "bg-input/60 text-muted-foreground hover:bg-input",
                  disabled && !isOwn && "opacity-50",
                )}
              >
                {on ? <Check className="h-4 w-4" /> : <Ratio className="h-4 w-4" />}
                {FORMATS[f].name} {f}
                {isOwn ? <span className="text-xs font-medium text-muted-foreground">(this video)</span> : null}
              </button>
            );
          })}
        </div>
      </section>

      {error ? <ErrorBanner error={error} /> : null}

      {running ? (
        <div className="space-y-2" aria-live="polite">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Loader2 className="h-4 w-4 animate-spin" /> Making the variants
            <span className="ml-auto tabular-nums text-muted-foreground">{Math.round(job?.progress ?? 0)}%</span>
          </div>
          <ProgressBar value={pct} />
          <p className="text-sm text-muted-foreground">You can leave this screen. The versions appear here when they are ready.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <p className="text-sm text-muted-foreground">
            {count > 0 ? `Makes ${count} new ${count === 1 ? "version" : "versions"} (every hook with every ending, in every shape).` : "Choose more hooks, endings or shapes."}
          </p>
          <Button variant="amber" className="shrink-0 sm:ml-auto" onClick={start} disabled={count < 1 || starting}>
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers className="h-4 w-4" />} Make the variants
          </Button>
        </div>
      )}

      {data.variants.length ? (
        <section>
          <h3 className="mb-3 text-sm font-semibold">
            {data.variants.length} {data.variants.length === 1 ? "version" : "versions"}
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            {data.variants.map((v) => (
              <VariantCard key={v.id} runId={runId} variant={v} />
            ))}
          </div>
        </section>
      ) : null}
    </Card>
  );
}

function VariantCard({ runId, variant: v }: { runId: string; variant: VariantInfo }) {
  const src = v.video ? `/media/${runId}/${v.video}` : null;
  return (
    <div className="space-y-3 rounded-2xl bg-input/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <code className="text-xs font-semibold">{v.id}</code>
        {v.differs.map((d) => (
          <Badge key={d} variant="violet">
            {DIFFERS[d]}
          </Badge>
        ))}
        <Badge variant="muted">
          {FORMATS[v.format]?.name ?? v.format} {v.format}
        </Badge>
        {v.state === "failed" ? <Badge variant="destructive">Not made</Badge> : v.state === "planned" ? <Badge variant="muted">Not filmed yet</Badge> : null}
      </div>
      {v.state === "rendered" && src ? (
        <div className="grid place-items-center overflow-hidden rounded-xl bg-black">
          <video controls playsInline preload="metadata" src={src} className={cn("w-full", v.format === "9:16" ? "max-h-[50dvh]" : "max-h-[40dvh]")} />
        </div>
      ) : null}
      <dl className="space-y-1.5 text-sm">
        {v.hookText ? (
          <div>
            <dt className="inline text-muted-foreground">Hook {v.hook}: </dt>
            <dd className="inline font-medium">{v.hookText}</dd>
          </div>
        ) : null}
        {v.endingText ? (
          <div>
            <dt className="inline text-muted-foreground">Ending {v.ending}: </dt>
            <dd className="inline font-medium">{v.endingText}</dd>
          </div>
        ) : null}
      </dl>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {formatSeconds(v.durationSec) ? <span>{formatSeconds(v.durationSec)}</span> : null}
        {v.timing ? <span>{v.timing === "kept" ? "Same length as this video" : "A little longer than this video"}</span> : null}
        {v.chunks ? (
          <span>
            {v.chunks.rendered} of {v.chunks.total} parts filmed, {v.chunks.reused} reused
          </span>
        ) : null}
        {src && v.state === "rendered" ? (
          <a href={src} download className="ml-auto inline-flex items-center gap-1 font-semibold text-foreground hover:underline">
            <Download className="h-3.5 w-3.5" /> Download
          </a>
        ) : null}
      </div>
      {v.state === "failed" && v.error ? <p className="text-xs text-destructive">{v.error}</p> : null}
    </div>
  );
}
