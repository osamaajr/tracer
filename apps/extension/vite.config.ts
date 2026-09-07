import { resolve } from "node:path";
import { build, defineConfig } from "vite";

export default defineConfig({
  plugins: [{
    name: "standalone-content-scripts",
    async closeBundle() {
      // Chrome injects these as classic scripts, so they cannot import shared chunks.
      for (const name of ["contentScript", "genericCapture"]) {
        await build({
          configFile: false,
          publicDir: false,
          build: {
            outDir: "dist",
            emptyOutDir: false,
            lib: {
              entry: resolve(import.meta.dirname, `src/${name}.ts`),
              name: `Tracer_${name}`,
              formats: ["iife"],
              fileName: () => `${name}.js`,
            },
          },
        });
      }
    },
  }],
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
