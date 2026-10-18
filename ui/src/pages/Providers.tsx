/**
 * Providers — key/config management, live model fetching, end-to-end tests.
 * ?provider=<name> deep-links to that provider card; state survives refresh.
 */
import { useEffect, useState } from "react";
import { Plug, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  getProviders,
  setProviderKey,
  addProvider,
  testProvider,
  fetchProviderModels,
  ProviderInfo,
  ProvidersResponse,
} from "../api";
import { PageHeader, EmptyState, ErrorBanner, MetaRow } from "../components/shared";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { InfoTip } from "../components/InfoTip";
import { useQuery, setQuery } from "../lib/navigation";
import { cn } from "../lib/utils";

export default function Providers() {
  const query = useQuery();
  const selected = query.get("provider") ?? undefined;
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [defaultProvider, setDefaultProvider] = useState<string | undefined>();
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  // Add-provider form
  const [newName, setNewName] = useState("");
  const [newPackage, setNewPackage] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("");
  const [newApiKeyEnv, setNewApiKeyEnv] = useState("");

  const load = () =>
    getProviders()
      .then((d: ProvidersResponse) => {
        setProviders(d.providers || []);
        setDefaultProvider(d.defaultProvider);
      })
      .catch((e) => setAddError(String(e)));

  useEffect(() => {
    load();
  }, []);

  // Deep-link scroll for ?provider=<name>.
  useEffect(() => {
    if (!selected) return;
    const el = document.getElementById(`provider-${selected}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selected, providers.length]);

  const setKey = async (name: string) => {
    setBusy(name);
    try {
      await setProviderKey(name, keys[name] || "");
      toast.success(`Key saved for ${name}`, { description: "Written to the local .env only." });
      await load();
      // Immediately pull the real model list — a fresh key is worthless without it.
      refreshModels(name);
    } catch (e) {
      toast.error(`Saving key for ${name} failed`, { description: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const refreshModels = async (name: string) => {
    setBusy(name);
    try {
      const r = await fetchProviderModels(name);
      if (r.ok) {
        toast.success(`Fetched ${r.models.length} models for ${name}`, {
          description: `source: ${r.source} — saved to ai.config.json`,
        });
      } else {
        toast.error(`Could not fetch models for ${name}`, {
          description: `${r.error ?? "unknown error"}${r.fix ? `\n→ Fix: ${r.fix}` : ""}`,
        });
      }
      await load();
    } catch (e) {
      toast.error(`Could not fetch models for ${name}`, { description: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const test = async (p: ProviderInfo) => {
    setBusy(p.name);
    try {
      const r = await testProvider(p.name);
      if (r.ok) {
        toast.success(`Test passed for ${p.name}`, {
          description: `${r.note ?? "configured"}${r.latencyMs ? ` · ${r.latencyMs}ms` : ""}`,
        });
      } else {
        toast.error(`Test failed for ${p.name}`, {
          description: `${r.error ?? "unknown error"}${r.fix ? `\n→ Fix: ${r.fix}` : ""}`,
        });
      }
    } catch (e) {
      toast.error(`Test failed for ${p.name}`, { description: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const handleAddProvider = async () => {
    if (!newName.trim()) return;
    try {
      await addProvider({
        name: newName.trim(),
        package: newPackage || undefined,
        baseUrl: newBaseUrl || undefined,
        apiKeyEnv: newApiKeyEnv || undefined,
      });
      toast.success(`Provider ${newName.trim()} added`, {
        description: "Paste its API key on its card, then Fetch models.",
      });
      setNewName("");
      setNewPackage("");
      setNewBaseUrl("");
      setNewApiKeyEnv("");
      setShowAdd(false);
      load();
    } catch (e) {
      setAddError(String(e));
      toast.error("Adding provider failed");
    }
  };

  return (
    <div>
      <PageHeader title="Providers">
        <Button
          variant={showAdd ? "secondary" : "outline"}
          size="sm"
          onClick={() => setShowAdd((s) => !s)}
        >
          <Plug className="h-4 w-4" /> {showAdd ? "Close form" : "Add provider"}
        </Button>
      </PageHeader>

      {addError ? <ErrorBanner error={addError} fix='Start the API server with "npm run server" and reload' /> : null}

      {showAdd ? (
        <Card className="mb-5">
          <CardHeader>
            <CardTitle className="text-base">Add a provider</CardTitle>
            <CardDescription>
              Package must be an installed ai-sdk adapter (openai / anthropic / google / gateway…).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Input placeholder="name (e.g. ollama-cloud)" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Input placeholder="package (openai/anthropic/google/gateway)" value={newPackage} onChange={(e) => setNewPackage(e.target.value)} />
            <Input placeholder="baseUrl (optional)" value={newBaseUrl} onChange={(e) => setNewBaseUrl(e.target.value)} />
            <Input placeholder="API key env var (e.g. OPENAI_API_KEY)" value={newApiKeyEnv} onChange={(e) => setNewApiKeyEnv(e.target.value)} />
            <div className="sm:col-span-2">
              <Button onClick={handleAddProvider} disabled={!newName.trim()}>
                Add provider
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {providers.length === 0 && !addError ? (
        <EmptyState
          icon={<Plug />}
          title="No providers"
          body="Add one for AI-spec generation — the story engine and every local render path work without any provider."
        />
      ) : (
        <div className="space-y-4">
          {providers.map((p) => (
            <Card
              key={p.name}
              id={`provider-${p.name}`}
              className={cn(
                "scroll-mt-20 transition-all",
                selected === p.name &&
                  "border-primary/60 bg-primary/[0.06] shadow-[0_0_0_1px_var(--primary)]",
              )}
              onClick={(e) => {
                const el = e.target as HTMLElement;
                if (el.closest("input,button,a")) return;
                setQuery({ provider: selected === p.name ? undefined : p.name });
              }}
            >
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <KeyRound
                      className={cn("h-4 w-4", p.keyConfigured ? "text-emerald-400" : "text-muted-foreground")}
                    />
                    {p.name}
                  </CardTitle>
                  {p.name === defaultProvider ? <Badge variant="amber">default</Badge> : null}
                  {p.keyConfigured ? (
                    <Badge variant="success">key configured</Badge>
                  ) : p.apiKeyEnv ? (
                    <Badge variant="destructive">key not set</Badge>
                  ) : (
                    <Badge variant="secondary">local — no key needed</Badge>
                  )}
                  {p.models?.length ? <Badge variant="outline">{p.models.length} models</Badge> : null}
                  <span className="ml-auto flex gap-1.5">
                    <Button variant="outline" size="sm" onClick={() => test(p)} disabled={busy === p.name}>
                      {busy === p.name ? "Testing…" : "Test"}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => refreshModels(p.name)} disabled={busy === p.name}>
                      {"Fetch models"}
                    </Button>
                  </span>
                </div>
                <div className="pt-1">
                  <MetaRow
                    items={[
                      { label: "package", value: p.package },
                      { label: "baseUrl", value: p.baseUrl },
                      { label: "keyEnv", value: p.apiKeyEnv },
                    ]}
                  />
                </div>
              </CardHeader>
              {p.apiKeyEnv ? (
                <CardContent>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      type="password"
                      className="max-w-xs"
                      placeholder={p.apiKeyEnv}
                      value={keys[p.name] || ""}
                      onChange={(e) => setKeys({ ...keys, [p.name]: e.target.value })}
                    />
                    <Button
                      size="sm"
                      onClick={() => setKey(p.name)}
                      disabled={busy === p.name || !(keys[p.name] || "").length}
                    >
                      Save key
                    </Button>
                    {busy === p.name ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
                    <InfoTip helpId="providers-key" />
                    <InfoTip helpId="providers-test" />
                  </div>
                  {p.models?.length ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {p.models.slice(0, 12).map((m) => (
                        <code key={m} className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {m}
                        </code>
                      ))}
                      {p.models.length > 12 ? (
                        <span className="pt-0.5 text-[10px] text-muted-foreground">
                          +{p.models.length - 12} more (visible on Generate → Advanced)
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </CardContent>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
