import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

/**
 * SOLID buttons only, every variant is a filled block a kid can spot instantly.
 * Big, plush, rounded. No outlines, no ghosts, no transparent buttons.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2.5 whitespace-nowrap rounded-xl font-semibold transition-all active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:brightness-115",
        secondary: "bg-secondary text-secondary-foreground shadow hover:brightness-125",
        amber: "bg-accent text-accent-foreground shadow-lg shadow-accent/25 hover:brightness-110 font-bold",
        success: "bg-success text-success-foreground shadow-lg shadow-success/25 hover:brightness-110",
        destructive: "bg-destructive text-destructive-foreground shadow hover:brightness-115",
        soft: "bg-primary/20 text-primary shadow hover:bg-primary/30",
      },
      size: {
        default: "h-12 px-6 text-[15px]",
        sm: "h-9 rounded-lg px-4 text-sm",
        lg: "h-14 px-8 text-lg",
        xl: "h-16 rounded-2xl px-10 text-xl",
        icon: "h-11 w-11",
        iconSm: "h-8 w-8 rounded-full p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };