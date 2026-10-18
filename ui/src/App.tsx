/**
 * App shell, solid pill nav (tab lives in the URL), global Help, toasts.
 * Dark-first: index.html sets `class="dark"`; tokens live in index.css.
 */
import * as React from "react";
import { Clapperboard, Sparkles, Film, Plug } from "lucide-react";
import { Toaster } from "sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { HelpDialog } from "./components/InfoTip";
import { useQuery, setQuery } from "./lib/navigation";
import Generate from "./pages/Generate";
import Providers from "./pages/Providers";
import Videos from "./pages/Videos";
import { cn } from "./lib/utils";

export type TabKey = "generate" | "providers" | "videos";

const TABS: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
  { key: "generate", label: "Generate", icon: <Sparkles className="h-4 w-4" /> },
  { key: "videos", label: "Videos", icon: <Film className="h-4 w-4" /> },
  { key: "providers", label: "Providers", icon: <Plug className="h-4 w-4" /> },
];

/** Coerce arbitrary ?tab= values onto a known tab. */
function safeTab(raw: string | undefined): TabKey {
  return raw === "videos" || raw === "providers" ? raw : "generate";
}

export default function App() {
  const query = useQuery();
  const tab = safeTab(query.get("tab") ?? undefined);

  // Default the URL to the primary tab on first paint (no history spam).
  React.useEffect(() => {
    if (!query.has("tab")) setQuery({ tab: "generate" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <TooltipProvider delayDuration={100}>
      <div className="min-h-dvh text-foreground">
        <header className="sticky top-0 z-40 bg-background/85 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 pt-2">
            <div className="hidden shrink-0 items-center gap-2.5 sm:flex">
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
                <Clapperboard className="h-5 w-5" />
              </span>
              <span className="text-base font-extrabold tracking-tight">Video Factory</span>
            </div>
            <nav className="flex flex-1 items-center justify-center gap-2">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setQuery({ tab: t.key })}
                  className={cn(
                    "inline-flex h-11 items-center gap-2 rounded-2xl px-5 text-[15px] font-bold transition-all active:scale-[0.97]",
                    tab === t.key
                      ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                      : "bg-secondary text-secondary-foreground hover:brightness-125",
                  )}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </nav>
            <div className="ml-auto flex shrink-0 items-center gap-2 sm:ml-0">
              <HelpDialog />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-8">
          {tab === "generate" && <Generate />}
          {tab === "videos" && <Videos />}
          {tab === "providers" && <Providers />}
        </main>

        <footer className="pb-8 pt-2 text-center text-sm font-medium text-muted-foreground">
          Everything runs on this computer. Nothing is uploaded anywhere, except
          the accounts you set up yourself.
        </footer>
      </div>
      <Toaster theme="dark" position="bottom-center" richColors />
    </TooltipProvider>
  );
}