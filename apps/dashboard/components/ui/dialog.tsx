"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

// shadcn/ui Dialog, recolored to this project's theme tokens (`ink` surfaces,
// `zinc` text) instead of shadcn's `--background`/`--foreground`, which this
// codebase doesn't define. Same reasoning as `card.tsx`.
//
// The overlay uses `zinc-950` rather than an `ink` step because `ink-0` flips
// to white in light mode — a scrim has to stay dark in both themes.

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      // No `animate-in`/`fade-in-0` here: those come from `tailwindcss-animate`,
      // which this project doesn't load (`plugins: []` in tailwind.config.ts).
      "fixed inset-0 z-50 bg-zinc-950/70 backdrop-blur-sm",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Sized off the viewport and scrolled internally: the sales breakdown
        // carries a table of unknown length, so the panel must never grow past
        // the screen and take the page's scrollbar with it.
        "fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-3xl",
        "-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden",
        "rounded-2xl border border-ink-700 bg-ink-900 shadow-card",
        "focus:outline-none",
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        className={cn(
          "absolute right-4 top-4 rounded-lg p-1.5 text-zinc-500 transition-colors",
          "hover:bg-ink-800 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500",
        )}
      >
        <X className="h-4 w-4" aria-hidden />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "shrink-0 border-b border-ink-700 px-5 py-4 pr-14",
        className,
      )}
      {...props}
    />
  );
}

/** The scrolling middle. Everything long belongs in here, not in the shell. */
function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto p-5", className)} {...props} />;
}

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-base font-semibold leading-none tracking-tight text-zinc-900 dark:text-zinc-100",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-zinc-500 dark:text-zinc-400", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogDescription,
};
