/**
 * App: the shell (sidebar or top bar), the five sections, and the editor
 * full width. The screen lives in the URL (lib/routes.ts); old links are
 * mapped onto the new screens before anything renders.
 * Dark-first: index.html sets class="dark"; tokens live in index.css.
 */
import * as React from "react";
import { Toaster } from "sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { AppShell } from "./components/AppShell";
import { LoadingState } from "./components/shared";
import { navigate, useQuery } from "./lib/navigation";
import { normalizeQuery, sectionOf, type Section } from "./lib/routes";
import { startJobsPolling } from "./lib/jobs";
import Create from "./pages/create/Create";
import Library from "./pages/library/Library";
import Assets from "./pages/assets/Assets";
import Settings from "./pages/settings/Settings";
import Help from "./pages/Help";

// The editor pulls in the 3D composition; load it only when it is opened.
const Editor = React.lazy(() => import("./pages/editor/Editor"));

/** The last screen seen in each section, so the sidebar returns you there. */
const lastSeen: Partial<Record<Section, Record<string, string>>> = {};

export default function App() {
  const query = useQuery();
  const fix = normalizeQuery(query);
  const section = sectionOf(query);

  React.useEffect(() => {
    if (fix) navigate(fix, { replace: true });
  }, [fix]);

  React.useEffect(() => startJobsPolling(), []);

  React.useEffect(() => {
    if (!fix) lastSeen[section] = Object.fromEntries(query.entries());
  }, [fix, query, section]);

  const go = (s: Exclude<Section, "editor">) => {
    // Pressing the section you are in starts it from the top.
    const remembered = s !== section ? lastSeen[s] : undefined;
    navigate(remembered ?? (s === "create" ? { tab: "create", step: "idea" } : { tab: s }));
  };

  let page: React.ReactNode = null;
  if (!fix) {
    if (section === "create") page = <Create />;
    else if (section === "library") page = <Library />;
    else if (section === "assets") page = <Assets />;
    else if (section === "settings") page = <Settings />;
    else if (section === "help") page = <Help />;
  }

  React.useEffect(() => {
    const titles: Record<Section, string> = {
      create: "Create",
      library: "Library",
      assets: "Assets",
      settings: "Settings",
      help: "Help",
      editor: "Editor",
    };
    document.title = `${titles[section]} | Video Factory`;
  }, [section]);

  return (
    <TooltipProvider delayDuration={150}>
      {section === "editor" ? (
        <main className="mx-auto w-full max-w-[1600px] px-3 pb-10 sm:px-4">
          <React.Suspense fallback={<LoadingState className="mt-10" title="Loading the editor..." />}>
            <Editor />
          </React.Suspense>
        </main>
      ) : (
        <AppShell section={section} onNavigate={go}>
          {page}
        </AppShell>
      )}
      <Toaster theme="dark" position="bottom-right" richColors closeButton />
    </TooltipProvider>
  );
}
