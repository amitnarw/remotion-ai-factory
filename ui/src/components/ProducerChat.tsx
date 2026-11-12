/**
 * ProducerChat: the producer you talk to, on one run (P5). Type a note
 * ("make scene 2 at night", "no music in the intro", "use my words: ...");
 * the producer answers and proposes changes, each with its diff. Nothing
 * changes until you press Apply; Undo takes back the last change it made. On
 * a finished plan each change is an editor version; on a story still at its
 * gate it rewrites the story, and notes about the scenes or the sound wait
 * for the director and the sound designer.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, MessagesSquare, Pin, Send, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import {
  applyProposal,
  discardProposal,
  getProducer,
  sayToProducer,
  undoProducer,
  type ProducerConversation,
  type ProducerProposal,
} from "../api";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Textarea } from "./ui/input";
import { cn } from "../lib/utils";

const STATE_LABEL: Record<ProducerProposal["state"], string> = { open: "Waiting for you", applied: "Applied", discarded: "Turned down", undone: "Undone" };

function ProposalCard({ p, busy, onApply, onDiscard }: { p: ProducerProposal; busy: boolean; onApply: () => void; onDiscard: () => void }) {
  return (
    <div className={cn("space-y-2 rounded-xl p-3", p.state === "open" ? "bg-input/60" : "bg-input/25")}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="muted">{p.id}</Badge>
        <Badge variant={p.state === "applied" ? "success" : p.state === "open" ? "violet" : "muted"}>{STATE_LABEL[p.state]}</Badge>
      </div>
      <div className="text-sm font-semibold">{p.summary}</div>
      {p.changes.length ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {p.changes.slice(0, 8).map((c, i) => (
            <li key={i} className="break-words rounded-lg bg-background/40 px-2 py-1 font-mono">
              {c}
            </li>
          ))}
          {p.changes.length > 8 ? <li>and {p.changes.length - 8} more</li> : null}
        </ul>
      ) : null}
      {p.state === "open" ? (
        <div className="flex gap-2">
          <Button size="sm" variant="success" disabled={busy} onClick={onApply}>
            <Check className="h-4 w-4" /> Apply
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={onDiscard}>
            <X className="h-4 w-4" /> Discard
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function ProducerChat({
  runId,
  onChanged,
  busy: outsideBusy = false,
  className,
}: {
  runId: string;
  /** A change was applied or undone: reload what the page shows. */
  onChanged?: () => void;
  /** The page is saving something else: no changes meanwhile. */
  busy?: boolean;
  className?: string;
}) {
  const [conv, setConv] = useState<ProducerConversation | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"say" | "act" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement | null>(null);

  const load = useCallback(() => {
    getProducer(runId)
      .then(setConv)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [runId]);
  useEffect(load, [load]);
  useEffect(() => end.current?.scrollIntoView({ block: "nearest" }), [conv?.turns.length]);

  const send = async () => {
    const note = text.trim();
    if (!note) return;
    setBusy("say");
    setError(null);
    try {
      setConv(await sayToProducer(runId, note));
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const act = async (work: () => Promise<ProducerConversation & { done?: { summary: string[] } }>, changes: boolean, message: string) => {
    setBusy("act");
    setError(null);
    try {
      const next = await work();
      setConv(next);
      if (changes) {
        toast.success(message, { description: next.done?.summary.slice(0, 2).join("; ") });
        onChanged?.();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const byId = new Map((conv?.proposals ?? []).map((p) => [p.id, p]));
  const locked = !!busy || outsideBusy;
  return (
    <div className={cn("space-y-3 rounded-2xl bg-card p-4 shadow-xl shadow-black/20", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <MessagesSquare className="h-4 w-4 text-accent" />
        <div className="text-base font-extrabold">Talk to the producer</div>
        {conv?.canUndo ? (
          <Button size="sm" variant="secondary" className="ml-auto" disabled={locked} onClick={() => void act(() => undoProducer(runId), true, "Undone")}>
            <Undo2 className="h-4 w-4" /> Undo the last change
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {conv?.phase === "story"
          ? "Notes on the story change it here (you read it again before going on); notes on the scenes and the sound wait for the director and the sound designer."
          : "Say what to change: a scene, the sound, a line, the hook. Nothing changes until you press Apply."}
      </p>

      {conv?.turns.length ? (
        <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
          {conv.turns.map((t, i) =>
            t.kind === "user" ? (
              <div key={i} className="ml-6 rounded-xl bg-primary/20 px-3 py-2 text-sm">
                {t.text}
              </div>
            ) : t.kind === "producer" ? (
              <div key={i} className="mr-6 space-y-2">
                {t.reply ? <div className="whitespace-pre-wrap rounded-xl bg-input/40 px-3 py-2 text-sm">{t.reply}</div> : null}
                {t.proposals.map((p) => {
                  const now = byId.get(p.id) ?? { ...p, state: "open" as const, n: t.n };
                  return (
                    <ProposalCard
                      key={p.id}
                      p={now}
                      busy={locked}
                      onApply={() => void act(() => applyProposal(runId, p.id), true, `Applied ${p.id}`)}
                      onDiscard={() => void act(() => discardProposal(runId, p.id), false, "")}
                    />
                  );
                })}
              </div>
            ) : null,
          )}
          <div ref={end} />
        </div>
      ) : null}

      {conv?.standing.length ? (
        <div className="space-y-1 rounded-xl bg-input/30 p-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1 font-semibold">
            <Pin className="h-3.5 w-3.5" /> Kept for this video
          </div>
          {conv.standing.map((s) => (
            <div key={s}>{s}</div>
          ))}
        </div>
      ) : null}

      <Textarea
        className="min-h-16 text-sm"
        placeholder="Make scene 2 at night"
        value={text}
        disabled={locked}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !locked) void send();
        }}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="amber" disabled={locked || !text.trim()} onClick={() => void send()}>
          {busy === "say" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {busy === "say" ? "Thinking..." : "Send"}
        </Button>
        <span className="text-xs text-muted-foreground">Ctrl+Enter sends.</span>
      </div>
      {error ? (
        <div role="alert" className="whitespace-pre-wrap rounded-xl bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground">
          {error}
        </div>
      ) : null}
    </div>
  );
}
