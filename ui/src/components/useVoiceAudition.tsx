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
import { cn } from "../lib/utils";

type Engine = "kitten2" | "voxcpm2";

export function useVoiceAudition() {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [playState, setPlayState] = useState<{ key: string; state: "playing" | "paused" } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  const toggle = (engine: Engine, voice: string, opts: { voiceDesc?: string; text?: string } = {}) => {
    const key = `${engine}:${voice}`;
    if (busyKey) return; // a sample is loading: ignore clicks
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
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      URL.revokeObjectURL(audioRef.current.src);
      audioRef.current = null;
    }
    setPlayState(null);
    setBusyKey(key);
    void (async () => {
      try {
        const blob = await voiceSample({ engine, voice, voiceDesc: opts.voiceDesc, text: opts.text });
        const audio = new Audio(URL.createObjectURL(blob));
        audioRef.current = audio;
        audio.onended = () => {
          if (audioRef.current === audio) setPlayState(null);
        };
        setPlayState({ key, state: "playing" });
        await audio.play();
      } catch (e) {
        toast.error("Could not play the sample", { description: e instanceof Error ? e.message : String(e) });
        if (audioRef.current === null) setPlayState(null);
      } finally {
        setBusyKey(null);
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
  return (
    <Button
      type="button"
      variant="secondary"
      size={showText ? "default" : "icon"}
      className={cn("shrink-0", className)}
      aria-label={`${text}: ${label}`}
      title={`${text}: ${label}`}
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
  );
}
