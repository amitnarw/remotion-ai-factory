/**
 * Assets: where the factory's models, sounds and music come from, and what
 * it has acquired (src/generator/library/acquire, GET /api/assets).
 *
 *   ?tab=assets
 *
 * Three parts:
 *   Sources          each source's state (works, an index, by link, needs a
 *                    key, off) and why
 *   Build requests   what only new code can make, most asked first
 *                    (build-requests/; nothing is built automatically)
 *   Acquired         every item intake took in (acquired.catalog.json): its
 *                    licence and tier, its source page, the need it was got
 *                    for, and whether its files are on this computer
 *
 * The page only reads. Items are got from a run's shopping list (gate 2) or
 * with `npx tsx scripts/acquire.ts`; nothing plays here.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Boxes, ExternalLink, Hammer, HardDrive, Package, RefreshCw } from "lucide-react";
import { getAssets, type AssetsResponse, type SourceStatus } from "../../api";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { EmptyState, ErrorBanner, LoadingState, PageHeader } from "../../components/shared";
import { formatDate } from "../../lib/format";
import { useJobs } from "../../lib/jobs";

const STATE_LABELS: Record<SourceStatus["state"], { label: string; variant: "success" | "violet" | "muted" | "amber" | "secondary" }> = {
  works: { label: "Works", variant: "success" },
  index: { label: "From its index", variant: "violet" },
  link: { label: "By link", variant: "secondary" },
  disabled: { label: "Needs a key", variant: "amber" },
  off: { label: "Off", variant: "muted" },
};

const TYPE_LABELS: Record<string, string> = { model: "models", sound: "sounds", ambience: "backgrounds", music: "music" };

const STATUS_LABELS: Record<string, string> = { open: "Open", accepted: "Accepted", building: "Being built", done: "Done", declined: "Declined" };

function Section({ title, hint, icon, children }: { title: string; hint?: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold [&_svg]:size-5 [&_svg]:text-primary">
          {icon}
          {title}
        </h2>
        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

export default function Assets() {
  const jobs = useJobs();
  const [data, setData] = useState<AssetsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    getAssets()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  // Reload when a job finishes: a shopping list may have taken something in.
  useEffect(() => {
    void load();
  }, [jobs.finished]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Assets"
        hintId="assets"
        icon={<Boxes />}
        description="Where models, sounds and music come from, what only new code can make, and everything downloaded so far. Things are got from a video's shopping list."
      >
        <Button variant="secondary" size="sm" onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </PageHeader>

      {error ? <ErrorBanner error={error} /> : null}
      {!data && !error ? <LoadingState title="Reading the library..." /> : null}

      {data ? (
        <>
          <Section title="Sources" icon={<Package />} hint="Searched only when a shopping list needs something. Nothing is downloaded without your approval.">
            <div className="grid gap-2 sm:grid-cols-2">
              {data.sources.map((s) => (
                <Card key={s.id} className="space-y-1.5 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{s.name}</span>
                    <Badge variant={STATE_LABELS[s.state].variant}>{STATE_LABELS[s.state].label}</Badge>
                    {s.default ? <Badge variant="muted">Searched by default</Badge> : null}
                  </div>
                  <p className="text-sm text-muted-foreground">{s.types.map((t) => TYPE_LABELS[t] ?? t).join(", ")}</p>
                  {s.why ? <p className="text-sm text-muted-foreground">{s.why}</p> : null}
                </Card>
              ))}
            </div>
          </Section>

          <Section
            title="Build requests"
            icon={<Hammer />}
            hint="What a story needed that only new code can make, most asked first. Nothing is built automatically; meanwhile each run uses its stand-in."
          >
            {data.requests.length ? (
              <ol className="space-y-2">
                {data.requests.map((r) => (
                  <li key={r.id}>
                    <Card className="space-y-1.5 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{r.title}</span>
                        <Badge variant={r.status === "open" ? "violet" : "muted"}>{STATUS_LABELS[r.status] ?? r.status}</Badge>
                        <Badge variant="muted">
                          Asked {r.count} {r.count === 1 ? "time" : "times"}
                        </Badge>
                        <span className="ml-auto text-xs text-muted-foreground">{r.id}</span>
                      </div>
                      <p className="text-[15px]">{r.what}</p>
                      {r.why ? <p className="text-sm text-muted-foreground">Why: {r.why}</p> : null}
                      {r.fallback ? <p className="text-sm text-muted-foreground">Meanwhile: {r.fallback}</p> : null}
                      {r.asks.length ? (
                        <p className="text-sm text-muted-foreground">
                          Asked by {r.asks.slice(0, 4).map((a) => `${a.run} (${a.need})`).join(", ")}
                          {r.asks.length > 4 ? ` and ${r.asks.length - 4} more` : ""}
                        </p>
                      ) : null}
                    </Card>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState icon={<Hammer />} title="No build requests" body="When a story needs something only new code can make, choose Ask for it on its shopping list." />
            )}
            {data.unreadable.length ? <p className="text-sm text-muted-foreground">Unreadable: {data.unreadable.join("; ")}</p> : null}
          </Section>

          <Section title="Acquired" icon={<HardDrive />} hint="Every item downloaded so far, with the licence read from the item itself.">
            {data.acquired.length ? (
              <ol className="space-y-2">
                {data.acquired.map((a) => (
                  <li key={a.id}>
                    <Card className="space-y-1.5 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{a.title}</span>
                        <Badge variant="violet">{a.kind === "model" ? "Model" : "Sound"}</Badge>
                        <Badge variant={a.tier === "free" ? "success" : "amber"}>{a.licence}</Badge>
                        {a.held ? <Badge variant="destructive">Held back</Badge> : null}
                        {!a.onDisk ? <Badge variant="muted">Not on this computer</Badge> : null}
                        <a
                          href={a.page}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
                          aria-label={`Open the page of ${a.title}`}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {a.id}, from {a.ref}
                        {a.author ? `, by ${a.author}` : ""}
                        {a.fetchedAt ? `, ${formatDate(a.fetchedAt)}` : ""}
                      </p>
                      {a.credit ? <p className="text-sm">Credit: {a.credit}</p> : null}
                      {a.need ? (
                        <p className="text-sm text-muted-foreground">
                          Got for "{a.need.what}"{a.need.run ? ` in ${a.need.run}` : ""}
                        </p>
                      ) : null}
                      {a.held ? <p className="text-sm text-muted-foreground">{a.held}</p> : null}
                      {!a.onDisk ? <p className="text-sm text-muted-foreground">Fetch it again: npx tsx scripts/acquire.ts sync</p> : null}
                    </Card>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState icon={<Package />} title="Nothing acquired yet" body="Models, sounds and music you approve on a shopping list are listed here, with their licences." />
            )}
          </Section>
        </>
      ) : null}
    </div>
  );
}
