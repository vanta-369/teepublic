import type { Metadata } from "next";

import { Dashboard } from "@/components/dashboard";
import { DashHeader } from "@/components/dashboard/DashBits";

export const metadata: Metadata = { title: "Sales & Earnings" };

/**
 * Earnings/sales analytics from a TeePublic export.
 *
 * Renders `<Dashboard />` directly rather than the `EfferdDashboard2` wrapper:
 * `app/dashboard/layout.tsx` already wraps this route in `DashboardShell`, so
 * `AppShell` would add a second sidebar. The wrapper stays available in
 * `components/ui/efferd-dashboard-2.tsx` for standalone use.
 */
export default function AnalyticsPage() {
  return (
    <>
      <DashHeader
        title="Sales & Earnings"
        subtitle="Drop your TeePublic earnings export to see how your designs are performing."
      />
      <Dashboard />
    </>
  );
}
