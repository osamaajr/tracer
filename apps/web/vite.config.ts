import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const devPagesRoot = resolve(import.meta.dirname, "dev-pages");
const devPageContentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

function tracerDevPages() {
  return {
    name: "tracer-dev-pages",
    apply: "serve" as const,
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use((request, response, next) => {
        let pathname: string;
        try {
          pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
        } catch {
          next();
          return;
        }

        let relativePath: string | null = null;
        if (pathname === "/extension-states" || pathname === "/extension-states/") {
          relativePath = "extension-states/index.html";
        } else if (pathname.startsWith("/extension-states/")) {
          relativePath = pathname.slice(1);
        } else if (/^\/tracer-demo-order(?:-[a-z0-9-]+)?\.html$/i.test(pathname)) {
          relativePath = pathname.slice(1);
        } else if (pathname === "/tracer-price-drop-demo.html" || pathname === "/tracer-price-drop-backpack.svg") {
          relativePath = pathname.slice(1);
        }

        if (!relativePath) {
          next();
          return;
        }
        const filePath = resolve(devPagesRoot, relativePath);
        if (!filePath.startsWith(`${devPagesRoot}${sep}`)) {
          next();
          return;
        }
        try {
          const body = readFileSync(filePath);
          response.statusCode = 200;
          response.setHeader("Content-Type", devPageContentTypes[extname(filePath)] ?? "application/octet-stream");
          response.setHeader("Cache-Control", "no-store");
          response.end(body);
        } catch {
          next();
        }
      });
    },
  };
}

function tracerMarketingPages() {
  return {
    name: "tracer-marketing-pages",
    apply: "build" as const,
    closeBundle() {
      // Keep the extension's dev fixtures out of production while publishing
      // only these reviewed, crawlable marketing files.
      const publicRoot = resolve(import.meta.dirname, "public");
      const outputRoot = resolve(import.meta.dirname, "dist");
      for (const path of [
        "guides/save-products-from-different-shops.html",
        "guides/carted-alternative-chrome.html",
        "guides/google-universal-cart-uk.html",
        "guides/guide.css",
        "guides/tracer-wordmark.webp",
        "guides/tracer-serif.woff2",
        "guides/tracer-sky.webp",
        "guides/favicon.png",
        "robots.txt",
        "sitemap.xml",
      ]) {
        const destination = resolve(outputRoot, path);
        mkdirSync(resolve(destination, ".."), { recursive: true });
        copyFileSync(resolve(publicRoot, path), destination);
      }
    },
  };
}

export default defineConfig({
  plugins: [tracerDevPages(), tracerMarketingPages(), react()],
  build: {
    // Runtime assets are imported from src; keep dev fixtures in public for Vite serve only.
    copyPublicDir: false,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
