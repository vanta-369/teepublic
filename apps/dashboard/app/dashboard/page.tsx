import type { Metadata } from "next";
import Link from "next/link";
import { DashHeader } from "@/components/dashboard/DashBits";
import { UploadStats } from "@/components/dashboard/UploadStats";
import { ProjectsPanel } from "@/components/dashboard/ProjectsPanel";
import { UploadHistoryPanel } from "@/components/dashboard/UploadHistoryPanel";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardHome() {
  return (
    <>
      <DashHeader title="Dashboard" subtitle="Your workspace at a glance.">
        <Link href="/dashboard/create" className="btn-primary">Create Product</Link>
      </DashHeader>

      {/* Upload activity. Client component: one figure comes from the account's
          aggregate counter in Supabase, the other from the design library in
          this browser's IndexedDB - and only the browser can read that. */}
      <UploadStats />

      {/* Per-project counts (one project per TeePublic account). */}
      <ProjectsPanel />
      <UploadHistoryPanel />
    </>
  );
}
