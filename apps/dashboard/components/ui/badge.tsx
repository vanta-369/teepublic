import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// shadcn/ui Badge on this project's tokens. The variants mirror the `.chip-*`
// classes in globals.css so a Badge and a chip read identically side by side.
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition",
  {
    variants: {
      variant: {
        default: "bg-accent-500/10 text-accent-600 dark:text-accent-400 border-accent-500/40",
        secondary: "bg-ink-800 text-zinc-600 dark:text-zinc-300 border-ink-700",
        success: "bg-success-500/10 text-success-600 dark:text-success-500 border-success-500/40",
        warn: "bg-warn-500/10 text-warn-600 dark:text-warn-500 border-warn-500/40",
        destructive: "bg-danger-500/10 text-danger-600 dark:text-danger-500 border-danger-500/40",
        outline: "border-ink-700 text-zinc-700 dark:text-zinc-300",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
