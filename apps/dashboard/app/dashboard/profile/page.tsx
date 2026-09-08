import type { Metadata } from "next";
import { getMyAccess } from "@/lib/access.server";
import { getSessionProfile } from "@/lib/auth";
import { DashHeader, Card } from "@/components/dashboard/DashBits";
import { ChangePassword } from "@/components/dashboard/ChangePassword";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const [{ user, profile }, access] = await Promise.all([
    getSessionProfile(),
    getMyAccess(),
  ]);

  const email = access?.email ?? user?.email ?? "—";
  const joined = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "—";
  const role = access?.is_admin ? "Admin" : "Member";
  const status = (access?.status ?? "—").replace("_", " ");

  const rows = [
    { k: "Email", v: email },
    { k: "Member since", v: joined },
    { k: "Role", v: role },
    { k: "Account status", v: status },
  ];

  return (
    <>
      <DashHeader title="Profile" subtitle="Your account details." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-4">Account</h2>
          <dl className="divide-y divide-ink-700">
            {rows.map((r) => (
              <div key={r.k} className="flex items-center justify-between py-2.5">
                <dt className="text-sm text-zinc-500">{r.k}</dt>
                <dd className="text-sm font-medium text-zinc-900 dark:text-zinc-100 capitalize">{r.v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card>
          <h2 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-4">Change password</h2>
          <ChangePassword />
        </Card>
      </div>
    </>
  );
}
