/**
 * Videos — render history. ?selected=<id> deep-links/highlights an entry;
 * refreshes keep the exact selection.
 */
import { useEffect, useRef, useState } from "react";
import { Film, Download, Trash2, Eye, Clock } from "lucide-react";
import { listVideos, deleteVideo, Video } from "../api";
import { toast } from "sonner";
import { PageHeader, EmptyState, ErrorBanner, MetaRow } from "../components/shared";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { useQuery, setQuery } from "../lib/navigation";
import { cn } from "../lib/utils";

// This dashboard is a React web app (not a Remotion composition), so native
// media elements are correct here.
/* eslint-disable @remotion/warn-native-media-tag */

export default function Videos() {
  const query = useQuery();
  const selected = query.get("selected") ?? undefined;
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Video | null>(null);
  const [openReview, setOpenReview] = useState<{ id: string; reviewFolder?: string } | null>(null);
  const [openVideo, setOpenVideo] = useState<Video | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    listVideos()
      .then(setVideos)
      .catch((e) => setVideos([]));
  }, []);

  // Deep-link scroll: once the list landed, scroll the selected card into view.
  const selectedRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (selected && videos && selectedRef.current) {
      selectedRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, videos]);

  const handleDelete = async (v: Video) => {
    try {
      await deleteVideo(v.id);
      toast.success(`Deleted “${v.premise.slice(0, 48)}…”`, {
        description: "Rendered videos, specs and review stills removed.",
      });
      if (selected === v.id) setQuery({ selected: undefined });
      const fresh = await listVideos();
      setVideos(fresh);
    } catch (e) {
      setDeleteError(String(e));
      toast.error("Delete failed");
    }
    setDeleteTarget(null);
  };

  return (
    <div>
      <PageHeader title="Videos" hintId="videos-review" />
      {deleteError ? (
        <ErrorBanner error={deleteError} fix="Retry — if the server restarted, refresh this list first" />
      ) : null}

      {videos === null ? (
        <div className="text-sm text-muted-foreground">Loading renders…</div>
      ) : videos.length === 0 ? (
        <EmptyState
          icon={<Film />}
          title="No renders yet"
          body="Generate your first story video on the Generate tab — it lands here with verified audio and every frame drawn at 1080×1920."
        />
      ) : (
        <div className="space-y-4">
          {videos.map((v, i) => (
            <Card
              key={v.id}
              ref={selected === v.id ? selectedRef : undefined}
              className={cn(
                "transition-all",
                selected === v.id &&
                  "border-primary/60 bg-primary/[0.06] shadow-[0_0_0_1px_var(--primary)]",
              )}
            >
              <CardContent className="flex flex-wrap items-start gap-4 p-5">
                <button
                  className="group relative shrink-0 overflow-hidden rounded-lg border border-border bg-black"
                  onClick={() => setOpenVideo(v)}
                  title="Play in a dialog"
                >
                  <div className="grid h-[104px] w-[59px] place-items-center">
                    <Eye className="h-5 w-5 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
                  </div>
                  <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center font-mono text-[9px] text-muted-foreground">
                    {v.durationSec ?? "?"}s
                  </span>
                </button>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge variant={v.engine === "story" ? "amber" : "secondary"}>
                      {v.engine === "story" ? "Story" : "AI spec"}
                    </Badge>
                    {selected === v.id ? <Badge variant="default">selected</Badge> : null}
                    {v.music?.mood ? (
                      <Badge variant="outline">
                        <Clock className="h-3 w-3" /> {v.music.mood}
                      </Badge>
                    ) : null}
                  </div>
                  <h3 className="truncate font-medium leading-snug" title={v.premise}>
                    {v.premise}
                  </h3>
                  <div className="mt-1.5">
                    <MetaRow
                      items={[
                        { label: "file", value: <code className="text-[11px]">{v.output}</code> },
                        { label: "rendered", value: v.generatedAt ? new Date(v.generatedAt).toLocaleString("en-GB") : undefined },
                        { label: "provider", value: v.engine !== "story" ? v.provider : undefined },
                        { label: "model", value: v.engine !== "story" ? v.model : undefined },
                      ]}
                    />
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Button variant="secondary" size="sm" asChild disabled={!v.output}>
                    <a href={`/media/${v.output}`} target="_blank" rel="noreferrer" download>
                      <Download className="h-4 w-4" /> MP4
                    </a>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setOpenReview({ id: v.id, reviewFolder: v.reviewFolder })}
                    disabled={!v.reviewFolder}
                    title={
                      v.reviewFolder
                        ? "Frame-by-frame review (AI-spec renders)"
                        : "No review folder — story renders are frame-verified at build time"
                    }
                  >
                    <Eye className="h-4 w-4" /> Review
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(v)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Video playback dialog */}
      <Dialog open={openVideo != null} onOpenChange={(o) => !o && setOpenVideo(null)}>
        <DialogContent className="max-w-[min(420px,92vw)] p-4">
          {openVideo ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-sm leading-snug pr-6">{openVideo.premise}</DialogTitle>
                <DialogDescription>
                  {openVideo.engine === "story" ? "Story render · verified" : "AI spec render"} ·{" "}
                  {openVideo.durationSec ?? "?"}s · 1080×1920
                </DialogDescription>
              </DialogHeader>
              <video controls className="w-full rounded-lg bg-black" src={`/media/${openVideo.output}`} />
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Review frames dialog (AI-spec stills) */}
      <Dialog open={openReview != null} onOpenChange={(o) => !o && setOpenReview(null)}>
        <DialogContent className="max-w-[min(760px,94vw)]">
          {openReview ? (
            <>
              <DialogHeader>
                <DialogTitle>Frame review</DialogTitle>
                <DialogDescription>
                  One still per second — the authoring inspection set for this render.
                </DialogDescription>
              </DialogHeader>
              <StillGallery id={openReview.id} reviewFolder={openReview.reviewFolder} />
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={deleteTarget != null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this render?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.premise}” and ALL of its rendered versions plus review stills will be
              removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && handleDelete(deleteTarget)}>
              Delete everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StillGallery({ id, reviewFolder }: { id: string; reviewFolder?: string }) {
  const [frames, setFrames] = useState<string[]>([]);
  useEffect(() => {
    if (!reviewFolder) return;
    fetch(`/media/${reviewFolder}/review-report.json`)
      .then((r) => r.json())
      .then((rep: { frames?: number[] }) => {
        if (rep?.frames)
          setFrames(
            rep.frames.map((f) => `/media/${reviewFolder}/frame-${String(f).padStart(4, "0")}.png`),
          );
      })
      .catch(() => setFrames([]));
  }, [id, reviewFolder]);

  if (!reviewFolder) {
    return (
      <EmptyState
        title="No review folder"
        body="Story renders are verified at build time (frames + audio QC), so no extraction strip is generated for them."
      />
    );
  }
  if (!frames.length) {
    return <div className="text-sm text-muted-foreground">Extracting stills…</div>;
  }
  return (
    <div className="grid max-h-[60dvh] grid-cols-3 gap-2 overflow-y-auto rounded-lg border border-border bg-black/30 p-2 pr-3 sm:grid-cols-4">
      {frames.map((src) => (
        <img
          key={src}
          src={src}
          loading="lazy"
          className="aspect-[9/16] w-full rounded-md border border-border object-cover"
        />
      ))}
    </div>
  );
}
