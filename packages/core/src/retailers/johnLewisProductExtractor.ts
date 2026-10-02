import { parseGbpPrice } from "../domain/money";
import type { ProductPriceSnapshot } from "../domain/types";
import { asRecord, extractJsonLdObjects, flattenJsonLd, firstString, jsonLdHasType } from "./jsonLd";
import { findProductPageImage } from "./productImage";
import { normalizeRetailerUrl } from "./urlSafety";

export function extractJohnLewisProductFromDocument(
  document: Document,
  productUrl: string,
  observedAt: string = new Date().toISOString(),
  expectedProductName?: string,
): ProductPriceSnapshot | null {
  const normalized = normalizeRetailerUrl("john-lewis", productUrl, {
    requireProductUrl: true,
  });
  const productNodes = flattenJsonLd(extractJsonLdObjects(document))
    .filter((value) => jsonLdHasType(value, "Product"));
  const jsonLdProduct = findJohnLewisProduct(productNodes, document, productUrl, expectedProductName);
  if (productNodes.length > 0 && !jsonLdProduct) return null;
  const offer = getOffer(jsonLdProduct);
  const name =
    firstString(jsonLdProduct?.name) ??
    document.querySelector("h1")?.textContent?.trim() ??
    document.title.trim();
  const heading = document.querySelector("h1");
  const priceRoot = heading?.closest<HTMLElement>(
    '[itemtype*="Product"], [data-testid*="product" i], [data-test*="product" i], main, article',
  ) ?? document;
  const price =
    parseGbpPrice(firstString(offer?.price) ?? String(offer?.price ?? "")) ??
    parseGbpPrice(
      priceRoot
        .querySelector<HTMLElement>(
          "[data-tracer-current-price], [data-test='product-price'], [itemprop='price'], .price",
        )
        ?.textContent?.trim(),
    );
  const image = findProductPageImage(document, productUrl, {
    structuredImage: jsonLdProduct?.image,
    productName: name,
    retailerSelectors: [
      "[data-test*='product-image' i] img",
      "[data-testid*='product-image' i] img",
      "[class*='product-image' i] img",
    ],
  });
  const sku = firstString(jsonLdProduct?.sku);

  if (!name || !price) {
    return null;
  }

  const snapshot: ProductPriceSnapshot = {
    retailerId: "john-lewis",
    retailerName: "John Lewis",
    storeHost: "www.johnlewis.com",
    productUrl: normalized.url,
    productName: name,
    price,
    observedAt,
    availability: getAvailability(offer),
  };

  if (normalized.productId) {
    snapshot.externalProductId = normalized.productId;
  }

  if (sku) {
    snapshot.sku = sku;
  }

  if (image) {
    snapshot.imageUrl = image.url;
  }

  return snapshot;
}

function findJohnLewisProduct(
  productNodes: unknown[],
  document: Document,
  productUrl: string,
  expectedProductName?: string,
): Record<string, unknown> | null {
  const products = productNodes
    .map(asRecord)
    .filter((value): value is Record<string, unknown> => value !== null);
  if (products.length === 0) return null;

  const requestedId = normalizeRetailerUrl("john-lewis", productUrl, { requireProductUrl: true }).productId;
  const urlMatches = products.filter((product) => johnLewisProductUrls(product).some((url) => {
    try {
      return normalizeRetailerUrl("john-lewis", new URL(url, productUrl).href, { requireProductUrl: true }).productId === requestedId;
    } catch {
      return false;
    }
  }));
  if (urlMatches.length === 1) return urlMatches[0] ?? null;

  const expectedNames = [expectedProductName, document.querySelector("h1")?.textContent]
    .map(normalizeProductName)
    .filter(Boolean);
  const nameMatches = products.filter((product) => {
    const name = normalizeProductName(product.name);
    return name && expectedNames.includes(name);
  });
  if (nameMatches.length === 1) return nameMatches[0] ?? null;

  if (products.length === 1) {
    const onlyProduct = products[0];
    return onlyProduct && johnLewisProductUrls(onlyProduct).length === 0 ? onlyProduct : null;
  }
  return null;
}

function johnLewisProductUrls(product: Record<string, unknown>): string[] {
  const output: string[] = [];
  for (const value of [product.url, product["@id"], product.mainEntityOfPage]) {
    if (typeof value === "string") output.push(value);
    else {
      const record = asRecord(value);
      const id = firstString(record?.["@id"]) ?? firstString(record?.url);
      if (id) output.push(id);
    }
  }
  return output;
}

function normalizeProductName(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    : "";
}

function getOffer(product: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!product) {
    return null;
  }

  const offers = product.offers;
  if (Array.isArray(offers)) {
    return asRecord(offers[0]);
  }

  return asRecord(offers);
}

function getAvailability(offer: Record<string, unknown> | null): ProductPriceSnapshot["availability"] {
  const availability = String(offer?.availability ?? "").toLowerCase();

  if (availability.includes("instock")) {
    return "in_stock";
  }

  if (availability.includes("outofstock")) {
    return "out_of_stock";
  }

  return "unknown";
}
