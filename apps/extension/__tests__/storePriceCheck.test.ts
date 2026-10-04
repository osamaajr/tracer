import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { gbp } from "@tracer/core";
import { checkStorePrice } from "../src/storePriceCheck";

const target = {
  retailerId: "store_shop-example-com",
  storeHost: "shop.example.com",
  productName: "Trail Pack 24L Moss Green",
  productUrl: "https://shop.example.com/products/trail-pack-24l-moss-green",
  sourceUrl: "https://shop.example.com/orders/123",
  pricePaid: gbp(8_450),
};

function storeResponse(body: string, status = 200, headers?: HeadersInit): typeof fetch {
  return (async () => new Response(body, { status, headers })) as typeof fetch;
}

const parseHtml = (html: string): Document => parseHTML(html).document;

describe("direct store price checking", () => {
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
});
