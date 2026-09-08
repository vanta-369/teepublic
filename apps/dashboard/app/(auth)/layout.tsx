import Link from "next/link";
import { Logo } from "@/components/site/Logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <div className="mx-auto max-w-7xl w-full px-5 h-16 flex items-center justify-between">
        <Logo />
        <Link href="/" className="text-sm text-zinc-500 hover:text-accent-500">
          ← Back to home
        </Link>
      </div>
      <div className="flex-1 grid place-items-center px-4 pb-16">{children}</div>
    </div>
  );
}
