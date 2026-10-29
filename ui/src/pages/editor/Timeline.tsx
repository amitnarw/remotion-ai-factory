/**
 * Timeline: one row per track, items placed at px = seconds * pxPerSec.
 *
 * Ctrl + wheel zooms around the pointer. The playhead follows the Player
 * through its "frameupdate" event and is moved by writing its transform
 * directly, so playback never re-renders React. Click an item to select it
 * and jump there; click empty space to jump to that moment.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PlayerRef } from "@remotion/player";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import type { ItemKind, Track, TrackItem } from "./tracks";

const LABEL_W = 92;
const LANE_H = 26;
const ROW_PAD = 4;
const RULER_H = 24;
const MIN_PX = 6;
const MAX_PX = 600;

const clampPx = (v: number) => Math.min(MAX_PX, Math.max(MIN_PX, v));

const KIND_CLASS: Record<ItemKind, string> = {
  hook: "bg-primary/55 text-primary-foreground",
  beat: "bg-primary/85 text-primary-foreground",
  shot: "bg-sky-600/85 text-white",
  caption: "bg-slate-500/75 text-white",
  voice: "bg-emerald-600/85 text-white",
  music: "bg-amber-500/85 text-amber-950",
  hit: "bg-rose-500/90 text-white",
  sfx: "bg-rose-400/35 text-rose-50",
  scene: "bg-violet-600/75 text-white",
};

/** 0:06.4 */
export function formatTime(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest < 10 ? "0" : ""}${rest.toFixed(1)}`;
}

function tickStep(px: number): number {
  for (const step of [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]) if (step * px >= 64) return step;
  return 600;
}

export function Timeline({
  tracks,
  duration,
  fps,
  player,
  selectedId,
  onSelect,
}: {
  tracks: Track[];
  duration: number;
  fps: number;
  player: PlayerRef | null;
  selectedId: string | null;
  onSelect: (item: TrackItem) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const [px, setPx] = useState(40);
  const pxRef = useRef(px);
  pxRef.current = px;
  const fitted = useRef(false);
  /** Keeps the moment under the pointer still while zooming. */
  const anchor = useRef<{ t: number; x: number } | null>(null);

  const fit = useCallback(() => {
    const el = scrollRef.current;
    if (!el || duration <= 0) return;
    anchor.current = null;
    setPx(clampPx((el.clientWidth - 24) / duration));
    el.scrollLeft = 0;
  }, [duration]);

  // First paint: fit the whole video in view.
  useLayoutEffect(() => {
    if (fitted.current || !scrollRef.current || duration <= 0) return;
    fitted.current = true;
    fit();
  }, [duration, fit]);

  const placePlayhead = useCallback(
    (frame: number) => {
      const x = (frame / fps) * pxRef.current;
      if (playheadRef.current) playheadRef.current.style.transform = `translateX(${x}px)`;
      if (timeRef.current) timeRef.current.textContent = formatTime(frame / fps);
      return x;
    },
    [fps],
  );

  // Follow the Player without React state per frame.
  useEffect(() => {
    if (!player) return;
    const onFrame = ({ detail }: { detail: { frame: number } }) => {
      const x = placePlayhead(detail.frame);
      const el = scrollRef.current;
      if (el && player.isPlaying() && (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft)) {
        el.scrollLeft = Math.max(0, x - 40);
      }
    };
    player.addEventListener("frameupdate", onFrame);
    placePlayhead(player.getCurrentFrame());
    return () => player.removeEventListener("frameupdate", onFrame);
  }, [player, placePlayhead]);

  // After a zoom: restore the anchor and move the playhead to the new scale.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && anchor.current) {
      el.scrollLeft = Math.max(0, anchor.current.t * px - anchor.current.x);
      anchor.current = null;
    }
    placePlayhead(player?.getCurrentFrame() ?? 0);
  }, [px, player, placePlayhead]);

  // Ctrl + wheel zoom (a native listener: React's wheel handler cannot preventDefault).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const cur = pxRef.current;
      const next = clampPx(cur * Math.exp(-e.deltaY * 0.0015));
      if (next === cur) return;
      anchor.current = { t: (el.scrollLeft + x) / cur, x };
      setPx(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    const el = scrollRef.current;
    if (el) {
      const x = el.clientWidth / 2;
      anchor.current = { t: (el.scrollLeft + x) / px, x };
    }
    setPx((p) => clampPx(p * factor));
  };

  const seek = (sec: number) => {
    if (!player) return;
    const frame = Math.round(Math.min(Math.max(0, sec), duration) * fps);
    player.seekTo(Math.min(frame, Math.max(0, Math.round(duration * fps) - 1)));
  };

  const width = Math.ceil(duration * px) + 24;
  const step = tickStep(px);
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let t = 0; t <= duration + 1e-6; t += step) out.push(Math.round(t * 1000) / 1000);
    return out;
  }, [duration, step]);
  const rowH = (t: Track) => t.lanes * LANE_H + ROW_PAD * 2;

  return (
    <div className="rounded-2xl bg-card p-3 shadow-xl shadow-black/20">
      <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Timeline</span>
        <span ref={timeRef} className="rounded-lg bg-input px-2 py-0.5 font-mono text-xs font-bold tabular-nums">
          0:00.0
        </span>
        <span className="text-xs text-muted-foreground">of {formatTime(duration)}</span>
        <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">Ctrl + wheel to zoom</span>
        <Button variant="secondary" size="iconSm" aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(1 / 1.5)}>
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="iconSm" aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(1.5)}>
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="iconSm" aria-label="Fit the whole video" title="Fit the whole video" onClick={fit}>
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex">
        {/* Track names */}
        <div className="shrink-0" style={{ width: LABEL_W }}>
          <div style={{ height: RULER_H }} />
          {tracks.map((t) => (
            <div
              key={t.key}
              className="flex items-center pr-2 text-xs font-bold text-muted-foreground"
              style={{ height: rowH(t) }}
            >
              {t.label}
            </div>
          ))}
        </div>

        {/* Scrollable time area */}
        <div ref={scrollRef} className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden rounded-xl bg-background/50">
          <div
            className="relative cursor-text select-none"
            style={{ width }}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              seek((e.clientX - rect.left) / px);
            }}
          >
            {/* Ruler */}
            <div className="relative" style={{ height: RULER_H }}>
              {ticks.map((t) => (
                <div
                  key={t}
                  className="absolute top-0 h-full pl-1 text-[10px] font-semibold tabular-nums text-muted-foreground"
                  style={{ left: t * px }}
                >
                  <div className="absolute left-0 top-1 h-3 w-px bg-muted-foreground/40" />
                  {formatTime(t).replace(/\.0$/, "")}
                </div>
              ))}
            </div>

            {tracks.map((t, ti) => (
              <div
                key={t.key}
                className={cn("relative", ti % 2 === 0 ? "bg-white/[0.025]" : "")}
                style={{ height: rowH(t) }}
              >
                {t.items.map((it) => {
                  const left = it.from * px;
                  const w = Math.max(6, (it.to - it.from) * px - 2);
                  const selected = it.id === selectedId;
                  const auto = (it.kind === "shot" || it.kind === "scene" || it.kind === "music") && it.filmIndex === undefined;
                  return (
                    <button
                      key={it.id}
                      type="button"
                      title={`${it.label}${it.detail ? ` (${it.detail})` : ""}\n${formatTime(it.from)} to ${formatTime(it.to)}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(it);
                        seek(it.from);
                      }}
                      className={cn(
                        "absolute overflow-hidden whitespace-nowrap rounded-md px-1.5 text-left text-[11px] font-semibold leading-[22px] transition-[filter] hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        KIND_CLASS[it.kind],
                        auto && "opacity-60",
                        selected && "z-10 ring-2 ring-white brightness-125",
                      )}
                      style={{ left, width: w, top: ROW_PAD + it.lane * LANE_H, height: LANE_H - 4 }}
                    >
                      {w > 28 ? it.label : null}
                    </button>
                  );
                })}
                {(t.markers ?? []).map((m, i) => (
                  <div
                    key={i}
                    title={`${m.label} at ${formatTime(m.t)}`}
                    className="pointer-events-none absolute top-0 z-10 h-full w-1 -translate-x-1/2 rounded-full bg-white/70"
                    style={{ left: m.t * px }}
                  />
                ))}
              </div>
            ))}

            {/* Playhead */}
            <div
              ref={playheadRef}
              className="pointer-events-none absolute left-0 top-0 z-20 h-full w-0.5 bg-accent shadow-[0_0_8px] shadow-accent/60"
            >
              <div className="absolute -left-[5px] top-0 h-3 w-3 rounded-sm bg-accent" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
