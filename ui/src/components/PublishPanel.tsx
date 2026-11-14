/**
 * PublishPanel: a finished video's publish pack (docs/factory/20-publish.md).
 *
 * Three titles, the description (with chapters and the CC-BY credits), the
 * tags and a thumbnail, each ready to copy or download. Nothing is uploaded
 * anywhere. The button starts the job (POST /api/videos/:id/publish, which
 * runs scripts/publish.ts), follows it here, then shows publish.json.
 *
 * Shown on the done screen and in the library's video page.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Download, Loader2, Megaphone } from "lucide-react";
import { getJob, getPublishPack, makePublishPack, type Job, type PublishPackInfo } from "../api";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { ErrorBanner, ProgressBar } from "./shared";
import { refreshJobs } from "../lib/jobs";
import { cn } from "../lib/utils";

/** A copy button that says so for a moment. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      window.setTimeout(() => setDone(false), 1500);
    } catch {
      /* the clipboard is not available here */
    }
  };
  return (
    <Button variant="secondary" size="sm" onClick={() => void copy()} aria-label={label} className="shrink-0">
      {done ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {done ? "Copied" : "Copy"}
    </Button>
  );
}

export function PublishPanel({ videoId, className }: { videoId: string; className?: string }) {
  const [pack, setPack] = useState<PublishPackInfo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const fresh = await getPublishPack(videoId);
      setPack(fresh);
      if (fresh.jobId) setJobId((j) => j ?? fresh.jobId!);
    } catch {
      // No pack yet (404): the button makes one.
      setPack(null);
    } finally {
      setLoaded(true);
    }
  }, [videoId]);

  useEffect(() => {
    setPack(null);
    setLoaded(false);
    setJobId(null);
    setJob(null);
    void load();
  }, [load]);

  /* Follow the running job until it ends, then read the pack again. */
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
          if (fresh.status === "failed") setError(fresh.error ?? "The publish pack could not be made.");
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

  if (!loaded) return null;

  const running = !!jobId;
  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const { jobId: id } = await makePublishPack(videoId);
      setJob(null);
      setJobId(id);
      refreshJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };
  const media = (file: string) => `/media/${encodeURIComponent(videoId)}/publish/${file}`;
  const pct = Math.max(3, Math.min(100, Math.round(job?.progress ?? 0)));

  return (
    <Card className={cn("space-y-5 p-4 sm:p-6", className)}>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/20 text-primary">
          <Megaphone className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold tracking-tight">Publish pack</h2>
          <p className="text-sm text-muted-foreground">
            Titles, a description with chapters and credits, tags and a thumbnail, ready to copy into YouTube. Nothing is uploaded for you.
          </p>
        </div>
        <Button onClick={() => void start()} disabled={running || starting} className="shrink-0">
          {running || starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
          {pack ? "Make it again" : "Make the publish pack"}
        </Button>
      </div>

      {running ? (
        <div className="space-y-1">
          <ProgressBar value={pct} />
          <p className="text-sm text-muted-foreground">Writing the titles and picking the thumbnail…</p>
        </div>
      ) : null}
      {error ? <ErrorBanner error={error} /> : null}

      {pack ? (
        <div className="space-y-5">
          {pack.warnings.length ? (
            <div className="flex flex-wrap gap-2">
              {pack.warnings.map((w) => (
                <Badge key={w} variant="amber">
                  {w}
                </Badge>
              ))}
            </div>
          ) : null}

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Titles{pack.titlesFrom === "code" ? " (from code: no writer model answered)" : ""}</h3>
            <ul className="space-y-2">
              {pack.titles.map((t) => (
                <li key={t} className="flex items-center gap-3 rounded-xl bg-input/40 p-3 text-[15px]">
                  <span className="min-w-0 flex-1">{t}</span>
                  <CopyButton text={t} label={`Copy the title ${t}`} />
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Description</h3>
              <CopyButton text={pack.description} label="Copy the description" />
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-input/40 p-3 font-sans text-[15px]">{pack.description}</pre>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Tags</h3>
              <CopyButton text={pack.tags.join(", ")} label="Copy the tags" />
            </div>
            <p className="rounded-xl bg-input/40 p-3 text-[15px]">{pack.tags.join(", ") || "none"}</p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Thumbnail</h3>
            {pack.thumbnail.file ? (
              <div className="space-y-2">
                <img
                  src={media(pack.thumbnail.file)}
                  alt="The thumbnail"
                  className="max-h-72 rounded-xl border border-border object-contain"
                  width={pack.thumbnail.width}
                  height={pack.thumbnail.height}
                />
                <Button variant="secondary" size="sm" asChild>
                  <a href={media(pack.thumbnail.upload ?? pack.thumbnail.file)} download>
                    <Download className="h-4 w-4" /> Download ({pack.thumbnail.width}×{pack.thumbnail.height})
                  </a>
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Not written{pack.thumbnail.skipped ? `: ${pack.thumbnail.skipped}` : ""}.</p>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Credits</h3>
            {pack.credits.length ? (
              <ul className="list-disc space-y-0.5 pl-5 text-[15px]">
                {pack.credits.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">None: this video uses no CC-BY model.</p>
            )}
          </section>
        </div>
      ) : null}
    </Card>
  );
}
