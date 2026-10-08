import { afterEach, describe, expect, it, vi } from "vitest";
import { checkSavedProductPrice } from "../src/savedProductPriceCheck";
import type { SavedProduct } from "@tracer/core";

const item: SavedProduct = { name: "Silver Bracelet", retailer: "Example", retailerId: "store_shop-example-com", canonicalUrl: "https://shop.example.com/products/bracelet", savedPrice: { amountMinor: 3500, currency: "GBP" } };
const productHtml = (price = "25.00", currency = "GBP", name = item.name, url = item.canonicalUrl) => `<html><head><link rel="canonical" href="${url}"><script type="application/ld+json">${JSON.stringify({ "@type": "Product", name, url, offers: { price, priceCurrency: currency } })}</script></head><body></body></html>`;
const response = (body: string, type = "text/html") => new Response(body, { headers: { "content-type": type } });
const fallback = () => vi.fn().mockResolvedValue(null);
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("direct saved-product checks", () => {
  it("reads structured data with the exact URL, no cached response and no tab APIs", async () => {
    const forbidden = vi.fn(() => { throw new Error("Browser mutation forbidden"); });
    vi.stubGlobal("chrome", { tabs: { create: forbidden, update: forbidden, remove: forbidden, query: forbidden }, windows: { create: forbidden } });
    const fetchImpl = vi.fn().mockResolvedValue(response(productHtml()));
    const product = await checkSavedProductPrice(item, { fetchImpl });
    expect(product?.savedPrice).toEqual({ amountMinor: 2500, currency: "GBP" });
    expect(fetchImpl).toHaveBeenCalledWith(item.canonicalUrl, expect.objectContaining({ credentials: "include", cache: "no-store", redirect: "manual", signal: expect.any(AbortSignal) }));
    expect(forbidden).not.toHaveBeenCalled();
  });
  it("reuses the DOM sale-price extractor without structured offers", async () => {
    const html = '<html><head><meta property="og:type" content="product"><meta property="og:title" content="Silver Bracelet"><meta property="product:price:currency" content="GBP"></head><body><main><h1>Silver Bracelet</h1><span data-product-price="Was £35, now £25">Was £35, now £25</span></main></body></html>';
    const product = await checkSavedProductPrice(item, { fetchImpl: vi.fn().mockResolvedValue(response(html)), readOpenProduct: fallback() });
    expect(product?.savedPrice?.amountMinor).toBe(2500);
  });
  it("uses Zara's existing application adapter when HTML has no price", async () => {
    const zara = { ...item, name: "BALLOON FIT JEANS", retailerId: "store_zara-com", canonicalUrl: "https://www.zara.com/uk/en/balloon-fit-jeans-p01300485.html?v1=576164655&v2=2432118" };
    const fetchImpl = vi.fn().mockResolvedValueOnce(response("<html></html>")).mockResolvedValueOnce(response(JSON.stringify({ product: { name: zara.name, detail: { colors: [{ pricing: { price: { value: 3999, currency: { code: "GBP" } } } }] } } }), "application/json"));
    expect((await checkSavedProductPrice(zara, { fetchImpl, readOpenProduct: fallback() }))?.savedPrice?.amountMinor).toBe(3999);
    expect(fetchImpl.mock.calls[1]?.[0]).toContain("ajax=true");
  });
  it.each([
    ["wrong name", productHtml("25", "GBP", "Gold Necklace")],
    ["wrong product", productHtml("25", "GBP", item.name, "https://shop.example.com/products/other")],
    ["currency changed", productHtml("25", "USD")], ["zero price", productHtml("0")],
    ["missing product", "<html><body>£25</body></html>"], ["challenge page", "<html><body>Please verify you are human</body></html>"],
  ])("rejects %s without inventing a price", async (_name, html) => {
    expect(await checkSavedProductPrice(item, { fetchImpl: vi.fn().mockResolvedValue(response(html)), readOpenProduct: fallback() })).toBeNull();
  });
  it.each(["https://evil.example/product", "https://shop.example.com/products/other", "http://127.0.0.1/products/bracelet"])("does not follow redirect to %s", async (location) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location } }));
    expect(await checkSavedProductPrice(item, { fetchImpl, readOpenProduct: fallback() })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("preserves variant parameters and rejects conflicting SKUs", async () => {
    const variant = { ...item, canonicalUrl: item.canonicalUrl + "?variant=123", sku: "silver" };
    const html = productHtml().replace('"@type":"Product"', '"@type":"Product","sku":"gold"');
    const fetchImpl = vi.fn().mockResolvedValue(response(html));
    expect(await checkSavedProductPrice(variant, { fetchImpl, readOpenProduct: fallback() })).toBeNull();
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(variant.canonicalUrl);
  });
  it.each(["declared", "streamed"])("bounds %s response sizes", async (mode) => {
    const tooLarge = new Response("x".repeat(mode === "streamed" ? 2_000_001 : 1), { headers: { "content-type": "text/html", ...(mode === "declared" ? { "content-length": "2000001" } : {}) } });
    expect(await checkSavedProductPrice(item, { fetchImpl: vi.fn().mockResolvedValue(tooLarge), readOpenProduct: fallback() })).toBeNull();
  });
  it("rejects non-HTML responses and non-public URLs", async () => {
    expect(await checkSavedProductPrice(item, { fetchImpl: vi.fn().mockResolvedValue(response(productHtml(), "application/pdf")), readOpenProduct: fallback() })).toBeNull();
    const fetchImpl = vi.fn();
    await expect(checkSavedProductPrice({ ...item, canonicalUrl: "https://127.0.0.1/item" }, { fetchImpl })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("reads only an existing matching loaded tab without changing any user tabs", async () => {
    const mutate = vi.fn(() => { throw new Error("Browser mutation forbidden"); });
    const executeScript = vi.fn().mockResolvedValue([{ frameId: 0, result: { ...item, savedPrice: { amountMinor: 2500, currency: "GBP" } } }]);
    vi.stubGlobal("chrome", { tabs: { create: mutate, update: mutate, remove: mutate,
      query: vi.fn().mockResolvedValue([{ id: 1, url: "https://shop.example.com/other", status: "complete" }, { id: 2, url: item.canonicalUrl, status: "loading" }, { id: 3, url: item.canonicalUrl, status: "complete" }]),
      get: vi.fn().mockResolvedValue({ url: item.canonicalUrl }) }, scripting: { executeScript }, windows: { create: mutate } });
    const product = await checkSavedProductPrice(item, { fetchImpl: vi.fn().mockRejectedValue(new Error("offline")) });
    expect(product?.savedPrice?.amountMinor).toBe(2500);
    expect(executeScript).toHaveBeenCalledExactlyOnceWith({ target: { tabId: 3 }, files: ["savedMonitoringCapture.js"] });
    expect(mutate).not.toHaveBeenCalled();
  });
  it("discards a result if the tab navigates while being read", async () => {
    vi.stubGlobal("chrome", { tabs: { query: vi.fn().mockResolvedValue([{ id: 3, url: item.canonicalUrl, status: "complete" }]), get: vi.fn().mockResolvedValue({ url: "https://shop.example.com/other" }), }, scripting: { executeScript: vi.fn().mockResolvedValue([{ frameId: 0, result: item }]) } });
    expect(await checkSavedProductPrice(item, { fetchImpl: vi.fn().mockRejectedValue(new Error("offline")) })).toBeNull();
  });
  it("times out an unresponsive existing tab", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("chrome", { tabs: { query: vi.fn().mockResolvedValue([{ id: 3, url: item.canonicalUrl, status: "complete" }]) }, scripting: { executeScript: vi.fn().mockReturnValue(new Promise(() => {})) } });
    const check = checkSavedProductPrice(item, { fetchImpl: vi.fn().mockRejectedValue(new Error("offline")) });
    await vi.advanceTimersByTimeAsync(5_001);
    expect(await check).toBeNull();
  });
});
