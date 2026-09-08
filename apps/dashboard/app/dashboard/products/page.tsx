import type { Metadata } from "next";
import Link from "next/link";
import { DashHeader } from "@/components/dashboard/DashBits";
import { ProductsList } from "@/components/dashboard/ProductsList";

export const metadata: Metadata = { title: "Products" };

export default function ProductsPage() {
  return (
    <>
      <DashHeader title="Products" subtitle="Your prepared products, ready to upload.">
        <Link href="/dashboard/create" className="btn-primary">Create Product</Link>
      </DashHeader>
      <ProductsList />
    </>
  );
}
