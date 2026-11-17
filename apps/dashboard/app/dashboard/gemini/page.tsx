import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GEMINI_BROWSER_JOBS } from "@teepublic/shared";
import { DashHeader } from "@/components/dashboard/DashBits";
import { GeminiAccountsPanel } from "@/components/dashboard/GeminiAccountsPanel";

export const metadata: Metadata = { title: "Connect account" };

export default function ConnectAccountPage() {
  // Google-account generation is switched off in this release (packages/shared/src/features.ts).
  if (!GEMINI_BROWSER_JOBS) redirect("/dashboard/create");
  return (
    <>
      <DashHeader
        title="Connect account"
        subtitle="Use your Google account to generate listings in Create Product → Generate with AI."
      />
      <GeminiAccountsPanel />
    </>
  );
}
