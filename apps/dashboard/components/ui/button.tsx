import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// shadcn/ui Button, recolored to this project's theme tokens (lime `accent`,
// `ink` surfaces, `zinc` text) instead of the default shadcn semantic tokens
// (`--primary`, `--input`, `--background`, …) which this codebase doesn't define.
const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 ring-offset-ink-950",
  {
    variants: {
      variant: {
        default: "bg-accent-500 text-zinc-950 hover:brightness-105 active:brightness-95",
        destructive: "bg-danger-500 text-white hover:bg-danger-600",
        outline:
          "border border-ink-700 bg-ink-900 text-zinc-900 dark:text-zinc-100 hover:bg-ink-800 hover:border-ink-600",
        secondary:
          "bg-ink-800 text-zinc-900 dark:text-zinc-100 border border-ink-700 hover:bg-ink-700",
        ghost: "text-zinc-900 dark:text-zinc-100 hover:bg-ink-800",
        link: "text-accent-600 dark:text-accent-400 underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
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
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
