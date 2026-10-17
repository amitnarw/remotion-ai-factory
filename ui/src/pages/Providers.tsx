import { useState, useEffect } from "react";
import { getProviders, setProviderKey, addProvider as addProviderApi, testProvider, fetchProviderModels, ProviderInfo, TestResult, FetchModelsResult } from "../api";

export default function Providers() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [defaultProvider, setDefaultProvider] = useState<string | undefined>(undefined);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [newPackage, setNewPackage] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("");
  const [newApiKeyEnv, setNewApiKeyEnv] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saveResult, setSaveResult] = useState<{ name: string; ok: boolean; message?: string } | null>(null);
  const [fetchResult, setFetchResult] = useState<(FetchModelsResult & { name: string }) | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const d = await getProviders();
    setProviders(d.providers || []);
    setDefaultProvider(d.defaultProvider);
  };

  const setKey = async (name: string) => {
    const key = keys[name] || "";
    try {
      await setProviderKey(name, key);
      load();
      // After saving a key, immediately pull the real model list for it.
      const success = { name, ok: true };
      setSaveResult(success);
      refreshModels(name);
    } catch (e) {
      const failure = { name, ok: false, message: String(e) };
      setSaveResult(failure);
    }
  };

  const refreshModels = async (name: string) => {
    setFetchResult(null);
    setFetching(name);
    try {
      const r = await fetchProviderModels(name);
      setFetchResult({ ...r, name });
      load();
    } catch (e) {
      setFetchResult({ name, ok: false, models: [], source: "", error: String(e) });
    } finally {
      setFetching(null);
    }
  };

  const test = async (p: ProviderInfo) => {
    setTestResult(null);
    try {
      const r = await testProvider(p.name);
      const result: TestResult = { ...r, name: p.name };
      setTestResult(result);
    } catch (e) {
      const result: TestResult = { name: p.name, ok: false, error: String(e) };
      setTestResult(result);
    }
  };

  const handleAddProvider = async () => {
    if (!newName) return;
    try {
      await addProviderApi({ name: newName, package: newPackage || undefined, baseUrl: newBaseUrl || undefined, apiKeyEnv: newApiKeyEnv || undefined });
      setNewName(""); setNewPackage(""); setNewBaseUrl(""); setNewApiKeyEnv("");
      load();
    } catch (e) {
      alert("Failed: " + String(e));
    }
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <h2 style={{ fontSize: "20px", marginBottom: 16 }}>Providers</h2>
      <div style={{ gap: 12, marginBottom: 16, display: "flex", flexWrap: "wrap" }}>
        <input
          placeholder="Provider name (e.g. openai)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          style={{ padding: "10px 14px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14 }}
        />
        <input
          placeholder="package (openai/anthropic/google/gateway)"
          value={newPackage}
          onChange={(e) => setNewPackage(e.target.value)}
          style={{ padding: "10px 14px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14 }}
        />
        <input
          placeholder="baseUrl (optional)"
          value={newBaseUrl}
          onChange={(e) => setNewBaseUrl(e.target.value)}
          style={{ padding: "10px 14px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14 }}
        />
        <input
          placeholder="API key env var (e.g. OPENAI_API_KEY)"
          value={newApiKeyEnv}
          onChange={(e) => setNewApiKeyEnv(e.target.value)}
          style={{ padding: "10px 14px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14 }}
        />
        <button onClick={handleAddProvider} style={{ padding: "10px 20px", background: "#111827", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>
          Add provider
        </button>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#6b7280", fontSize: 12 }}>
            <th style={{ padding: 8, borderBottom: "1px solid #e5e7eb" }}>Provider</th>
            <th style={{ padding: 8, borderBottom: "1px solid #e5e7eb" }}>Key env</th>
            <th style={{ padding: 8, borderBottom: "1px solid #e5e7eb" }}>Status</th>
            <th style={{ padding: 8, borderBottom: "1px solid #e5e7eb" }}>Models</th>
            <th style={{ padding: 8, borderBottom: "1px solid #e5e7eb" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {providers.map((p) => (
            <tr key={p.name} style={{ borderBottom: "1px solid #e5e7eb" }}>
              <td style={{ padding: 8 }}>{p.name}</td>
              <td style={{ padding: 8 }}>
                {!p.apiKeyEnv ? (
                  <span style={{ color: "#6b7280", fontSize: 13 }}>Local — no key needed</span>
                ) : (
                  <>
                    <input
                      placeholder={p.apiKeyEnv}
                      value={keys[p.name] || ""}
                      onChange={(e) => setKeys({ ...keys, [p.name]: e.target.value })}
                      type="password"
                      style={{ width: 180, padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13 }}
                    />
                    <button
                      onClick={() => setKey(p.name)}
                      style={{ marginLeft: 6, padding: "6px 12px", background: "#111827", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
                    >
                      Save
                    </button>
                  </>
                )}
              </td>
              <td style={{ padding: 8 }}>
                {!p.apiKeyEnv ? (
                  <span style={{ color: "#16a34a", fontWeight: 600 }}>Local — no key needed</span>
                ) : p.keyConfigured ? (
                  <span style={{ color: "#16a34a", fontWeight: 600 }}>Configured ✓</span>
                ) : (
                  <span style={{ color: "#dc2626", fontWeight: 600 }}>Not set</span>
                )}
              </td>
              <td style={{ padding: 8 }}>{(p.models || []).join(", ")}</td>
              <td style={{ padding: 8 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button
                    onClick={() => test(p)}
                    style={{ padding: "6px 12px", background: "#3b82f6", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
                  >
                    Test
                  </button>
                  <button
                    onClick={() => refreshModels(p.name)}
                    disabled={fetching === p.name}
                    style={{ padding: "6px 12px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, opacity: fetching === p.name ? 0.6 : 1 }}
                  >
                    {fetching === p.name ? "Fetching…" : "Fetch models"}
                  </button>
                  {p.name === defaultProvider ? (
                    <span style={{ color: "#16a34a", fontSize: 12 }}>default</span>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {testResult && (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            background: testResult.ok ? "#f0fdf4" : "#fef2f2",
            color: testResult.ok ? "#166534" : "#991b1b",
            marginBottom: 8,
            whiteSpace: "pre-wrap",
          }}
        >
          {testResult.ok
            ? `Test passed for ${testResult.name} — ${testResult.note ?? "configured"}${testResult.latencyMs ? ` (${testResult.latencyMs}ms)` : ""}`
            : `Test failed: ${testResult.error ?? "unknown error"}${testResult.fix ? `\n→ Fix: ${testResult.fix}` : ""}`}
        </div>
      )}
      {saveResult && (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            background: saveResult.ok ? "#f0fdf4" : "#fef2f2",
            color: saveResult.ok ? "#166534" : "#991b1b",
            marginBottom: 8,
            whiteSpace: "pre-wrap",
          }}
        >
          {saveResult.ok
            ? `API key saved for ${saveResult.name} — written to .env (never sent to the browser)`
            : `Saving key for ${saveResult.name} failed: ${saveResult.message || "unknown error"}`}
        </div>
      )}
      {fetchResult && (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            background: fetchResult.ok ? "#f0fdf4" : "#fef2f2",
            color: fetchResult.ok ? "#166534" : "#991b1b",
            marginBottom: 16,
            whiteSpace: "pre-wrap",
          }}
        >
          {fetchResult.ok
            ? `Fetched ${fetchResult.models.length} models for ${fetchResult.name} from ${fetchResult.source} — saved to ai.config.json`
            : `Could not fetch models for ${fetchResult.name}: ${fetchResult.error ?? "unknown error"}${fetchResult.fix ? `\n→ Fix: ${fetchResult.fix}` : ""}`}
        </div>
      )}
    </div>
  );
}
