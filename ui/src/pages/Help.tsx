/**
 * Help: how making a video works, step by step, and every help entry
 * (lib/help.ts) with a search box.
 */
import { useState } from "react";
import {
  Captions,
  Clapperboard,
  FileText,
  Lightbulb,
  Mic,
  Plus,
  Ratio,
  Search,
  type LucideIcon,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { EmptyState, PageHeader } from "../components/shared";
import { HELP, HELP_GROUPS } from "../lib/help";
import { navigate } from "../lib/navigation";

const FLOW: Array<{ icon: LucideIcon; title: string; body: string }> = [
  { icon: Lightbulb, title: "Your idea", body: "One \"what if\" question." },
  { icon: Ratio, title: "Shape and length", body: "Vertical, landscape or square." },
  { icon: Mic, title: "Voices", body: "A narrator, characters, or none." },
  { icon: Captions, title: "Captions", body: "How the words look." },
  { icon: FileText, title: "The plan", body: "The AI writes it; you check it." },
  { icon: Clapperboard, title: "The video", body: "Made on this computer." },
];

export default function Help() {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const entries = HELP.filter((e) => !needle || `${e.title} ${e.body} ${e.group}`.toLowerCase().includes(needle));

  return (
    <div>
      <PageHeader title="Help" description="How the factory works, and answers to common questions.">
        <Button variant="amber" onClick={() => navigate({ tab: "create", step: "idea" })}>
          <Plus className="h-4 w-4" /> Make a video
        </Button>
      </PageHeader>

      <Card className="p-5 sm:p-6">
        <h2 className="text-lg font-semibold">How a video is made</h2>
        <p className="mt-1 text-[15px] text-muted-foreground">
          Six short steps. Nothing is made until you approve the plan, and everything runs on this computer.
        </p>
        <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FLOW.map((f, i) => {
            const Icon = f.icon;
            return (
              <li key={f.title} className="flex items-start gap-3 rounded-2xl bg-input/40 p-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/20 text-primary">
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Step {i + 1}</div>
                  <div className="font-semibold">{f.title}</div>
                  <div className="text-sm text-muted-foreground">{f.body}</div>
                </div>
              </li>
            );
          })}
        </ol>
      </Card>

      <div className="mt-8">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold">Questions and answers</h2>
          <div className="relative sm:w-80">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search help" aria-label="Search help" className="h-11 pl-11" />
          </div>
        </div>

        {entries.length === 0 ? (
          <EmptyState icon={<Search />} title="Nothing found" body="Try other words." />
        ) : (
          <div className="space-y-8">
            {HELP_GROUPS.map((g) => {
              const list = entries.filter((e) => e.group === g);
              if (!list.length) return null;
              return (
                <section key={g}>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g}</h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    {list.map((e) => (
                      <Card key={e.id} id={`help-${e.id}`} className="p-4 sm:p-5">
                        <div className="font-semibold">{e.title}</div>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{e.body}</p>
                      </Card>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
