/**
 * InfoTip, a small help button next to a control. Its text comes from
 * lib/help.ts, the same entries the Help screen lists.
 */
import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { helpById } from "../lib/help";
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
            "grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <CircleHelp className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <div className="font-semibold">{entry.title}</div>
        <div className="mt-0.5">{entry.body}</div>
      </TooltipContent>
    </Tooltip>
  );
}
