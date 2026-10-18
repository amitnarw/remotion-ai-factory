/**
 * Providers — key/config management with solid, borderless cards.
 * ?provider=<name> deep-links to that provider card.
 */
import { useEffect, useState } from "react";
import { Plug, KeyRound, Loader2, Plus, Minus } from "lucide-react";
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
import { Card } from "../components/ui/card";
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
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
      .catch((e) => setLoadError(String(e)));

  useEffect(() => {
    load();
  }, []);

  // Deep-link scroll for ?provider=<name>.
  useEffect(() => {
    if (!selected) return;
    document.getElementById(`provider-${selected}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selected, providers.length]);

  const setKey = async (name: string) => {
    setBusy(name);
    try {
      await setProviderKey(name, keys[name] || "");
      toast.success(`Key saved for ${name}`, { description: "Only written to a private file on your computer." });
      await load();
      refreshModels(name);
    } catch (e) {
      toast.error(`Saving the key for ${name} failed`, { description: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const refreshModels = async (name: string) => {
    setBusy(name);
    try {
      const r = await fetchProviderModels(name);
      if (r.ok) {
        toast.success(`${r.models.length} models found for ${name}`, {
          description: `source: ${r.source}`,
        });
      } else {
        toast.error(`Could not get models for ${name}`, {
          description: `${r.error ?? "unknown error"}${r.fix ? `\nFix: ${r.fix}` : ""}`,
        });
      }
      await load();
    } catch (e) {
      toast.error(`Could not get models for ${name}`, { description: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const test = async (p: ProviderInfo) => {
    setBusy(p.name);
    try {
      const r = await testProvider(p.name);
      if (r.ok) {
        toast.success(`${p.name} works!`, {
          description: `${r.note ?? "connected"}${r.latencyMs ? ` · fast (${r.latencyMs}ms)` : ""}`,
        });
      } else {
        toast.error(`${p.name} is not working`, {
          description: `${r.error ?? "unknown error"}${r.fix ? `\nFix: ${r.fix}` : ""}`,
        });
      }
    } catch (e) {
      toast.error(`${p.name} is not working`, { description: String(e) });
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
      toast.success(`${newName.trim()} added!`, { description: "Now paste its key below." });
      setNewName("");
      setNewPackage("");
      setNewBaseUrl("");
      setNewApiKeyEnv("");
      setShowAdd(false);
      load();
    } catch (e) {
      toast.error("Adding the provider failed", { description: String(e) });
    }
  };

  return (
    <div>
      <PageHeader title="Providers">
        <Button variant={showAdd ? "secondary" : "default"} size="lg" onClick={() => setShowAdd((s) => !s)}>
          {showAdd ? <Minus className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
          {showAdd ? "Close" : "Add provider"}
        </Button>
      </PageHeader>

      {loadError ? <ErrorBanner error={loadError} fix='Start the app with "npm run server" and reload the page' /> : null}

      {showAdd ? (
        <Card className="mb-6 p-6">
          <h3 className="mb-4 text-lg font-extrabold">New provider</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input placeholder="Name — e.g. openai" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Input placeholder="Package — openai / anthropic / google" value={newPackage} onChange={(e) => setNewPackage(e.target.value)} />
            <Input placeholder="Address (optional)" value={newBaseUrl} onChange={(e) => setNewBaseUrl(e.target.value)} />
            <Input placeholder="Key name — e.g. OPENAI_API_KEY" value={newApiKeyEnv} onChange={(e) => setNewApiKeyEnv(e.target.value)} />
          </div>
          <div className="mt-4">
            <Button size="lg" onClick={handleAddProvider} disabled={!newName.trim()}>
              <Plus className="h-5 w-5" /> Add provider
            </Button>
          </div>
        </Card>
      ) : null}

      {providers.length === 0 && !loadError && !showAdd ? (
        <EmptyState
          icon={<Plug />}
          title="No providers yet"
          body="Providers are only needed for the AI-spec pipeline. Everything else — including making story videos — works without them."
        />
      ) : (
        <div className="space-y-5">
          {providers.map((p) => (
            <div
              key={p.name}
              id={`provider-${p.name}`}
              onClick={(e) => {
                const el = e.target as HTMLElement;
                if (el.closest("input,button,a")) return;
                setQuery({ provider: selected === p.name ? undefined : p.name });
              }}
              className={cn(
                "rounded-3xl p-6 shadow-xl shadow-black/20 transition-all",
                selected === p.name ? "bg-primary/90 text-primary-foreground" : "bg-card hover:brightness-110",
              )}
            >
              <div className="mb-3 flex flex-wrap items-center gap-2.5">
                <span
                  className={cn(
                    "grid h-11 w-11 place-items-center rounded-2xl",
                    selected === p.name ? "bg-black/25" : p.keyConfigured ? "bg-success/20 text-success" : "bg-input",
                  )}
                >
                  <KeyRound className="h-5 w-5" />
                </span>
                <span className="text-lg font-extrabold">{p.name}</span>
                {p.name === defaultProvider ? <Badge variant="amber">star</Badge> : null}
                {p.keyConfigured ? (
                  <Badge variant={selected === p.name ? "default" : "success"}>key saved ✓</Badge>
                ) : p.apiKeyEnv ? (
                  <Badge variant="destructive">no key yet</Badge>
                ) : (
                  <Badge variant={selected === p.name ? "default" : "muted"}>works on its own</Badge>
                )}
                {p.models?.length ? (
                  <Badge variant={selected === p.name ? "default" : "muted"}>{p.models.length} models</Badge>
                ) : null}
                <span className="ml-auto flex flex-wrap gap-2.5">
                  <Button
                    variant={selected === p.name ? "amber" : "secondary"}
                    size="sm"
                    onClick={() => test(p)}
                    disabled={busy === p.name}
                  >
                    {busy === p.name ? "…" : "Check it"}
                  </Button>
                  <Button
                    variant={selected === p.name ? "amber" : "secondary"}
                    size="sm"
                    onClick={() => refreshModels(p.name)}
                    disabled={busy === p.name}
                  >
                    {busy === p.name ? "…" : "Get models"}
                  </Button>
                </span>
              </div>

              <div className="mb-4">
                <MetaRow
                  items={[
                    { label: "package", value: p.package },
                    { label: "address", value: p.baseUrl },
                    { label: "key name", value: p.apiKeyEnv },
                  ]}
                />
              </div>

              {p.apiKeyEnv ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    type="password"
                    className={cn("max-w-sm", selected === p.name && "bg-black/25")}
                    placeholder={p.apiKeyEnv}
                    value={keys[p.name] || ""}
                    onChange={(e) => setKeys({ ...keys, [p.name]: e.target.value })}
                  />
                  <Button
                    variant={selected === p.name ? "amber" : "default"}
                    size="lg"
                    onClick={() => setKey(p.name)}
                    disabled={busy === p.name || !(keys[p.name] || "").length}
                  >
                    Save key
                  </Button>
                  {busy === p.name ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                  <InfoTip helpId="providers-key" />
                  <InfoTip helpId="providers-test" />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}