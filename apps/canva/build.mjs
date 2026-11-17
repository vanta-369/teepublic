import { build } from "esbuild";
import { fileURLToPath } from "node:url";
await build({
  entryPoints: [fileURLToPath(new URL("./src/main.ts", import.meta.url))],
  outfile: fileURLToPath(new URL("./dist/app.js", import.meta.url)),
  bundle: true, format: "iife", target: "es2022",
});
