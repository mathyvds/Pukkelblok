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
  },
});
