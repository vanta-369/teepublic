import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Tiny class-name helper for the shadcn-style UI components. The rest of the app
// imports `clsx` directly; `cn` is the conventional name those components use,
// so keep this thin wrapper rather than rewriting them.
//
// tailwind-merge is here because the shadcn primitives are built around
// `className` overriding a variant's defaults (`<Card className="p-0">` has to
// beat the base `p-6`). Plain clsx keeps both classes and lets source order
// decide, which silently drops the override.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
