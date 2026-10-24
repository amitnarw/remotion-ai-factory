/**
 * Inspector: a form for the selected timeline item, drawn from the server's
 * field list (enums become a Select, text an Input or Textarea). Save sends
 * one edit per changed field, with paths written the way film/edits.ts reads
 * them: beats by id, shots / scenes / hits / music by their index in the film.
 *
 * Wording is different (Phase 4, keep-timing vs reflow): narration, dialog
 * and hook text go through PUT /api/film/:id with the edited spec — the
 * server adopts the story text (re-voices the changed line from the cache and
 * re-times) — and a caption's on-screen words are saved as keep-timing
 * overrides (the voice and the window stay, only the words change).
 */
import { useState, type ReactNode } from "react";
import { MousePointerClick, Save } from "lucide-react";
import type { ShotSpec } from "@/generator/spec.schema";
import { subjectsFor } from "@/generator/camera/subjects";
import type { EditorFields, FieldInfo, Film, FilmEdit, SaveEditsSpec } from "../../api";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Input, Textarea } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { formatTime } from "./Timeline";
import type { TrackItem } from "./tracks";

/** Saves edits; resolves to the server's message on failure, null on success. */
export type SaveEdits = (edits: FilmEdit[]) => Promise<string | null>;

const LABELS: Record<string, string> = {
  say: "Narration",
  see: "What we see",
  stress: "Word to stress",
  pace: "Pace",
  subject: "Subject",
  size: "Shot size",
  angle: "Angle",
  side: "Side",
  move: "Camera move",
  place: "Place in frame",
  energy: "Energy",
  style: "Style",
  kit: "World",
  time: "Time of day",
  weather: "Weather",
  crowd: "Crowd",
  camera: "Camera",
  accent: "Street look",
  sound: "Sound",
  at: "When",
  mood: "Mood",
};

const OPTION_LABELS: Record<string, string> = {
  ECU: "extreme close-up",
  CU: "close-up",
  MS: "medium",
  FS: "full",
  WS: "wide",
  EWS: "extreme wide",
  start: "at the start of the beat",
  end: "at the end of the beat",
};

const pretty = (v: string) => OPTION_LABELS[v] ?? v.replace(/[_-]/g, " ");
const labelFor = (key: string) => LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);

interface Entry {
  path: string;
  label: string;
  info: FieldInfo;
  value: unknown;
  /** Text shown in a tall box. */
  long?: boolean;
}

/** Wording the editor saves through the approved spec (PUT), not through /edit. */
const TEXT_EDIT_PATH = /^(story\.hook|story\.beats\[[^\]]+\]\.say|captions\[\d+\]\.text)$/;

/**
 * Turn wording changes into an edited spec (the server diffs it against the
 * film). Entries whose target is gone from the spec come back in `missed`;
 * the caller saves those through /edit instead.
 */
function specTextMutate(
  spec: ShotSpec,
  changes: Entry[],
  values: Record<string, unknown>,
): { spec: ShotSpec; missed: Entry[] } {
  const missed: Entry[] = [];
  const story = spec.story ? { ...spec.story } : undefined;
  if (story) story.beats = (story.beats ?? []).map((b) => ({ ...b }));
  const captions = (spec.captions ?? []).map((c) => ({ ...c }));
  for (const e of changes) {
    const v = typeof values[e.path] === "string" ? (values[e.path] as string) : "";
    let m = /^captions\[(\d+)\]\.text$/.exec(e.path);
    if (m) {
      const cap = captions[Number(m[1])];
      if (!cap) {
        missed.push(e);
        continue;
      }
      cap.text = v;
      cap.words = undefined; // the server re-times the words inside the window
      continue;
    }
    if (!story) {
      missed.push(e);
      continue;
    }
    m = /^story\.hook$/.exec(e.path);
    if (m) {
      story.hook = v;
      continue;
    }
    m = /^story\.beats\[([^\]]+)\]\.say$/.exec(e.path);
    if (m) {
      const b = story.beats?.find((x) => x.id === m![1]);
      if (!b) {
        missed.push(e);
        continue;
      }
      b.say = v;
      continue;
    }
    // Character dialog lines are NOT approved-spec wording: the playable spec's
    // timed lines include narrator lines the film does not have, so their
    // spelling edits go through /edit (validated per line; same fast re-voice).
    missed.push(e);
  }
  const out: ShotSpec = { ...spec, story: story ?? spec.story, captions: captions.length ? captions : spec.captions };
  return { spec: out, missed };
}

/** Short old-to-new reading for the diff preview. */
const shortText = (v: unknown): string => {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 44 ? `${t.slice(0, 41)}...` : t || "(empty)";
  }
  return JSON.stringify(v);
};

/** One entry per editable field of an object, skipping lists and nested objects. */
function entriesFor(base: string, fields: Record<string, FieldInfo>, obj: Record<string, unknown>, skip: string[] = []): Entry[] {
  return Object.entries(fields)
    .filter(([k, info]) => !skip.includes(k) && (info.kind === "enum" || info.kind === "text" || info.kind === "number"))
    .map(([k, info]) => ({ path: `${base}.${k}`, label: labelFor(k), info, value: obj[k] }));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function FieldInput({ entry, value, onChange, disabled }: { entry: Entry; value: unknown; onChange: (v: unknown) => void; disabled: boolean }) {
  const { info } = entry;
  if (info.kind === "enum") {
    const current = typeof value === "string" ? value : "";
    const options = [...(info.options ?? [])];
    if (current && !options.includes(current)) options.unshift(current);
    return (
      <Select value={current || undefined} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="h-10 text-sm">
          <SelectValue placeholder="Pick one" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {pretty(o)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (info.kind === "number") {
    return (
      <Input
        type="number"
        className="h-10 text-sm"
        value={value === undefined || value === null ? "" : String(value)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      />
    );
  }
  if (entry.long) {
    return (
      <Textarea
        className="min-h-20 text-sm"
        value={typeof value === "string" ? value : ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <Input
      className="h-10 text-sm"
      value={typeof value === "string" ? value : ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * The form itself. `toEdits` turns the changed fields into edits (default: one
 * "set" per field); `alwaysSave` allows saving with no change (keeping a shot
 * that was picked automatically).
 *
 * Wording entries (say / lines / hook / caption text) go through `onSaveSpec`
 * (the approved-spec PUT) when it is given; everything else goes through
 * `onSave` (/edit) as before. A small diff preview shows what will change.
 */
function FieldsForm({
  groups,
  busy,
  onSave,
  onSaveSpec,
  spec,
  saveLabel = "Save changes",
  toEdits,
  alwaysSave = false,
}: {
  groups: Array<{ title?: string; entries: Entry[] }>;
  busy: boolean;
  onSave: SaveEdits;
  /** Wording saves go here (PUT /api/film/:id). Absent = this form cannot save wording. */
  onSaveSpec?: SaveEditsSpec;
  /** The current spec, needed by onSaveSpec. */
  spec?: ShotSpec;
  saveLabel?: string;
  toEdits?: (values: Record<string, unknown>, changed: Entry[]) => FilmEdit[];
  alwaysSave?: boolean;
}) {
  const all = groups.flatMap((g) => g.entries);
  const [draft, setDraft] = useState<Record<string, unknown>>(() => Object.fromEntries(all.map((e) => [e.path, e.value])));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const changed = all.filter((e) => !same(draft[e.path], e.value));
  const wording = changed.filter((e) => TEXT_EDIT_PATH.test(e.path));
  const structural = changed.filter((e) => !TEXT_EDIT_PATH.test(e.path));

  const save = async () => {
    if (changed.length === 0) return;
    setSaving(true);
    setError(null);
    if (wording.length > 0) {
      if (!onSaveSpec || !spec) {
        setSaving(false);
        setError("This wording cannot be saved from here (no spec to diff against).");
        return;
      }
      const { spec: next, missed } = specTextMutate(spec, wording, draft);
      const message = await onSaveSpec(() => next);
      if (message) {
        setSaving(false);
        setError(message);
        return;
      }
      const fallback = missed.map((e) => ({ op: "set" as const, path: e.path, value: draft[e.path] }));
      if (fallback.length > 0) {
        const fallbackMessage = await onSave(fallback);
        if (fallbackMessage) {
          setSaving(false);
          setError(fallbackMessage);
          return;
        }
      }
    }
    if (structural.length > 0) {
      const edits = toEdits
        ? toEdits(draft, structural)
        : structural.map((e) => ({ op: "set" as const, path: e.path, value: draft[e.path] }));
      if (edits.length === 0) {
        setSaving(false);
        return;
      }
      const message = await onSave(edits);
      if (message) {
        setSaving(false);
        setError(message);
        return;
      }
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      {groups.map((g, gi) => (
        <div key={gi} className="space-y-3">
          {g.title ? <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{g.title}</div> : null}
          {g.entries.map((e) => (
            <label key={e.path} className="block space-y-1">
              <span className="text-xs font-semibold text-muted-foreground">{e.label}</span>
              <FieldInput
                entry={e}
                value={draft[e.path]}
                disabled={busy || saving}
                onChange={(v) => setDraft((d) => ({ ...d, [e.path]: v }))}
              />
            </label>
          ))}
        </div>
      ))}
      {changed.length > 0 ? (
        <div className="rounded-xl bg-input/40 px-3 py-2">
          <div className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {changed.length === 1 ? "1 line changed" : `${changed.length} lines changed`}
          </div>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {changed.map((e) => (
              <li key={e.path} className="break-words tabular-nums">
                <span className="font-semibold text-foreground/70">{labelFor(e.path.slice(e.path.lastIndexOf(".") + 1))}</span>{" "}
                {shortText(e.value)} <span className="font-bold">to</span> {shortText(draft[e.path])}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="whitespace-pre-wrap rounded-xl bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground">
          {error}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy || saving || (!alwaysSave && changed.length === 0)} onClick={save}>
          <Save className={saving ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />
          {saving ? "Saving..." : wording.length > 0 && structural.length === 0 && alwaysSave ? "Keep timing" : saveLabel}
        </Button>
        {changed.length > 0 && !saving ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setDraft(Object.fromEntries(all.map((e) => [e.path, e.value])));
              setError(null);
            }}
          >
            Reset
          </Button>
        ) : null}
        {wording.length > 0 ? (
          <span className="text-xs text-muted-foreground">re-voices the changed line(s) + re-times the video</span>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function BeatForm({ film, fields, beatId, line, busy, onSave, onSaveSpec, spec }: { film: Film; fields: EditorFields; beatId: string; line?: number; busy: boolean; onSave: SaveEdits; onSaveSpec?: SaveEditsSpec; spec?: ShotSpec }) {
  const beat = film.story.beats.find((b) => b.id === beatId);
  if (!beat) return <Note>Beat {beatId} is not in the story any more.</Note>;
  const base = `story.beats[${beatId}]`;
  const main = entriesFor(base, fields.beat, beat as unknown as Record<string, unknown>).map((e) =>
    e.path.endsWith(".say") ? { ...e, long: true } : e,
  );
  const names = film.story.characters.map((c) => c.name);
  const lines: Entry[] = beat.lines.flatMap((l, i) => [
    { path: `${base}.lines[${i}].who`, label: `Line ${i + 1}: who says it${line === i ? " (selected)" : ""}`, info: { kind: "enum" as const, options: names }, value: l.who },
    { path: `${base}.lines[${i}].text`, label: `Line ${i + 1}: words`, info: { kind: "text" as const }, value: l.text, long: true },
  ]);
  return (
    <FieldsForm
      busy={busy}
      onSave={onSave}
      onSaveSpec={onSaveSpec}
      spec={spec}
      groups={[{ entries: main }, ...(lines.length ? [{ title: "Character lines", entries: lines }] : [])]}
    />
  );
}

/** A caption's on-screen words, saved as keep-timing (the voice stays). */
function CaptionScreenForm({ spec, item, busy, onSaveSpec }: { spec: ShotSpec; item: TrackItem; busy: boolean; onSaveSpec?: SaveEditsSpec }) {
  const cap = spec.captions?.[item.specIndex];
  if (!cap) return <Note>This caption is not in the plan any more.</Note>;
  return (
    <FieldsForm
      busy={busy}
      onSave={async () => "Use the caption save instead (it keeps the timing)."}
      onSaveSpec={onSaveSpec}
      spec={spec}
      alwaysSave
      saveLabel="Keep timing"
      groups={[
        {
          entries: [
            { path: `captions[${item.specIndex}].text`, label: "Words on screen", info: { kind: "text" as const }, value: cap.text, long: true },
          ],
        },
      ]}
    />
  );
}

function ShotForm({ film, spec, fields, item, busy, onSave }: { film: Film; spec: ShotSpec; fields: EditorFields; item: TrackItem; busy: boolean; onSave: SaveEdits }) {
  const specShot = spec.shots?.[item.specIndex];
  if (!specShot) return <Note>This shot is not in the plan any more.</Note>;
  if (item.beat === "hook") return <Note>The opening shot is picked for you. It films the whole place while the question is asked.</Note>;
  const directed = item.filmIndex !== undefined ? film.direction.shots[item.filmIndex] : undefined;
  const source = (directed ?? specShot) as unknown as Record<string, unknown>;
  const kit = spec.scenes.find((sc) => specShot.from >= sc.from && specShot.from < sc.to)?.kit ?? spec.scenes[0]?.kit;
  const shotFields = { ...fields.shot };
  if (shotFields.subject?.kind === "text") shotFields.subject = { kind: "enum", options: subjectsFor(kit) };
  const base = item.filmIndex !== undefined ? `direction.shots[${item.filmIndex}]` : "direction.shots[new]";
  const entries = entriesFor(base, shotFields, source);
  if (directed) return <FieldsForm groups={[{ entries }]} busy={busy} onSave={onSave} />;
  // Picked by film rules: saving adds it to the director's shots for this beat.
  const beat = item.beat;
  return (
    <div className="space-y-3">
      <Note>This shot was picked by the film rules. Saving makes it the shot for {beat}.</Note>
      <FieldsForm
        groups={[{ entries }]}
        busy={busy}
        onSave={onSave}
        alwaysSave
        saveLabel="Save as this beat's shot"
        toEdits={(values) => [
          {
            op: "insert",
            path: "direction.shots",
            value: {
              beat,
              ...Object.fromEntries(entries.map((e) => [e.path.slice(e.path.lastIndexOf(".") + 1), values[e.path]])),
            },
          },
        ]}
      />
    </div>
  );
}

function SceneForm({ film, fields, item, busy, onSave }: { film: Film; fields: EditorFields; item: TrackItem; busy: boolean; onSave: SaveEdits }) {
  const scene = item.filmIndex !== undefined ? film.direction.scenes[item.filmIndex] : undefined;
  if (!scene) return <Note>This scene was merged into another one, so it has no settings of its own.</Note>;
  const entries = entriesFor(`direction.scenes[${item.filmIndex}]`, fields.scene, scene as unknown as Record<string, unknown>, ["cast", "start"]);
  return <FieldsForm groups={[{ entries }]} busy={busy} onSave={onSave} />;
}

function HitForm({ film, fields, item, busy, onSave }: { film: Film; fields: EditorFields; item: TrackItem; busy: boolean; onSave: SaveEdits }) {
  const hit = item.filmIndex !== undefined ? film.sound.hits[item.filmIndex] : undefined;
  if (!hit) return <Note>This sound is not in the sound plan any more.</Note>;
  const base = `sound.hits[${item.filmIndex}]`;
  const entries: Entry[] = [
    { path: `${base}.sound`, label: "Sound", info: { kind: "enum", options: fields.sound.sounds }, value: hit.sound },
    { path: `${base}.at`, label: "When", info: { kind: "enum", options: ["start", "end"] }, value: hit.at },
  ];
  return <FieldsForm groups={[{ entries }]} busy={busy} onSave={onSave} />;
}

function MusicForm({ film, fields, item, busy, onSave }: { film: Film; fields: EditorFields; item: TrackItem; busy: boolean; onSave: SaveEdits }) {
  const cue = item.filmIndex !== undefined ? film.sound.music[item.filmIndex] : undefined;
  const path = cue ? `sound.music[${item.filmIndex}].mood` : "sound.music[new].mood";
  const entries: Entry[] = [{ path, label: "Mood", info: { kind: "enum", options: fields.sound.moods }, value: cue?.mood ?? film.story.mood }];
  if (cue) return <FieldsForm groups={[{ entries }]} busy={busy} onSave={onSave} />;
  const start = film.story.beats[0]?.id;
  return (
    <FieldsForm
      groups={[{ entries }]}
      busy={busy}
      onSave={onSave}
      toEdits={(values) => [{ op: "insert", path: "sound.music", value: { start, mood: values[path] } }]}
    />
  );
}

function HookForm({ film, busy, onSave, onSaveSpec, spec }: { film: Film; busy: boolean; onSave: SaveEdits; onSaveSpec?: SaveEditsSpec; spec?: ShotSpec }) {
  const entries: Entry[] = [{ path: "story.hook", label: "Opening question", info: { kind: "text" }, value: film.story.hook, long: true }];
  return <FieldsForm groups={[{ entries }]} busy={busy} onSave={onSave} onSaveSpec={onSaveSpec} spec={spec} />;
}

function Note({ children }: { children: ReactNode }) {
  return <div className="rounded-xl bg-input/50 px-3 py-2 text-sm text-muted-foreground">{children}</div>;
}

const TITLES: Record<TrackItem["kind"], string> = {
  hook: "Opening",
  beat: "Beat",
  shot: "Shot",
  caption: "Caption",
  voice: "Voice line",
  music: "Music",
  hit: "Sound",
  sfx: "Sound",
  scene: "Scene",
};

export function Inspector({
  item,
  film,
  spec,
  fields,
  version,
  busy,
  onSave,
  onSaveSpec,
}: {
  item: TrackItem | undefined;
  film: Film;
  spec: ShotSpec;
  fields: EditorFields;
  /** Current version number: forms start over from the saved values after every change. */
  version: number;
  busy: boolean;
  onSave: SaveEdits;
  /** Wording saves (narration, dialog, caption) through the approved spec. */
  onSaveSpec?: SaveEditsSpec;
}) {
  const renderBody = () => {
    if (!item) return null;
    const props = { film, fields, busy, onSave, onSaveSpec, spec };
    switch (item.kind) {
      case "hook":
        return <HookForm film={film} busy={busy} onSave={onSave} onSaveSpec={onSaveSpec} spec={spec} />;
      case "beat":
        return <BeatForm {...props} beatId={item.beat!} />;
      case "caption":
      case "voice":
        if (item.beat === "hook") {
          return (
            <div className="space-y-3">
              <Note>{item.kind === "caption" ? "The opening question rides the Hook card." : "This is the opening question, read aloud."} Change the words below; the narrator speaks them again.</Note>
              <HookForm film={film} busy={busy} onSave={onSave} onSaveSpec={onSaveSpec} spec={spec} />
            </div>
          );
        }
        if (item.beat && item.beat !== "hook") {
          return (
            <div className="space-y-3">
              <Note>
                {item.kind === "caption"
                  ? "What this caption shows, and what is spoken in this moment."
                  : "One spoken line. Change the words it says below."}
              </Note>
              {item.kind === "caption" ? <CaptionScreenForm spec={spec} item={item} busy={busy} onSaveSpec={onSaveSpec} /> : null}
              <BeatForm {...props} beatId={item.beat} line={item.kind === "voice" ? item.line : undefined} />
            </div>
          );
        }
        return null;
      case "shot":
        return <ShotForm {...props} spec={spec} item={item} />;
      case "scene":
        return <SceneForm {...props} item={item} />;
      case "hit":
        return <HitForm {...props} item={item} />;
      case "music":
        return <MusicForm {...props} item={item} />;
      case "sfx":
        return <Note>This sound plays with the {item.detail ?? "event"}. It moves with its beat.</Note>;
    }
  };

  return (
    <div className="rounded-2xl bg-card p-4 shadow-xl shadow-black/20">
      {item ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="text-base font-extrabold">{TITLES[item.kind]}</div>
            {item.beat && item.beat !== "hook" ? <Badge variant="violet">{item.beat}</Badge> : null}
            <span className="ml-auto text-xs font-semibold tabular-nums text-muted-foreground">
              {formatTime(item.from)} to {formatTime(item.to)}
            </span>
          </div>
          <div key={`${item.id}:${version}`}>{renderBody()}</div>
        </>
      ) : (
        <div className="flex items-center gap-3 py-2 text-sm text-muted-foreground">
          <MousePointerClick className="h-5 w-5 shrink-0 text-primary" />
          Click anything on the timeline to change it.
        </div>
      )}
    </div>
  );
}
