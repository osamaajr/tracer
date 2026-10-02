import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ProductRecord } from "@tracer/core";
import { HttpPriceFetcher } from "../httpPriceFetcher";

const product: ProductRecord = {
  id: "prod_trail_pack",
  retailerId: "store_shop-example-com",
  retailerName: "Shop",
  storeHost: "shop.example.com",
  name: "Trail Pack 24L, Moss Green",
  canonicalUrl: "https://shop.example.com/products/trail-pack-24l-moss-green",
  externalProductId: "acme-pack-24-moss",
  sku: "TP24-MOSS",
  firstSeenAt: "2026-09-01T00:00:00.000Z",
  monitoringStatus: "active",
};

describe("HTTP price fetching", () => {
  it("retries a transient retailer failure with bounded backoff", async () => {
    const html = readFileSync(
      new URL("../../../../packages/core/fixtures/generic-store/product-pack-dropped.html", import.meta.url),
      "utf8",
    );
    let attempts = 0;
    const delays: number[] = [];
    const fetcher = new HttpPriceFetcher({
      maxAttempts: 2,
      retryDelayMs: 25,
      fetchImpl: (async () => {
        attempts += 1;
        return attempts === 1
          ? new Response("busy", { status: 503 })
          : new Response(html, { status: 200 });
      }) as typeof fetch,
      resolveHost: async () => [{ address: "93.184.216.34" }],
      sleep: async (milliseconds) => { delays.push(milliseconds); },
    });

    await expect(fetcher.fetchCurrentPrice(product)).resolves.toMatchObject({
      price: { amountMinor: 7_200, currency: "GBP" },
    });
    expect(attempts).toBe(2);
    expect(delays).toEqual([25]);
  });

  it("rejects a redirect to a private destination", async () => {
    const fetcher = new HttpPriceFetcher({
      fetchImpl: (async () => new Response(null, {
        status: 302,
        headers: { location: "https://127.0.0.1/latest" },
      })) as typeof fetch,
      resolveHost: async () => [{ address: "93.184.216.34" }],
      sleep: async () => undefined,
    });

    await expect(fetcher.fetchCurrentPrice(product)).rejects.toThrow("public");
  });

  it("detects a current sale price from scoped product markup without JSON-LD", async () => {
    const html = `
      <!doctype html><html><head>
        <meta property="og:type" content="product" />
        <meta property="og:title" content="Trail Pack 24L, Moss Green" />
        <meta property="og:site_name" content="Shop" />
        <meta property="product:price:currency" content="GBP" />
        <link rel="canonical" href="https://shop.example.com/products/trail-pack-24l-moss-green" />
      </head><body><main>
        <h1>Trail Pack 24L, Moss Green</h1>
        <div class="current-price">Was £84.50, now £69.50</div>
      </main></body></html>
    `;
    const fetcher = new HttpPriceFetcher({
      maxAttempts: 1,
      fetchImpl: (async () => new Response(html, { status: 200 })) as typeof fetch,
      resolveHost: async () => [{ address: "93.184.216.34" }],
    });

    await expect(fetcher.fetchCurrentPrice(product)).resolves.toMatchObject({
      productName: "Trail Pack 24L, Moss Green",
      price: { amountMinor: 6_950, currency: "GBP" },
      availability: "unknown",
    });
  });
});
