import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [tailwindcss()],
  publicDir: "public",
  resolve: {
    alias: {
      "@shared": path.resolve("./src/shared"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    middlewareMode: true,
    // Cursor port-forward and tent-wifi IPs send a Host header other than
    // localhost; Vite 7 otherwise blocks the page (403 / "404" in the preview).
    allowedHosts: true,
  },
});
