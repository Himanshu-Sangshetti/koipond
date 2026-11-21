import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "node:path";

// one self-contained index.html (no network, no module fetches) that the desktop apps load from disk
export default defineConfig({
  root: path.resolve(__dirname, "web"),
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: { koipond: path.resolve(__dirname, "../src/index.ts") },
    dedupe: ["react", "react-dom", "three"],
  },
  build: { minify: false, outDir: path.resolve(__dirname, "build/web"), emptyOutDir: true, chunkSizeWarningLimit: 3000 },
});
