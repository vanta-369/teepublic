import type { Metadata } from "next";
import Link from "next/link";
import { getMyAccess } from "@/lib/access.server";
import { DashHeader, Card } from "@/components/dashboard/DashBits";

export const metadata: Metadata = { title: "Subscription" };

const PLAN_LABEL: Record<string, string> = {
  none: "No plan",
  trial: "Free trial",
  pro_monthly: "Pro (monthly)",
  pro_yearly: "Pro (yearly)",
};

export default async function SubscriptionPage() {
  const access = await getMyAccess();

  const status = access?.status ?? "trialing";
  const plan = access?.plan ?? "none";
  const trialEnd = access?.trial_end ?? null;
  const daysLeft = trialEnd
    ? Math.max(0, Math.ceil((new Date(trialEnd).getTime() - Date.now()) / 86_400_000))
    : null;

  return (
    <>
      <DashHeader title="Subscription" subtitle="Your current plan and access status." />

      <div className="grid gap-4 sm:grid-cols-2 mb-6">
        <Card>
          <p className="label">Current plan</p>
          <p className="mt-2 text-2xl font-bold text-zinc-900 dark:text-zinc-100">{PLAN_LABEL[plan]}</p>
        </Card>
        <Card>
          <p className="label">Status</p>
          <p className="mt-2 text-2xl font-bold text-zinc-900 dark:text-zinc-100 capitalize">
            {status.replace("_", " ")}
          </p>
          {status === "trialing" && daysLeft !== null && (
            <p className="mt-1 text-sm text-warn-600 dark:text-warn-500">{daysLeft} days left in your trial</p>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">Upgrade to Pro</h2>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Higgstee doesn&apos;t have self-serve checkout yet. To upgrade your plan or extend
          access, contact us and we&apos;ll enable Pro on your account.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/contact" className="btn-primary">Contact to upgrade</Link>
          <Link href="/pricing" className="btn-ghost">View pricing</Link>
        </div>
      </Card>
    </>
  );
}
