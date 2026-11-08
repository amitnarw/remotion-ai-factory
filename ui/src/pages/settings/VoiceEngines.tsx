/**
 * Settings, Voice engines: download the two text-to-speech engines once per
 * computer, and watch the install while it runs.
 */
import { useEffect, useState } from "react";
import { AudioLines, Check, ChevronDown, Download, Loader2, Terminal } from "lucide-react";
import { getTtsInstallJob, getTtsStatus, startTtsInstall, type TtsEngineStatus, type TtsInstallJob, type TtsStatus } from "../../api";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import { ErrorBanner, LoadingState, ProgressBar } from "../../components/shared";
import { InfoTip } from "../../components/InfoTip";
import { cn } from "../../lib/utils";

const ENGINE_FACTS: Record<"kitten2" | "voxcpm2", string> = {
  kitten2: "23 preset voices with emotion. Small and fast.",
  voxcpm2: "Voices made from a description. Best quality, needs more time.",
};

const INSTALL_STAGES = [
  { key: "venv", label: "Setting up", doneAt: 8 },
  { key: "pip", label: "Packages", doneAt: 40 },
  { key: "weights", label: "Voice model", doneAt: 95 },
  { key: "verify", label: "Checking", doneAt: 100 },
] as const;

function EngineCard({ engine, status }: { engine: "kitten2" | "voxcpm2"; status: TtsEngineStatus }) {
  const [job, setJob] = useState<TtsInstallJob | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  useEffect(() => {
    if (!job || job.status === "done" || job.status === "failed") return;
    const t = window.setInterval(async () => {
      try {
        const j = await getTtsInstallJob(job.id);
        setJob(j);
        if (j.status === "done" || j.status === "failed") window.clearInterval(t);
      } catch {
        /* keep polling */
      }
    }, 1500);
    return () => window.clearInterval(t);
  }, [job]);

  const running = !!job && (job.status === "queued" || job.status === "running");
  const install = () => {
    setStartError(null);
    startTtsInstall(engine)
      .then((r) => setJob({ id: r.jobId, engine, status: "queued", stage: "queued", progress: 0, message: "Waiting to start" }))
      .catch((e) => setStartError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <Card className={cn("p-4 sm:p-5", status.installed && "ring-1 ring-success/40")}>
      <div className="flex flex-wrap items-start gap-3">
        <span
          className={cn(
            "grid h-11 w-11 shrink-0 place-items-center rounded-2xl",
            status.installed ? "bg-success/20 text-success" : "bg-input text-muted-foreground",
          )}
        >
          <AudioLines className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{status.label}</h2>
          <p className="text-sm text-muted-foreground">
            {ENGINE_FACTS[engine]} About {status.sizeMB} MB.
          </p>
        </div>
        {status.installed ? (
          <Badge variant="success">
            <Check className="h-3 w-3" /> Ready
          </Badge>
        ) : running ? (
          <Badge variant="amber">
            <Loader2 className="h-3 w-3 animate-spin" /> Installing, {job!.progress}%
          </Badge>
        ) : (
          <Badge variant="muted">Not installed</Badge>
        )}
      </div>

      {status.python ? <div className="mt-3 break-all text-xs text-muted-foreground">Python: {status.python}</div> : null}
      {startError ? <ErrorBanner className="mb-0 mt-4" error={startError} /> : null}

      {running && job ? (
        <div className="mt-4 space-y-3">
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {INSTALL_STAGES.map((s) => {
              const active = job.stage === s.key;
              const done = job.progress >= s.doneAt;
              return (
                <li
                  key={s.key}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-center text-xs font-semibold",
                    active ? "bg-accent text-accent-foreground" : done ? "bg-success text-success-foreground" : "bg-input text-muted-foreground",
                  )}
                >
                  {s.label}
                </li>
              );
            })}
          </ol>
          <ProgressBar value={job.progress} />
          <div className="text-sm text-muted-foreground">{job.message}</div>
          {job.stage === "pip" ? (
            <div className="text-xs text-muted-foreground/80">
              The packages step has no overall percentage. On the first install it downloads about 2 to 3 GB; the log
              shows that it is still working.
            </div>
          ) : null}
          <div className="flex justify-between text-xs text-muted-foreground/80">
            <span>Running for {Math.round((Date.now() - (job.startedAt ?? Date.now())) / 1000)} s</span>
            <span>Last activity {Math.round((Date.now() - (job.lastActivityAt ?? Date.now())) / 1000)} s ago</span>
          </div>
          {job.logTail && job.logTail.length > 0 ? (
            <Collapsible open={logOpen} onOpenChange={setLogOpen}>
              <CollapsibleTrigger className="flex items-center gap-2 rounded-lg px-1 py-1 text-sm font-semibold text-muted-foreground hover:text-foreground">
                <Terminal className="h-4 w-4" /> {logOpen ? "Hide the log" : "Show the log"}
                <ChevronDown className={cn("h-4 w-4 transition-transform", logOpen && "rotate-180")} />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 max-h-40 overflow-y-auto rounded-xl bg-black/40 p-3 font-mono text-[11px] text-foreground/80">
                  {job.logTail.map((l, i) => (
                    <div key={i} className="whitespace-pre-wrap break-words">
                      {l}
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </div>
      ) : null}

      {job?.status === "failed" ? <ErrorBanner className="mb-0 mt-4" error={`The install failed: ${job.error ?? "unknown error"}`} /> : null}
      {job?.status === "done" && !status.installed ? (
        <p className="mt-4 text-sm font-semibold text-success">Installed. It is ready to use in a moment.</p>
      ) : null}

      {!status.installed && !running ? (
        <Button variant="amber" className="mt-4 w-full sm:w-auto" onClick={install}>
          <Download className="h-4 w-4" /> Download {status.label} (about {status.sizeMB} MB)
        </Button>
      ) : null}
    </Card>
  );
}

export default function VoiceEngines() {
  const [status, setStatus] = useState<TtsStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const load = () =>
      getTtsStatus()
        .then((s) => {
          setStatus(s);
          setErr(null);
        })
        .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    void load();
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-[15px] text-muted-foreground">
        These make the narration and the character voices, on this computer. Download each one once; they are kept in
        the project's .tts folder. Someone else using this project downloads them on their own computer.
        <InfoTip helpId="voice-engines" className="ml-1 inline-grid align-middle" />
      </p>
      {err ? <ErrorBanner error={err} fix='Start the app with "npm run server" and reload the page.' /> : null}
      {status ? (
        <div className="space-y-4">
          <EngineCard engine="kitten2" status={status.kitten2} />
          <EngineCard engine="voxcpm2" status={status.voxcpm2} />
        </div>
      ) : !err ? (
        <LoadingState title="Checking the voice engines..." />
      ) : null}
    </div>
  );
}
