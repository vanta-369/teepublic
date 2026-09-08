import { cn } from "@/lib/utils";

// shadcn/ui Skeleton on this project's tokens.
//
// Note for chart/table use: per the dashboard's loading rule, a *refetch* holds
// the previous render at reduced opacity rather than swapping in skeletons —
// skeletons are for the FIRST paint only, where there is nothing to hold.
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-ink-800", className)} {...props} />;
}

export { Skeleton };
