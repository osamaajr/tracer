import type { FastifyInstance } from "fastify";

interface Bucket {
  count: number;
  resetAt: number;
}

export function registerApiRateLimit(app: FastifyInstance): void {
  const buckets = new Map<string, Bucket>();
  let lastSweep = 0;

  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    const now = Date.now();
    if (now - lastSweep > 60_000) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
      lastSweep = now;
    }

    const path = request.url.split("?", 1)[0] ?? "";
    const limits: Array<[string, number, number]> = [[`all:${request.ip}`, 120, 60_000]];
    if (request.method === "POST" && path.endsWith("/check-price")) {
      limits.push([`price:${request.ip}`, 8, 600_000]);
    }
    if (request.method === "POST" && path === "/api/purchases/protect") {
      limits.push([`protect:${request.ip}`, 30, 3_600_000]);
    }

    for (const [key, max, windowMs] of limits) {
      const bucket = buckets.get(key);
      const next = !bucket || bucket.resetAt <= now
        ? { count: 1, resetAt: now + windowMs }
        : { count: bucket.count + 1, resetAt: bucket.resetAt };
      buckets.set(key, next);
      if (next.count > max) {
        return reply.code(429).header("retry-after", String(Math.ceil((next.resetAt - now) / 1000)))
          .send({ error: "rate_limited" });
      }
    }
  });
}
