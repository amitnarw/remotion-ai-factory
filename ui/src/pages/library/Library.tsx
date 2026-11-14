/**
 * Library: every video made on this computer.
 *
 *   ?tab=library               a grid of video cards
 *   ?tab=library&video=<id>    one video: player, facts and actions
 *
 * Paths from /api/videos are relative to output/ and served at /media/<path>
 * (per-video folders: <id>/video.mp4, <id>/thumb.jpg).
 */
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Clock,
  Download,
  FileJson,
  Film,
  Images,
  Plus,
  Ratio,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { deleteVideo, listVideos, type Video } from "../../api";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
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
import { EmptyState, ErrorBanner, InfoRow, PageHeader } from "../../components/shared";
import { InfoTip } from "../../components/InfoTip";
import { VariantsPanel } from "../../components/VariantsPanel";
import { PublishPanel } from "../../components/PublishPanel";
import {
  FORMATS,
  formatClock,
  formatDate,
  formatDateTime,
  formatFromId,
  formatFromSize,
  formatSeconds,
  timeOf,
  type VideoFormat,
} from "../../lib/format";
import { navigate, useQuery } from "../../lib/navigation";
import { useJobs } from "../../lib/jobs";
import { cn } from "../../lib/utils";

// A dashboard page (not a Remotion composition): native media elements are right here.
/* eslint-disable @remotion/warn-native-media-tag */

type Sort = "newest" | "oldest";
type Kind = "all" | "story" | "older";

/** Shapes learned from thumbnails, shared by the grid and the detail view. */
const knownFormats = new Map<string, VideoFormat>();

function useVideos() {
  const jobs = useJobs();
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    listVideos()
      .then((v) => {
        setVideos(v);
        setError(null);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setVideos((v) => v ?? []);
      });
  // Reload when a job finishes and when the window comes back into focus.
  useEffect(() => {
    void load();
  }, [jobs.finished]);
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  return { videos, error, reload: load, setVideos };
}

export default function Library() {
  const query = useQuery();
  const selected = query.get("video");
  const { videos, error, reload, setVideos } = useVideos();

  if (selected) {
    return (
      <VideoDetail
        id={selected}
        videos={videos}
        onDeleted={(id) => setVideos((v) => (v ?? []).filter((x) => x.id !== id))}
      />
    );
  }
  return <VideoGrid videos={videos} error={error} onRetry={reload} />;
}

/* ------------------------------------------------------------------ */
/*  The grid                                                           */
/* ------------------------------------------------------------------ */

function VideoGrid({ videos, error, onRetry }: { videos: Video[] | null; error: string | null; onRetry: () => void }) {
  const [text, setText] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const [kind, setKind] = useState<Kind>("all");

  const visible = useMemo(
    () =>
      (videos ?? [])
        .filter((v) => (kind === "all" ? true : kind === "story" ? v.engine === "story" : v.engine !== "story"))
        .filter((v) => !text.trim() || (v.premise ?? "").toLowerCase().includes(text.trim().toLowerCase()))
        .sort((a, b) => (sort === "newest" ? timeOf(b.generatedAt) - timeOf(a.generatedAt) : timeOf(a.generatedAt) - timeOf(b.generatedAt))),
    [videos, text, sort, kind],
  );
  const total = (videos ?? []).reduce((s, v) => s + (Number(v.durationSec) || 0), 0);
  const hasStory = (videos ?? []).some((v) => v.engine === "story");

  return (
    <div>
      <PageHeader
        title="Library"
        hintId="library-files"
        description={
          videos && videos.length
            ? `${videos.length} ${videos.length === 1 ? "video" : "videos"}, ${formatSeconds(total) || "0 s"} in total.`
            : "Every video you make is kept here."
        }
      >
        <Button variant="amber" onClick={() => navigate({ tab: "create", step: "idea" })}>
          <Plus className="h-4 w-4" /> New video
        </Button>
      </PageHeader>

      {error ? (
        <ErrorBanner
          error={error}
          fix="Check that the app is running, then try again."
          action={
            <Button variant="secondary" size="sm" onClick={onRetry}>
              <RefreshCw className="h-4 w-4" /> Try again
            </Button>
          }
        />
      ) : null}

      {videos && videos.length > 0 ? (
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Search your videos"
              aria-label="Search your videos"
              className="h-11 pl-11"
            />
          </div>
          <div className="flex gap-3">
            {hasStory ? (
              <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
                <SelectTrigger className="h-11 sm:w-44" aria-label="Which videos">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All videos</SelectItem>
                  <SelectItem value="story">Story videos</SelectItem>
                  <SelectItem value="older">Older videos</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
            <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
              <SelectTrigger className="h-11 sm:w-44" aria-label="Sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="oldest">Oldest first</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}

      {videos === null ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading videos">
          {[0, 1, 2].map((i) => (
            <div key={i} className="overflow-hidden rounded-2xl bg-card shadow-xl shadow-black/20">
              <div className="aspect-video animate-pulse bg-input/60" />
              <div className="space-y-2 p-4">
                <div className="h-4 w-3/4 animate-pulse rounded bg-input/60" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-input/60" />
              </div>
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        text || kind !== "all" ? (
          <EmptyState
            icon={<Search />}
            title="No videos match"
            body="Try other words, or show all videos."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setText("");
                  setKind("all");
                }}
              >
                Show all videos
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<Film />}
            title="No videos yet"
            body="Make your first video in Create. It shows up here as soon as it is ready."
            action={
              <Button variant="amber" onClick={() => navigate({ tab: "create", step: "idea" })}>
                <Plus className="h-4 w-4" /> Make a video
              </Button>
            }
          />
        )
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((v) => (
            <li key={v.id}>
              <VideoCard video={v} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Thumb({ video, className }: { video: Video; className?: string }) {
  const [format, setFormat] = useState<VideoFormat | undefined>(knownFormats.get(video.id) ?? formatFromId(video.id));
  const [broken, setBroken] = useState(false);
  const src = video.thumbnail ? `/media/${video.thumbnail}` : null;
  return (
    <div className={cn("relative aspect-video overflow-hidden bg-black", className)}>
      {src && !broken ? (
        <>
          <img src={src} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-xl" />
          <img
            src={src}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
            onLoad={(e) => {
              const f = formatFromSize(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight);
              if (f) {
                knownFormats.set(video.id, f);
                setFormat(f);
              }
            }}
            className="relative h-full w-full object-contain"
          />
        </>
      ) : (
        <div className="grid h-full w-full place-items-center bg-[linear-gradient(160deg,oklch(0.3_0.08_292),oklch(0.18_0.03_278))]">
          <Film className="h-10 w-10 text-primary/70" />
        </div>
      )}
      {format ? (
        <span className="absolute left-2 top-2 rounded-lg bg-black/70 px-2 py-0.5 text-xs font-semibold text-white">{format}</span>
      ) : null}
      {formatClock(video.durationSec) ? (
        <span className="absolute bottom-2 right-2 rounded-lg bg-black/70 px-2 py-0.5 text-xs font-semibold tabular-nums text-white">
          {formatClock(video.durationSec)}
        </span>
      ) : null}
    </div>
  );
}

function VideoCard({ video }: { video: Video }) {
  return (
    <button
      type="button"
      onClick={() => navigate({ tab: "library", video: video.id })}
      className="group block w-full overflow-hidden rounded-2xl bg-card text-left shadow-xl shadow-black/20 transition-transform hover:-translate-y-0.5 hover:brightness-110"
    >
      <Thumb video={video} />
      <div className="p-4">
        <h2 className="line-clamp-2 min-h-[2.75rem] text-[15px] font-semibold leading-snug" title={video.premise}>
          {video.premise || video.id}
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {formatDate(video.generatedAt) ? (
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" /> {formatDate(video.generatedAt)}
            </span>
          ) : null}
          {formatSeconds(video.durationSec) ? (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> {formatSeconds(video.durationSec)}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  One video                                                          */
/* ------------------------------------------------------------------ */

function VideoDetail({ id, videos, onDeleted }: { id: string; videos: Video[] | null; onDeleted: (id: string) => void }) {
  const video = videos?.find((v) => v.id === id) ?? null;
  const [format, setFormat] = useState<VideoFormat | undefined>(knownFormats.get(id) ?? formatFromId(id));
  const [editable, setEditable] = useState<boolean | null>(null);
  const [specOk, setSpecOk] = useState(false);
  const specPath = videos?.find((v) => v.id === id)?.spec;
  const [framesOpen, setFramesOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // A video can be opened in the editor when its plan's stage files exist.
  useEffect(() => {
    let alive = true;
    setEditable(null);
    fetch(`/media/${encodeURIComponent(id)}/story.json`, { method: "HEAD" })
      .then((r) => alive && setEditable(r.ok))
      .catch(() => alive && setEditable(false));
    return () => {
      alive = false;
    };
  }, [id]);

  // Offer the plan file only when it is really on disk.
  useEffect(() => {
    let alive = true;
    setSpecOk(false);
    if (!specPath) return;
    fetch(`/media/${specPath}`, { method: "HEAD" })
      .then((r) => alive && setSpecOk(r.ok))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [specPath]);

  const back = () => navigate({ tab: "library" });

  if (videos === null) {
    return (
      <div className="space-y-4">
        <BackButton onClick={back} />
        <div className="aspect-video animate-pulse rounded-2xl bg-card" aria-busy="true" />
      </div>
    );
  }

  if (!video) {
    return (
      <div className="space-y-4">
        <BackButton onClick={back} />
        <EmptyState
          icon={<Film />}
          title="This video is not in your library"
          body="It may have been deleted, or it is still being made."
          action={<Button onClick={back}>Show all videos</Button>}
        />
      </div>
    );
  }

  const remove = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteVideo(video.id);
      toast.success("Video deleted", { description: video.premise });
      onDeleted(video.id);
      navigate({ tab: "library" }, { replace: true });
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  };

  const src = video.output ? `/media/${video.output}` : null;
  const ratio = format ?? "16:9";

  return (
    <div className="space-y-5">
      <BackButton onClick={back} />
      {deleteError ? <ErrorBanner error={deleteError} fix="Try again. If the app was restarted, reload the page first." /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-h-60 place-items-center overflow-hidden rounded-2xl bg-black shadow-2xl shadow-black/40">
          {src ? (
            <video
              key={src}
              controls
              playsInline
              preload="metadata"
              poster={video.thumbnail ? `/media/${video.thumbnail}` : undefined}
              src={src}
              onLoadedMetadata={(e) => {
                const f = formatFromSize(e.currentTarget.videoWidth, e.currentTarget.videoHeight);
                if (f) {
                  knownFormats.set(video.id, f);
                  setFormat(f);
                }
              }}
              className={cn("w-full", ratio === "9:16" ? "max-h-[75dvh]" : "max-h-[70dvh]")}
            />
          ) : (
            <div className="p-10 text-center text-muted-foreground">The video file is missing.</div>
          )}
        </div>

        <div className="space-y-5">
          <div>
            <h1 className="break-words text-2xl font-bold leading-snug tracking-tight">{video.premise || video.id}</h1>
            <div className="mt-2 flex flex-wrap gap-2">
              {format ? (
                <Badge variant="muted">
                  {FORMATS[format].name} {format}
                </Badge>
              ) : null}
              {formatSeconds(video.durationSec) ? <Badge variant="muted">{formatSeconds(video.durationSec)}</Badge> : null}
              {video.engine === "story" ? <Badge variant="violet">Story</Badge> : null}
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            {editable ? (
              <Button variant="amber" onClick={() => navigate({ tab: "editor", film: video.id, from: "library" })}>
                <SlidersHorizontal className="h-4 w-4" /> Open in editor
              </Button>
            ) : null}
            {src ? (
              <Button variant={editable ? "secondary" : "amber"} asChild>
                <a href={src} download>
                  <Download className="h-4 w-4" /> Download video
                </a>
              </Button>
            ) : null}
            <div className="flex flex-wrap gap-2.5">
              {specOk ? (
                <Button variant="secondary" className="flex-1" asChild>
                  <a href={`/media/${video.spec}`} download title="The plan as a JSON file">
                    <FileJson className="h-4 w-4" /> Plan file
                  </a>
                </Button>
              ) : null}
              {video.reviewFolder ? (
                <Button variant="secondary" className="flex-1" onClick={() => setFramesOpen(true)}>
                  <Images className="h-4 w-4" /> Review frames
                </Button>
              ) : null}
            </div>
          </div>

          <Card className="px-4 py-1">
            <div>
              <InfoRow icon={<CalendarDays />} label="Made on" value={formatDateTime(video.generatedAt)} />
              <InfoRow icon={<Clock />} label="Length" value={formatSeconds(video.durationSec)} />
              <InfoRow icon={<Ratio />} label="Shape" value={format ? `${FORMATS[format].name} ${format}` : undefined} />
              <InfoRow icon={<Film />} label="Scenes" value={video.scenes ? String(video.scenes) : undefined} />
              <InfoRow icon={<FileJson />} label="Saved as" value={video.output ? <code className="text-xs">output/{video.output}</code> : undefined} />
            </div>
          </Card>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="w-full" disabled={deleting}>
                <Trash2 className="h-4 w-4" /> {deleting ? "Deleting..." : "Delete video"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this video?</AlertDialogTitle>
                <AlertDialogDescription>
                  &ldquo;{video.premise || video.id}&rdquo; and all of its files (the video, the plan and the pictures) are
                  removed from this computer. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction onClick={remove}>Yes, delete it</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* A planned run (its stage files are there) can have other versions. */}
      {editable ? <VariantsPanel runId={video.id} /> : null}
      {/* Titles, description, tags and a thumbnail to copy into YouTube (20-publish.md). */}
      <PublishPanel videoId={video.id} />

      <Dialog open={framesOpen} onOpenChange={setFramesOpen}>
        <DialogContent className="max-w-[min(820px,94vw)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Review frames <InfoTip helpId="videos-review" />
            </DialogTitle>
            <DialogDescription>Each picture is one second of the video.</DialogDescription>
          </DialogHeader>
          {framesOpen ? <StillGallery reviewFolder={video.reviewFolder} format={format} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="secondary" size="sm" onClick={onClick}>
      <ArrowLeft className="h-4 w-4" /> All videos
    </Button>
  );
}

function StillGallery({ reviewFolder, format }: { reviewFolder?: string; format?: VideoFormat }) {
  const [frames, setFrames] = useState<string[] | null>(null);
  useEffect(() => {
    if (!reviewFolder) return;
    fetch(`/media/${reviewFolder}/review-report.json`)
      .then((r) => r.json())
      .then((rep: { frames?: number[] }) =>
        setFrames((rep?.frames ?? []).map((f) => `/media/${reviewFolder}/frame-${String(f).padStart(4, "0")}.png`)),
      )
      .catch(() => setFrames([]));
  }, [reviewFolder]);

  if (frames === null) return <div className="py-8 text-center text-sm text-muted-foreground">Loading the pictures...</div>;
  if (!frames.length) return <div className="py-8 text-center text-sm text-muted-foreground">No pictures were saved for this video.</div>;
  const aspect = format === "16:9" ? "aspect-video" : format === "1:1" ? "aspect-square" : "aspect-[9/16]";
  return (
    <div className="grid max-h-[60dvh] grid-cols-3 gap-3 overflow-y-auto rounded-2xl bg-black/40 p-3 sm:grid-cols-4">
      {frames.map((src, i) => (
        <figure key={src} className="space-y-1">
          <img src={src} loading="lazy" alt={`Second ${i + 1}`} className={cn("w-full rounded-xl object-cover shadow-lg", aspect)} />
          <figcaption className="text-center text-xs text-muted-foreground">{i + 1} s</figcaption>
        </figure>
      ))}
    </div>
  );
}
