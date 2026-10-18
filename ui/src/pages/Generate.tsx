import { useState, useEffect, useRef } from "react";
import {
  getProviders,
  getStories,
  generateVideo,
  generateStory,
  getJob,
  Job,
  ProviderInfo,
  StoryInfo,
} from "../api";
import { PlayerPreview } from "../preview/PlayerPreview";

export default function Generate() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [engine, setEngine] = useState<"story" | "template">("story");
  const [stories, setStories] = useState<StoryInfo[]>([]);
  const [selectedStory, setSelectedStory] = useState<string | undefined>(undefined);
  const [premise, setPremise] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string | undefined>(undefined);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined);
  const [job, setJob] = useState<Job | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [stage, setStageState] = useState<string>("script");
  const [etaSec, setEta] = useState<number | null>(null);
  const [startAt, setStartAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(Date.now());
  const [pollJobId, setPollJobId] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  const selectedProviderInfo = providers.find((p) => p.name === selectedProvider);
  const keyMissing =
    selectedProviderInfo !== undefined &&
    selectedProviderInfo.package !== "gateway" &&
    !selectedProviderInfo.keyConfigured;

  useEffect(() => {
    getProviders().then((d) => setProviders(d.providers || []));
    getStories()
      .then((d) => {
        setStories(d);
        if (d.length && !selectedStory) setSelectedStory(d[0].slug);
      })
      .catch(() => {
        /* story registry unreachable — toggle hides the picker */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once
  }, []);

  // Elapsed-time ticker while a job is running.
  useEffect(() => {
    if (status !== "running" || startAt == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [status, startAt]);

  // Polling fallback: if the SSE stream drops (sleep/wake, proxy hiccup, or
  // server restart), keep syncing the job so the UI never freezes.
  useEffect(() => {
    if (!pollJobId || status !== "running") return;
    let failures = 0;
    const iv = window.setInterval(async () => {
      try {
        const fresh = await getJob(pollJobId);
        failures = 0;
        setJob(fresh);
        setProgress(fresh.progress);
        if (fresh.stage) setStageState(fresh.stage);
        setEta(fresh.etaSec ?? null);
        if (fresh.logs.length) setLogs(fresh.logs.slice(-100));
        if (fresh.status === "done" || fresh.status === "failed") {
          setStatus(fresh.status);
          setPollJobId(null);
        }
      } catch {
        failures += 1;
        if (failures >= 3) {
          // Job really gone (e.g. server restarted and lost it).
          setPollJobId(null);
          setGenError(
            "Lost track of the job — the API server likely restarted. Please start again.",
          );
          setStatus("idle");
        }
      }
    }, 2500);
    return () => window.clearInterval(iv);
  }, [pollJobId, status]);

  const selectedStoryMeta = stories.find((s) => s.slug === selectedStory);

  const handleGenerate = async () => {
    if (status === "running") return;
    if (engine === "story" && !selectedStory) return;
    if (engine === "template" && (!premise.trim() || keyMissing)) return;
    setLogs([]);
    setProgress(0);
    setGenError(null);
    setStageState(engine === "story" ? "music" : "script");
    setEta(null);
    setStartAt(Date.now());
    setNow(Date.now());
    setPollJobId(null);
    setStatus("running");
    const title =
      engine === "story" ? selectedStoryMeta?.title ?? selectedStory : premise;
    try {
      const r =
        engine === "story"
          ? await generateStory(selectedStory!)
          : await generateVideo(premise, selectedProvider, selectedModel);
      setJob({
        id: r.jobId,
        status: "queued",
        progress: 0,
        stage: engine === "story" ? "music" : "script",
        etaSec: null,
        logs: [] as string[],
        premise: title,
        engine,
        createdAt: Date.now(),
      } as Job);
      openSSE(r.jobId);
    } catch (e) {
      setGenError(String(e));
      setStatus("idle");
    }
  };

  const openSSE = (jobId: string) => {
    const es = new EventSource(`${window.location.origin}/api/jobs/${jobId}/events`);
    es.onmessage = (ev: MessageEvent) => {
      try {
        const d = JSON.parse(ev.data) as {
          type: string;
          text?: string;
          progress?: number;
          stage?: string;
          etaSec?: number | null;
          status?: string;
          error?: string;
        };
        if (d.type === "log") setLogs((l) => [...l, d.text ?? ""]);
        else if (d.type === "progress") {
          setProgress(d.progress ?? 0);
          if (d.stage) setStageState(d.stage);
          setEta(d.etaSec ?? null);
        } else if (d.type === "done") {
          setStatus("done");
          es.close();
          setProgress(100);
          setStageState("done");
          setJob((j) => (j ? { ...j, status: "done", progress: 100 } : null));
          // The click-time stub lacks output/timeline — fetch the finished job.
          getJob(jobId).then((fresh) => setJob(fresh)).catch(() => {});
        } else if (d.type === "failed") {
          setStatus("failed");
          es.close();
          setStageState("failed");
          setJob((j) => (j ? { ...j, status: "failed", error: d.error } : null));
          getJob(jobId).then((fresh) => setJob(fresh)).catch(() => {});
        } else if (d.type === "status") {
          setStatus(d.status as "idle" | "running" | "done" | "failed");
        }
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => {
      // Stream lost — fall back to polling so the UI keeps updating.
      es.close();
      setPollJobId(jobId);
    };
    // Sync the full job state once — the job could have already finished
    // (or failed) before the SSE connection attached, and the missed
    // terminal events would otherwise leave the UI stuck on "queued".
    getJob(jobId)
      .then((fresh) => {
        setJob(fresh);
        setProgress(fresh.progress);
        if (fresh.stage) setStageState(fresh.stage);
        setEta(fresh.etaSec ?? null);
        if (fresh.status === "done" || fresh.status === "failed") {
          setStatus(fresh.status);
          es.close();
        } else if (fresh.status === "running") {
          setStatus("running");
        }
      })
      .catch(() => {
        /* job listing unavailable — SSE will drive updates */
      });
  };

  const isStory = engine === "story" || job?.engine === "story";
  const STEPS: Array<{ key: string; label: string }> = isStory
    ? [
        { key: "music", label: "Music bed" },
        { key: "bundle", label: "Bundle" },
        { key: "render", label: "Render" },
        { key: "encode", label: "Encode" },
      ]
    : [
        { key: "script", label: "Script (AI)" },
        { key: "bundle", label: "Bundle" },
        { key: "render", label: "Render" },
        { key: "encode", label: "Encode" },
      ];
  const STAGE_LABELS: Record<string, string> = {
    music: "Syncing synthesized music bed…",
    script: "Writing script with AI…",
    bundle: "Bundling composition…",
    render: "Rendering frames…",
    encode: "Encoding + muxing audio…",
    done: "Done",
    failed: "Failed",
  };
  // Chip state derives from the timeline spans (robust for done/failed/
  // refreshed views): a span with endedAt = finished, an open span = current.
  const spanFor = (key: string) => job?.timeline?.find((t) => t.stage === key);
  const stageDuration = (key: string): number => {
    const span = spanFor(key);
    if (!span) return 0;
    const end = span.endedAt ?? Date.now();
    return Math.round((end - span.startedAt) / 1000);
  };
  const tookTotal = Math.round(
    (job?.timeline ?? []).reduce((acc, s) => acc + (s.endedAt ? s.endedAt - s.startedAt : 0), 0) / 1000,
  );
  const fmtEta = (s: number): string => {
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return m > 0 ? `${m}m ${String(sec).padStart(2, "0")}s` : `${sec}s`;
  };
  const elapsedSec = startAt ? Math.round((startAt == null ? 0 : now - startAt) / 1000) : 0;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <h2 style={{ fontSize: "20px", marginBottom: 16 }}>Generate a video</h2>
      {engine === "template" && premise.trim().length > 0 && premise.trim().length < 6 && (
        <div style={{ color: "#b45309", fontSize: 12, marginBottom: 8 }}>
          Too short — describe a full scenario, e.g. "What if gravity disappeared for just 5 seconds?"
        </div>
      )}
      {engine === "template" && keyMissing && (
        <div
          style={{
            background: "#fef2f2",
            color: "#991b1b",
            border: "1px solid #fecaca",
            padding: "10px 14px",
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          API key not set for <strong>{selectedProvider}</strong> — open the
          Providers tab, paste the key and click Save first.
        </div>
      )}
      {genError && (
        <div
          style={{
            background: "#fef2f2",
            color: "#991b1b",
            border: "1px solid #fecaca",
            padding: "10px 14px",
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 13,
            whiteSpace: "pre-wrap",
          }}
        >
          {genError}
        </div>
      )}
      {/* Engine toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {(
          [
            { key: "story", label: "Story engine", hint: "Agent-authored bespoke compositions" },
            { key: "template", label: "AI spec", hint: "Template / LLM spec pipeline" },
          ] as const
        ).map((e) => (
          <button
            key={e.key}
            onClick={() => setEngine(e.key)}
            disabled={status === "running"}
            title={e.hint}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: engine === e.key ? 700 : 400,
              border: "1px solid #d1d5db",
              cursor: status === "running" ? "not-allowed" : "pointer",
              background: engine === e.key ? "#111827" : "#f3f4f6",
              color: engine === e.key ? "#fff" : "#374151",
            }}
          >
            {e.label}
          </button>
        ))}
      </div>

      <div style={{ gap: 12, marginBottom: 16, display: "flex", flexWrap: "wrap" }}>
        {engine === "story" ? (
          <select
            value={selectedStory || ""}
            onChange={(e) => setSelectedStory(e.target.value)}
            disabled={status === "running"}
            style={{
              flex: 1,
              minWidth: 280,
              padding: "10px 14px",
              border: "1px solid #d1d5db",
              borderRadius: 8,
              fontSize: 14,
            }}
          >
            {stories.length === 0 && <option value="">No registered story videos yet</option>}
            {stories.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.title} — {s.durationSec}s
              </option>
            ))}
          </select>
        ) : (
          <input
            placeholder="What if gravity disappeared for just 5 seconds?"
            value={premise}
            onChange={(e) => setPremise(e.target.value)}
            style={{
              flex: 1,
              padding: "10px 14px",
              border: "1px solid #d1d5db",
              borderRadius: 8,
              fontSize: 14,
            }}
          />
        )}
        {engine === "template" && (
          <>
            <select
              value={selectedProvider || ""}
              onChange={(e) => {
                const val = e.target.value || undefined;
                setSelectedProvider(val);
                setSelectedModel(undefined);
                if (val === "offline") {
                  setModels(["templates"]);
                } else {
                  const p = providers.find((x) => x.name === val);
                  setModels((p?.models || []).slice());
                }
              }}
              style={{ padding: "10px 14px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14 }}
            >
              <option value="">Provider</option>
              <option value="offline">offline / templates (no key needed)</option>
              {providers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} {p.keyConfigured ? "✓" : "○"}
                </option>
              ))}
            </select>
            <select
              value={selectedModel || ""}
              onChange={(e) => setSelectedModel(e.target.value || undefined)}
              disabled={!models.length}
              style={{ padding: "10px 14px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14 }}
            >
              <option value="">Model</option>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </>
        )}
        <button
          onClick={handleGenerate}
          disabled={
            status === "running" ||
            (engine === "story" ? !selectedStory : !premise.trim() || keyMissing)
          }
          style={{
            padding: "10px 20px",
            background: status === "running" ? "#9ca3af" : "#111827",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            cursor: status === "running" ? "not-allowed" : "pointer",
          }}
        >
          {status === "running" ? "Rendering…" : "Generate"}
        </button>
      </div>

      {status !== "idle" && (
        <div style={{ background: "#1f2937", color: "#e5e7eb", padding: 14, borderRadius: 8, marginBottom: 16 }}>
          {/* headline: big percent + stage + ETA + elapsed */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.1 }}>
                {status === "done" ? "100%" : `${progress}%`}
              </div>
              <div style={{ fontSize: 13, color: "#cbd5e1", marginTop: 2 }}>
                {STAGE_LABELS[stage] ?? stage}
                {stage === "script" && status === "running" ? " (no % available — usually 10–30s)" : ""}
                {etaSec != null && status === "running" ? ` — ~${fmtEta(etaSec)} remaining` : ""}
              </div>
            </div>
            <div style={{ fontSize: 13, color: "#9ca3af", textAlign: "right" }}>
              {status === "running" && startAt != null
                ? `elapsed ${elapsedSec}s`
                : tookTotal > 0
                ? `took ${fmtEta(tookTotal)}`
                : ""}
            </div>
          </div>

          {/* progress bar */}
          <div style={{ height: 8, background: "#374151", borderRadius: 4, overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                // eslint-disable-next-line @remotion/non-pure-animation -- dashboard CSS, not a Remotion composition
                transition: "width 0.4s ease",
                background:
                  stage === "music" ? "#f59e0b" :
                  stage === "script" ? "#f59e0b" :
                  stage === "bundle" ? "#38bdf8" :
                  stage === "encode" ? "#a855f7" :
                  stage === "done" ? "#16a34a" :
                  stage === "failed" ? "#dc2626" : "#2563eb",
                width: status === "done" ? "100%" : `${progress || 4}%`,
              }}
            />
          </div>

          {/* stage stepper — spans drive state */}
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", fontSize: 12 }}>
            {STEPS.map((s) => {
              const span = spanFor(s.key);
              const state = !span
                ? "pending"
                : span.endedAt != null
                ? "done"
                : "current";
              const dur = stageDuration(s.key);
              return (
                <div
                  key={s.key}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 12,
                    fontWeight: state === "current" ? 700 : 400,
                    background:
                      state === "done" ? "#14532d" : state === "current" ? "#1e3a8a" : "#374151",
                    color:
                      state === "done" ? "#86efac" : state === "current" ? "#93c5fd" : "#6b7280",
                  }}
                >
                  {state === "done" ? "✓ " : state === "current" ? "▸ " : ""}
                  {s.label}
                  {state === "done" && dur > 0 ? ` (${dur}s)` : ""}
                </div>
              );
            })}
          </div>

          {/* full live log console */}
          <LogConsole logs={logs} />
        </div>
      )}

      {status === "failed" && (
        <div
          style={{
            background: "#fef2f2",
            color: "#991b1b",
            border: "1px solid #fecaca",
            padding: 12,
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          <strong>Generation failed.</strong>
          {job?.error ? (
            <pre style={{ margin: "6px 0 0", whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 12 }}>
              {job.error}
            </pre>
          ) : (
            <div style={{ fontSize: 12, marginTop: 4 }}>See the log tail above for details.</div>
          )}
        </div>
      )}

      {status === "done" && job && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: "18px", marginBottom: 12 }}>Result</h3>
          {job.output?.mp4 ? (
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                marginBottom: 12,
                padding: 10,
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                flexWrap: "wrap",
              }}
            >
              <a
                href={`/media/${job.output.mp4}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  padding: "8px 14px",
                  background: "#111827",
                  color: "#fff",
                  borderRadius: 6,
                  textDecoration: "none",
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                Download MP4
              </a>
              <span style={{ fontSize: 13, color: "#6b7280" }}>{job.output.mp4}</span>
            </div>
          ) : null}
          {isStory ? null : <PlayerPreview spec={job.output?.spec || {}} />}
          <p style={{ marginTop: 10, fontSize: 13, color: "#6b7280" }}>
            {isStory
              ? "Bespoke agent-authored composition — every frame was rendered, extracted and visually verified. Use Download to watch with the full music + SFX mix."
              : job.output?.mp4
              ? "In-browser preview of the real composition (audio included)."
              : "Rendering finished — result files were not found for this job."}
          </p>
        </div>
      )}
    </div>
  );
}

/** Full scrolling live-log console with autoscroll + severity coloring. */
function LogConsole({ logs }: { logs: string[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs]);
  const lines = logs.join("").split(/\r?\n/).filter((l) => l.trim()).slice(-300);
  return (
    <div
      ref={ref}
      style={{
        marginTop: 10,
        maxHeight: 220,
        overflowY: "auto",
        fontSize: 12,
        fontFamily: "monospace",
        whiteSpace: "pre-wrap",
        borderTop: "1px solid #374151",
        paddingTop: 8,
      }}
    >
      {lines.map((l, i) => (
        <div
          key={i}
          style={{
            color:
              l.startsWith("(node:") || l.includes("AI_SDK") || l.includes("Deprecation")
                ? "#6b7280"
                : l.startsWith("[AI]") || l.includes("/5]")
                ? "#93c5fd"
                : l.includes("═══") || l.startsWith("✓")
                ? "#a7f3d0"
                : "#e5e7eb",
          }}
        >
          {l}
        </div>
      ))}
    </div>
  );
}
