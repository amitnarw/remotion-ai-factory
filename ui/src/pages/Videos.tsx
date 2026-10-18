/**
 * Videos, render history. Solid cards, big buttons, zero borders.
 * ?selected=<id> deep-links/highlights an entry; survives refresh.
 */
import { useEffect, useRef, useState } from "react";
import { Film, Download, Trash2, Eye, Play } from "lucide-react";
import { listVideos, deleteVideo, Video } from "../api";
import { toast } from "sonner";
import { PageHeader, EmptyState, ErrorBanner, MetaRow } from "../components/shared";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
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
      .catch(() => setVideos([]));
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
      toast.success("Deleted!", { description: "The video and its files are gone." });
      if (selected === v.id) setQuery({ selected: undefined });
      setVideos(await listVideos());
    } catch (e) {
      setDeleteError(String(e));
      toast.error("Delete failed");
    }
    setDeleteTarget(null);
  };

  return (
    <div>
      <PageHeader title="Your videos" hintId="videos-review" />
      {deleteError ? (
        <ErrorBanner error={deleteError} fix="Try again, if the app was restarted, refresh the page first" />
      ) : null}

      {videos === null ? (
        <div className="text-[15px] font-semibold text-muted-foreground">Loading…</div>
      ) : videos.length === 0 ? (
        <EmptyState
          icon={<Film />}
          title="No videos yet"
          body="Go to Generate, pick a video and press the big yellow button, it will show up here."
        />
      ) : (
        <div className="space-y-5">
          {videos.map((v) => (
            <div
              key={v.id}
              ref={selected === v.id ? selectedRef : undefined}
              className={cn(
                "flex flex-wrap items-start gap-5 rounded-3xl p-6 shadow-xl shadow-black/20 transition-all",
                selected === v.id ? "bg-primary text-primary-foreground" : "bg-card hover:brightness-110",
              )}
            >
              <button
                onClick={() => setOpenVideo(v)}
                title="Watch this video"
                className={cn(
                  "grid h-24 w-24 shrink-0 place-items-center rounded-2xl transition-transform active:scale-[0.97]",
                  selected === v.id ? "bg-black/25" : "bg-primary/20 text-primary",
                )}
              >
                <Play className="h-9 w-9" />
              </button>
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant={selected === v.id ? "default" : v.engine === "story" ? "violet" : "secondary"}>
                    {v.engine === "story" ? "Story" : "AI spec"}
                  </Badge>
                  {selected === v.id ? <Badge variant="amber">picked</Badge> : null}
                  <Badge variant={selected === v.id ? "default" : "muted"}>{v.durationSec ?? "?"}s</Badge>
                </div>
                <h3 className="truncate text-lg font-extrabold leading-snug" title={v.premise}>
                  {v.premise}
                </h3>
                <div className="mt-2">
                  <MetaRow
                    items={[
                      { label: "saved as", value: <code className="text-[11px]">{v.output}</code> },
                      {
                        label: "made",
                        value: v.generatedAt ? new Date(v.generatedAt).toLocaleString("en-GB") : undefined,
                      },
                      { label: "provider", value: v.engine !== "story" ? v.provider : undefined },
                    ]}
                  />
                </div>
              </div>
              <div className={cn("flex shrink-0 flex-wrap items-center gap-2.5", selected === v.id && "opacity-95")}>
                <Button
                  variant={selected === v.id ? "amber" : "secondary"}
                  size="sm"
                  asChild
                  disabled={!v.output}
                >
                  <a href={`/media/${v.output}`} target="_blank" rel="noreferrer" download>
                    <Download className="h-4 w-4" /> Download
                  </a>
                </Button>
                <Button
                  variant={selected === v.id ? "amber" : "secondary"}
                  size="sm"
                  onClick={() => setOpenReview({ id: v.id, reviewFolder: v.reviewFolder })}
                  disabled={!v.reviewFolder}
                  title={
                    v.reviewFolder
                      ? "See every second of the video as a picture"
                      : "Story videos were already checked picture-by-picture"
                  }
                >
                  <Eye className="h-4 w-4" /> Pictures
                </Button>
                <Button
                  variant={selected === v.id ? "amber" : "destructive"}
                  size="iconSm"
                  onClick={() => setDeleteTarget(v)}
                  title="Delete this video"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Video playback dialog */}
      <Dialog open={openVideo != null} onOpenChange={(o) => !o && setOpenVideo(null)}>
        <DialogContent className="max-w-[min(440px,92vw)] p-5">
          {openVideo ? (
            <>
              <DialogHeader>
                <DialogTitle className="pr-8 text-base leading-snug">{openVideo.premise}</DialogTitle>
                <DialogDescription>
                  {openVideo.engine === "story" ? "Story video, checked" : "AI-spec video"} ·{" "}
                  {openVideo.durationSec ?? "?"}s · tall 1080×1920
                </DialogDescription>
              </DialogHeader>
              <video controls className="w-full rounded-2xl bg-black" src={`/media/${openVideo.output}`} />
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Review pictures dialog */}
      <Dialog open={openReview != null} onOpenChange={(o) => !o && setOpenReview(null)}>
        <DialogContent className="max-w-[min(780px,94vw)]">
          {openReview ? (
            <>
              <DialogHeader>
                <DialogTitle>Pictures of every second</DialogTitle>
                <DialogDescription>Each picture below is one second of the video.</DialogDescription>
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
            <AlertDialogTitle>Delete this video?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.premise}” and ALL of its files will be removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && handleDelete(deleteTarget)}>
              Yes, delete it
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
        title="No pictures for this one"
        body="Story videos were already checked picture-by-picture while being made."
      />
    );
  }
  if (!frames.length) {
    return <div className="text-[15px] font-semibold text-muted-foreground">Loading…</div>;
  }
  return (
    <div className="grid max-h-[60dvh] grid-cols-3 gap-3 overflow-y-auto rounded-2xl bg-black/40 p-3 pr-4 sm:grid-cols-4">
      {frames.map((src) => (
        <img
          key={src}
          src={src}
          loading="lazy"
          className="aspect-[9/16] w-full rounded-xl object-cover shadow-lg"
        />
      ))}
    </div>
  );
}
