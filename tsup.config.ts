import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2020",
  external: ["react", "three"],
  // keep the component usable from Next.js App Router pages
  banner: { js: '"use client";' },
});
