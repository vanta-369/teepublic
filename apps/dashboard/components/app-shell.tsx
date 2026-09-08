"use client";

import * as React from "react";

import { DashboardSidebar } from "@/components/dashboard-sidebar";

/**
 * Standalone page chrome (sidebar + content column) for the `EfferdDashboard2`
 * composition — the self-contained export you can drop on a blank route.
 *
 * Inside this app the analytics page renders `<Dashboard />` on its own,
 * because `app/dashboard/layout.tsx` already wraps it in `DashboardShell`.
 * Using `AppShell` there too would render a second sidebar.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ink-950 p-4 lg:p-6">
      <div className="mx-auto flex max-w-[1400px] gap-6">
        <DashboardSidebar />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
