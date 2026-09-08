"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

// shadcn/ui Tooltip, recolored to this project's theme tokens. The default
// shadcn `--popover` / `--border` variables don't exist here, so map them onto
// the `ink`/`zinc` scale. (The `animate-in`/`fade-in-*` utilities need the
// tailwindcss-animate plugin, which isn't installed — they're harmless no-ops
// and the tooltip still shows/hides.)
const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-50 overflow-hidden rounded-md border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 shadow-card",
      className,
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
