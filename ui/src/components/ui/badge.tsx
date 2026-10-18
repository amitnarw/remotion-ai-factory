import * as React from "react";
import { cn } from "../../lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/20 text-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-muted-foreground",
        amber: "border-transparent bg-accent/20 text-accent",
        success: "border-transparent bg-emerald-500/15 text-emerald-300",
        destructive: "border-transparent bg-destructive/20 text-destructive",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

const Badge = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>
>(({ className, variant, ...props }, ref) => (
  <div ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
));
Badge.displayName = "Badge";

export { Badge, badgeVariants };
