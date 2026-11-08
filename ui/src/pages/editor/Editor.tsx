/**
 * Editor: change a planned video before (or after) it is made.
 *
 *   ?tab=editor&film=<id>&from=library|plan|done(&plan=<jobId>|&job=<jobId>)
 *
 * It opens full width from the Library, from the plan review or after a
 * render; Back returns to where it was opened from.
 *
 * Three panes: the Player (the real composition), the Inspector and Ask AI
 * for the selected item, and the Timeline below. Every save is a new version
 * on the server; Undo and Redo move between versions. Render uses the same
 * render flow as the review screen.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlayerRef } from "@remotion/player";
import { ArrowLeft, ChevronDown, Clapperboard, History, Info, Loader2, Redo2, RefreshCw, Undo2 } from "lucide-react";
import { toast } from "sonner";
import {
  editFilm,
  getFilm,
  getFilmStatus,
  putFilm,
  redoFilm,
  renderSpec,
  undoFilm,
  type FilmChangeResponse,
  type FilmEdit,
  type FilmHead,
  type FilmProposal,
  type FilmResponse,
  type SaveEditsSpec,
} from "../../api";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Switch } from "../../components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import { EmptyState, ErrorBanner } from "../../components/shared";
import { navigate, useQuery } from "../../lib/navigation";
import { cn } from "../../lib/utils";
import { SpecPlayer, specTiming } from "../../preview/PlayerPreview";
import { AskAi } from "./AskAi";
import { Inspector } from "./Inspector";
import { Timeline } from "./Timeline";
import { askTargetBeat, deriveTracks, findItem, type TrackItem } from "./tracks";

const DRAFT_LS_KEY = "vf:editorFastPreview";

function loadDraft(): boolean {
  try {
    return localStorage.getItem(DRAFT_LS_KEY) !== "off";
  } catch {
    return true;
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function ago(iso: string): string {
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

const SOURCE_LABEL = { plan: "Plan", user: "You", ai: "AI" } as const;

function VersionHistory({ head, open, onOpenChange }: { head: FilmHead; open: boolean; onOpenChange: (o: boolean) => void }) {
  const currentIndex = head.versions.findIndex((v) => v.v === head.current);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Versions</DialogTitle>
          <DialogDescription>Every save is kept. Undo and Redo move between them.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {head.versions
            .map((v, i) => ({ v, i }))
            .reverse()
            .map(({ v, i }) => {
              const current = v.v === head.current;
              const undone = i > currentIndex;
              return (
                <div
                  key={v.v}
                  className={cn("rounded-xl p-3", current ? "bg-primary/20" : "bg-input/50", undone && "opacity-50")}
                >
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-extrabold">Version {v.v}</span>
                    <Badge variant={v.source === "ai" ? "amber" : v.source === "user" ? "violet" : "muted"}>
                      {SOURCE_LABEL[v.source] ?? v.source}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{ago(v.at)}</span>
                    {current ? <Badge variant="success" className="ml-auto">Now</Badge> : null}
                    {undone ? <span className="ml-auto text-xs text-muted-foreground">undone</span> : null}
                  </div>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {v.summary.slice(0, 4).map((s, k) => (
                      <li key={k} className="break-words">{s}</li>
                    ))}
                    {v.summary.length > 4 ? <li>and {v.summary.length - 4} more</li> : null}
                  </ul>
                </div>
              );
            })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Editor() {
  const query = useQuery();
  const filmId = query.get("film") ?? undefined;
  const from = query.get("from") ?? (query.get("plan") ? "plan" : "library");
  const fromPlan = query.get("plan") ?? undefined;
  const fromJob = query.get("job") ?? undefined;

  const [data, setData] = useState<FilmResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [player, setPlayer] = useState<PlayerRef | null>(null);
  const [draft, setDraft] = useState(loadDraft);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [rendering, setRendering] = useState(false);
  /** The server is re-voicing/re-measuring edited lines in the background. */
  const [measuring, setMeasuring] = useState(false);

  useEffect(() => {
    if (!filmId) return;
    let alive = true;
    setData(null);
    setLoadError(null);
    getFilm(filmId)
      .then((r) => {
        if (!alive) return;
        setData(r);
        setMeasuring(!!r.measuring);
      })
      .catch((e) => alive && setLoadError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [filmId]);

  const spec = data?.spec;
  const film = data?.film;
  const tracks = useMemo(() => (spec && film ? deriveTracks(spec, film) : []), [spec, film]);
  const timing = useMemo(() => (spec ? specTiming(spec) : null), [spec]);
  const selected = findItem(tracks, selectedId);

  const adopt = useCallback((r: FilmChangeResponse) => {
    setData((d) => (d ? { ...d, head: r.head, film: r.film, spec: r.spec, warnings: r.warnings, audio: r.audio, measured: r.measured } : d));
    setMeasuring(!!r.measuring);
  }, []);

  /** Poll /status until the background voice measurement lands, then refresh. */
  useEffect(() => {
    if (!filmId || !measuring) return;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const status = await getFilmStatus(filmId);
        if (status.measuring) return;
        clearInterval(timer);
        if (!alive) return;
        setMeasuring(false);
        if (status.error) toast.error("Background voicing failed", { description: status.error.slice(0, 200) });
        const r = await getFilm(filmId);
        if (!alive) return;
        setData(r);
        setMeasuring(!!r.measuring); // a newer edit may already be re-measuring
        if (!status.error) toast.success("Voice measured", { description: "The timing is real now - the video can be made." });
      } catch {
        /* server hiccup: keep polling */
      }
    }, 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [filmId, measuring]);

  /** One save = one version. Resolves to the server's message on failure. */
  const save = useCallback(
    async (edits: FilmEdit[], source: "user" | "ai" = "user", summary?: string): Promise<string | null> => {
      if (!filmId) return "No video is open.";
      setBusy(edits.some((e) => /\.(see|stress|pace|sound|at|who)$/i.test(e.path)) ? "Saving..." : "Saving and re-timing...");
      try {
        const r = await editFilm(filmId, { edits, source, summary });
        adopt(r);
        toast.success(source === "ai" ? "AI change applied" : "Saved", { description: `Version ${r.head.current}` });
        return null;
      } catch (e) {
        return errorMessage(e);
      } finally {
        setBusy(null);
      }
    },
    [filmId, adopt],
  );

  const onSaveUser = useCallback((edits: FilmEdit[]) => save(edits, "user"), [save]);
  const onApplyAi = useCallback((p: FilmProposal) => save(p.edits, "ai", p.summary), [save]);

  /** Wording saves (PUT /api/film/:id): narration/dialog text re-voices and
   *  re-times ("reflow", the changed length is offered), caption text keeps
   *  its timing. */
  const onSaveSpec = useCallback<SaveEditsSpec>(
    async (mutate) => {
      if (!filmId || !spec) return "No video is open.";
      const from = specTiming(spec);
      setBusy(spec.captions ? "Saving..." : "Saving and re-timing...");
      try {
        const r = await putFilm(filmId, { spec: mutate(spec) });
        adopt(r);
        const to = specTiming(r.spec);
        const delta = (to.durationInFrames - from.durationInFrames) / (from.fps || 30);
        const keptTiming = (r.changed?.lines ?? 0) === 0 && (r.changed?.captions ?? 0) > 0;
        toast.success(keptTiming ? "Words kept on their timing" : "Saved", {
          description:
            keptTiming
              ? `The voice did not change; ${(r.changed?.captions ?? 0)} caption(s) re-timed in place (version ${r.head.current}).`
              : Math.abs(delta) >= 0.4
                ? `Reflowed: the video is now ${(to.durationInFrames / to.fps).toFixed(1)}s (${delta >= 0 ? "+" : ""}${delta.toFixed(1)}s), version ${r.head.current}.`
                : `Re-voiced from the cache; version ${r.head.current}.`,
        });
        return null;
      } catch (e) {
        return errorMessage(e);
      } finally {
        setBusy(null);
      }
    },
    [filmId, spec, adopt],
  );

  const move = async (dir: "undo" | "redo") => {
    if (!filmId) return;
    setBusy(dir === "undo" ? "Undoing..." : "Redoing...");
    try {
      const r = await (dir === "undo" ? undoFilm(filmId) : redoFilm(filmId));
      adopt(r);
      toast.success(dir === "undo" ? "Undone" : "Redone", { description: `Back on version ${r.head.current}` });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const render = async () => {
    if (!filmId) return;
    setRendering(true);
    try {
      // No audio override: the film's own voice settings are already in the spec.
      // Chunked render: only the chunks this edit session changed are re-rendered.
      const { jobId } = await renderSpec(filmId, undefined, { chunked: true });
      navigate({ tab: "create", step: "rendering", job: jobId });
    } catch (e) {
      toast.error(errorMessage(e));
      setRendering(false);
    }
  };

  const back = () => {
    if (from === "plan" && fromPlan) navigate({ tab: "create", step: "review", plan: fromPlan });
    else if (from === "done" && fromJob) navigate({ tab: "create", step: "done", job: fromJob });
    else navigate({ tab: "library", video: from === "library" ? filmId : undefined });
  };
  const backLabel =
    from === "plan" && fromPlan ? "Back to the plan" : from === "done" && fromJob ? "Back to the video" : "Back to the library";

  const onSelect = useCallback((item: TrackItem) => setSelectedId(item.id), []);

  if (!filmId) {
    return (
      <EmptyState
        icon={<Clapperboard />}
        title="No video to edit"
        body="Open a video from the Library, or write a plan and press Open in editor on the review screen."
        action={
          <>
            <Button variant="secondary" onClick={() => navigate({ tab: "library" })}>
              <ArrowLeft className="h-4 w-4" /> Library
            </Button>
            <Button variant="amber" onClick={() => navigate({ tab: "create", step: "idea" })}>
              Make a video
            </Button>
          </>
        }
      />
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 pt-10">
        <ErrorBanner error={`This video cannot be opened in the editor: ${loadError}`} />
        <Button variant="secondary" onClick={back}>
          <ArrowLeft className="h-4 w-4" /> {backLabel}
        </Button>
      </div>
    );
  }

  if (!data || !spec || !film || !timing) {
    return (
      <div className="mx-auto mt-10 max-w-md rounded-2xl bg-card p-8 text-center shadow-xl shadow-black/20" role="status">
        <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-primary" />
        <div className="text-lg font-semibold">Opening the editor...</div>
        <div className="mt-1 text-sm text-muted-foreground">The voice lines are checked first. This can take a moment.</div>
        <Button variant="secondary" size="sm" className="mt-5" onClick={back}>
          <ArrowLeft className="h-4 w-4" /> {backLabel}
        </Button>
      </div>
    );
  }

  const { head } = data;
  const at = head.versions.findIndex((v) => v.v === head.current);
  const canUndo = at > 0;
  const canRedo = at >= 0 && at < head.versions.length - 1;
  const locked = !!busy || rendering;
  const duration = timing.durationInFrames / timing.fps;

  return (
    <div className="space-y-4" data-testid="editor">
      {/* Header: back, what is open, its state, and the actions. */}
      <header className="sticky top-0 z-30 -mx-3 bg-background/90 px-3 py-3 backdrop-blur-md sm:-mx-4 sm:px-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-card p-2.5 shadow-xl shadow-black/20 sm:p-3">
          <Button variant="secondary" size="sm" onClick={back} disabled={rendering} aria-label={backLabel}>
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">{backLabel}</span>
          </Button>
          <div className="min-w-0 flex-1 basis-40 px-1">
            <div className="flex items-center gap-2">
              <Clapperboard className="hidden h-4 w-4 shrink-0 text-primary sm:block" />
              <h1 className="truncate text-base font-bold leading-tight sm:text-lg">{film.story.title || "Untitled video"}</h1>
            </div>
            <div className="truncate text-xs font-medium text-muted-foreground">
              Version {head.current}, {Math.round(duration)} s, {spec.settings?.format ?? "9:16"}
              {data.measured ? "" : ", timing estimated"}
            </div>
          </div>
          {busy || measuring ? (
            <Badge variant="amber" className="order-last gap-2 sm:order-none" role="status">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" /> {busy ?? "Voicing the changed words..."}
            </Badge>
          ) : null}
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            <Button variant="secondary" size="sm" className="px-3 md:px-4" disabled={!canUndo || locked} onClick={() => move("undo")} title="Undo the last change" aria-label="Undo">
              <Undo2 className="h-4 w-4" /> <span className="hidden md:inline">Undo</span>
            </Button>
            <Button variant="secondary" size="sm" className="px-3 md:px-4" disabled={!canRedo || locked} onClick={() => move("redo")} title="Redo" aria-label="Redo">
              <Redo2 className="h-4 w-4" /> <span className="hidden md:inline">Redo</span>
            </Button>
            <Button variant="secondary" size="sm" className="gap-1.5 px-3 md:gap-2.5 md:px-4" onClick={() => setHistoryOpen(true)} aria-label={`Versions, ${head.versions.length}`}>
              <History className="h-4 w-4" /> <span className="hidden md:inline">Versions</span>
              <span className="rounded-full bg-black/25 px-2 text-xs">{head.versions.length}</span>
            </Button>
            <Button variant="amber" size="sm" className="ml-auto px-3 sm:ml-0 sm:px-4" disabled={locked} onClick={render}>
              {rendering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
              {rendering ? "Starting..." : "Make the video"}
            </Button>
          </div>
        </div>
      </header>
      <VersionHistory head={head} open={historyOpen} onOpenChange={setHistoryOpen} />

      {data.warnings.length > 0 ? (
        <Collapsible className="rounded-2xl bg-card px-4 py-2 shadow-xl shadow-black/20">
          <CollapsibleTrigger className="flex w-full items-center gap-2 py-1 text-left text-sm font-semibold text-muted-foreground hover:text-foreground">
            <Info className="h-4 w-4 text-accent" />
            {data.warnings.length} {data.warnings.length === 1 ? "note" : "notes"} from the last build
            <ChevronDown className="ml-auto h-4 w-4" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="space-y-1 pb-2 pt-1 text-xs text-muted-foreground">
              {data.warnings.map((w, i) => (
                <li key={i} className="break-words rounded-lg bg-input/50 px-2 py-1">{w}</li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      {/* Player | Inspector + Ask AI */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
        <div className="overflow-hidden rounded-2xl bg-black shadow-xl shadow-black/20">
          <div className="flex h-[min(62vh,640px)] min-h-[320px] items-center justify-center">
            <SpecPlayer ref={setPlayer} spec={spec} draft={draft} />
          </div>
          <div className="flex items-center gap-2 bg-card px-3 py-2 text-xs text-muted-foreground">
            <Switch
              checked={draft}
              aria-label="Fast preview"
              onCheckedChange={(on) => {
                setDraft(on);
                try { localStorage.setItem(DRAFT_LS_KEY, on ? "on" : "off"); } catch { /* ignore */ }
              }}
            />
            <span className="font-semibold">Fast preview</span>
            <span>Lighter picture while you edit. The video is made at full quality.</span>
          </div>
        </div>
        <div className="space-y-4">
          <Inspector
            item={selected}
            film={film}
            spec={spec}
            fields={data.fields}
            version={head.current}
            busy={locked}
            onSave={onSaveUser}
            onSaveSpec={onSaveSpec}
          />
          <AskAi filmId={filmId} beat={askTargetBeat(selected)} busy={locked} onApply={onApplyAi} />
        </div>
      </div>

      <Timeline
        tracks={tracks}
        duration={duration}
        fps={timing.fps}
        player={player}
        selectedId={selected?.id ?? null}
        onSelect={onSelect}
      />
    </div>
  );
}
