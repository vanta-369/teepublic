"use client";

import { AppShell } from "@/components/app-shell";
import { Dashboard } from "@/components/dashboard";

/**
 * Self-contained earnings/sales analytics dashboard — page chrome included.
 *
 * Drop this on a blank route. Inside this app, `/dashboard/analytics` renders
 * `<Dashboard />` on its own instead, because `app/dashboard/layout.tsx`
 * already supplies the shell (using both would render two sidebars).
 */
export function EfferdDashboard2() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}

export default EfferdDashboard2;
