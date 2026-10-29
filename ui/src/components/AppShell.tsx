/**
 * AppShell: the frame around every screen except the editor.
 *
 * Wide screens: a sidebar with the four sections (the current one
 * highlighted) and a status area for the jobs that are running. Narrow
 * screens: one top bar with the same sections, and a slim status line under
 * it while something runs.
 */
import * as React from "react";
import { CircleCheck, CircleHelp, Clapperboard, Film, Loader2, Settings, Sparkles, type LucideIcon } from "lucide-react";
import { useJobs, jobScreen, type ActiveJob } from "../lib/jobs";
import { navigate } from "../lib/navigation";
import type { Section } from "../lib/routes";
import { cn } from "../lib/utils";
import { ProgressBar } from "./shared";

const NAV: Array<{ key: Exclude<Section, "editor">; label: string; icon: LucideIcon }> = [
  { key: "create", label: "Create", icon: Sparkles },
  { key: "library", label: "Library", icon: Film },
  { key: "settings", label: "Settings", icon: Settings },
  { key: "help", label: "Help", icon: CircleHelp },
];

function jobTitle(j: ActiveJob): string {
  if (j.kind === "plan") return "Writing a plan";
  return j.status === "queued" ? "Waiting to start" : "Making a video";
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => navigate({ tab: "create", step: "idea" })}
      className="flex items-center gap-2.5 rounded-xl text-left"
      aria-label="Video Factory, start a new video"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
        <Clapperboard className="h-5 w-5" />
      </span>
      {compact ? null : (
        <span className="leading-tight">
          <span className="block text-[15px] font-bold tracking-tight">Video Factory</span>
          <span className="block text-xs text-muted-foreground">Runs on this computer</span>
        </span>
      )}
    </button>
  );
}

function StatusArea({ active }: { active: ActiveJob[] }) {
  if (!active.length) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-card/60 px-3 py-2.5 text-sm text-muted-foreground">
        <CircleCheck className="h-4 w-4 text-success" /> Nothing running
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Working on</div>
      {active.slice(0, 3).map((j) => (
        <button
          key={j.id}
          type="button"
          onClick={() => navigate(jobScreen(j))}
          className="block w-full rounded-xl bg-card p-3 text-left shadow-lg shadow-black/20 hover:brightness-110"
        >
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
            <span className="truncate">{jobTitle(j)}</span>
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">{Math.round(j.progress)}%</span>
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">{j.premise}</div>
          <ProgressBar value={Math.max(j.progress, 4)} className="mt-2 h-1.5" />
        </button>
      ))}
    </div>
  );
}

export function AppShell({
  section,
  onNavigate,
  children,
}: {
  section: Section;
  onNavigate: (s: Exclude<Section, "editor">) => void;
  children: React.ReactNode;
}) {
  const { active } = useJobs();
  const first = active[0];

  return (
    <div className="min-h-dvh lg:pl-64">
      <a
        href="#main"
        className="sr-only z-50 rounded-xl bg-primary px-4 py-2 font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>

      {/* Sidebar (wide screens) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col gap-6 bg-sidebar px-4 py-5 shadow-2xl shadow-black/30 lg:flex">
        <div className="px-1">
          <Brand />
        </div>
        <nav aria-label="Main">
          <ul className="space-y-1">
            {NAV.map((n) => {
              const activeItem = section === n.key;
              const Icon = n.icon;
              return (
                <li key={n.key}>
                  <button
                    type="button"
                    onClick={() => onNavigate(n.key)}
                    aria-current={activeItem ? "page" : undefined}
                    className={cn(
                      "flex h-11 w-full items-center gap-3 rounded-xl px-3 text-[15px] font-semibold transition-colors",
                      activeItem ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25" : "text-foreground/85 hover:bg-secondary",
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {n.label}
                    {n.key === "create" && active.length ? (
                      <span
                        className={cn(
                          "ml-auto grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-xs",
                          activeItem ? "bg-black/25" : "bg-accent text-accent-foreground",
                        )}
                        aria-label={`${active.length} running`}
                      >
                        {active.length}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="mt-auto space-y-4">
          <StatusArea active={active} />
          <p className="px-1 text-xs leading-relaxed text-muted-foreground">
            Everything runs on this computer. Nothing is uploaded, except to the AI accounts you set up yourself.
          </p>
        </div>
      </aside>

      {/* Top bar (narrow screens) */}
      <header className="sticky top-0 z-30 bg-background/90 backdrop-blur-md lg:hidden">
        <div className="flex h-16 items-center gap-2 px-4 sm:px-6">
          <Brand compact />
          <nav aria-label="Main" className="ml-auto flex-1 sm:flex-none">
            <ul className="grid grid-cols-4 gap-1 sm:flex sm:gap-2">
              {NAV.map((n) => {
                const activeItem = section === n.key;
                const Icon = n.icon;
                return (
                  <li key={n.key}>
                    <button
                      type="button"
                      onClick={() => onNavigate(n.key)}
                      aria-current={activeItem ? "page" : undefined}
                      className={cn(
                        "relative flex h-12 w-full flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-[11px] font-semibold sm:h-10 sm:flex-row sm:gap-2 sm:px-3 sm:text-sm",
                        activeItem ? "bg-primary text-primary-foreground" : "text-foreground/80 hover:bg-secondary",
                      )}
                    >
                      <Icon className="h-5 w-5 sm:h-4 sm:w-4" />
                      {n.label}
                      {n.key === "create" && active.length ? (
                        <span className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-accent sm:static" aria-hidden />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
        {first ? (
          <button
            type="button"
            onClick={() => navigate(jobScreen(first))}
            className="flex w-full items-center gap-2 bg-card/80 px-4 py-2 text-left text-sm sm:px-6"
          >
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
            <span className="font-semibold">{jobTitle(first)}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{first.premise}</span>
            <span className="tabular-nums text-muted-foreground">{Math.round(first.progress)}%</span>
          </button>
        ) : null}
      </header>

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 outline-none sm:px-6 lg:px-10 lg:pt-10">
        {children}
      </main>
    </div>
  );
}
