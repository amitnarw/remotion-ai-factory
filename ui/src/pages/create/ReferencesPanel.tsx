import * as React from "react";
import { useState, useEffect, useRef } from "react";
import { FileAudio, Plus, Loader2, Play, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";

import { toast } from "sonner";
import * as api from "../../api";

export function ReferencesPanel() {
  const [refs, setRefs] = useState<api.VoiceReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [form, setForm] = useState({ label: "", archetype: "narrator", audioBase64: "", fileName: "", transcript: "", license: "CC0", consent: false });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const reload = React.useCallback(async () => {
    setLoading(true);
    try { setRefs(await api.listVoiceReferences()); } catch { setRefs([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    const fr = new FileReader();
    fr.onload = () => { const b64 = (fr.result as string).split(",")[1] ?? ""; setForm((p) => ({ ...p, audioBase64: b64, fileName: f.name })); };
    fr.readAsDataURL(f);
  }

  async function submit() {
    if (!form.label || !form.audioBase64 || !form.transcript || !form.consent) {
      toast.error("Label, an audio clip, a transcript and consent are required.");
      return;
    }
    setUploading(true);
    try {
      await api.uploadVoiceReference({ label: form.label, archetype: form.archetype, audioBase64: form.audioBase64, transcript: form.transcript, license: form.license, consent: true });
      toast.success("Voice added.");
      setForm({ label: "", archetype: "narrator", audioBase64: "", fileName: "", transcript: "", license: "CC0", consent: false });
      setOpen(false);
      await reload();
    } catch (e) { toast.error("Upload failed", { description: e instanceof Error ? e.message : String(e) }); }
    finally { setUploading(false); }
  }

  async function audition(id: string) {
    setPlaying(id); setBusy(true);
    try {
      const blob = await api.auditionVoiceReference(id, { engine: "voxcpm2" });
      const url = URL.createObjectURL(blob);
      if (audioRef.current) audioRef.current.pause();
      const a = new Audio(url); audioRef.current = a;
      a.onended = () => { setPlaying(null); URL.revokeObjectURL(url); };
      await a.play();
    } catch (e) { toast.error("Audition failed", { description: e instanceof Error ? e.message : String(e) }); setPlaying(null); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    try { await api.deleteVoiceReference(id); toast.success("Removed."); await reload(); }
    catch (e) { toast.error("Remove failed", { description: e instanceof Error ? e.message : String(e) }); }
  }

  return (
    <Card className="mt-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold tracking-tight">Your recorded voices (premium)</h3>
          <p className="mt-1 text-xs text-muted-foreground">Upload a clean 3-20 second clip with its exact transcript. VoxCPM2 clones it; generation stays offline. Consent is recorded with the clip.</p>
        </div>
        <Button size="sm" variant="soft" onClick={() => setOpen((o) => !o)}>
          <Plus className="h-3.5 w-3.5" /> Add voice
        </Button>
      </div>

      {open ? (
        <div className="mt-4 grid gap-3 rounded-xl bg-input/40 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="Voice name" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            <select className="h-10 rounded-xl border border-border bg-card px-3 text-sm" value={form.archetype} onChange={(e) => setForm({ ...form, archetype: e.target.value })}>
              <option value="narrator">Narrator</option>
              <option value="hero">Hero</option>
              <option value="villain">Villain</option>
              <option value="elder">Elder</option>
              <option value="child">Child (adult performer)</option>
            </select>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input type="file" accept="audio/*" onChange={onFile} />
            <Input placeholder="License (CC0, self-recorded, ...)" value={form.license} onChange={(e) => setForm({ ...form, license: e.target.value })} />
          </div>
          {form.fileName ? <div className="text-xs text-muted-foreground">Selected: {form.fileName}</div> : null}
          <textarea rows={3} className="w-full resize-none rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none ring-primary placeholder:text-muted-foreground/60 focus:ring-2" placeholder="Exact transcript of the clip (must match spoken audio)" value={form.transcript} onChange={(e) => setForm({ ...form, transcript: e.target.value })} />
          <div className="flex items-start gap-2">
            <input id="consent" type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} />
            <label htmlFor="consent" className="text-xs leading-relaxed text-muted-foreground">
              I affirm I have the right to use this voice: original performance, licensed sample, or written consent from the speaker. I will not upload a real, named narrator's voice without rights.
            </label>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => void submit()} disabled={uploading}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save voice
            </Button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="mt-3 text-sm text-muted-foreground">Loading your voices...</div>
      ) : refs.length === 0 ? (
        <div className="mt-3 rounded-xl bg-input/40 p-3 text-sm text-muted-foreground">No recorded voices yet. Use "Add voice" to build one. Until then, only the base narrator voices will appear above.</div>
      ) : (
        <ul className="mt-3 grid gap-2">
          {refs.map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded-xl border border-border bg-input/30 px-2 py-1.5">
              <FileAudio className="h-4 w-4 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{r.label}</div>
                <div className="text-xs text-muted-foreground">{r.archetype} Â· {r.duration.toFixed(1)}s Â· {r.license}</div>
              </div>
              <Button type="button" variant="secondary" size="icon" onClick={() => void audition(r.id)} disabled={busy}>
                {playing === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              </Button>
              <Button type="button" variant="secondary" size="icon" onClick={() => void remove(r.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

