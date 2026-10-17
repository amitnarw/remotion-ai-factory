import { useState, useEffect } from "react";
import { getProviders, generateVideo, getJob, Job, ProviderInfo } from "../api";
import { PlayerPreview } from "../preview/PlayerPreview";

export default function Generate() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [premise, setPremise] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string | undefined>(undefined);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined);
  const [job, setJob] = useState<Job | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [genError, setGenError] = useState<string | null>(null);

  const selectedProviderInfo = providers.find((p) => p.name === selectedProvider);
  const keyMissing =
    selectedProviderInfo !== undefined &&
    selectedProviderInfo.package !== "gateway" &&
    !selectedProviderInfo.keyConfigured;

  useEffect(() => {
    getProviders().then((d) => setProviders(d.providers || []));
  }, []);

  const handleGenerate = async () => {
    if (!premise.trim() || keyMissing || status === "running") return;
    setLogs([]);
    setProgress(0);
    setGenError(null);
    setStatus("running");
    try {
      const r = await generateVideo(premise, selectedProvider, selectedModel);
      setJob({ id: r.jobId, status: "queued", progress: 0, logs: [] as string[], premise, createdAt: Date.now() } as Job);
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
          status?: string;
          error?: string;
        };
        if (d.type === "log") setLogs((l) => [...l, d.text ?? ""]);
        else if (d.type === "progress") setProgress(d.progress ?? 0);
        else if (d.type === "done") {
          setStatus("done");
          es.close();
          setJob((j) => (j ? { ...j, status: "done", progress: 100 } : null));
        } else if (d.type === "failed") {
          setStatus("failed");
          es.close();
          setJob((j) => (j ? { ...j, status: "failed", error: d.error } : null));
        } else if (d.type === "status") {
          setStatus(d.status as "idle" | "running" | "done" | "failed");
        }
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => es.close();
    // Sync the full job state once — the job could have already finished
    // (or failed) before the SSE connection attached, and the missed
    // terminal events would otherwise leave the UI stuck on "queued".
    getJob(jobId)
      .then((fresh) => {
        setJob(fresh);
        setProgress(fresh.progress);
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

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <h2 style={{ fontSize: "20px", marginBottom: 16 }}>Generate a video</h2>
      {keyMissing && (
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
          }}
        >
          {genError}
        </div>
      )}
      <div style={{ gap: 12, marginBottom: 16, display: "flex", flexWrap: "wrap" }}>
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
        <button
          onClick={handleGenerate}
          disabled={status === "running" || keyMissing || !premise.trim()}
          style={{
            padding: "10px 20px",
            background: status === "running" || keyMissing || !premise.trim() ? "#9ca3af" : "#111827",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            cursor: status === "running" || keyMissing || !premise.trim() ? "not-allowed" : "pointer",
          }}
        >
          {status === "running" ? "Rendering…" : "Generate"}
        </button>
      </div>

      {status !== "idle" && (
        <div style={{ background: "#1f2937", color: "#e5e7eb", padding: 12, borderRadius: 8, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span>Status</span>
            <span>{job?.status || status}</span>
          </div>
          <div style={{ height: 6, background: "#374151", borderRadius: 3, overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                background: progress ? "#2563eb" : "#4b5563",
                width: `${progress || 5}%`,
              }}
            />
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: "#9ca3af", whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
            {logs.slice(-20).join("\n")}
          </div>
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
          <PlayerPreview spec={job.output?.spec || {}} />
          <p style={{ marginTop: 10, fontSize: 13, color: "#6b7280" }}>
            Video: {job.output?.mp4}
          </p>
        </div>
      )}
    </div>
  );
}
