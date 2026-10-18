/**
 * InfoTip — per-control "?" tooltip (copy from lib/help.ts), plus the global
 * Help dialog listing every entry with live text search.
 */
import * as React from "react";
import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { helpById, HELP } from "../lib/help";
import { cn } from "../lib/utils";

export function InfoTip({ helpId, className }: { helpId: string; className?: string }) {
  const entry = helpById(helpId);
  if (!entry) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Help: ${entry.title}`}
          className={cn(
            "grid h-6 w-6 shrink-0 place-items-center rounded-full bg-secondary font-bold text-secondary-foreground transition-colors hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <span className="text-xs">?</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <div className="font-semibold">{entry.title}</div>
        <div className="mt-0.5">{entry.body}</div>
      </TooltipContent>
    </Tooltip>
  );
}

export function HelpDialog() {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const groups = ["Generate", "Sound design", "Videos", "Providers"] as const;
  const needle = q.trim().toLowerCase();
  const filtered = HELP.filter(
    (e) => !needle || `${e.title} ${e.body} ${e.group}`.toLowerCase().includes(needle),
  );
  return (
    <>
      <Button variant="secondary" size="icon" onClick={() => setOpen(true)} title="Help & documentation" className="rounded-full">
        <CircleHelp className="h-5 w-5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Help</DialogTitle>
            <DialogDescription>
              Every control's documentation lives in this one dialog (prepended with its section).
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Search help…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <div className="max-h-[50dvh] space-y-5 overflow-y-auto pr-2">
            {groups.map((g) => {
              const entries = filtered.filter((e) => e.group === g);
              if (!entries.length) return null;
              return (
                <div key={g}>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {g}
                  </div>
                  <div className="space-y-3">
                    {entries.map((e) => (
                      <div key={e.id} className="rounded-xl bg-card p-3.5 shadow-lg shadow-black/20">
                        <div className="mb-1 flex items-center gap-2 text-sm font-bold">
                          {e.title}
                          <Badge variant="muted" className="text-[10px]">
                            {e.id}
                          </Badge>
                        </div>
                        <p className="text-xs leading-relaxed font-medium text-muted-foreground">{e.body}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {!filtered.length ? (
              <div className="text-sm text-muted-foreground">No matching help entry.</div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
