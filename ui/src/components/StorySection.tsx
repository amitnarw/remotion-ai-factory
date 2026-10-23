/**
 * StorySection — the planned story on the review screen: the beats with their
 * lines and lengths, and each character's voice with ▶ audition and recast.
 * Recasting rebuilds the plan on the server from its saved stages (no AI calls).
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { ShotSpec } from "../../../src/generator/spec.schema";
import { getVoices, recastVoice, voiceSample } from "../api";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

type Engine = "kitten2" | "voxcpm2";

async function audition(engine: Engine, voice: string, text?: string) {
  try {
    const blob = await voiceSample({ engine, voice, text });
    await new Audio(URL.createObjectURL(blob)).play();
  } catch (e) {
    toast.error(`Could not play the sample: ${e instanceof Error ? e.message : String(e)}`);
  }
}

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
      toast.success(`${name} now speaks as ${voice}`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-2xl bg-input/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Story</div>
        {anyEstimated ? <Badge variant="muted">timing estimated — the render measures the real voice</Badge> : null}
      </div>

      {story.characters.length > 0 ? (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            Voices were matched to each character by the preset's assumed gender and age (not checked by ear). Listen with ▶ and pick another if one doesn't fit.
          </div>
          {story.characters.map((c) => (
            <div key={c.name} className="flex flex-wrap items-center gap-2 rounded-xl bg-background/40 p-2">
              <span className="font-bold">{c.name}</span>
              {c.look ? <span className="text-xs text-muted-foreground">{c.look}</span> : null}
              <span className="ml-auto flex items-center gap-2">
                <Select value={c.voice ?? ""} onValueChange={(v) => recast(c.name, v)} disabled={busy === c.name || voices.length === 0}>
                  <SelectTrigger className="w-40"><SelectValue placeholder="voice" /></SelectTrigger>
                  <SelectContent>
                    {voices.map((v) => (
                      <SelectItem key={v} value={v}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Listen to ${c.name}'s voice`}
                  disabled={!c.voice}
                  onClick={() => c.voice && audition(engine, c.voice)}
                >
                  ▶
                </Button>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-2 text-sm">
        {story.beats.map((b) => (
          <div key={b.id} className="rounded-xl bg-background/40 p-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{b.id}</span>
              {b.from !== undefined && b.to !== undefined ? <span>{(b.to - b.from).toFixed(1)}s</span> : null}
              {b.pace ? <span>· {b.pace}</span> : null}
              {b.see ? <span className="truncate">· {b.see}</span> : null}
            </div>
            {(b.lines ?? []).length > 0 ? (
              (b.lines ?? []).map((l) => (
                <div key={l.id} className="mt-1">
                  <span className="mr-1 font-semibold">{l.who === "narrator" ? "Narrator" : l.who}:</span>
                  {l.text}
                </div>
              ))
            ) : b.say ? (
              <div className="mt-1 opacity-90">{b.say}</div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
