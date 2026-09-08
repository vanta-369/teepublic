// Central brand + navigation config. One source of truth for the marketing
// navbar, the dashboard sidebar, and shared links so labels/routes never drift.

export const BRAND = "Higgstee";
export const BRAND_TAGLINE = "Prepare once, upload everywhere.";
export const BRAND_BLURB =
  "Higgstee helps print-on-demand sellers prepare a product once and auto-upload it to TeePublic, Etsy, Teachers Pay Teachers, and Redbubble with a browser extension.";

// The extension is distributed via the Chrome Web Store. Replace with the real
// listing URL once published; the public /download-extension page links here.
export const EXTENSION_STORE_URL = "https://chromewebstore.google.com/";

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

// Dashboard sidebar. `icon` keys map to inline SVGs in the Sidebar component.
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
  { label: "Uploads", href: "/dashboard/uploads", icon: "upload" },
  { label: "Sales & Earnings", href: "/dashboard/analytics", icon: "chart" },
  { label: "Extension", href: "/dashboard/extension", icon: "puzzle" },
  { label: "Settings", href: "/dashboard/settings", icon: "gear" },
  { label: "Support", href: "/dashboard/support", icon: "help" },
];
