import type { Config } from "tailwindcss";

// Every colour resolves to a CSS variable (RGB channels, so Tailwind's
// `/<alpha>` opacity modifiers still work). The actual values live in
// app/globals.css under each [data-theme="…"] block, so the whole UI can be
// re-skinned at runtime by flipping one attribute on <html>. See lib/theme.ts.
const c = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ink: {
          0:   c("--ink-0"),
          950: c("--ink-950"),
          900: c("--ink-900"),
          800: c("--ink-800"),
          700: c("--ink-700"),
          600: c("--ink-600"),
          500: c("--ink-500"),
        },
        accent: {
          50:  c("--accent-50"),
          200: c("--accent-200"),
          400: c("--accent-400"),
          500: c("--accent-500"),
          600: c("--accent-600"),
          700: c("--accent-700"),
        },
        zinc: {
          50:  c("--zinc-50"),
          100: c("--zinc-100"),
          200: c("--zinc-200"),
          300: c("--zinc-300"),
          400: c("--zinc-400"),
          500: c("--zinc-500"),
          600: c("--zinc-600"),
          700: c("--zinc-700"),
          800: c("--zinc-800"),
          900: c("--zinc-900"),
          950: c("--zinc-950"),
        },
        violet2: { 500: c("--violet2-500"), 600: c("--violet2-600") },
        success: { 500: c("--success-500"), 600: c("--success-600") },
        warn:    { 500: c("--warn-500"),    600: c("--warn-600") },
        danger:  { 500: c("--danger-500"),  600: c("--danger-600") },
      },
      backgroundImage: {
        "grad-accent": "var(--grad-accent)",
        "grad-soft":   "var(--grad-soft)",
      },
      boxShadow: {
        glow: "var(--glow)",
        card: "var(--shadow-card)",
      },
      fontFamily: {
        sans: ["var(--font)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      // All rounding is theme-driven (terminals are sharp, SaaS is soft).
      // `none` and `full` stay fixed so toggles/dots/swatches keep their shape.
      borderRadius: {
        none: "0",
        sm: "var(--radius)",
        DEFAULT: "var(--radius)",
        md: "var(--radius)",
        lg: "var(--radius)",
        xl: "var(--radius)",
        "2xl": "var(--radius)",
        xl2: "var(--radius)",
        full: "9999px",
      },
    },
  },
  plugins: [],
};

export default config;
