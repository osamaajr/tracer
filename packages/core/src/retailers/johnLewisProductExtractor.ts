import { parseGbpPrice } from "../domain/money";
import type { ProductPriceSnapshot } from "../domain/types";
import { asRecord, extractJsonLdObjects, findJsonLdByType, firstString } from "./jsonLd";
import { normalizeRetailerUrl } from "./urlSafety";

export function extractJohnLewisProductFromDocument(
  document: Document,
  productUrl: string,
  observedAt: string = new Date().toISOString(),
): ProductPriceSnapshot | null {
  const normalized = normalizeRetailerUrl("john-lewis", productUrl, {
    requireProductUrl: true,
  });
  const jsonLdProduct = findJsonLdByType(extractJsonLdObjects(document), "Product");
  const offer = getOffer(jsonLdProduct);
  const name =
    firstString(jsonLdProduct?.name) ??
    document.querySelector("h1")?.textContent?.trim() ??
    document.title.trim();
  const price =
    parseGbpPrice(firstString(offer?.price) ?? String(offer?.price ?? "")) ??
    parseGbpPrice(
      document
        .querySelector<HTMLElement>(
          "[data-afterbuy-current-price], [data-test='product-price'], [itemprop='price'], .price",
        )
        ?.textContent?.trim(),
    );
  const imageUrl = firstString(jsonLdProduct?.image);
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

  if (imageUrl) {
    snapshot.imageUrl = imageUrl;
  }

  return snapshot;
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
