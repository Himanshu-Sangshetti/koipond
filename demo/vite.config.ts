import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// the demo uses the component straight from ../src
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { koipond: path.resolve(__dirname, "../src/index.ts") }, dedupe: ["react", "react-dom", "three"] },
  build: { chunkSizeWarningLimit: 1500 },
});
