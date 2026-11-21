import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "node:path";

// self-contained pages (no network, no module fetches) that the desktop apps load from disk:
// index.html = the wallpaper, panel.html = the pop-up panel (PAGE=panel)
const page = process.env.PAGE === "panel" ? "panel" : "index";
export default defineConfig({
  root: path.resolve(__dirname, "web"),
  plugins: [react(), viteSingleFile()],
  resolve: {
    // the app ships its own copy of the pond (faster rendering, finite food); the npm component in ../src is untouched
    alias: { koipond: path.resolve(__dirname, "pond/index.ts") },
    dedupe: ["react", "react-dom", "three"],
  },
  build: {
    outDir: path.resolve(__dirname, "build/web"), emptyOutDir: page === "index", chunkSizeWarningLimit: 3000,
    rollupOptions: { input: path.resolve(__dirname, `web/${page}.html`) },
  },
});
