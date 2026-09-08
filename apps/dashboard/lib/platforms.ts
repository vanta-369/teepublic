// The four supported POD platforms. Shared by the landing drop-zone cards and
// the Connected Platforms page so status stays consistent in one place.
//
// NOTE: only TeePublic automation exists today. Etsy / TPT / Redbubble are
// intentionally marked "soon" until their automation ships.

export type PlatformStatus = "live" | "soon";

export interface Platform {
  id: string;
  name: string;
  /** Short description shown on cards. */
  short: string;
  status: PlatformStatus;
  /** Single-letter placeholder mark until real logos are added. */
  initial: string;
  /** Explicit (non-dynamic) Tailwind classes so nothing gets purged. */
  tileClass: string;
}

export const PLATFORMS: Platform[] = [
  {
    id: "teepublic",
    name: "TeePublic",
    short: "Auto-fill listings and publish your designs in bulk.",
    status: "live",
    initial: "T",
    tileClass: "bg-accent-500/15 text-accent-600 dark:text-accent-400 border-accent-500/40",
  },
  {
    id: "etsy",
    name: "Etsy",
    short: "Prepare and push listings to your Etsy shop.",
    status: "soon",
    initial: "E",
    tileClass: "bg-warn-500/15 text-warn-600 dark:text-warn-500 border-warn-500/40",
  },
  {
    id: "tpt",
    name: "Teachers Pay Teachers",
    short: "Upload teaching resources and digital products.",
    status: "soon",
    initial: "T",
    tileClass: "bg-success-500/15 text-success-600 dark:text-success-500 border-success-500/40",
  },
  {
    id: "redbubble",
    name: "Redbubble",
    short: "Send your designs to your Redbubble store.",
    status: "soon",
    initial: "R",
    tileClass: "bg-danger-500/15 text-danger-600 dark:text-danger-500 border-danger-500/40",
  },
];

export const STATUS_LABEL: Record<PlatformStatus, string> = {
  live: "Supported",
  soon: "Supported — coming soon",
};
