/**
 * Gate 2, the shopping list: the plan stopped after the library match because
 * the story needs things the library does not have. Each need is a card with
 * its words, its beats, what stands in for it meanwhile, and the offers the
 * sources have (licence, size, source, a link to the item's page). Nothing is
 * downloaded until you choose:
 *
 *   Get one             that offer is downloaded, its licence read again, and taken in
 *   Use the stand-in    the plan keeps what the library has (close)
 *   Ask for it          a build request is filed (build-requests/)
 *   Leave it out        skip
 *
 * Under the offers, "More offers" asks the sources again for that need alone
 * (up to 20 from each), and a pasted link to an item's page is read as an
 * offer (its source's public record; nothing is downloaded).
 *
 * "Approve every CC0 pick" approves the best free offer of every need you did
 * not change, in one click. Either button starts a plan job that resumes the
 * run: the downloads, then the director, the sound and the rest.
 */
import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, BadgeCheck, Check, ExternalLink, Hammer, Link2, ListPlus, Loader2, Package, ShoppingBasket, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { moreOffers, offerFromLink, resumeRun, type ShopOffer, type ShoppingList, type ShoppingNeed } from "../../api";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { ErrorBanner, SegmentedControl } from "../../components/shared";
import { InfoTip } from "../../components/InfoTip";
import { formatSeconds } from "../../lib/format";
import { navigate } from "../../lib/navigation";
import { refreshJobs } from "../../lib/jobs";
import { cn } from "../../lib/utils";

type Action = "get" | "close" | "build" | "skip";

interface Choice {
  action: Action;
  /** The offer, when the action is get (a pasted link's offer: the link itself). */
  ref?: string;
  /** You changed it (the CC0 button leaves these alone). */
  touched: boolean;
}

const KIND_LABELS: Record<string, string> = {
  set: "A place",
  character: "A character",
  prop: "A prop",
  vehicle: "A vehicle",
  animal: "An animal",
  action: "An action",
  effect: "An effect",
  sound: "A sound",
  ambience: "A background sound",
  music: "Music",
  camera: "A camera move",
  graphic: "A graphic",
};

/** Nothing downloads by default: the stand-in when there is one, else left out. */
function startChoice(n: ShoppingNeed): Choice {
  return { action: n.use ? "close" : "skip", touched: false };
}

/** The choice as the CLI writes it ("n6=bigsoundbank:1048", "n2=close"). */
function approval(need: string, c: Choice): string {
  return `${need}=${c.action === "get" ? c.ref : c.action}`;
}

function sizeOf(o: ShopOffer): string | null {
  const parts: string[] = [];
  if (o.size) parts.push(o.size >= 1024 * 1024 ? `${(o.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(o.size / 1024))} KB`);
  if (o.durSec) parts.push(formatSeconds(o.durSec) || "under a second");
  return parts.length ? parts.join(", ") : null;
}

function LicenceBadge({ offer }: { offer: ShopOffer }) {
  if (offer.tier === "free") return <Badge variant="success">{offer.licence || "CC0"}</Badge>;
  if (offer.tier === "credit") return <Badge variant="amber">{offer.licence || "CC-BY"}, credited</Badge>;
  if (offer.tier === "never") return <Badge variant="destructive">Not allowed: {offer.licence}</Badge>;
  return <Badge variant="muted">{offer.licence ? `${offer.licence}, read at download` : "Licence read at download"}</Badge>;
}

function OfferRow({ offer, source, selected, onSelect }: { offer: ShopOffer; source: string; selected: boolean; onSelect: () => void }) {
  const blocked = offer.tier === "never";
  const size = sizeOf(offer);
  return (
    <div className={cn("flex items-start gap-3 rounded-xl p-3", selected ? "bg-primary/20 ring-2 ring-primary" : "bg-input/50")}>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={blocked}
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-start gap-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span
          className={cn(
            "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full",
            selected ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
          )}
        >
          {selected ? <Check className="h-3.5 w-3.5" /> : null}
        </span>
        {offer.type === "model" && offer.preview && /^https:\/\//.test(offer.preview) ? (
          <img src={offer.preview} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-14 w-14 shrink-0 rounded-lg bg-secondary object-cover" />
        ) : null}
        <span className="min-w-0 space-y-1">
          <span className="block font-semibold leading-snug">{offer.title}</span>
          <span className="block text-sm text-muted-foreground">
            {source}
            {offer.author ? `, by ${offer.author}` : ""}
            {size ? ` · ${size}` : ""}
            {offer.pack ? " · a pack: the best match inside is taken" : ""}
          </span>
          <span className="flex flex-wrap gap-1.5">
            <LicenceBadge offer={offer} />
            <Badge variant="muted">{offer.ref}</Badge>
          </span>
        </span>
      </button>
      <a
        href={offer.page}
        target="_blank"
        rel="noreferrer noopener"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
        aria-label={`Open the page of ${offer.title}`}
        title="Open its page (look or listen there)"
      >
        <ExternalLink className="h-4 w-4" />
      </a>
    </div>
  );
}

function NeedCard({
  runId,
  need,
  choice,
  sources,
  onChoice,
  onNeed,
}: {
  runId: string;
  need: ShoppingNeed;
  choice: Choice;
  sources: Map<string, string>;
  onChoice: (c: Choice) => void;
  /** The need with more offers, or a pasted link's offer added. */
  onNeed: (n: ShoppingNeed) => void;
}) {
  const [busy, setBusy] = useState<"more" | "link" | null>(null);
  const [link, setLink] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const usable = need.offers.filter((o) => o.tier !== "never");
  const isLink = (ref: string) => ref.startsWith("https://");
  const more = async () => {
    setBusy("more");
    setProblem(null);
    try {
      const got = await moreOffers(runId, need.need);
      const added = got.need.offers.filter((o) => !need.offers.some((x) => x.ref === o.ref)).length;
      onNeed({ ...need, offers: [...need.offers.filter((o) => isLink(o.ref)), ...got.need.offers], notes: got.need.notes });
      if (!added) setProblem("The sources have nothing more for it.");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const readLink = async () => {
    const url = link.trim();
    setBusy("link");
    setProblem(null);
    try {
      const { offer } = await offerFromLink(runId, need.need, url);
      // Approved as "nN=<link>": the link is what the plan downloads from.
      onNeed({ ...need, offers: [{ ...offer, ref: url }, ...need.offers.filter((o) => o.ref !== url)] });
      if (offer.tier !== "never") onChoice({ action: "get", ref: url, touched: true });
      setLink("");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const options: Array<{ value: Action; label: string; icon: ReactNode }> = [
    ...(usable.length ? [{ value: "get" as const, label: "Get one", icon: <Package /> }] : []),
    ...(need.use ? [{ value: "close" as const, label: "Use the stand-in", icon: <BadgeCheck /> }] : []),
    { value: "build", label: "Ask for it", icon: <Hammer /> },
    { value: "skip", label: "Leave it out", icon: <SkipForward /> },
  ];
  const pick = (action: Action) => onChoice({ action, ref: action === "get" ? choice.ref ?? (usable.find((o) => o.tier === "free") ?? usable[0])?.ref : undefined, touched: true });
  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="violet">{KIND_LABELS[need.kind] ?? need.kind}</Badge>
          {need.must ? <Badge variant="amber">The story needs it</Badge> : null}
          {need.status === "download" ? <Badge variant="muted">Nothing in stock</Badge> : <Badge variant="muted">A download would fit better</Badge>}
          <span className="ml-auto text-xs font-bold tabular-nums text-muted-foreground">{need.need}</span>
        </div>
        <h3 className="text-lg font-semibold leading-snug">{need.what}</h3>
        <p className="text-sm text-muted-foreground">
          {need.beats.length ? `In beat${need.beats.length === 1 ? "" : "s"} ${need.beats.map((b) => b.replace(/^b/, "")).join(", ")}. ` : ""}
          {need.useName ? `Meanwhile the plan uses ${need.useName}.` : "Nothing stands in for it yet."}
        </p>
      </div>

      <SegmentedControl<Action> label={`What to do about ${need.what}`} size="sm" value={choice.action} onChange={pick} options={options} />

      {choice.action === "get" ? (
        <div role="radiogroup" aria-label="Offers" className="space-y-2">
          {need.offers.map((o) => (
            <OfferRow key={o.ref} offer={o} source={sources.get(o.source) ?? o.source} selected={choice.ref === o.ref} onSelect={() => onChoice({ action: "get", ref: o.ref, touched: true })} />
          ))}
        </div>
      ) : null}
      {choice.action === "get" || !usable.length ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void more()}>
              {busy === "more" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListPlus className="h-4 w-4" />} More offers
            </Button>
            <form
              className="flex min-w-0 flex-1 basis-64 gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (link.trim()) void readLink();
              }}
            >
              <Input className="h-9 min-w-0 flex-1" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Or paste a link to an item's page" aria-label={`A link for ${need.what}`} />
              <Button size="sm" variant="secondary" type="submit" disabled={!!busy || !link.trim()}>
                {busy === "link" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Read it
              </Button>
            </form>
          </div>
          {problem ? <p className="text-sm text-muted-foreground">{problem}</p> : null}
        </div>
      ) : null}
      {choice.action === "build" ? (
        <p className="rounded-xl bg-input/40 p-3 text-sm text-muted-foreground">
          A build request is filed for the developers (the Assets page lists them). {need.useName ? `The plan uses ${need.useName} until it is built.` : ""}
        </p>
      ) : null}
      {!usable.length && need.notes.length ? (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {need.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

export interface ShopGateData {
  runId: string;
  shopping: ShoppingList;
}

export function ShoppingGateView({ data }: { data: ShopGateData }) {
  const { shopping: given } = data;
  // More offers and pasted links change the needs' offers here; the choices are sent as approvals.
  const [needs, setNeeds] = useState<ShoppingNeed[]>(given.needs);
  const shopping = { ...given, needs };
  const [choices, setChoices] = useState<Record<string, Choice>>(() => Object.fromEntries(given.needs.map((n) => [n.need, startChoice(n)])));
  const [sending, setSending] = useState<"choices" | "free" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sources = useMemo(() => new Map(given.sources.map((s) => [s.id as string, s.name])), [given.sources]);
  // The sources the list searched (a list from before they were recorded: every one that works).
  const searched = given.sources.filter((s) => (given.searched ? given.searched.includes(s.id) : s.state === "works" || s.state === "index")).map((s) => s.name);
  const freePicks = shopping.needs.filter((n) => !choices[n.need]?.touched && n.offers.some((o) => o.tier === "free")).length;
  const downloads = Object.values(choices).filter((c) => c.action === "get").length;

  const send = async (allFree: boolean) => {
    setSending(allFree ? "free" : "choices");
    setError(null);
    try {
      // "Every CC0 pick" leaves the needs you did not change to the free picks.
      const named = shopping.needs.filter((n) => !allFree || choices[n.need]?.touched).map((n) => approval(n.need, choices[n.need]));
      const { jobId } = await resumeRun(data.runId, { approvals: named, allFree });
      refreshJobs();
      toast.success(allFree ? "Getting every free pick. Then the AI plans the scenes and the sound" : "Your choices are in. The AI plans the scenes and the sound now");
      navigate({ tab: "create", step: "writing", plan: jobId });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSending(null);
    }
  };

  if (!shopping.waiting) {
    return (
      <Card className="p-5 sm:p-6">
        <h1 className="text-xl font-semibold">These choices were already made</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">The plan went on from this shopping list. Open the plan from your jobs, or start a new one.</p>
        <Button variant="secondary" className="mt-5" onClick={() => navigate({ tab: "create", step: "summary" })}>
          <ArrowLeft className="h-4 w-4" /> Back to your choices
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="violet">
            <ShoppingBasket className="h-3.5 w-3.5" /> Shopping list
          </Badge>
          <Badge variant="muted">
            {shopping.needs.length} {shopping.needs.length === 1 ? "thing" : "things"} to get
          </Badge>
          <InfoTip helpId="shopping-list" className="ml-auto" />
        </div>
        <h1 className="mt-3 text-2xl font-bold leading-snug tracking-tight sm:text-3xl">The story needs things the library does not have</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Nothing is downloaded until you choose. Each licence is read again before anything is added: free (CC0) items, and models that only ask for a credit. Open an offer's page to look at it or listen to it there.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">Searched: {searched.length ? searched.join(", ") : "no source (the plan was asked to search none)"}.</p>
      </Card>

      {shopping.warnings.length ? (
        <Card className="space-y-1 p-4 text-sm text-muted-foreground">
          {shopping.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </Card>
      ) : null}

      {shopping.needs.map((n) => (
        <NeedCard
          key={n.need}
          runId={data.runId}
          need={n}
          choice={choices[n.need]}
          sources={sources}
          onChoice={(c) => setChoices((all) => ({ ...all, [n.need]: c }))}
          onNeed={(next) => setNeeds((all) => all.map((x) => (x.need === next.need ? next : x)))}
        />
      ))}

      {error ? <ErrorBanner error={error} /> : null}

      <div className="sticky bottom-3 z-20">
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-card/95 p-2.5 shadow-2xl shadow-black/50 backdrop-blur-md sm:gap-3 sm:p-3">
          <Button variant="secondary" className="px-4" aria-label="Back to your choices" onClick={() => navigate({ tab: "create", step: "summary" })}>
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Back</span>
          </Button>
          <Button variant="secondary" className="px-4" disabled={!!sending || freePicks === 0} onClick={() => void send(true)} title="Get the best free offer of every need you did not change">
            {sending === "free" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
            Approve every CC0 pick
          </Button>
          <Button variant="amber" className="flex-1 px-4 sm:ml-auto sm:flex-none sm:px-6" disabled={!!sending} onClick={() => void send(false)}>
            {sending === "choices" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
            {downloads ? `Get ${downloads} and plan the rest` : "Plan the rest with what I have"}
          </Button>
        </div>
      </div>
    </div>
  );
}
