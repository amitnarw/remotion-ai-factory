/**
 * Editor: change a planned video before it is made.
 *
 *   ?tab=editor&film=<id>   (opened from the plan review; Back returns there)
 *
 * Three panes: the Player (the real composition), the Inspector and Ask AI
 * for the selected item, and the Timeline below. Every save is a new version
 * on the server; Undo and Redo move between versions. Render uses the same
 * render flow as the review screen.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlayerRef } from "@remotion/player";
import { ArrowLeft, Clapperboard, History, Info, Redo2, RefreshCw, Undo2 } from "lucide-react";
import { toast } from "sonner";
import {
  editFilm,
  getFilm,
  redoFilm,
  renderSpec,
  undoFilm,
  type FilmChangeResponse,
  type FilmEdit,
  type FilmHead,
  type FilmProposal,
  type FilmResponse,
} from "../../api";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Switch } from "../../components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import { EmptyState, ErrorBanner } from "../../components/shared";
import { setQuery, useQuery } from "../../lib/navigation";
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
  const fromPlan = query.get("plan") ?? undefined;

  const [data, setData] = useState<FilmResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [player, setPlayer] = useState<PlayerRef | null>(null);
  const [draft, setDraft] = useState(loadDraft);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    if (!filmId) return;
    let alive = true;
    setData(null);
    setLoadError(null);
    getFilm(filmId)
      .then((r) => alive && setData(r))
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
  }, []);

  /** One save = one version. Resolves to the server's message on failure. */
  const save = useCallback(
    async (edits: FilmEdit[], source: "user" | "ai" = "user", summary?: string): Promise<string | null> => {
      if (!filmId) return "No video is open.";
      setBusy(edits.some((e) => /\.(say|text|who)$|story\.hook|\.lines/.test(e.path)) ? "Saving and voicing the new words..." : "Saving...");
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
      setQuery({ tab: "generate", step: "3", job: jobId, plan: undefined, film: undefined });
    } catch (e) {
      toast.error(errorMessage(e));
      setRendering(false);
    }
  };

  const back = () => setQuery({ tab: "generate", step: fromPlan ? "review" : "1", film: undefined });

  const onSelect = useCallback((item: TrackItem) => setSelectedId(item.id), []);

  if (!filmId) {
    return (
      <EmptyState
        icon={<Clapperboard />}
        title="No video to edit"
        body="Write a plan first, then press Open editor on the review screen."
        action={<Button onClick={() => setQuery({ tab: "generate", step: "1" })}>Write a plan</Button>}
      />
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <ErrorBanner error={loadError} />
        <Button variant="secondary" onClick={back}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
      </div>
    );
  }

  if (!data || !spec || !film || !timing) {
    return (
      <div className="mx-auto max-w-md rounded-2xl bg-card p-8 text-center shadow-xl shadow-black/20">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
        <div className="font-extrabold">Opening the editor...</div>
        <div className="mt-1 text-sm text-muted-foreground">The voice lines are checked first. This can take a moment.</div>
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
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-card p-3 shadow-xl shadow-black/20">
        <Button variant="secondary" size="sm" onClick={back} disabled={rendering}>
          <ArrowLeft className="h-4 w-4" /> {fromPlan ? "Back to the plan" : "Back"}
        </Button>
        <div className="min-w-0 px-1">
          <div className="truncate text-base font-extrabold leading-tight">{film.story.title}</div>
          <div className="truncate text-xs font-semibold text-muted-foreground">
            Version {head.current} · {Math.round(duration)}s · {spec.settings?.format ?? "9:16"}
            {data.measured ? "" : " · timing estimated"}
          </div>
        </div>
        {busy ? (
          <Badge variant="amber" className="gap-2">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" /> {busy}
          </Badge>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" disabled={!canUndo || locked} onClick={() => move("undo")} title="Undo the last change">
            <Undo2 className="h-4 w-4" /> Undo
          </Button>
          <Button variant="secondary" size="sm" disabled={!canRedo || locked} onClick={() => move("redo")} title="Redo">
            <Redo2 className="h-4 w-4" /> Redo
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setHistoryOpen(true)}>
            <History className="h-4 w-4" /> Versions
            <span className="rounded-full bg-black/25 px-2 text-xs">{head.versions.length}</span>
          </Button>
          <Button variant="amber" size="sm" disabled={locked} onClick={render}>
            <Clapperboard className={cn("h-4 w-4", rendering && "animate-pulse")} />
            {rendering ? "Starting..." : "Make the video"}
          </Button>
        </div>
      </div>
      <VersionHistory head={head} open={historyOpen} onOpenChange={setHistoryOpen} />

      {data.warnings.length > 0 ? (
        <Collapsible className="rounded-2xl bg-card px-4 py-2 shadow-xl shadow-black/20">
          <CollapsibleTrigger className="flex w-full items-center gap-2 py-1 text-left text-sm font-semibold text-muted-foreground hover:text-foreground">
            <Info className="h-4 w-4 text-accent" />
            {data.warnings.length} {data.warnings.length === 1 ? "note" : "notes"} from the last build
            <span className="ml-auto text-xs">show</span>
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
