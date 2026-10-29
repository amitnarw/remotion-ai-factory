/**
 * Settings: one section at a time.
 *
 *   ?tab=settings&section=models     AI models (providers, keys, model roles)
 *   ?tab=settings&section=voice      Voice engines (download and status)
 *   ?tab=settings&section=checklist  Getting started (what this computer needs)
 */
import { useEffect, useState } from "react";
import {
  AudioLines,
  BrainCircuit,
  CircleCheck,
  CircleDashed,
  Info,
  ListChecks,
  type LucideIcon,
} from "lucide-react";
import { getProviders, getTtsStatus } from "../../api";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { PageHeader } from "../../components/shared";
import { navigate, useQuery } from "../../lib/navigation";
import type { SettingsSection } from "../../lib/routes";
import { cn } from "../../lib/utils";
import AiModels from "./AiModels";
import VoiceEngines from "./VoiceEngines";

const SECTIONS: Array<{ key: SettingsSection; label: string; note: string; icon: LucideIcon }> = [
  { key: "models", label: "AI models", note: "Providers, keys and roles", icon: BrainCircuit },
  { key: "voice", label: "Voice engines", note: "Narration and character voices", icon: AudioLines },
  { key: "checklist", label: "Getting started", note: "What this computer needs", icon: ListChecks },
];

export default function Settings() {
  const query = useQuery();
  const section = (query.get("section") as SettingsSection) ?? "models";
  const current = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0];

  return (
    <div>
      <PageHeader title="Settings" description="Set things up once. Everything is saved on this computer." />
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Settings sections">
          <ul className="grid grid-cols-3 gap-2 lg:flex lg:flex-col">
            {SECTIONS.map((s) => {
              const active = s.key === current.key;
              const Icon = s.icon;
              return (
                <li key={s.key} className="min-w-0">
                  <button
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => navigate({ tab: "settings", section: s.key })}
                    className={cn(
                      "flex h-full w-full flex-col items-center gap-1.5 rounded-xl px-2 py-2.5 text-center transition-colors lg:flex-row lg:gap-3 lg:px-3 lg:text-left",
                      active ? "bg-primary text-primary-foreground shadow" : "bg-card text-foreground hover:bg-secondary lg:bg-transparent",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold sm:text-sm">{s.label}</span>
                      <span className={cn("hidden text-xs lg:block", active ? "text-primary-foreground/80" : "text-muted-foreground")}>
                        {s.note}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <section aria-labelledby="settings-title" className="min-w-0">
          <h2 id="settings-title" className="mb-4 hidden text-xl font-semibold lg:block">
            {current.label}
          </h2>
          {current.key === "models" ? <AiModels /> : null}
          {current.key === "voice" ? <VoiceEngines /> : null}
          {current.key === "checklist" ? <Checklist /> : null}
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Getting started                                                    */
/* ------------------------------------------------------------------ */

type CheckState = "ok" | "todo" | "info" | "loading";

function Checklist() {
  const [voice, setVoice] = useState<CheckState>("loading");
  const [ai, setAi] = useState<CheckState>("loading");

  useEffect(() => {
    getTtsStatus()
      .then((s) => setVoice(s.kitten2.installed || s.voxcpm2.installed ? "ok" : "todo"))
      .catch(() => setVoice("info"));
    getProviders()
      .then((r) => {
        const def = r.providers.find((p) => p.name === r.defaultProvider) ?? r.providers[0];
        setAi(def && (def.keyConfigured || !def.apiKeyEnv) ? "ok" : "todo");
      })
      .catch(() => setAi("info"));
  }, []);

  const items: Array<{ state: CheckState; title: string; body: string; action?: { label: string; to: Record<string, string> } }> = [
    {
      state: ai,
      title: "An AI provider with a key",
      body: "The AI writes every plan. Add a provider and save its key, or use one that needs no key.",
      action: { label: "Open AI models", to: { tab: "settings", section: "models" } },
    },
    {
      state: voice,
      title: "A voice engine",
      body: "Needed for narration and character voices. KittenTTS 2 is quick to download; VoxCPM2 sounds best.",
      action: { label: "Open Voice engines", to: { tab: "settings", section: "voice" } },
    },
    {
      state: "info",
      title: "Python 3.10 or newer",
      body: "Used to install the voice engines. It must be on the PATH.",
    },
    {
      state: "info",
      title: "ffmpeg",
      body: "Used to save the videos and make thumbnails. It must be on the PATH.",
    },
  ];

  return (
    <div className="space-y-3">
      <p className="max-w-2xl text-[15px] text-muted-foreground">
        What this computer needs before the first video. Green items are ready.
      </p>
      {items.map((it) => (
        <Card key={it.title} className="flex flex-wrap items-start gap-4 p-4 sm:p-5">
          <span
            className={cn(
              "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
              it.state === "ok" && "bg-success/20 text-success",
              it.state === "todo" && "bg-accent/20 text-accent",
              (it.state === "info" || it.state === "loading") && "bg-input text-muted-foreground",
            )}
          >
            {it.state === "ok" ? (
              <CircleCheck className="h-5 w-5" />
            ) : it.state === "todo" ? (
              <CircleDashed className="h-5 w-5" />
            ) : (
              <Info className="h-5 w-5" />
            )}
          </span>
          <div className="min-w-0 flex-1 basis-56">
            <div className="font-semibold">
              {it.title}
              {it.state === "ok" ? <span className="ml-2 text-sm font-medium text-success">Ready</span> : null}
              {it.state === "todo" ? <span className="ml-2 text-sm font-medium text-accent">To do</span> : null}
            </div>
            <div className="text-sm text-muted-foreground">{it.body}</div>
          </div>
          {it.action && it.state !== "ok" && it.state !== "loading" ? (
            <Button variant="soft" size="sm" className="ml-14 sm:ml-0" onClick={() => navigate(it.action!.to)}>
              {it.action.label}
            </Button>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
