/**
 * StorySection: the planned story on the review screen. Each character with
 * a voice you can listen to and change, then the beats with their lines and
 * lengths. Changing a voice rebuilds the plan on the server from its saved
 * stages (no AI calls).
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, UserRound } from "lucide-react";
import type { ShotSpec } from "../../../src/generator/spec.schema";
import { getVoices, recastVoice } from "../api";
import { Badge } from "./ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { AuditionButton, useVoiceAudition } from "./useVoiceAudition";
import { prettyVoice } from "../lib/format";

type Engine = "kitten2" | "voxcpm2";

const PACE_LABELS: Record<string, string> = { quick: "Quick", normal: "Normal", linger: "Slow" };

export function StorySection({
  spec,
  specId,
  onSpec,
}: {
  spec: ShotSpec;
  specId: string | null;
  onSpec: (spec: ShotSpec) => void;
}) {
  const story = spec.story;
  const engine: Engine = spec.audio?.dialogs?.engine ?? "kitten2";
  const [voices, setVoices] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const audition = useVoiceAudition();

  useEffect(() => {
    getVoices(engine)
      .then((r) => setVoices((r.voices ?? []).map((v: { id: string }) => v.id)))
      .catch(() => setVoices([]));
  }, [engine]);

  if (!story || story.beats.length === 0) return null;
  const anyEstimated = story.beats.some((b) => (b.lines ?? []).some((l) => l.estimated));

  const recast = async (name: string, voice: string) => {
    if (!specId) return;
    setBusy(name);
    try {
      const r = await recastVoice(specId, name, voice);
      onSpec(r.spec as ShotSpec);
      toast.success(`${name} now speaks as ${prettyVoice(voice)}`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      {story.characters.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h3 className="text-base font-semibold">Characters and their voices</h3>
            <p className="text-sm text-muted-foreground">
              Voices were matched to each character by the voice's usual gender and age. Listen to each one and pick
              another if it does not fit.
            </p>
          </div>
          {story.characters.map((c) => (
            <div key={c.name} className="flex flex-wrap items-center gap-3 rounded-xl bg-input/50 p-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/20 text-primary">
                <UserRound className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{c.name}</div>
                {c.look ? <div className="truncate text-xs text-muted-foreground">{c.look}</div> : null}
              </div>
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <Select value={c.voice ?? ""} onValueChange={(v) => recast(c.name, v)} disabled={busy === c.name || voices.length === 0}>
                  <SelectTrigger className="h-11 sm:w-48" aria-label={`Voice for ${c.name}`}>
                    <SelectValue placeholder="Choose a voice" />
                  </SelectTrigger>
                  <SelectContent>
                    {voices.map((v) => (
                      <SelectItem key={v} value={v}>{prettyVoice(v)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {busy === c.name ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
                <AuditionButton
                  state={c.voice ? audition.stateOf(engine, c.voice) : "idle"}
                  label={`${c.name}'s voice`}
                  disabled={!c.voice || (audition.busy && audition.stateOf(engine, c.voice) !== "loading")}
                  onClick={() => c.voice && audition.toggle(engine, c.voice)}
                />
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold">The story, beat by beat</h3>
          {anyEstimated ? <Badge variant="muted">Timing is estimated until the video is made</Badge> : null}
        </div>
        <ol className="space-y-2 text-[15px]">
          {story.beats.map((b, i) => (
            <li key={b.id} className="rounded-xl bg-input/50 p-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground/80">Beat {i + 1}</span>
                {b.from !== undefined && b.to !== undefined ? <span>{(b.to - b.from).toFixed(1)} s</span> : null}
                {b.pace ? <span>{PACE_LABELS[b.pace] ?? b.pace} pace</span> : null}
                {b.see ? <span className="min-w-0 truncate">We see: {b.see}</span> : null}
              </div>
              {(b.lines ?? []).length > 0 ? (
                (b.lines ?? []).map((l) => (
                  <p key={l.id} className="mt-1.5">
                    <span className="mr-1.5 font-semibold">{l.who === "narrator" ? "Narrator" : l.who}:</span>
                    {l.text}
                  </p>
                ))
              ) : b.say ? (
                <p className="mt-1.5 opacity-90">{b.say}</p>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
