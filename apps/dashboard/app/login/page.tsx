import { redirect } from "next/navigation";

// Legacy route — preserved so old links/bookmarks keep working. Sign-in now
// lives at /signin; carry any ?next through.
export default async function LoginRedirect({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  redirect(next ? `/signin?next=${encodeURIComponent(next)}` : "/signin");
}
