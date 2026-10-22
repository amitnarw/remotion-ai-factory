/**
 * Providers, key/config management with solid, borderless cards.
 * ?provider=<name> deep-links to that provider card.
 */
import { useEffect, useState } from "react";
import { Plug, KeyRound, Loader2, Plus, Minus, Check, Save } from "lucide-react";
import { toast } from "sonner";
import {
  getProviders,
  getRoles,
  saveRoles,
  RolesResponse,
  setProviderKey,
  addProvider,
  testProvider,
  fetchProviderModels,
  setDefaultProvider as setDefaultProviderApi,
  deleteProvider,
  ProviderInfo,
  ProvidersResponse,
} from "../api";
import { PageHeader, EmptyState, ErrorBanner, MetaRow } from "../components/shared";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { InfoTip } from "../components/InfoTip";
import { useQuery, setQuery } from "../lib/navigation";
import { cn } from "../lib/utils";

const DEFAULT_CHOICE = "__default";

/** Pick a provider and model for each pipeline role (stored in ai.config.json). */
function ModelRolesCard() {
  const [data, setData] = useState<RolesResponse | null>(null);
  const [draft, setDraft] = useState<Record<string, { provider: string; model: string }>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getRoles()
      .then((r) => {
        setData(r);
        setDraft(
          Object.fromEntries(
            r.roles
              .filter((x) => x.assignment?.provider && x.assignment?.model)
              .map((x) => [x.name, { provider: x.assignment!.provider!, model: x.assignment!.model! }]),
          ),
        );
      })
      .catch((e) => toast.error(String(e)));
  }, []);

  if (!data) return null;

  const modelsOf = (provider: string) => data.providers.find((p) => p.name === provider)?.models ?? [];

  const setRole = (name: string, patch: { provider?: string; model?: string }) => {
    const current = draft[name] ?? { provider: "", model: "" };
    const next = { ...current, ...patch };
    // Changing provider clears the model: the old one may not exist there.
    if (patch.provider !== undefined && patch.provider !== current.provider) next.model = "";
    setDraft((d) => ({ ...d, [name]: next }));
  };

  const clearRole = (name: string) => setDraft((d) => {
    const { [name]: _removed, ...rest } = d;
    return rest;
  });

  const save = async () => {
    setSaving(true);
    try {
      const payload: Record<string, { provider: string; model: string } | null> = {};
      for (const r of data.roles) {
        const d = draft[r.name];
        payload[r.name] = d?.provider && d?.model ? d : null;
      }
      await saveRoles(payload);
      toast.success("Model roles saved");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mb-6 p-6">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h3 className="text-lg font-extrabold">Model roles</h3>
        <Button size="lg" onClick={save} disabled={saving}>
          <Save className="h-5 w-5" /> {saving ? "Saving…" : "Save roles"}
        </Button>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Choose which model does each job. Roles that are not used yet are saved now and take effect when their phase lands.
        A role left on "Default" uses the default provider{data.defaultProvider ? ` (${data.defaultProvider})` : ""}.
      </p>
      <div className="space-y-3">
        {data.roles.map((r) => {
          const d = draft[r.name];
          const models = d?.provider ? modelsOf(d.provider) : [];
          return (
            <div key={r.name} className="grid items-center gap-3 rounded-xl bg-muted/40 p-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold">{r.label}</span>
                  <Badge variant={r.usedFrom === "now" ? "success" : "muted"}>
                    {r.usedFrom === "now" ? "used now" : `from ${r.usedFrom}`}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">{r.description}</div>
              </div>
              <Select
                value={d?.provider || DEFAULT_CHOICE}
                onValueChange={(v) => (v === DEFAULT_CHOICE ? clearRole(r.name) : setRole(r.name, { provider: v }))}
              >
                <SelectTrigger><SelectValue placeholder="Default provider" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_CHOICE}>Default provider</SelectItem>
                  {data.providers.map((p) => (
                    <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {d?.provider ? (
                models.length > 0 ? (
                  <Select value={d.model || ""} onValueChange={(v) => setRole(r.name, { model: v })}>
                    <SelectTrigger><SelectValue placeholder="Choose a model" /></SelectTrigger>
                    <SelectContent>
                      {models.map((m) => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    No models yet. Open this provider's card and press Get models.
                  </div>
                )
              ) : (
                <div className="text-xs text-muted-foreground">Uses the default model</div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export default function Providers() {
  const query = useQuery();
  const selected = query.get("provider") ?? undefined;
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [defaultProvider, setDefaultProvider] = useState<string | undefined>();
  const [keys, setKeys] = useState<Record<string, string>>({});
const [reveal, setReveal] = useState<Record<string, boolean>>({});
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

      <ModelRolesCard />

      {showAdd ? (
        <Card className="mb-6 p-6">
          <h3 className="mb-4 text-lg font-extrabold">New provider</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input placeholder="Name, e.g. openai" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Input placeholder="Package, openai / anthropic / google" value={newPackage} onChange={(e) => setNewPackage(e.target.value)} />
            <Input placeholder="Address (optional)" value={newBaseUrl} onChange={(e) => setNewBaseUrl(e.target.value)} />
            <Input placeholder="Key name, e.g. OPENAI_API_KEY" value={newApiKeyEnv} onChange={(e) => setNewApiKeyEnv(e.target.value)} />
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
          body="Keys are only needed for the older pipeline. Everything else works without them."
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
                  <Badge variant={selected === p.name ? "default" : "success"} className="gap-1">
                    <Check className="h-3 w-3" /> key saved
                  </Badge>
                ) : p.apiKeyEnv ? (
                  <Badge variant="destructive">no key yet</Badge>
                ) : (
                  <Badge variant={selected === p.name ? "default" : "muted"}>works on its own</Badge>
                )}
                {p.models?.length ? (
                  <Badge variant={selected === p.name ? "default" : "muted"}>{p.models.length} models</Badge>
                ) : null}
                <span className="ml-auto flex flex-wrap gap-2.5">
                  {p.name !== defaultProvider && (
                    <Button variant={selected === p.name ? "amber" : "secondary"} size="sm" onClick={async () => { await setDefaultProviderApi(p.name); load(); toast.success(`${p.name} is now default`); }} disabled={busy === p.name}>
                      Set default
                    </Button>
                  )}
                  <Button variant={selected === p.name ? "amber" : "secondary"} size="sm" onClick={() => test(p)} disabled={busy === p.name}>
                    {busy === p.name ? "…" : "Check it"}
                  </Button>
                  <Button variant={selected === p.name ? "amber" : "secondary"} size="sm" onClick={() => refreshModels(p.name)} disabled={busy === p.name}>
                    {busy === p.name ? "…" : "Get models"}
                  </Button>
                  <Button variant="destructive" size="sm" onClick={async () => {
                    if (!confirm(`Remove provider ${p.name}?`)) return;
                    await deleteProvider(p.name);
                    toast.success(`${p.name} removed`);
                    load();
                  }} disabled={busy === p.name} aria-label={`Remove ${p.name}`}>
                    Remove
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
                    type={reveal[p.name] ? "text" : "password"}
                    className={cn("max-w-sm", selected === p.name && "bg-black/25")}
                    placeholder={p.apiKeyEnv}
                    value={keys[p.name] || ""}
                    onChange={(e) => setKeys({ ...keys, [p.name]: e.target.value })}
                  />
                  <Button variant="secondary" size="sm" onClick={() => setReveal({ ...reveal, [p.name]: !reveal[p.name] })} aria-label="Toggle key visibility">
                    {reveal[p.name] ? "Hide" : "Show"}
                  </Button>
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