import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";
import { extractSavedProduct } from "@tracer/core";
import { checkSavedProductPrice } from "../src/savedProductPriceCheck";
import { WatchlistRepository } from "../src/watchlistRepository";

const html = readFileSync(new URL("../../../packages/core/src/__tests__/fixtures/footlocker-product-group.html", import.meta.url), "utf8");
const pageUrl = "https://www.footlocker.co.uk/en/product/new-balance-740-men-shoes/314216963604.html";
const extract = (source = html, url = pageUrl) => extractSavedProduct(parseHTML(source).document, url);

describe("ProductGroup pages with a shared model canonical", () => {
  it("captures the displayed colour's sale price, identity, image, and URL", () => {
    expect(extract()).toMatchObject({
      name: "New Balance 740 - Men Shoes",
      retailerId: "store_footlocker-co-uk",
      canonicalUrl: pageUrl,
      sku: "314216963604",
      savedPrice: { amountMinor: 7000, currency: "GBP" },
      imageUrl: "https://assets.footlocker.com/is/image/FLDM/314216963604_01",
      availability: "in_stock",
    });
  });

  it("saves and refreshes the same colour without taking a cheaper neighbouring offer", async () => {
    const product = extract()!;
    const stored: Record<string, unknown> = {};
    const repository = new WatchlistRepository({
      get: async key => ({ [key]: stored[key] }),
      set: async values => { Object.assign(stored, values); },
    });
    await repository.save(product);
    expect((await repository.list())[0]).toMatchObject({ canonicalUrl: pageUrl, sku: "314216963604" });
    const fetchImpl = vi.fn(async () => new Response(html, { headers: { "content-type": "text/html" } }));
    const readOpenProduct = vi.fn(async () => null);
    await expect(checkSavedProductPrice(product, { fetchImpl, readOpenProduct }))
      .resolves.toMatchObject({ savedPrice: { amountMinor: 7000, currency: "GBP" }, sku: "314216963604" });
    expect(readOpenProduct).not.toHaveBeenCalled();
  });

  it("uses the selected variant's stock state separately from other colours", () => {
    const document = parseHTML(html).document;
    const script = document.querySelector('script[type="application/ld+json"]')!;
    const group = JSON.parse(script.textContent!);
    group.hasVariant.find((variant: { sku: string }) => variant.sku === group.sku).offers.availability = "https://schema.org/OutOfStock";
    script.textContent = JSON.stringify(group);
    expect(extractSavedProduct(document, pageUrl)).toMatchObject({
      sku: "314216963604", availability: "out_of_stock", savedPrice: { amountMinor: 7000, currency: "GBP" },
    });
  });

  it.each([
    ["a category", "https://www.footlocker.co.uk/en/category/shoes.html"],
    ["an unknown colour", pageUrl.replace("314216963604", "999999999999")],
    ["a different store", pageUrl.replace("www.footlocker.co.uk", "other.example.com")],
  ])("rejects %s even when group data is present", (_name, url) => {
    expect(extract(html, url)).toBeNull();
  });

  it("rejects stale selected-colour metadata and duplicate ambiguous variants", () => {
    expect(extract(html.replace('"sku": "314216963604"', '"sku": "314216961004"'))).toBeNull();
    const document = parseHTML(html).document;
    const script = document.querySelector('script[type="application/ld+json"]')!;
    const group = JSON.parse(script.textContent!);
    group.hasVariant.push(group.hasVariant.find((variant: { sku: string }) => variant.sku === group.sku));
    script.textContent = JSON.stringify(group);
    expect(extractSavedProduct(document, pageUrl)).toBeNull();
  });

  it("supports the same schema pattern on other stores", () => {
    const genericHtml = html.replaceAll("www.footlocker.co.uk", "shoes.example.com");
    expect(extract(genericHtml, pageUrl.replace("www.footlocker.co.uk", "shoes.example.com")))
      .toMatchObject({ savedPrice: { amountMinor: 7000, currency: "GBP" }, sku: "314216963604" });
  });
});
