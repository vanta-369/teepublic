// Admin dashboard. Access is gated two ways: the middleware blocks non-admins
// from /admin, and the API routes re-check admin status server-side. This page
// just renders the management UI.

import { AdminUsers } from "@/components/AdminUsers";

export const metadata = { title: "Admin · teepublic://uploader" };

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-accent-400">User administration</h2>
        <p className="text-xs text-zinc-400 mt-1">
          <span className="text-accent-700">$</span> approve, trial, grant Pro, suspend/restore, or remove accounts — every action is audited
        </p>
      </div>
      <AdminUsers />
    </div>
  );
}
