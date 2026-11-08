/**
 * useVoiceAudition: listen to a voice before choosing it.
 *
 * One shared audio element: starting another voice stops the previous one.
 * Pressing the same voice again pauses it, and again resumes it. While the
 * sample is being made (the engine may need to load first) the button shows
 * a spinner and ignores clicks.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { voiceSample } from "../api";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { cn } from "../lib/utils";

type Engine = "kitten2" | "voxcpm2";

export function useVoiceAudition() {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [playState, setPlayState] = useState<{ key: string; state: "playing" | "paused" } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Stop and release the sample when the screen closes.
  useEffect(
    () => () => {
      const a = audioRef.current;
      if (a) {
        a.pause();
        URL.revokeObjectURL(a.src);
      }
      audioRef.current = null;
    },
    [],
  );

  const toggle = (engine: Engine, voice: string, opts: { voiceDesc?: string; text?: string; sampleUrl?: string } = {}) => {
    const key = `${engine}:${voice}`;
    if (playState && playState.key === key) {
      const a = audioRef.current;
      if (a) {
        if (playState.state === "playing") {
          a.pause();
          setPlayState({ key, state: "paused" });
        } else {
          void a.play();
          setPlayState({ key, state: "playing" });
        }
      }
      return;
    }
    // A new voice (or a replay from the start): stop the old one.
    abortRef.current?.abort();
    if (audioRef.current) {
      const prev = audioRef.current;
      prev.pause();
      prev.currentTime = 0;
      // Only revoke blob URLs we created; static preview URLs are served by the server.
      if (prev.src.startsWith("blob:")) URL.revokeObjectURL(prev.src);
      audioRef.current = null;
    }
    setPlayState(null);
    // Never leave a spinner stuck on a previous (aborted) request.
    setBusyKey(null);
    const ac = new AbortController();
    abortRef.current = ac;
    void (async () => {
      // Fast path: a pre-rendered, definition-keyed preview already exists.
      const staticUrl = opts.sampleUrl;
      if (staticUrl) {
        const audio = new Audio(staticUrl);
        try {
          if (ac.signal.aborted) return;
          audioRef.current = audio;
          audio.onended = () => {
            if (audioRef.current === audio) setPlayState(null);
          };
          await audio.play();
          if (ac.signal.aborted || abortRef.current !== ac) return;
          setPlayState({ key, state: "playing" });
          return;
        } catch {
          if (audioRef.current === audio) {
            audio.pause();
            audioRef.current = null;
          }
        }
      }
      if (ac.signal.aborted || abortRef.current !== ac) return;
      // Fall back to on-demand synthesis; it caches the result so the next
      // click uses the fast path.
      setBusyKey(key);
      try {
        const blob = await voiceSample({ engine, voice, voiceDesc: opts.voiceDesc, text: opts.text }, ac.signal);
        if (ac.signal.aborted || abortRef.current !== ac) return;
        const synthAudio = new Audio(URL.createObjectURL(blob));
        audioRef.current = synthAudio;
        synthAudio.onended = () => {
          if (audioRef.current === synthAudio) setPlayState(null);
        };
        setPlayState({ key, state: "playing" });
        await synthAudio.play();
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        toast.error("Could not play the sample", { description: e instanceof Error ? e.message : String(e) });
        if (audioRef.current === null) setPlayState(null);
      } finally {
        if (abortRef.current === ac) setBusyKey(null);
      }
    })();
  };

  const stateOf = (engine: Engine, voice: string): "loading" | "playing" | "paused" | "idle" => {
    const key = `${engine}:${voice}`;
    if (busyKey === key) return "loading";
    if (playState?.key === key) return playState.state;
    return "idle";
  };

  return { toggle, stateOf, busy: busyKey !== null };
}

/** The listen button: play, pause while playing, a spinner while loading. */
export function AuditionButton({
  state,
  onClick,
  disabled,
  label,
  className,
  showText = false,
}: {
  state: "loading" | "playing" | "paused" | "idle";
  onClick: () => void;
  disabled?: boolean;
  label: string;
  className?: string;
  showText?: boolean;
}) {
  const text = state === "loading" ? "Loading" : state === "playing" ? "Pause" : "Listen";
  const tip = `${text}: ${label}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size={showText ? "default" : "icon"}
          className={cn("shrink-0", className)}
          aria-label={tip}
          onClick={onClick}
          disabled={disabled}
        >
          {state === "loading" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : state === "playing" ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {showText ? text : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}
