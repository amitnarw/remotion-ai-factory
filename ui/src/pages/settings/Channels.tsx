/**
 * Settings, Channels: each channel's profile (channels/<id>.json), the rules
 * its videos are made by: how the writer writes, the story modes, the music,
 * the look, the devices the director may use and where a plan stops for you.
 *
 *   ?tab=settings&section=channels&channel=<id>
 *
 * Saving checks the profile as a plan would and raises its version when it
 * changed, so every run still records which version it used. A new channel
 * starts as a copy of another. The form covers the everyday fields; "As JSON"
 * edits every field, the formats, voices and captions included.
 *
 * The brand (src/compositions/brand/brand.ts) is the channel's look on screen:
 * its name and logo, colours, fonts, the intro and outro bumpers and a corner
 * watermark. A channel without one makes its videos as before.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Braces, Copy, ListChecks, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { copyChannel, getChannelProfile, getChannels, saveChannelProfile, type ChannelInfo, type ChannelProfileFile } from "../../api";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input, Textarea } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { ErrorBanner, LoadingState, SegmentedControl } from "../../components/shared";
import { setQuery, useQuery } from "../../lib/navigation";
import { cn } from "../../lib/utils";
import { CAPTION_FONTS, FONT_STACKS } from "@/generator/caption-style";
import { BRAND_MARKS, INTRO_SECONDS, OUTRO_SECONDS } from "@/compositions/brand/brand";
import { MARK_PATHS } from "@/compositions/brand/shapes";

type Profile = ChannelProfileFile;
type Obj = Record<string, unknown>;

const DEVICES: Array<{ key: string; label: string }> = [
  { key: "counter", label: "Counter" },
  { key: "react", label: "Counter reactions" },
  { key: "timer", label: "Timer" },
  { key: "heroProp", label: "Hero prop" },
  { key: "bpm", label: "Heartbeat pulse" },
  { key: "worldEvents", label: "World events" },
  { key: "lapse", label: "Time-lapse" },
  { key: "flights", label: "Flights between places" },
  { key: "actors", label: "Featured actors" },
  { key: "bulletTime", label: "Bullet time" },
];

const MODE_LABELS: Record<string, string> = { premise: "From an idea", adapt: "Rewrite my story", "as-written": "Keep my words" };

/** The value at a dotted path of the profile. */
function at(o: Obj, path: string): unknown {
  return path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Obj)[k] : undefined), o);
}

/** A copy of the profile with the value at a dotted path replaced (undefined removes it). */
function withValue(o: Profile, path: string, value: unknown): Profile {
  const next = structuredClone(o) as Obj;
  const keys = path.split(".");
  let node = next;
  for (const k of keys.slice(0, -1)) {
    if (!node[k] || typeof node[k] !== "object") node[k] = {};
    node = node[k] as Obj;
  }
  const last = keys[keys.length - 1];
  if (value === undefined) delete node[last];
  else node[last] = value;
  return next as Profile;
}

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** Lists typed one per line or comma separated: blank items and edge spaces dropped before saving. */
function cleaned(p: Profile): Profile {
  let out = p;
  for (const path of ["writer.rules", "writer.avoid", "writer.tone", "look.grades", "look.times"]) {
    const v = at(out, path);
    if (Array.isArray(v)) out = withValue(out, path, v.map((x) => String(x).trim()).filter(Boolean));
  }
  return out;
}

export default function Channels() {
  const query = useQuery();
  const [list, setList] = useState<ChannelInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    getChannels()
      .then((c) => {
        setList(c);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(load, [load]);
  const selected = query.get("channel") ?? list?.[0]?.id ?? null;

  if (error) return <ErrorBanner error={error} />;
  if (!list) return <LoadingState title="Reading the channels" />;
  return (
    <div className="space-y-5">
      <p className="max-w-2xl text-[15px] text-muted-foreground">
        A channel is one YouTube channel in one genre. Its profile tells the writer, the director and the sound designer how its videos are made. Each
        plan records the version it was made with.
      </p>
      <div className="grid gap-5 xl:grid-cols-[240px_minmax(0,1fr)]">
        <div className="space-y-3">
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            {list.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  aria-current={c.id === selected ? "true" : undefined}
                  onClick={() => setQuery({ channel: c.id })}
                  className={cn(
                    "w-full rounded-xl px-3 py-2.5 text-left transition-colors",
                    c.id === selected ? "bg-primary text-primary-foreground shadow" : "bg-card hover:bg-secondary",
                  )}
                >
                  <span className="block text-sm font-semibold">{c.name}</span>
                  <span className={cn("block text-xs", c.id === selected ? "text-primary-foreground/80" : "text-muted-foreground")}>
                    {c.genre}, version {c.version}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {selected ? <NewChannel from={selected} fromName={list.find((c) => c.id === selected)?.name ?? selected} onMade={load} /> : null}
        </div>
        {selected ? <ChannelEditor key={selected} id={selected} onSaved={load} /> : null}
      </div>
    </div>
  );
}

function NewChannel({ from, fromName, onMade }: { from: string; fromName: string; onMade: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      const made = await copyChannel(from, id, name.trim());
      toast.success(`The ${name.trim()} channel is made`);
      setName("");
      onMade();
      setQuery({ channel: made.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="space-y-2 p-3">
      <div className="text-sm font-semibold">New channel</div>
      <div className="text-xs text-muted-foreground">Starts as a copy of {fromName}.</div>
      <Input value={name} placeholder="Its name, e.g. Cozy mysteries" onChange={(e) => setName(e.target.value)} aria-label="The new channel's name" />
      {id ? <div className="text-xs text-muted-foreground">File: channels/{id}.json</div> : null}
      <Button size="sm" variant="soft" disabled={busy || !id} onClick={make}>
        <Copy className="h-4 w-4" /> Copy it
      </Button>
      {error ? <div className="text-xs text-destructive">{error}</div> : null}
    </Card>
  );
}

function ChannelEditor({ id, onSaved }: { id: string; onSaved: () => void }) {
  const [saved, setSaved] = useState<Profile | null>(null);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [moods, setMoods] = useState<string[]>([]);
  const [modes, setModes] = useState<string[]>([]);
  const [view, setView] = useState<"form" | "json">("form");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    getChannelProfile(id)
      .then((r) => {
        if (!alive) return;
        setSaved(r.profile);
        setDraft(r.profile);
        setMoods(r.moods);
        setModes(r.modes);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [id]);

  if (error && !draft) return <ErrorBanner error={error} />;
  if (!draft || !saved) return <LoadingState title="Reading the profile" />;

  const set = (path: string, value: unknown) => setDraft((d) => (d ? withValue(d, path, value) : d));
  const dirty = JSON.stringify(cleaned(draft)) !== JSON.stringify(saved);
  const switchView = (v: "form" | "json") => {
    if (v === "json") {
      setJsonText(JSON.stringify(cleaned(draft), null, 2));
      setJsonError(null);
    }
    setView(v);
  };
  const editJson = (text: string) => {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text) as Profile;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("the profile must be one JSON object");
      setDraft(parsed);
      setJsonError(null);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : String(e));
    }
  };
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await saveChannelProfile(cleaned(draft));
      setSaved(r.profile);
      setDraft(r.profile);
      if (view === "json") setJsonText(JSON.stringify(r.profile, null, 2));
      toast.success(r.changed ? `Saved as version ${r.version}` : "Nothing changed");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const reset = () => {
    setDraft(saved);
    setJsonText(JSON.stringify(saved, null, 2));
    setJsonError(null);
    setError(null);
  };

  const modeList = asList(at(draft, "writer.modes"));
  const moodValue = at(draft, "music.moods");
  const moodList = moodValue === "all" ? moods : asList(moodValue);
  const shot = Array.isArray(at(draft, "look.shotSeconds")) ? (at(draft, "look.shotSeconds") as number[]) : null;
  const formats = Array.isArray(at(draft, "formats.allowed")) ? (at(draft, "formats.allowed") as Array<{ format: string; min: number; max: number }>) : [];

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="violet">channels/{id}.json</Badge>
        <Badge variant="muted">version {saved.version}</Badge>
        {dirty ? <Badge variant="amber">Not saved</Badge> : null}
        <SegmentedControl
          label="Edit as"
          size="sm"
          value={view}
          onChange={switchView}
          options={[
            { value: "form", label: "Form", icon: <ListChecks /> },
            { value: "json", label: "As JSON", icon: <Braces /> },
          ]}
          className="ml-auto w-auto"
        />
      </div>
      {error ? <ErrorBanner error={error} /> : null}

      {view === "json" ? (
        <Card className="space-y-2 p-4">
          <Textarea className="min-h-[28rem] font-mono text-xs" value={jsonText} onChange={(e) => editJson(e.target.value)} aria-label="The profile as JSON" spellCheck={false} />
          {jsonError ? <div className="text-sm text-destructive">Not valid JSON yet: {jsonError}</div> : null}
        </Card>
      ) : (
        <>
          <Group title="The channel">
            <Field label="Name">
              <Input value={String(draft.name ?? "")} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Genre">
              <Input value={String(at(draft, "genre") ?? "")} onChange={(e) => set("genre", e.target.value)} />
            </Field>
            <Field label="What it makes" wide>
              <Textarea className="min-h-16" value={String(at(draft, "description") ?? "")} onChange={(e) => set("description", e.target.value)} />
            </Field>
          </Group>

          <Group title="The story">
            <Field label="Story modes" wide>
              <div className="flex flex-wrap gap-2">
                {modes.map((m) => (
                  <Chip key={m} on={modeList.includes(m)} onClick={() => set("writer.modes", modeList.includes(m) ? modeList.filter((x) => x !== m) : [...modeList, m])}>
                    {MODE_LABELS[m] ?? m}
                  </Chip>
                ))}
              </div>
            </Field>
            <Field label="A pasted story is">
              <Select value={String(at(draft, "writer.scriptMode") ?? "adapt")} onValueChange={(v) => set("writer.scriptMode", v)}>
                <SelectTrigger className="h-11" aria-label="What a pasted story gets">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="adapt">Rewritten into beats</SelectItem>
                  <SelectItem value="as-written">Kept word for word</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Most characters (0 to 3)">
              <Input
                type="number"
                min={0}
                max={3}
                value={String(at(draft, "writer.maxCharacters") ?? 3)}
                onChange={(e) => set("writer.maxCharacters", e.target.value === "" ? undefined : Number(e.target.value))}
              />
            </Field>
            <Field label="The writer's first line" wide>
              <Textarea className="min-h-16" value={String(at(draft, "writer.intro") ?? "")} onChange={(e) => set("writer.intro", e.target.value)} />
            </Field>
            <Field label="The genre's rules, one per line" wide>
              <Textarea className="min-h-32" value={asList(at(draft, "writer.rules")).join("\n")} onChange={(e) => set("writer.rules", e.target.value.split("\n"))} />
            </Field>
            <Field label="How the narrator speaks">
              <Input value={String(at(draft, "writer.narration") ?? "")} onChange={(e) => set("writer.narration", e.target.value)} />
            </Field>
            <Field label="An example hook">
              <Input value={String(at(draft, "writer.hookExample") ?? "")} onChange={(e) => set("writer.hookExample", e.target.value)} />
            </Field>
            <Field label="Tone, comma separated">
              <Input value={asList(at(draft, "writer.tone")).join(",")} onChange={(e) => set("writer.tone", e.target.value.split(",").map((s) => s.replace(/^\s+/, "")))} />
            </Field>
            <Field label="Avoid, one per line">
              <Textarea className="min-h-16" value={asList(at(draft, "writer.avoid")).join("\n")} onChange={(e) => set("writer.avoid", e.target.value.split("\n"))} />
            </Field>
            <Field label="The critic's first line" wide>
              <Input value={String(at(draft, "critic.intro") ?? "")} onChange={(e) => set("critic.intro", e.target.value)} />
            </Field>
            <Field label="What makes a beat weak in this genre" wide>
              <Textarea className="min-h-16" value={String(at(draft, "critic.watchFor") ?? "")} onChange={(e) => set("critic.watchFor", e.target.value)} />
            </Field>
          </Group>

          <Group title="Music and sound">
            <Field label="Music moods" wide>
              <div className="flex flex-wrap gap-2">
                <Chip on={moodValue === "all"} onClick={() => set("music.moods", moodValue === "all" ? [...moods] : "all")}>
                  Every mood
                </Chip>
                {moodValue !== "all"
                  ? moods.map((m) => (
                      <Chip key={m} on={moodList.includes(m)} onClick={() => set("music.moods", moodList.includes(m) ? moodList.filter((x) => x !== m) : [...moodList, m])}>
                        {m}
                      </Chip>
                    ))
                  : null}
              </div>
            </Field>
            <Field label="A mood it does not use becomes">
              <Select value={String(at(draft, "music.fallback") ?? "")} onValueChange={(v) => set("music.fallback", v)}>
                <SelectTrigger className="h-11" aria-label="The fallback mood">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {moodList.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Toggle label="Ambience beds" on={at(draft, "music.ambience") !== false} onChange={(on) => set("music.ambience", on)} />
          </Group>

          <Group title="The look">
            <Field label="Grades, comma separated">
              <Input value={asList(at(draft, "look.grades")).join(",")} onChange={(e) => set("look.grades", e.target.value.split(",").map((s) => s.replace(/^\s+/, "")))} />
            </Field>
            <Field label="Times of day, comma separated">
              <Input value={asList(at(draft, "look.times")).join(",")} onChange={(e) => set("look.times", e.target.value.split(",").map((s) => s.replace(/^\s+/, "")))} />
            </Field>
            <Field label="Seconds per shot, shortest and longest">
              <div className="flex gap-2">
                {[0, 1].map((i) => (
                  <Input
                    key={i}
                    type="number"
                    min={0.5}
                    step={0.5}
                    aria-label={i === 0 ? "Shortest shot" : "Longest shot"}
                    value={shot ? String(shot[i]) : ""}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      const next: [number, number] = shot ? [shot[0], shot[1]] : [2, 4];
                      next[i] = v;
                      set("look.shotSeconds", e.target.value === "" ? undefined : next);
                    }}
                  />
                ))}
              </div>
            </Field>
            <Field label="Notes for the director">
              <Input value={String(at(draft, "look.notes") ?? "")} onChange={(e) => set("look.notes", e.target.value || undefined)} />
            </Field>
          </Group>

          <Group title="What the director may use">
            {DEVICES.map((d) => (
              <Toggle key={d.key} label={d.label} on={at(draft, `devices.${d.key}`) === true} onChange={(on) => set(`devices.${d.key}`, on)} />
            ))}
          </Group>

          <Group title="Where a plan stops for you">
            <Toggle label="Read the story first" on={at(draft, "gates.story") !== false} onChange={(on) => set("gates.story", on)} />
            <Toggle label="Show me the shopping list" on={at(draft, "gates.shop") !== false} onChange={(on) => set("gates.shop", on)} />
          </Group>

          <BrandGroup id={id} draft={draft} set={set} />

          <Group title="Formats">
            <div className="text-sm text-muted-foreground sm:col-span-2">
              {formats.map((f) => `${f.format}: ${f.min} to ${f.max} s`).join("; ") || "none"}. The formats, voices and captions are edited As JSON.
            </div>
          </Group>
        </>
      )}

      <div className="sticky bottom-0 flex flex-wrap gap-2 rounded-2xl bg-background/90 py-3 backdrop-blur">
        <Button variant="success" disabled={saving || !dirty || !!jsonError} onClick={save}>
          <Save className="h-4 w-4" /> {saving ? "Saving..." : "Save"}
        </Button>
        <Button variant="secondary" disabled={saving || !dirty} onClick={reset}>
          <RotateCcw className="h-4 w-4" /> Undo my changes
        </Button>
      </div>
    </div>
  );
}

const OWN_FONT = "own";
const HEX = /^#[0-9a-fA-F]{6}$/;
const NEW_BRAND = (name: string) => ({
  name: name || "My channel",
  mark: "circle",
  colors: { accent: "#ff6a1a", text: "#ffffff", background: "#0d0f14" },
  fonts: {},
  intro: { seconds: INTRO_SECONDS.default },
  outro: { seconds: OUTRO_SECONDS.default, subscribe: "Subscribe for more" },
  watermark: false,
});

/** The brand: on or off, then its name, logo or mark, colours, fonts, bumpers and watermark, with a small preview. */
function BrandGroup({ id, draft, set }: { id: string; draft: Profile; set: (path: string, value: unknown) => void }) {
  const on = !!at(draft, "brand") && typeof at(draft, "brand") === "object";
  const str = (path: string, fallback = "") => String(at(draft, path) ?? fallback);
  const colour = (key: "accent" | "text" | "background", label: string) => (
    <Field label={label}>
      <div className="flex gap-2">
        <input
          type="color"
          aria-label={`${label}, picker`}
          className="h-11 w-14 shrink-0 cursor-pointer rounded-lg bg-input p-1"
          value={HEX.test(str(`brand.colors.${key}`)) ? str(`brand.colors.${key}`) : "#000000"}
          onChange={(e) => set(`brand.colors.${key}`, e.target.value)}
        />
        <Input value={str(`brand.colors.${key}`)} onChange={(e) => set(`brand.colors.${key}`, e.target.value.trim())} aria-label={label} />
      </div>
    </Field>
  );
  const font = (key: "caption" | "title", label: string) => (
    <Field label={label}>
      <Select value={str(`brand.fonts.${key}`, OWN_FONT)} onValueChange={(v) => set(`brand.fonts.${key}`, v === OWN_FONT ? undefined : v)}>
        <SelectTrigger className="h-11" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={OWN_FONT}>The caption look's own</SelectItem>
          {CAPTION_FONTS.map((f) => (
            <SelectItem key={f} value={f}>
              <span style={{ fontFamily: FONT_STACKS[f] }}>{f}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
  const seconds = (path: string, label: string, range: { min: number; max: number; default: number }) => (
    <Field label={label}>
      <Input
        type="number"
        min={range.min}
        max={range.max}
        step={0.5}
        value={str(`${path}.seconds`, String(range.default))}
        onChange={(e) => set(`${path}.seconds`, e.target.value === "" ? undefined : Number(e.target.value))}
      />
    </Field>
  );
  const bg = HEX.test(str("brand.colors.background")) ? str("brand.colors.background") : "#0d0f14";
  const accent = HEX.test(str("brand.colors.accent")) ? str("brand.colors.accent") : "#ff6a1a";
  const mark = str("brand.mark", "circle") as keyof typeof MARK_PATHS;
  const titleKey = (at(draft, "brand.fonts.title") ?? at(draft, "brand.fonts.caption") ?? "inter") as keyof typeof FONT_STACKS;
  const intro = !!at(draft, "brand.intro");
  const outro = !!at(draft, "brand.outro");

  return (
    <Group title="The brand">
      <div className="sm:col-span-2">
        <Toggle label="Brand this channel's videos" on={on} onChange={(v) => set("brand", v ? NEW_BRAND(String(draft.name ?? "")) : undefined)} />
      </div>
      {!on ? (
        <div className="text-sm text-muted-foreground sm:col-span-2">No brand: no bumpers or watermark, and the captions keep their own look.</div>
      ) : (
        <>
          <div className="flex items-center gap-4 rounded-xl px-4 py-5 sm:col-span-2" style={{ background: bg }} aria-label="Brand preview">
            <svg width={56} height={56} viewBox="0 0 100 100" aria-hidden>
              <path d={MARK_PATHS[mark] ?? MARK_PATHS.circle} fill={accent} />
            </svg>
            <div className="min-w-0">
              <div className="truncate text-2xl font-bold" style={{ fontFamily: FONT_STACKS[titleKey] ?? FONT_STACKS.inter, color: str("brand.colors.text", "#ffffff") }}>
                {str("brand.name") || "My channel"}
              </div>
              <div className="text-xs" style={{ color: accent }}>
                {outro ? str("brand.outro.subscribe", "Subscribe for more") : "No outro"}
              </div>
            </div>
          </div>
          <Field label="Name on screen">
            <Input value={str("brand.name")} onChange={(e) => set("brand.name", e.target.value)} />
          </Field>
          <Field label={`Logo, a file in public/brand/${id}/ (empty: the mark)`}>
            <Input value={str("brand.logo")} placeholder={`brand/${id}/logo.svg`} onChange={(e) => set("brand.logo", e.target.value.trim() || undefined)} />
          </Field>
          <Field label="Mark, when there is no logo">
            <Select value={mark} onValueChange={(v) => set("brand.mark", v)}>
              <SelectTrigger className="h-11" aria-label="The mark">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BRAND_MARKS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Toggle label="Watermark in the corner" on={at(draft, "brand.watermark") === true} onChange={(v) => set("brand.watermark", v)} />
          {colour("accent", "Accent (keywords, the HUD, the mark)")}
          {colour("text", "Text")}
          {colour("background", "Background (the bumpers)")}
          <div className="hidden sm:block" />
          {font("caption", "Caption font")}
          {font("title", "Title font (hook, numbers, bumpers)")}
          <Toggle label={`Intro bumper, ${INTRO_SECONDS.min} to ${INTRO_SECONDS.max} s`} on={intro} onChange={(v) => set("brand.intro", v ? { seconds: INTRO_SECONDS.default } : undefined)} />
          {intro ? seconds("brand.intro", "Intro seconds", INTRO_SECONDS) : <div className="hidden sm:block" />}
          <Toggle
            label={`Outro bumper, ${OUTRO_SECONDS.min} to ${OUTRO_SECONDS.max} s`}
            on={outro}
            onChange={(v) => set("brand.outro", v ? { seconds: OUTRO_SECONDS.default, subscribe: "Subscribe for more" } : undefined)}
          />
          {outro ? seconds("brand.outro", "Outro seconds", OUTRO_SECONDS) : <div className="hidden sm:block" />}
          {outro ? (
            <Field label="The call to subscribe, on screen only (never spoken)" wide>
              <Input value={str("brand.outro.subscribe")} onChange={(e) => set("brand.outro.subscribe", e.target.value)} />
            </Field>
          ) : null}
        </>
      )}
    </Group>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="p-4 sm:p-5">
      <h3 className="mb-3 text-base font-semibold">{title}</h3>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={cn("block space-y-1", wide && "sm:col-span-2")}>
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-input/50 px-3 py-2">
      <span className="text-sm">{label}</span>
      <Switch checked={on} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("rounded-full px-3 py-1 text-sm font-medium transition-colors", on ? "bg-primary text-primary-foreground" : "bg-input text-muted-foreground hover:bg-secondary")}
    >
      {children}
    </button>
  );
}
