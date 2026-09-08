import type { Metadata } from "next";
import { DashHeader } from "@/components/dashboard/DashBits";
import { UploaderApp } from "@/components/UploaderApp";

export const metadata: Metadata = { title: "Create Product" };

export default function CreateProductPage() {
  return (
    <>
      <DashHeader
        title="Create Product"
        subtitle="Prepare a product once — generate a listing with AI or import a spreadsheet, then send it to the extension."
      />
      <UploaderApp />
    </>
  );
}
