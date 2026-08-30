import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(import.meta.dirname, "src/background.ts"),
        contentScript: resolve(import.meta.dirname, "src/contentScript.ts"),
        genericCapture: resolve(import.meta.dirname, "src/genericCapture.ts"),
        popup: resolve(import.meta.dirname, "popup.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
