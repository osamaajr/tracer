import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = fileURLToPath(new URL("./dist/", import.meta.url));
const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const relative = pathname === "/" || !extname(pathname) ? "index.html" : pathname.slice(1);
  const filePath = join(distDir, normalize(relative));
  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "cache-control": "no-cache, no-store, must-revalidate",
      "content-type": mime[extname(filePath)] ?? "application/octet-stream",
    });
    response.end(body);
  } catch {
    try {
      const body = await readFile(join(distDir, "index.html"));
      response.writeHead(200, { "cache-control": "no-cache, no-store, must-revalidate", "content-type": mime[".html"] });
      response.end(body);
    } catch {
      response.writeHead(500);
      response.end("Preview unavailable");
    }
  }
});

server.listen(5173, "0.0.0.0");
