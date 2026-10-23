/**
 * AskAi: ask the Editor model for a change to the selected beat (or the whole
 * video). The answer is only a proposal: nothing is saved until Apply sends
 * its edits through the normal edit route.
 */
import { useState } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { askFilm, type FilmProposal, type FilmTarget } from "../../api";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Textarea } from "../../components/ui/input";

export function AskAi({
  filmId,
  beat,
  busy,
  onApply,
}: {
  filmId: string;
  /** Beat to work on, or null for the whole video. */
  beat: string | null;
  busy: boolean;
  /** Saves the proposal; resolves to the server's message on failure, null on success. */
  onApply: (proposal: FilmProposal) => Promise<string | null>;
}) {
  const [request, setRequest] = useState("");
  const [asking, setAsking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{ target: FilmTarget; reply: FilmProposal } | null>(null);
  const target: FilmTarget = beat ? { kind: "beat", beat } : { kind: "video" };
  const targetLabel = (t: FilmTarget) => (t.kind === "beat" ? `beat ${t.beat}` : "the whole video");

  const ask = async () => {
    if (!request.trim()) return;
    setAsking(true);
    setError(null);
    setProposal(null);
    try {
      const reply = await askFilm(filmId, target, request.trim());
      setProposal({ target, reply });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAsking(false);
    }
  };

  const apply = async () => {
    if (!proposal) return;
    setApplying(true);
    setError(null);
    const message = await onApply(proposal.reply);
    setApplying(false);
    if (message) setError(message);
    else {
      setProposal(null);
      setRequest("");
    }
  };

  return (
    <div className="space-y-3 rounded-2xl bg-card p-4 shadow-xl shadow-black/20">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent" />
        <div className="text-base font-extrabold">Ask AI</div>
        <Badge variant={beat ? "violet" : "muted"} className="ml-auto">
          About {targetLabel(target)}
        </Badge>
      </div>
      <Textarea
        className="min-h-20 text-sm"
        placeholder={beat ? "Make this beat more dramatic" : "Make the ending calmer"}
        value={request}
        disabled={asking || applying}
        onChange={(e) => setRequest(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !asking) void ask();
        }}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="amber" disabled={asking || applying || busy || !request.trim()} onClick={ask}>
          <Sparkles className={asking ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />
          {asking ? "Thinking..." : "Ask"}
        </Button>
        <span className="text-xs text-muted-foreground">Nothing changes until you press Apply.</span>
      </div>

      {error ? (
        <div role="alert" className="whitespace-pre-wrap rounded-xl bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground">
          {error}
        </div>
      ) : null}

      {proposal ? (
        <div className="space-y-2 rounded-xl bg-input/50 p-3">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Suggested for {targetLabel(proposal.target)}
          </div>
          <div className="text-sm font-semibold">{proposal.reply.summary}</div>
          {proposal.reply.changes.length ? (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {proposal.reply.changes.map((c, i) => (
                <li key={i} className="break-words rounded-lg bg-background/40 px-2 py-1 font-mono">
                  {c}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="success" disabled={applying || busy} onClick={apply}>
              <Check className={applying ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />
              {applying ? "Applying..." : "Apply"}
            </Button>
            <Button size="sm" variant="secondary" disabled={applying} onClick={() => setProposal(null)}>
              <X className="h-4 w-4" /> Discard
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
