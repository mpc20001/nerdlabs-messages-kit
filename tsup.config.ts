import { defineConfig } from "tsup";

export default defineConfig({
  entry: { server: "src/server/index.ts", ui: "src/ui/index.ts" },
  format: ["esm"],
  target: "es2022",
  platform: "neutral",
  dts: true,
  clean: true,
  sourcemap: false,
  splitting: true,
  treeshake: true,
  // Stable chunk name so committed dist/ diffs stay readable between builds.
  esbuildOptions(options) {
    options.chunkNames = "shared-[name]";
  },
  external: ["react", "react/jsx-runtime", "@remix-run/node", "@remix-run/react", "@shopify/polaris"],
});
