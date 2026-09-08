import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Higgstee — Prepare once, upload everywhere",
    template: "%s · Higgstee",
  },
  description:
    "Higgstee helps print-on-demand sellers prepare a product once and auto-upload it to TeePublic, Etsy, Teachers Pay Teachers, and Redbubble with a browser extension.",
};

// Apply the saved light/dark choice before paint to avoid a flash. Default dark
// (Fincash is dark-first: near-black + lime; the toggle still switches to light).
// (Storage key kept as `teepublic.colormode` for session continuity.)
const themeBootstrap = `
(function(){
  try {
    var m = localStorage.getItem("teepublic.colormode");
    if (m !== "light" && m !== "dark") m = "dark";
    document.documentElement.classList.toggle("dark", m === "dark");
    document.documentElement.style.colorScheme = m;
  } catch (e) {
    document.documentElement.classList.add("dark");
    document.documentElement.style.colorScheme = "dark";
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      {/* suppressHydrationWarning is needed on <body> as well as <html>: the
          flag is NOT inherited, it only covers the element it sits on. Browser
          extensions (antivirus/anti-tracker shields, password managers) stamp
          attributes like `bis_register` and `__processed_<uuid>__` onto <body>
          before React hydrates, which React then reports as a mismatch the app
          can't fix — the markup it rendered was correct.

          This silences the warning for THIS element's own attributes only. Real
          hydration bugs inside the tree are still reported. */}
      <body className="min-h-screen" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
