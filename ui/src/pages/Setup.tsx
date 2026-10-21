import { useEffect, useState } from "react";
import { Cpu, Download, Check, Loader2 } from "lucide-react";
import { getTtsStatus, startTtsInstall, getTtsInstallJob, TtsEngineStatus, TtsInstallJob } from "../api";
import { PageHeader, ErrorBanner } from "../components/shared";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";

function EngineCard({ engine, status, onInstall }: {
  engine: "kitten2" | "voxcpm2";
  status: TtsEngineStatus;
  onInstall: (e: "kitten2" | "voxcpm2") => void;
}) {
  const [job, setJob] = useState<TtsInstallJob | null>(null);
  useEffect(() => {
    if (!job || job.status === "done" || job.status === "failed") return;
    const t = window.setInterval(async () => {
      try {
        const j = await getTtsInstallJob(job.id);
        setJob(j);
        if (j.status === "done" || j.status === "failed") window.clearInterval(t);
      } catch { /* ignore */ }
    }, 1500);
    return () => window.clearInterval(t);
  }, [job]);

  const running = job && (job.status === "queued" || job.status === "running");
  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-extrabold">{status.label}</div>
          <div className="text-xs text-muted-foreground">~{status.sizeMB} MB · {engine === "kitten2" ? "23 preset voices, emotion tags, 24 kHz" : "voice design, 48 kHz, best quality"}</div>
        </div>
        {status.installed ? (
          <Badge variant="success" className="gap-1"><Check className="h-3 w-3" /> Ready</Badge>
        ) : running ? (
          <Badge variant="amber" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" /> {job!.progress}%</Badge>
        ) : (
          <Badge variant="destructive">Not installed</Badge>
        )}
      </div>
      {status.python && <div className="text-xs text-muted-foreground">python: {status.python}</div>}
      {running && (
        <div className="space-y-2">
          <div className="flex gap-1">
            {(["venv", "pip", "weights", "verify"] as const).map((s) => {
              const active = job!.stage === s;
              const done = (s === "venv" && job!.progress >= 8) || (s === "pip" && job!.progress >= 40) || (s === "weights" && job!.progress >= 95) || (s === "verify" && job!.progress >= 100);
              return (
                <div key={s} className={`flex-1 rounded-full px-2 py-1 text-center text-[10px] font-bold ${active ? "bg-accent text-accent-foreground" : done ? "bg-success text-success-foreground" : "bg-input text-muted-foreground"}`}>
                  {s === "venv" ? "venv" : s === "pip" ? "packages" : s === "weights" ? "model" : "verify"}
                </div>
              );
            })}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-input">
            <div className="h-full bg-primary transition-all" style={{ width: `${job!.progress}%` }} />
          </div>
          <div className="text-xs text-muted-foreground">{job!.message}</div>
          {job!.stage === "pip" && (
            <div className="text-[10px] text-muted-foreground/80">
              Python packages report no overall percent — this step installs ~2–3 GB on first run. Watch the log below for activity.
            </div>
          )}
          <div className="flex justify-between text-[10px] text-muted-foreground/70">
            <span>Elapsed: {Math.round((Date.now() - (job!.startedAt ?? Date.now())) / 1000)}s</span>
            <span>Last activity: {Math.round((Date.now() - (job!.lastActivityAt ?? Date.now())) / 1000)}s ago</span>
          </div>
          {job!.logTail && job!.logTail.length > 0 && (
            <div className="max-h-32 overflow-y-auto rounded bg-black/40 p-2 font-mono text-[10px] text-foreground/80">
              {job!.logTail.map((l, i) => <div key={i} className="whitespace-pre-wrap">{l}</div>)}
            </div>
          )}
        </div>
      )}
      {job?.status === "failed" && <div className="text-xs text-destructive">Failed: {job.error}</div>}
      {!status.installed && !running && (
        <Button variant="amber" size="lg" className="w-full" onClick={() => {
          startTtsInstall(engine).then((r: { jobId: string }) => setJob({ id: r.jobId, engine, status: "queued", stage: "queued", progress: 0, message: "Queued" }));
        }}>
          <Download className="h-5 w-5" /> Download {status.label} (~{status.sizeMB} MB)
        </Button>
      )}
    </Card>
  );
}

export default function Setup() {
  const [status, setStatus] = useState<{ kitten2: TtsEngineStatus; voxcpm2: TtsEngineStatus } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => getTtsStatus().then(setStatus).catch((e) => setErr(String(e)));
  useEffect(() => { load(); const t = window.setInterval(load, 5000); return () => window.clearInterval(t); }, []);

  return (
    <div className="space-y-4">
      <PageHeader title="Setup" hintId="story-engine" />
      {err && <ErrorBanner error={err} fix="Start the app with npm run server and reload" />}
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Cpu className="h-5 w-5 text-primary" />
          <div className="font-extrabold">TTS voice models</div>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          These power narration and character voices. Download once per machine — they live in a
          project-local <code>.tts/</code> folder (gitignored). If you hand this project to
          someone else, they run the same downloads on their machine.
        </p>
        <div className="space-y-3">
          {status ? (
            <>
              <EngineCard engine="kitten2" status={status.kitten2} onInstall={() => {}} />
              <EngineCard engine="voxcpm2" status={status.voxcpm2} onInstall={() => {}} />
            </>
          ) : (
            <div className="text-sm text-muted-foreground">Checking…</div>
          )}
        </div>
      </Card>
      <Card className="p-5">
        <div className="mb-2 font-extrabold">First-run checklist</div>
        <ul className="space-y-1 text-sm text-muted-foreground">
          <li>• Python 3.10+ on PATH (used to create the voice venvs)</li>
          <li>• ffmpeg on PATH (rendering + thumbnails)</li>
          <li>• At least one AI provider key in the Providers tab (or use offline templates)</li>
          <li>• Download KittenTTS 2 above for fast narration; VoxCPM2 for best quality</li>
        </ul>
      </Card>
    </div>
  );
}
