/**
 * App shell — top nav (tab lives in the URL), global Help dialog, toasts.
 * Dark-first: index.html sets `class="dark"` and the tokens live in index.css.
 */
import { useEffect } from "react";
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
  useEffect(() => {
    if (!query.has("tab")) setQuery({ tab: "generate" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <TooltipProvider delayDuration={100}>
      <div className="min-h-dvh text-foreground">
        <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
            <div className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/20 text-primary">
                <Clapperboard className="h-4.5 w-4.5" />
              </span>
              <span className="text-[15px]">
                AI Video Factory
                <span className="ml-2 rounded-md bg-secondary px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  What If Shorts
                </span>
              </span>
            </div>
            <nav className="ml-6 flex items-center gap-1">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setQuery({ tab: t.key })}
                  className={cn(
                    "inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
                    tab === t.key
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                  )}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-1">
              <HelpDialog />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-8">
          {tab === "generate" && <Generate />}
          {tab === "videos" && <Videos />}
          {tab === "providers" && <Providers />}
        </main>

        <footer className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
          100% local pipeline — synthesis, rendering and CC0 assets. No external APIs besides the
          providers you configure.
        </footer>
      </div>
      <Toaster theme="dark" position="bottom-right" richColors />
    </TooltipProvider>
  );
}
