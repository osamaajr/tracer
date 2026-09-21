import type { PurchaseDraft, PurchaseLineItemDraft } from "../domain/types";
import { parsePrice } from "../domain/money";
import { selectProductImage } from "./productImage";
import {
  createGenericRetailerIdFromHost,
  deriveRetailerNameFromHost,
  normalizePublicStoreUrl,
} from "./urlSafety";

const shopifyAccountHost = "shopify.com";

export function isShopifyAccountOrderUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.hostname.toLowerCase() === shopifyAccountHost &&
      /^\/\d+\/account\/orders\/[a-z0-9_-]+\/?$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function extractShopifyAccountPurchaseFromDocument(
  document: Document,
  sourceUrl: string,
  fallbackNow: string | Date = new Date(),
): PurchaseDraft | null {
  if (!isShopifyAccountOrderUrl(sourceUrl)) {
    return null;
  }

  const candidateRows = Array.from(
    document.querySelectorAll("tr, [role='row']"),
  ).filter((row) => row.querySelector("a[href*='/products/']"));
  const rows = candidateRows.length > 0
    ? candidateRows
    : Array.from(document.querySelectorAll("a[href*='/products/']"));
  const extracted = rows.flatMap((row) => extractLineItem(row, sourceUrl));
  const lineItems = dedupeLineItems(extracted);

  if (lineItems.length === 0) {
    return null;
  }

  const productUrl = lineItems[0]?.productUrl;
  if (!productUrl) {
    return null;
  }

  const storeHost = new URL(productUrl).hostname.toLowerCase();
  if (
    lineItems.some(
      (item) => !item.productUrl || new URL(item.productUrl).hostname.toLowerCase() !== storeHost,
    )
  ) {
    return null;
  }

  const orderReference = extractOrderReference(document);
  const draft: PurchaseDraft = {
    retailerId: createGenericRetailerIdFromHost(storeHost),
    retailerName: extractStoreName(document, storeHost),
    storeHost,
    sourceUrl,
    purchasedAt: extractConfirmedDate(document, fallbackNow),
    lineItems,
    captureMethod: "generic_dom",
    captureConfidence: "high",
  };

  if (orderReference) {
    draft.orderReference = orderReference;
  }

  return draft;
}

function extractLineItem(root: Element, sourceUrl: string): PurchaseLineItemDraft[] {
  const anchor = root.matches("a[href*='/products/']")
    ? root
    : root.querySelector("a[href*='/products/']");
  const rawUrl = anchor?.getAttribute("href");

  if (!anchor || !rawUrl) {
    return [];
  }

  let normalized;
  try {
    normalized = normalizePublicStoreUrl(new URL(rawUrl, sourceUrl).toString());
  } catch {
    return [];
  }

  if (!new URL(normalized.url).pathname.toLowerCase().includes("/products/")) {
    return [];
  }

  const productName = extractProductName(root, anchor);
  const quantity = extractQuantity(root);
  const pricePaid = extractLineItemPrice(root, quantity);

  if (!productName || !pricePaid || pricePaid.amountMinor <= 0) {
    return [];
  }

  const item: PurchaseLineItemDraft = {
    productName,
    quantity,
    pricePaid,
    productUrl: normalized.url,
    productUrlConfidence: "high",
  };
  const productUrl = new URL(normalized.url);
  const variantId = productUrl.searchParams.get("variant");
  const productImage = root.querySelector<HTMLImageElement>("img");
  const imageUrl = selectProductImage([{
    value: [
      productImage?.getAttribute("srcset"),
      productImage?.getAttribute("data-srcset"),
      productImage?.getAttribute("data-zoom-image"),
      productImage?.getAttribute("data-src"),
      productImage?.getAttribute("src"),
    ],
    source: "order_confirmation",
    width: Number(productImage?.getAttribute("width")) || undefined,
    height: Number(productImage?.getAttribute("height")) || undefined,
    alt: productImage?.alt,
  }], sourceUrl, productName)?.url;

  if (variantId && /^\d+$/.test(variantId)) {
    item.externalProductId = variantId;
  }
  if (imageUrl) {
    item.imageUrl = imageUrl;
  }

  return [item];
}

function extractLineItemPrice(root: Element, quantity: number): ReturnType<typeof parsePrice> {
  const elements = Array.from(root.querySelectorAll([
    "[data-afterbuy-price-paid]",
    "[data-line-item-price]",
    "[data-line-price]",
    "[data-line-total]",
    "[data-test*='price' i]",
    "[data-testid*='price' i]",
    "[class*='price' i]",
    "th",
    "td",
    "[role='cell']",
  ].join(",")));
  const candidates = [...new Set(elements)]
    .map((element) => cleanText(element.textContent))
    .filter((text): text is string => Boolean(
      text && hasCurrencyAmount(text) && !/(?:saving|discount|shipping|delivery|tax|refund)/i.test(text),
    ));
  const source = candidates.at(-1) ?? cleanText(root.textContent);
  const price = parseLastPrice(source);
  if (!price || quantity <= 1 || isUnitPrice(source)) return price;
  return {
    amountMinor: Math.max(1, Math.round(price.amountMinor / quantity)),
    currency: price.currency,
  };
}

function isUnitPrice(value: string | undefined): boolean {
  return Boolean(
    value && /(?:each|per\s+(?:item|unit)|unit\s+price|\/\s*(?:item|unit)|\bea\.?\b)/i.test(value),
  );
}

function parseLastPrice(value: string | undefined): ReturnType<typeof parsePrice> {
  if (!value) return null;
  const matches = value.match(
    /(?:(?:£|\$|€|\b(?:GBP|USD|EUR)\b)\s*-?\s*\d[\d.,]*|\d[\d.,]*\s*\b(?:GBP|USD|EUR)\b)/gi,
  );
  for (const match of matches?.reverse() ?? []) {
    const parsed = parsePrice(match);
    if (parsed && parsed.amountMinor > 0) return parsed;
  }
  return parsePrice(value);
}

function extractProductName(root: Element, anchor: Element): string | undefined {
  const directCandidates = [
    anchor.getAttribute("aria-label"),
    anchor.getAttribute("title"),
    anchor.textContent,
    anchor.querySelector("img")?.getAttribute("alt"),
  ];

  for (const candidate of directCandidates) {
    const cleaned = cleanProductName(candidate);
    if (cleaned) {
      return cleaned;
    }
  }

  for (const cell of Array.from(root.querySelectorAll("th, td, [role='cell']"))) {
    const cleaned = cleanProductName(cell.textContent);
    if (cleaned) {
      return cleaned;
    }
  }

  return undefined;
}

function cleanProductName(value: string | null | undefined): string | undefined {
  const text = cleanText(value);
  if (
    !text ||
    text.length < 3 ||
    hasCurrencyAmount(text) ||
    /^(view|open|product|item|image|buy again)$/i.test(text)
  ) {
    return undefined;
  }

  return text.replace(/\s+(?:product\s+)?image$/i, "").trim() || undefined;
}

function extractQuantity(root: Element): number {
  const explicit = root.querySelector(
    "[data-quantity], [aria-label^='Quantity'], [aria-label*=' quantity']",
  );
  const candidate = explicit?.getAttribute("data-quantity") ??
    explicit?.getAttribute("aria-label") ??
    explicit?.textContent;
  const match = candidate?.match(/\b(\d+)\b/);
  const quantity = match?.[1] ? Number.parseInt(match[1], 10) : 1;
  return Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
}

function dedupeLineItems(items: PurchaseLineItemDraft[]): PurchaseLineItemDraft[] {
  const unique = new Map<string, PurchaseLineItemDraft>();
  for (const item of items) {
    const key = `${item.productUrl ?? ""}|${item.productName}|${item.pricePaid.currency}|${item.pricePaid.amountMinor}`;
    if (!unique.has(key)) {
      unique.set(key, item);
    }
  }
  return Array.from(unique.values());
}

function extractStoreName(document: Document, storeHost: string): string {
  const titleMatch = document.title.match(/^Order\s+#?.+?\s+-\s+(.+?)\s+-\s+Account$/i);
  if (titleMatch?.[1]?.trim()) {
    return titleMatch[1].trim();
  }

  const logoAlt = Array.from(document.querySelectorAll("img[alt]"))
    .map((image) => image.getAttribute("alt")?.trim())
    .find((alt) => alt && /\blogo$/i.test(alt));
  if (logoAlt) {
    return logoAlt.replace(/\s+logo$/i, "").trim();
  }

  return deriveRetailerNameFromHost(storeHost);
}

function extractOrderReference(document: Document): string | undefined {
  const text = `${document.title} ${document.body?.textContent ?? ""}`;
  return text.match(/\bOrder\s+#\s*([a-z0-9-]+)/i)?.[1];
}

function extractConfirmedDate(document: Document, fallbackNow: string | Date): string {
  const explicitDate = Array.from(document.querySelectorAll("time[datetime]"))
    .map((time) => time.getAttribute("datetime"))
    .find((value) => value && !Number.isNaN(new Date(value).getTime()));
  if (explicitDate) {
    return new Date(explicitDate).toISOString();
  }

  const text = document.body?.textContent ?? "";
  const match = text.match(
    /Confirmed\s*(\d{1,2}\s+[A-Za-z]{3,9}(?:\s+\d{4})?)/i,
  );
  if (!match?.[1]) {
    return normalizeFallbackDate(fallbackNow);
  }

  const fallback = new Date(fallbackNow);
  const valueIncludesYear = /\b\d{4}\b/.test(match[1]);
  let parsed = new Date(`${match[1]}${valueIncludesYear ? "" : ` ${fallback.getUTCFullYear()}`} UTC`);

  if (Number.isNaN(parsed.getTime())) {
    return normalizeFallbackDate(fallbackNow);
  }

  if (!valueIncludesYear && parsed.getTime() > fallback.getTime() + 7 * 86_400_000) {
    parsed = new Date(Date.UTC(
      parsed.getUTCFullYear() - 1,
      parsed.getUTCMonth(),
      parsed.getUTCDate(),
    ));
  }

  return parsed.toISOString();
}

function normalizeFallbackDate(value: string | Date): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function cleanText(value: string | null | undefined): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  return text || undefined;
}

function hasCurrencyAmount(value: string): boolean {
  return /(?:£|\$|€|\bGBP\b|\bUSD\b|\bEUR\b)\s*-?\s*\d/i.test(value);
}
