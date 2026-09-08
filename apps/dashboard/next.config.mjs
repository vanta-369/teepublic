/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@teepublic/shared"],
  experimental: {
    serverActions: { bodySizeLimit: "50mb" },
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
  async headers() {
    return [
      {
        // Allow the extension's service worker to fetch staged design files.
        source: "/api/files/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET" },
        ],
      },
    ];
  },
};

export default nextConfig;
