import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { DashHeader } from "@/components/dashboard/DashBits";
import { PLATFORMS, STATUS_LABEL } from "@/lib/platforms";

export const metadata: Metadata = { title: "Connected Platforms" };

export default function PlatformsPage() {
  return (
    <>
      <DashHeader
        title="Connected Platforms"
        subtitle="Choose where your products get uploaded. You sign in to each platform inside the extension."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {PLATFORMS.map((p) => {
          const live = p.status === "live";
          return (
            <div key={p.id} className={clsx("surface p-6 flex flex-col gap-4", !live && "opacity-70")}>
              <div className="flex items-center gap-3">
                <span className={clsx("h-11 w-11 rounded-lg grid place-items-center font-bold border", p.tileClass)}>
                  {p.initial}
                </span>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{p.name}</h3>
                  <span className={live ? "chip-ok mt-1" : "chip-mute mt-1"}>{STATUS_LABEL[p.status]}</span>
                </div>
              </div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{p.short}</p>
              {live ? (
                <p className="text-xs text-zinc-500">
                  Sign in to TeePublic inside the extension side panel to upload.
                </p>
              ) : (
                <p className="text-xs text-zinc-500">Automation for this platform is on the way.</p>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-6 text-sm text-zinc-500">
        Need to connect the extension first?{" "}
        <Link href="/dashboard/extension" className="text-accent-500 hover:text-accent-400">
          Go to Extension
        </Link>
        .
      </p>
    </>
  );
}
