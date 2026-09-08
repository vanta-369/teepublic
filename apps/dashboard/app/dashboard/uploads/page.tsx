import type { Metadata } from "next";
import Link from "next/link";
import { DashHeader, Card } from "@/components/dashboard/DashBits";
import { UploadStagePanel } from "@/components/dashboard/UploadStagePanel";

export const metadata: Metadata = { title: "Uploads" };

export default function UploadsPage() {
  return (
    <>
      <DashHeader title="Uploads" subtitle="Send products to the extension and publish them.">
        <Link href="/dashboard/create" className="btn-primary">Create &amp; Send</Link>
      </DashHeader>

      <Card className="mb-6">
        <div className="flex items-start gap-3">
          <span className="chip-info">Runs in the extension</span>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Uploading happens in your browser through the Higgstee extension. Stage the designs
            below, then send them — progress shows in the extension&apos;s side panel.
          </p>
        </div>
      </Card>

      <UploadStagePanel />
    </>
  );
}
