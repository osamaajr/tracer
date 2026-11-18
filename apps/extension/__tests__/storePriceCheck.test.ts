import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gbp } from "@tracer/core";
import { checkStorePrice } from "../src/storePriceCheck";
afterEach(() => vi.unstubAllGlobals());

const target = {
  retailerId: "store_shop-example-com",
  storeHost: "shop.example.com",
  productName: "Trail Pack 24L Moss Green",
  productUrl: "https://shop.example.com/products/trail-pack-24l-moss-green",
  sourceUrl: "https://shop.example.com/orders/123",
  pricePaid: gbp(8_450),
};

function storeResponse(body: string, status = 200, headers?: HeadersInit): typeof fetch {
  return (async () => new Response(body, {
    status,
    headers: { "content-type": "text/html", ...Object.fromEntries(new Headers(headers)) },
  })) as typeof fetch;
}

const parseHtml = (html: string): Document => parseHTML(html).document;

describe("direct store price checking", () => {
  it("checks legacy receipt names with a trailing Product Page label", async () => {
    const productUrl = "https://www.urbanoutfitters.com/en-gb/shop/graphic-beanie?color=030";
    const productName = "iets frans... Brushed Graphic Beanie";
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@type": "Product", name: productName,
      url: productUrl.split("?")[0],
      offers: { price: 20, priceCurrency: "GBP", url: productUrl.split("?")[0], availability: "https://schema.org/InStock" },
    })}</script></head><body></body></html>`;
    await expect(checkStorePrice({
      ...target, retailerId: "store_urbanoutfitters-com", storeHost: "urbanoutfitters.com",
      productName: `${productName} Product Page`, productUrl, pricePaid: gbp(1_800),
    }, { fetchImpl: storeResponse(html), parseHtml })).resolves.toMatchObject({ price: gbp(2_000), availability: "in_stock" });
  });

  it("recovers a blocked request from an existing matching product tab", async () => {
    const readOpenProduct = vi.fn(async () => ({
      name: target.productName, retailer: "Shop", retailerId: target.retailerId,
      canonicalUrl: target.productUrl, savedPrice: gbp(6_950), availability: "out_of_stock" as const,
    }));
    await expect(checkStorePrice(target, {
      fetchImpl: storeResponse("blocked", 403), parseHtml, readOpenProduct,
    })).resolves.toMatchObject({ price: gbp(6_950), availability: "out_of_stock" });
    expect(readOpenProduct).toHaveBeenCalledOnce();
  });

  it("reads only an existing matching colour tab, including the store's www alias", async () => {
    const productUrl = `${target.productUrl}?color=green`;
    const tabUrl = productUrl.replace("shop.example.com", "www.shop.example.com");
    const mutate = vi.fn(() => { throw new Error("Unexpected tab mutation"); });
    const executeScript = vi.fn(async () => [{ frameId: 0, result: {
      name: target.productName, retailer: "Shop", retailerId: target.retailerId,
      canonicalUrl: target.productUrl.replace("shop.example.com", "www.shop.example.com"), savedPrice: gbp(6_950),
    } }]);
    vi.stubGlobal("chrome", {
      tabs: {
        query: vi.fn(async () => [
          { id: 1, status: "complete", url: tabUrl.replace("green", "blue") },
          { id: 2, status: "complete", url: tabUrl },
        ]),
        get: vi.fn(async () => ({ id: 2, url: tabUrl })), create: mutate, update: mutate, remove: mutate,
      },
      scripting: { executeScript }, windows: { create: mutate },
    });
    await expect(checkStorePrice({ ...target, productUrl }, {
      fetchImpl: storeResponse("blocked", 403), parseHtml,
    })).resolves.toMatchObject({ price: gbp(6_950), productUrl });
    expect(executeScript).toHaveBeenCalledExactlyOnceWith({ target: { tabId: 2 }, files: ["savedMonitoringCapture.js"] });
    expect(mutate).not.toHaveBeenCalled();
  });

  it.each([
    { canonicalUrl: "https://other.example.com/product" },
    { canonicalUrl: `${target.productUrl}?color=wrong` },
    { name: "An entirely different product" },
    { savedPrice: { amountMinor: 69_50, currency: "USD" } },
    { externalProductId: "wrong-id" },
  ])("rejects an existing-tab result that mismatches the protected item %j", async (override) => {
    await expect(checkStorePrice({ ...target, externalProductId: "expected-id" }, {
      fetchImpl: storeResponse("blocked", 403), parseHtml,
      readOpenProduct: async () => ({
        name: target.productName, retailer: "Shop", retailerId: target.retailerId,
        canonicalUrl: target.productUrl, savedPrice: gbp(6_950), ...override,
      }),
    })).rejects.toThrow("Store returned 403");
  });

  it("requires the selected Shopify variant in an existing-tab price", async () => {
    await expect(checkStorePrice({ ...target, productUrl: `${target.productUrl}?variant=123` }, {
      fetchImpl: storeResponse("blocked", 403), parseHtml,
      readOpenProduct: async () => ({
        name: target.productName, retailer: "Shop", retailerId: target.retailerId,
        canonicalUrl: target.productUrl, savedPrice: gbp(6_950),
      }),
    })).rejects.toThrow("Store returned 403");
  });

  it("reports a product redirected to the homepage without reading its recommendation prices", async () => {
    const readOpenProduct = vi.fn();
    await expect(checkStorePrice(target, {
      fetchImpl: storeResponse("", 302, { location: "https://shop.example.com/" }), parseHtml, readOpenProduct,
    })).rejects.toThrow("product page is no longer available");
    expect(readOpenProduct).not.toHaveBeenCalled();
  });

  it("uses the current sale price, rather than the crossed-out old price", async () => {
    const html = `<html><body><main><h1>Trail Pack 24L Moss Green</h1>
      <div class="current-price">Was £84.50, now £69.50</div></main></body></html>`;
    await expect(checkStorePrice(target, { fetchImpl: storeResponse(html), parseHtml }))
      .resolves.toMatchObject({ price: gbp(6_950) });
  });

  it("rejects a different product or currency", async () => {
    const otherProduct = `<html><body><main><h1>Desk lamp</h1>
      <span class="current-price">£12.00</span></main></body></html>`;
    await expect(checkStorePrice(target, { fetchImpl: storeResponse(otherProduct), parseHtml }))
      .rejects.toThrow("verify this product");
    const wrongCurrency = `<html><body><main><h1>Trail Pack 24L Moss Green</h1>
      <span class="current-price">$69.50</span></main></body></html>`;
    await expect(checkStorePrice(target, { fetchImpl: storeResponse(wrongCurrency), parseHtml }))
      .rejects.toThrow("verify this product");
  });

  it("rejects a cross-host redirect and a receipt URL", async () => {
    const redirect = storeResponse("", 302, { location: "https://other.example.com/product" });
    await expect(checkStorePrice(target, { fetchImpl: redirect, parseHtml }))
      .rejects.toThrow("does not match");
    await expect(checkStorePrice({ ...target, productUrl: target.sourceUrl }, {
      fetchImpl: storeResponse(""), parseHtml,
    })).rejects.toThrow("not a product page");
  });
  it("accepts duplicate theme and SEO records for the same requested variant", async () => {
    const productUrl = `${target.productUrl}?variant=123`;
    const product = { "@type": "Product", name: target.productName, url: target.productUrl };
    const offer = { price: "69.50", priceCurrency: "GBP", url: productUrl };
    const html = `<html><head><script type="application/ld+json">${JSON.stringify([
      { ...product, offers: offer },
      { ...product, productID: "parent-id", offers: [{ ...offer, sku: "123" }] },
    ])}</script></head><body><h1>${target.productName}</h1></body></html>`;
    await expect(checkStorePrice({ ...target, productUrl, externalProductId: "123" }, {
      fetchImpl: storeResponse(html), parseHtml,
    })).resolves.toMatchObject({ price: gbp(6_950), externalProductId: "123" });
    const conflicting = html.replace('"price":"69.50"', '"price":"19.50"');
    await expect(checkStorePrice({ ...target, productUrl }, {
      fetchImpl: storeResponse(conflicting), parseHtml,
    })).rejects.toThrow("verify this product");
  });

  it("selects the requested variant instead of the first offer", async () => {
    const productUrl = `${target.productUrl}?variant=123`;
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@type": "Product", name: target.productName, url: target.productUrl,
      offers: [
        { price: "19.50", priceCurrency: "GBP", url: `${target.productUrl}?variant=999` },
        { price: "69.50", priceCurrency: "GBP", url: productUrl },
      ],
    })}</script></head><body><h1>${target.productName}</h1></body></html>`;
    await expect(checkStorePrice({ ...target, productUrl }, {
      fetchImpl: storeResponse(html), parseHtml,
    })).resolves.toMatchObject({ price: gbp(6_950) });
    await expect(checkStorePrice({ ...target, productUrl: `${target.productUrl}?variant=missing` }, {
      fetchImpl: storeResponse(html), parseHtml,
    })).rejects.toThrow("verify this product");
  });

});
