import { getMyAccess } from "@/lib/access.server";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

// Middleware already guarantees only allowed users reach /dashboard/*; here we
// just resolve the access state (request-memoized) to drive the sidebar chip.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const access = await getMyAccess();
  return (
    <DashboardShell
      access={{
        email: access?.email ?? null,
        plan: access?.plan ?? "none",
        status: access?.status ?? "trialing",
        trialEnd: access?.trial_end ?? null,
        isAdmin: access?.is_admin ?? false,
      }}
    >
      {children}
    </DashboardShell>
  );
}
