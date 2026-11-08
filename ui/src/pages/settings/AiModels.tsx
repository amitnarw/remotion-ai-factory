/**
 * Settings, AI models: the providers (keys, models, the default) and which
 * model does each job (model roles).
 *
 *   ?tab=settings&section=models&view=providers|roles&provider=<name>
 */
import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  ListTree,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  Save,
  Star,
  Trash2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  addProvider,
  deleteProvider,
  fetchProviderModels,
  getProviders,
  getRoles,
  saveRoles,
  setDefaultProvider as setDefaultProviderApi,
  setProviderKey,
  testProvider,
  type ProviderInfo,
  type RolesResponse,
} from "../../api";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../../components/ui/alert-dialog";
import { EmptyState, ErrorBanner, LoadingState, SegmentedControl } from "../../components/shared";
import { InfoTip } from "../../components/InfoTip";
import { setQuery, useQuery } from "../../lib/navigation";
import { cn } from "../../lib/utils";

const DEFAULT_CHOICE = "__default";

export default function AiModels() {
  const query = useQuery();
  const view = query.get("view") === "roles" ? "roles" : "providers";
  return (
    <div className="space-y-5">
      <SegmentedControl
        label="AI models"
        size="sm"
        value={view}
        onChange={(v) => setQuery({ view: v === "providers" ? undefined : v, provider: undefined })}
        options={[
          { value: "providers", label: "Providers and keys", icon: <Plug /> },
          { value: "roles", label: "Model roles", icon: <ListTree /> },
        ]}
        className="sm:max-w-md"
      />
      {view === "providers" ? <Providers selected={query.get("provider") ?? undefined} /> : <ModelRoles />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Providers                                                          */
/* ------------------------------------------------------------------ */

function Providers({ selected }: { selected?: string }) {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [defaultProvider, setDefaultProvider] = useState<string | undefined>();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const load = () =>
    getProviders()
      .then((d) => {
        setProviders(d.providers || []);
        setDefaultProvider(d.defaultProvider);
        setLoadError(null);
      })
      .catch((e) => {
        setLoadError(e instanceof Error ? e.message : String(e));
        setProviders((p) => p ?? []);
      });

  useEffect(() => {
    void load();
  }, []);

  // Deep link: ?provider=<name> scrolls to that provider.
  useEffect(() => {
    if (!selected || !providers) return;
    document.getElementById(`provider-${selected}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selected, providers]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-[15px] text-muted-foreground">
          The AI that writes your plans. Keys are saved only on this computer.
        </p>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Add provider
        </Button>
      </div>

      {loadError ? <ErrorBanner error={loadError} fix='Start the app with "npm run server" and reload the page.' /> : null}

      {providers === null ? (
        <LoadingState title="Loading providers..." />
      ) : providers.length === 0 && !loadError ? (
        <EmptyState
          icon={<Plug />}
          title="No providers yet"
          body="Add the AI service you want to use. Its key is kept on this computer."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /> Add provider
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {[...providers]
            .sort((a, b) => Number(b.name === defaultProvider) - Number(a.name === defaultProvider))
            .map((p) => (
            <ProviderCard
              key={p.name}
              provider={p}
              isDefault={p.name === defaultProvider}
              highlighted={selected === p.name}
              onChanged={load}
            />
          ))}
        </div>
      )}

      <AddProviderDialog open={addOpen} onOpenChange={setAddOpen} onAdded={load} />
    </div>
  );
}

function ProviderCard({
  provider: p,
  isDefault,
  highlighted,
  onChanged,
}: {
  provider: ProviderInfo;
  isDefault: boolean;
  highlighted: boolean;
  onChanged: () => void;
}) {
  const [key, setKey] = useState("");
  const [reveal, setReveal] = useState(false);
  // One provider open at a time keeps the list short: the default one and a
  // deep-linked one start open.
  const [open, setOpen] = useState(highlighted || isDefault);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const refreshModels = () =>
    run("models", async () => {
      try {
        const r = await fetchProviderModels(p.name);
        if (r.ok) toast.success(`${r.models.length} models found for ${p.name}`, { description: `From ${r.source}` });
        else toast.error(`Could not get the models of ${p.name}`, { description: `${r.error ?? "Unknown error"}${r.fix ? `\nHow to fix it: ${r.fix}` : ""}` });
        onChanged();
      } catch (e) {
        toast.error(`Could not get the models of ${p.name}`, { description: String(e) });
      }
    });

  const saveKey = () =>
    run("key", async () => {
      try {
        await setProviderKey(p.name, key);
        toast.success(`Key saved for ${p.name}`, { description: "Written only to a private file on this computer." });
        setKey("");
        onChanged();
      } catch (e) {
        toast.error(`Saving the key for ${p.name} failed`, { description: String(e) });
        return;
      }
      await refreshModels();
    });

  const check = () =>
    run("test", async () => {
      try {
        const r = await testProvider(p.name);
        if (r.ok) toast.success(`${p.name} works`, { description: `${r.note ?? "Connected"}${r.latencyMs ? `, answered in ${r.latencyMs} ms` : ""}` });
        else toast.error(`${p.name} is not working`, { description: `${r.error ?? "Unknown error"}${r.fix ? `\nHow to fix it: ${r.fix}` : ""}` });
      } catch (e) {
        toast.error(`${p.name} is not working`, { description: String(e) });
      }
    });

  const makeDefault = () =>
    run("default", async () => {
      try {
        await setDefaultProviderApi(p.name);
        toast.success(`${p.name} is now the default`);
        onChanged();
      } catch (e) {
        toast.error(String(e));
      }
    });

  const remove = () =>
    run("remove", async () => {
      try {
        await deleteProvider(p.name);
        toast.success(`${p.name} removed`);
        onChanged();
      } catch (e) {
        toast.error(String(e));
      }
    });

  const status = p.keyConfigured ? (
    <Badge variant="success">
      <Check className="h-3 w-3" /> Key saved
    </Badge>
  ) : p.apiKeyEnv ? (
    <Badge variant="destructive">Needs a key</Badge>
  ) : (
    <Badge variant="muted">No key needed</Badge>
  );

  return (
    <Card id={`provider-${p.name}`} className={cn("p-4 sm:p-5", highlighted && "ring-2 ring-primary")}>
      <div className="flex flex-wrap items-start gap-3">
        <span
          className={cn(
            "grid h-11 w-11 shrink-0 place-items-center rounded-2xl",
            p.keyConfigured || !p.apiKeyEnv ? "bg-success/20 text-success" : "bg-input text-muted-foreground",
          )}
        >
          <KeyRound className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{p.name}</h2>
            {isDefault ? (
              <Badge variant="amber">
                <Star className="h-3 w-3" /> Default
              </Badge>
            ) : null}
            {status}
            {p.models?.length ? <Badge variant="muted">{p.models.length} models</Badge> : null}
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          aria-expanded={open}
          aria-controls={`provider-body-${p.name}`}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Close" : p.apiKeyEnv && !p.keyConfigured ? "Add key" : "Manage"}
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </Button>
      </div>

      {open ? (
      <div id={`provider-body-${p.name}`}>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:pl-14">
        {p.package ? <span>Package: {p.package}</span> : null}
        {p.baseUrl ? <span className="break-all">Address: {p.baseUrl}</span> : null}
        {p.apiKeyEnv ? <span>Key name: {p.apiKeyEnv}</span> : null}
      </div>
      {p.apiKeyEnv ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-56">
            <Input
              type={reveal ? "text" : "password"}
              placeholder={p.keyConfigured ? "Paste a new key to replace the saved one" : `Paste your ${p.apiKeyEnv}`}
              aria-label={`Key for ${p.name}`}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && key) void saveKey();
              }}
              className="h-11 pr-12"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setReveal((r) => !r)}
              aria-label={reveal ? "Hide the key" : "Show the key"}
              className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <Button onClick={saveKey} disabled={!!busy || !key.length} className="h-11">
            {busy === "key" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save key
          </Button>
          <InfoTip helpId="providers-key" />
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={check} disabled={!!busy}>
          {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Check it
        </Button>
        <Button variant="secondary" size="sm" onClick={refreshModels} disabled={!!busy}>
          {busy === "models" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Get models
        </Button>
        {!isDefault ? (
          <Button variant="secondary" size="sm" onClick={makeDefault} disabled={!!busy}>
            <Star className="h-4 w-4" /> Make default
          </Button>
        ) : null}
        <InfoTip helpId="providers-test" />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="secondary" size="sm" className="ml-auto" disabled={!!busy} aria-label={`Remove ${p.name}`}>
              <Trash2 className="h-4 w-4" /> Remove
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove {p.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                The provider and its settings are removed. You can add it again later.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction onClick={remove}>Remove</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      </div>
      ) : null}
    </Card>
  );
}

function AddProviderDialog({ open, onOpenChange, onAdded }: { open: boolean; onOpenChange: (o: boolean) => void; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [pkg, setPkg] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKeyEnv, setApiKeyEnv] = useState("");
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await addProvider({ name: name.trim(), package: pkg || undefined, baseUrl: baseUrl || undefined, apiKeyEnv: apiKeyEnv || undefined });
      toast.success(`${name.trim()} added`, { description: "Now paste its key." });
      setName("");
      setPkg("");
      setBaseUrl("");
      setApiKeyEnv("");
      onOpenChange(false);
      onAdded();
    } catch (e) {
      toast.error("Adding the provider failed", { description: String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a provider</DialogTitle>
          <DialogDescription>Only the name is needed; the rest depends on the service.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <LabeledInput id="p-name" label="Name" placeholder="For example openai" value={name} onChange={setName} autoFocus />
          <LabeledInput id="p-package" label="Package" placeholder="openai, anthropic or google" value={pkg} onChange={setPkg} />
          <LabeledInput id="p-url" label="Address (optional)" placeholder="https://..." value={baseUrl} onChange={setBaseUrl} />
          <LabeledInput id="p-key" label="Key name" placeholder="For example OPENAI_API_KEY" value={apiKeyEnv} onChange={setApiKeyEnv} />
          <DialogFooter className="pt-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add provider
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LabeledInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <Input id={id} value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} className="h-11" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Model roles                                                        */
/* ------------------------------------------------------------------ */

/** Pick a provider and model for each pipeline role (stored in ai.config.json). */
function ModelRoles() {
  const [data, setData] = useState<RolesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { provider: string; model: string }>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

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
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <ErrorBanner error={error} fix='Start the app with "npm run server" and reload the page.' />;
  if (!data) return <LoadingState title="Loading the model roles..." />;

  const modelsOf = (provider: string) => data.providers.find((p) => p.name === provider)?.models ?? [];

  const setRole = (name: string, patch: { provider?: string; model?: string }) => {
    const current = draft[name] ?? { provider: "", model: "" };
    const next = { ...current, ...patch };
    // Changing the provider clears the model: the old one may not exist there.
    if (patch.provider !== undefined && patch.provider !== current.provider) next.model = "";
    setDraft((d) => ({ ...d, [name]: next }));
    setDirty(true);
  };

  const clearRole = (name: string) => {
    setDraft((d) => {
      const { [name]: _removed, ...rest } = d;
      void _removed;
      return rest;
    });
    setDirty(true);
  };

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
      setDirty(false);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-[15px] text-muted-foreground">
          Choose which model does each job. A role on Default uses the default provider
          {data.defaultProvider ? ` (${data.defaultProvider})` : ""}.
          <InfoTip helpId="model-roles" className="ml-1 inline-grid align-middle" />
        </p>
      </div>
      <div className="space-y-3">
        {data.roles.map((r) => {
          const d = draft[r.name];
          const models = d?.provider ? modelsOf(d.provider) : [];
          return (
            <Card key={r.name} className="grid grid-cols-[minmax(0,1fr)] items-center gap-3 p-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{r.label}</span>
                  <Badge variant={r.usedFrom === "now" ? "success" : "muted"}>
                    {r.usedFrom === "now" ? "In use" : `From ${r.usedFrom}`}
                  </Badge>
                </div>
                <div className="text-sm text-muted-foreground">{r.description}</div>
              </div>
              <Select
                value={d?.provider || DEFAULT_CHOICE}
                onValueChange={(v) => (v === DEFAULT_CHOICE ? clearRole(r.name) : setRole(r.name, { provider: v }))}
              >
                <SelectTrigger className="h-11" aria-label={`Provider for ${r.label}`}>
                  <SelectValue placeholder="Default provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_CHOICE}>Default provider</SelectItem>
                  {data.providers.map((p) => (
                    <SelectItem key={p.name} value={p.name}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {d?.provider ? (
                models.length > 0 ? (
                  <Select value={d.model || ""} onValueChange={(v) => setRole(r.name, { model: v })}>
                    <SelectTrigger className="h-11" aria-label={`Model for ${r.label}`}>
                      <SelectValue placeholder="Choose a model" />
                    </SelectTrigger>
                    <SelectContent>
                      {models.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No models yet. Press Get models on this provider under Providers and keys.
                  </div>
                )
              ) : (
                <div className="text-sm text-muted-foreground">Uses the default model</div>
              )}
            </Card>
          );
        })}
      </div>
      <div className="sticky bottom-3 z-20">
        <div className="flex items-center gap-3 rounded-2xl bg-card/95 p-2.5 shadow-2xl shadow-black/50 backdrop-blur-md sm:p-3">
          <span className="px-2 text-sm text-muted-foreground" aria-live="polite">
            {dirty ? "You have changes that are not saved yet." : "All roles are saved."}
          </span>
          <Button variant="amber" className="ml-auto" onClick={save} disabled={saving || !dirty}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Saving..." : "Save roles"}
          </Button>
        </div>
      </div>
    </div>
  );
}
