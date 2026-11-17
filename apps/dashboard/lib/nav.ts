// Central brand + navigation config. One source of truth for the marketing
// navbar, the dashboard sidebar, and shared links so labels/routes never drift.

import { GEMINI_BROWSER_JOBS } from "@teepublic/shared";

export const BRAND = "Higgstee";
export const BRAND_TAGLINE = "Prepare once, upload everywhere.";
export const BRAND_BLURB =
  "Higgstee helps print-on-demand sellers prepare a product once and auto-upload it to TeePublic, Etsy, Teachers Pay Teachers, and Redbubble with a browser extension.";

// The extension is distributed via the Chrome Web Store. Every "Add to Chrome"
// button on the site links here.
export const EXTENSION_STORE_URL =
  "https://chromewebstore.google.com/detail/higgstee-%E2%80%94-pod-listing-up/obkkmfkhfofjemedkdmemdadbcodjdpn";

// The published Web Store extension. The dashboard connects to this ID and no
// other: there is no manual-ID override. (A manually loaded, unpacked build
// gets a different ID, so it won't connect.)
export const EXTENSION_ID = "obkkmfkhfofjemedkdmemdadbcodjdpn";

export interface NavLink {
  label: string;
  href: string;
}

// Marketing navbar — center links (Sign In / Get Started / Download Extension
// are rendered separately as prominent CTAs).
export const PUBLIC_NAV: NavLink[] = [
  { label: "How It Works", href: "/how-it-works" },
  { label: "Pricing", href: "/pricing" },
  { label: "About", href: "/about" },
  { label: "FAQ", href: "/faq" },
  { label: "Contact", href: "/contact" },
];

// Footer columns.
export const FOOTER_PRODUCT: NavLink[] = [
  { label: "How It Works", href: "/how-it-works" },
  { label: "Pricing", href: "/pricing" },
  { label: "Download Extension", href: "/download-extension" },
];
export const FOOTER_COMPANY: NavLink[] = [
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
  { label: "FAQ", href: "/faq" },
];
export const FOOTER_LEGAL: NavLink[] = [
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Terms of Service", href: "/terms" },
];

// Dashboard sidebar. `icon` keys map to Lucide icons in DashboardShell (ICONS).
export interface SidebarLink extends NavLink {
  icon: string;
}
// Only what's in this array renders in the sidebar. The routes removed below
// (products, history, platforms, subscription, profile) still EXIST and still
// resolve if navigated to directly — this hides them from the nav rather than
// deleting working pages, so nothing that links to them 404s and restoring one
// is a one-line change.
export const DASHBOARD_NAV: SidebarLink[] = [
  { label: "Dashboard", href: "/dashboard", icon: "home" },
  { label: "Create Product", href: "/dashboard/create", icon: "plus" },
  // Google-account generation - hidden while GEMINI_BROWSER_JOBS is off (packages/shared/src/features.ts).
  ...(GEMINI_BROWSER_JOBS ? [{ label: "Connect account", href: "/dashboard/gemini", icon: "sparkle" } as SidebarLink] : []),
  { label: "Uploads", href: "/dashboard/uploads", icon: "upload" },
  { label: "Sales & Earnings", href: "/dashboard/analytics", icon: "chart" },
  { label: "Extension", href: "/dashboard/extension", icon: "puzzle" },
  { label: "Settings", href: "/dashboard/settings", icon: "gear" },
  { label: "Support", href: "/dashboard/support", icon: "help" },
];
