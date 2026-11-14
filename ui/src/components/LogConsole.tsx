/**
 * LogConsole: a foldable, scrollable technical log.
 *
 * Used on the render screen and the Activity page. Accepts an array of log
 * strings and renders the last 200 lines (configurable via maxLines) in a
 * monospace block. Auto-scrolls when open and new lines arrive.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Terminal } from "lucide-react";
import { Card } from "./ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { cn } from "../lib/utils";

interface LogConsoleProps {
  logs: string[];
  title?: string;
  maxLines?: number;
  openDefault?: boolean;
}

export function LogConsole({
  logs,
  title = "Technical log",
  maxLines = 200,
  openDefault = false,
}: LogConsoleProps) {
  const [open, setOpen] = useState(openDefault);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lines = logs.join("").split(/\r?\n/).filter((l) => l.trim()).slice(-maxLines);
  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [open, lines.length]);
  if (!lines.length) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="overflow-hidden">
        <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1">{open ? `Hide ${title}` : `Show ${title}`}</span>
          <span className="text-xs font-medium text-muted-foreground">{lines.length} {lines.length === 1 ? "line" : "lines"}</span>
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div ref={scrollRef} className="max-h-72 overflow-y-auto bg-black/50 p-4 font-mono text-[11px] leading-relaxed">
            {lines.map((l, i) => (
              <div key={i} className="whitespace-pre-wrap break-words text-foreground/80">
                {l}
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
