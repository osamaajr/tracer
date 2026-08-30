import { parsePrice } from "../domain/money";
import type { PurchaseDraft, PurchaseLineItemDraft, ProductPriceSnapshot } from "../domain/types";
import {
  asRecord,
  extractJsonLdObjects,
  findJsonLdByType,
  firstString,
  readString,
} from "./jsonLd";
import {
  createGenericRetailerIdFromHost,
  deriveRetailerNameFromHost,
  normalizePublicStoreUrl,
} from "./urlSafety";

export function extractGenericPurchaseFromDocument(
  document: Document,
  sourceUrl: string,
  fallbackNow: Date = new Date(),
): PurchaseDraft | null {
  const storefront = getStorefront(sourceUrl);

  if (!storefront) {
    return null;
  }

  const jsonLdOrder = findJsonLdByType(extractJsonLdObjects(document), "Order");
  const jsonLdLineItems = jsonLdOrder
    ? extractLineItemsFromJsonLdOrder(jsonLdOrder, sourceUrl, storefront.host)
    : [];

  if (jsonLdLineItems.length > 0) {
    return buildDraft({
      sourceUrl,
      storefront,
      purchasedAt:
        firstString(jsonLdOrder?.orderDate) ??
        firstString(jsonLdOrder?.orderDateTime) ??
        fallbackNow.toISOString(),
      orderReference:
        firstString(jsonLdOrder?.orderNumber) ??
        firstString(jsonLdOrder?.identifier) ??
        extractOrderReference(document.body?.textContent ?? ""),
      lineItems: jsonLdLineItems,
      captureMethod: "generic_schema_org",
      captureConfidence: "high",
    });
  }

  if (!looksLikeOrderConfirmation(document, sourceUrl)) {
    return null;
  }

  const domLineItems = extractLineItemsFromDom(document, sourceUrl, storefront.host);

  if (domLineItems.length === 0) {
    return null;
  }

  return buildDraft({
    sourceUrl,
    storefront,
    purchasedAt:
      attrFromSelectors(document, ["time[datetime]", "[data-afterbuy-purchased-at]"], "datetime") ??
      fallbackNow.toISOString(),
    orderReference: extractOrderReference(document.body?.textContent ?? ""),
    lineItems: domLineItems,
    captureMethod: "generic_dom",
    captureConfidence: "medium",
  });
}

export function extractGenericProductFromDocument(
  document: Document,
  productUrl: string,
  observedAt: string = new Date().toISOString(),
): ProductPriceSnapshot | null {
  const storefront = getStorefront(productUrl);

  if (!storefront) {
    return null;
  }

  const product = findJsonLdByType(extractJsonLdObjects(document), "Product");
  const offer = getOffer(product);
  const productName =
    firstString(product?.name) ??
    document.querySelector("h1")?.textContent?.trim() ??
    document.title.trim();
  const priceCurrency = firstString(offer?.priceCurrency) ?? "GBP";
  const price =
    parsePrice(firstString(offer?.price) ?? String(offer?.price ?? ""), priceCurrency) ??
    parsePrice(
      document
        .querySelector<HTMLElement>(
          "[data-afterbuy-current-price], [data-test='product-price'], [itemprop='price'], .price",
        )
        ?.textContent?.trim(),
      priceCurrency,
    );

  if (!productName || !price) {
    return null;
  }

  const normalized = normalizePublicStoreUrl(productUrl);
  const snapshot: ProductPriceSnapshot = {
    retailerId: storefront.retailerId,
    retailerName: storefront.retailerName,
    storeHost: storefront.host,
    productUrl: normalized.url,
    productName,
    price,
    observedAt,
    availability: getAvailability(offer),
  };

  const sku = firstString(product?.sku);
  const imageUrl = firstString(product?.image);

  if (sku) {
    snapshot.sku = sku;
  }
  if (imageUrl) {
    snapshot.imageUrl = imageUrl;
  }

  return snapshot;
}

export function looksLikeOrderConfirmation(document: Document, sourceUrl: string): boolean {
  let url: URL;

  try {
    url = new URL(sourceUrl);
  } catch {
    return false;
  }

  const path = `${url.pathname} ${url.search}`.toLowerCase();
  const bodyText = (document.body?.textContent ?? "").toLowerCase().replace(/\s+/g, " ");

  return (
    /order|checkout|confirmation|confirmed|complete|receipt|thank/.test(path) &&
    /(thank you|thanks|confirmed|complete|order number|order ref|receipt)/.test(bodyText) &&
    /(order|purchase|receipt)/.test(bodyText)
  );
}

function extractLineItemsFromJsonLdOrder(
  order: Record<string, unknown>,
  sourceUrl: string,
  expectedHost: string,
): PurchaseLineItemDraft[] {
  const entries = [
    ...toArray(order.acceptedOffer),
    ...toArray(order.orderedItem),
    ...toArray(order.itemListElement),
  ];
  const priceCurrency = firstString(order.priceCurrency) ?? "GBP";

  return entries
    .map((entry) =>
      extractLineItemFromJsonLdEntry(asRecord(entry), sourceUrl, expectedHost, priceCurrency),
    )
    .filter((item): item is PurchaseLineItemDraft => item !== null);
}

function extractLineItemFromJsonLdEntry(
  entry: Record<string, unknown> | null,
  sourceUrl: string,
  expectedHost: string,
  fallbackCurrency: string,
): PurchaseLineItemDraft | null {
  if (!entry) {
    return null;
  }

  const product = asRecord(entry.itemOffered) ?? asRecord(entry.item) ?? asRecord(entry.product);
  const name = firstString(product?.name) ?? firstString(entry.name);
  const rawUrl = firstString(product?.url) ?? firstString(entry.url);
  const currency = firstString(entry.priceCurrency) ?? fallbackCurrency;
  const price = parsePrice(firstString(entry.price) ?? String(entry.price ?? ""), currency);

  if (!name || !rawUrl || !price) {
    return null;
  }

  const normalized = normalizeItemUrl(rawUrl, sourceUrl, expectedHost);

  if (!normalized) {
    return null;
  }

  const item: PurchaseLineItemDraft = {
    productName: name,
    quantity: parseQuantity(entry.eligibleQuantity ?? entry.quantity),
    pricePaid: price,
    productUrl: normalized.url,
    productUrlConfidence: "high",
  };
  const sku = firstString(product?.sku) ?? firstString(entry.sku);
  const productId = firstString(product?.productID) ?? firstString(entry.productID);
  const imageUrl = firstString(product?.image);

  if (sku) {
    item.sku = sku;
  }
  if (productId) {
    item.externalProductId = productId;
  }
  if (imageUrl) {
    item.imageUrl = imageUrl;
  }

  return item;
}

function extractLineItemsFromDom(
  document: Document,
  sourceUrl: string,
  expectedHost: string,
): PurchaseLineItemDraft[] {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      [
        "[data-afterbuy-line-item]",
        "[data-test*='order'][data-test*='item']",
        "[class*='order'][class*='item']",
        "[class*='line'][class*='item']",
      ].join(","),
    ),
  ).slice(0, 10);

  return candidates
    .map((element) => extractLineItemFromDomElement(element, sourceUrl, expectedHost))
    .filter((item): item is PurchaseLineItemDraft => item !== null);
}

function extractLineItemFromDomElement(
  element: HTMLElement,
  sourceUrl: string,
  expectedHost: string,
): PurchaseLineItemDraft | null {
  const name =
    element.dataset.afterbuyProductName ??
    textFromSelectors(element, [
      "[data-afterbuy-product-name]",
      "[data-test*='name']",
      "h1",
      "h2",
      "h3",
      "a",
    ]);
  const rawUrl =
    element.dataset.afterbuyProductUrl ??
    element.querySelector<HTMLAnchorElement>("a[href]")?.href;
  const priceText =
    element.dataset.afterbuyPricePaid ??
    textFromSelectors(element, [
      "[data-afterbuy-price-paid]",
      "[data-test*='price']",
      "[class*='price']",
    ]);

  if (!name || !rawUrl || !priceText) {
    return null;
  }

  const normalized = normalizeItemUrl(rawUrl, sourceUrl, expectedHost);

  if (!normalized) {
    return null;
  }

  const pricePaid = parsePrice(priceText);

  if (!pricePaid) {
    return null;
  }

  const item: PurchaseLineItemDraft = {
    productName: name,
    quantity: parseQuantity(
      element.dataset.afterbuyQuantity ??
        textFromSelectors(element, [
          "[data-afterbuy-quantity]",
          "[data-test*='quantity']",
          "[class*='quantity']",
        ]),
    ),
    pricePaid,
    productUrl: normalized.url,
    productUrlConfidence: "medium",
  };
  const sku =
    element.dataset.afterbuySku ??
    textFromSelectors(element, ["[data-afterbuy-sku]", "[data-test*='sku']"]);

  if (sku) {
    item.sku = sku;
  }

  return item;
}

function buildDraft(input: {
  sourceUrl: string;
  storefront: Storefront;
  purchasedAt: string;
  orderReference: string | null;
  lineItems: PurchaseLineItemDraft[];
  captureMethod: PurchaseDraft["captureMethod"];
  captureConfidence: PurchaseDraft["captureConfidence"];
}): PurchaseDraft {
  const draft: PurchaseDraft = {
    retailerId: input.storefront.retailerId,
    retailerName: input.storefront.retailerName,
    storeHost: input.storefront.host,
    sourceUrl: input.sourceUrl,
    purchasedAt: new Date(input.purchasedAt).toISOString(),
    lineItems: input.lineItems,
    captureMethod: input.captureMethod,
    captureConfidence: input.captureConfidence,
  };

  if (input.orderReference) {
    draft.orderReference = input.orderReference;
  }

  return draft;
}

interface Storefront {
  retailerId: string;
  retailerName: string;
  host: string;
}

function getStorefront(sourceUrl: string): Storefront | null {
  try {
    const normalized = normalizePublicStoreUrl(sourceUrl);
    return {
      retailerId: createGenericRetailerIdFromHost(normalized.host),
      retailerName: deriveRetailerNameFromHost(normalized.host),
      host: normalized.host,
    };
  } catch {
    return null;
  }
}

function toAbsoluteUrl(rawUrl: string, baseUrl: string): string {
  return new URL(rawUrl, baseUrl).toString();
}

function normalizeItemUrl(
  rawUrl: string,
  sourceUrl: string,
  expectedHost: string,
): ReturnType<typeof normalizePublicStoreUrl> | null {
  try {
    return normalizePublicStoreUrl(toAbsoluteUrl(rawUrl, sourceUrl), {
      expectedHost,
    });
  } catch {
    return null;
  }
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

function textFromSelectors(root: ParentNode, selectors: string[]): string | null {
  for (const selector of selectors) {
    const value = root.querySelector<HTMLElement>(selector)?.textContent?.trim();

    if (value) {
      return value;
    }
  }

  return null;
}

function attrFromSelectors(root: ParentNode, selectors: string[], attribute: string): string | null {
  for (const selector of selectors) {
    const value = root.querySelector<HTMLElement>(selector)?.getAttribute(attribute)?.trim();

    if (value) {
      return value;
    }
  }

  return null;
}

function extractOrderReference(text: string): string | null {
  const match = text.match(
    /order\s*(?:number|no\.?|ref(?:erence)?|id)\s*[:#]?\s*([A-Z0-9-]{5,})/i,
  );
  return readString(match?.[1]);
}

function parseQuantity(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value !== "string") {
    return 1;
  }

  const match = value.match(/[0-9]+/);
  const quantity = match?.[0] ? Number.parseInt(match[0], 10) : 1;

  return Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
}

function toArray(value: unknown): unknown[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}
