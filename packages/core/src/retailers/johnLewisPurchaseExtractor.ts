import { parseGbpPrice } from "../domain/money";
import type { PurchaseDraft, PurchaseLineItemDraft } from "../domain/types";
import { extractJsonLdObjects, findJsonLdByType, asRecord, firstString, readString } from "./jsonLd";
import {
  findOpenGraphImage,
  findOrderConfirmationImage,
  selectProductImage,
} from "./productImage";
import { extractJohnLewisProductId, normalizeRetailerUrl } from "./urlSafety";

export function isJohnLewisSupportedOrderPage(sourceUrl: string, document?: Document): boolean {
  let url: URL;

  try {
    url = new URL(sourceUrl);
  } catch {
    return false;
  }

  if (!["johnlewis.com", "www.johnlewis.com"].includes(url.hostname.toLowerCase())) {
    return false;
  }

  const path = url.pathname.toLowerCase();
  const looksLikeOrderPath =
    path.includes("order-confirmation") ||
    path.includes("order-confirmed") ||
    path.includes("order-complete") ||
    path.includes("checkout/confirmation") ||
    path.includes("thank-you");

  if (looksLikeOrderPath) {
    return true;
  }

  const bodyText = document?.body?.textContent?.toLowerCase() ?? "";

  return bodyText.includes("thanks for your order") && bodyText.includes("order number");
}

export function extractJohnLewisPurchaseFromDocument(
  document: Document,
  sourceUrl: string,
  fallbackNow: Date = new Date(),
): PurchaseDraft | null {
  if (!isJohnLewisSupportedOrderPage(sourceUrl, document)) {
    return null;
  }

  const jsonLdDraft = extractFromJsonLd(document, sourceUrl);
  if (jsonLdDraft) {
    return jsonLdDraft;
  }

  const orderReference =
    textFromSelectors(document, [
      "[data-tracer-order-reference]",
      "[data-order-number]",
      "[data-test='order-number']",
    ]) ?? extractOrderReference(document.body?.textContent ?? "");

  const purchasedAt =
    attrFromSelectors(document, [
      "[data-tracer-purchased-at]",
      "time[datetime]",
    ], "datetime") ??
    textFromSelectors(document, ["[data-tracer-purchased-at]"]) ??
    fallbackNow.toISOString();

  const lineItems = Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-tracer-line-item], [data-test='order-line-item'], .order-line-item, .order-item",
    ),
  )
    .map(extractLineItemFromElement)
    .filter((item): item is PurchaseLineItemDraft => item !== null);

  if (lineItems.length === 0) {
    return null;
  }

  const draft: PurchaseDraft = {
    retailerId: "john-lewis",
    retailerName: "John Lewis",
    storeHost: "www.johnlewis.com",
    sourceUrl,
    purchasedAt: new Date(purchasedAt).toISOString(),
    lineItems,
    captureMethod: "retailer_adapter",
    captureConfidence: "high",
  };

  if (orderReference) {
    draft.orderReference = orderReference;
  }

  return draft;
}

function extractFromJsonLd(document: Document, sourceUrl: string): PurchaseDraft | null {
  const order = findJsonLdByType(extractJsonLdObjects(document), "Order");

  if (!order) {
    return null;
  }

  const offers = Array.isArray(order.acceptedOffer)
    ? order.acceptedOffer
    : order.acceptedOffer
      ? [order.acceptedOffer]
      : [];

  const lineItems = offers
    .map((offer) => extractLineItemFromOffer(asRecord(offer), document, sourceUrl))
    .filter((item): item is PurchaseLineItemDraft => item !== null);

  if (lineItems.length === 0) {
    return null;
  }

  const orderDate = firstString(order.orderDate) ?? firstString(order.orderDateTime);
  const draft: PurchaseDraft = {
    retailerId: "john-lewis",
    retailerName: "John Lewis",
    storeHost: "www.johnlewis.com",
    sourceUrl,
    purchasedAt: orderDate ? new Date(orderDate).toISOString() : new Date().toISOString(),
    lineItems,
    captureMethod: "retailer_adapter",
    captureConfidence: "high",
  };

  const orderReference = firstString(order.orderNumber) ?? firstString(order.identifier);
  if (orderReference) {
    draft.orderReference = orderReference;
  }

  return draft;
}

function extractLineItemFromOffer(
  offer: Record<string, unknown> | null,
  document?: Document,
  sourceUrl?: string,
): PurchaseLineItemDraft | null {
  if (!offer) {
    return null;
  }

  const product = asRecord(offer.itemOffered) ?? asRecord(offer.item);
  const productName = firstString(product?.name) ?? firstString(offer.name);
  const productUrl = firstString(product?.url) ?? firstString(offer.url);
  const price = parseGbpPrice(firstString(offer.price) ?? String(offer.price ?? ""));
  const sku = firstString(product?.sku) ?? firstString(offer.sku);

  if (!productName || !productUrl || !price) {
    return null;
  }

  const normalized = normalizeRetailerUrl("john-lewis", productUrl, {
    requireProductUrl: true,
  });

  const item: PurchaseLineItemDraft = {
    productName,
    quantity: Number(offer.eligibleQuantity ?? 1) || 1,
    pricePaid: price,
    productUrl: normalized.url,
    productUrlConfidence: "high",
  };

  if (normalized.productId) {
    item.externalProductId = normalized.productId;
  }

  if (sku) {
    item.sku = sku;
  }

  const image = selectProductImage(
    [
      {
        value: document
          ? findOrderConfirmationImage(document, productName, normalized.url, sourceUrl ?? normalized.url)
          : null,
        source: "order_confirmation",
      },
      { value: product?.image, source: "json_ld" },
      {
        value: document && sourceUrl ? findOpenGraphImage(document, sourceUrl) : null,
        source: "open_graph",
      },
    ],
    sourceUrl,
    productName,
  );

  if (image) {
    item.imageUrl = image.url;
  }

  return item;
}

function extractLineItemFromElement(element: HTMLElement): PurchaseLineItemDraft | null {
  const productName =
    element.dataset.tracerProductName ??
    textFromSelectors(element, ["[data-tracer-product-name]", "h1", "h2", "h3", "a"]);
  const productHref =
    element.dataset.tracerProductUrl ??
    element.querySelector<HTMLAnchorElement>("a[href*='/p']")?.href;
  const priceText =
    element.dataset.tracerPricePaid ??
    textFromSelectors(element, [
      "[data-tracer-price-paid]",
      "[data-test='line-price']",
      ".price",
    ]);
  const quantityText =
    element.dataset.tracerQuantity ??
    textFromSelectors(element, ["[data-tracer-quantity]", "[data-test='quantity']"]);
  const sku =
    element.dataset.tracerSku ??
    textFromSelectors(element, ["[data-tracer-sku]", "[data-test='sku']"]);

  if (!productName || !productHref || !priceText) {
    return null;
  }

  const pricePaid = parseGbpPrice(priceText);

  if (!pricePaid) {
    return null;
  }

  const normalized = normalizeRetailerUrl("john-lewis", productHref, {
    requireProductUrl: true,
  });
  const externalProductId = normalized.productId ?? extractJohnLewisProductId(productHref);

  const item: PurchaseLineItemDraft = {
    productName,
    quantity: parseQuantity(quantityText),
    pricePaid,
    productUrl: normalized.url,
    productUrlConfidence: "high",
  };

  if (externalProductId) {
    item.externalProductId = externalProductId;
  }

  if (sku) {
    item.sku = sku;
  }

  const productImage = element.querySelector<HTMLImageElement>("img");
  const image = selectProductImage([{
    value: [
      productImage?.getAttribute("srcset"),
      productImage?.getAttribute("data-srcset"),
      productImage?.getAttribute("data-zoom-image"),
      elementImageUrl(element),
    ],
    source: "order_confirmation",
    width: Number(productImage?.getAttribute("width")) || undefined,
    height: Number(productImage?.getAttribute("height")) || undefined,
    alt: productImage?.alt,
  }], undefined, productName);

  if (image) {
    item.imageUrl = image.url;
  }

  return item;
}

function elementImageUrl(element: HTMLElement): string | null {
  const image = element.querySelector<HTMLImageElement>("img");

  return image?.currentSrc || image?.src || image?.getAttribute("data-src") || null;
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
  const match = text.match(/order\s*(?:number|ref(?:erence)?)\s*[:#]?\s*([A-Z0-9-]{6,})/i);
  return readString(match?.[1]);
}

function parseQuantity(value: string | null | undefined): number {
  if (!value) {
    return 1;
  }

  const match = value.match(/[0-9]+/);
  const quantity = match?.[0] ? Number.parseInt(match[0], 10) : 1;

  return Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
}
