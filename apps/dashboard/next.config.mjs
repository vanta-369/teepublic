/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@teepublic/shared"],
  experimental: {
    // Nothing large is posted to this app any more - designs and listings stay
    // on the user's device - but Server Actions keep a modest ceiling rather
    // than the old 50mb one, which existed for image uploads that no longer
    // happen.
    serverActions: { bodySizeLimit: "1mb" },
    // Barrel-file packages: `import { X } from "lucide-react"` pulls the
    // package's whole index in dev, so a single icon drags in ~1,500 modules
    // and recharts adds hundreds more. That is what makes a first visit to a
    // route take seconds — dev compiles each route on demand.
    //
    // optimizePackageImports rewrites those to deep imports automatically, so
    // only the icons/charts actually used get compiled. No source changes, and
    // production output is unaffected (it already tree-shook these).
    optimizePackageImports: ["lucide-react", "recharts"],
  },
};

export default nextConfig;
