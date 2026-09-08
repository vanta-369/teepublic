import type { Metadata } from "next";
import { DashHeader } from "@/components/dashboard/DashBits";
import { ExtensionPanel } from "@/components/dashboard/ExtensionPanel";

export const metadata: Metadata = { title: "Extension" };

export default function ExtensionPage() {
  return (
    <>
      <DashHeader
        title="Extension"
        subtitle="Install and connect the Higgstee browser extension — it does the uploading."
      />
      <ExtensionPanel />
    </>
  );
}
