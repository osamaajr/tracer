import { parsePrice } from "../domain/money";
import { extractOrderTotalPaid } from "./orderTotal";
import { isCompletedPurchasePage } from "./purchasePage";
import type { PurchaseDraft, PurchaseLineItemDraft, ProductPriceSnapshot } from "../domain/types";
import {
  asRecord,
  extractJsonLdObjects,
  flattenJsonLd,
  findJsonLdByType,
  firstString,
  jsonLdHasType,
  readString,
} from "./jsonLd";
import {
  createGenericRetailerIdFromHost,
  deriveRetailerNameFromHost,
  normalizePublicStoreUrl,
} from "./urlSafety";
import {
  findOpenGraphImage,
  findOrderConfirmationImage,
  findProductPageImage,
  selectProductImage,
} from "./productImage";

export function extractGenericPurchaseFromDocument(
  document: Document,
  sourceUrl: string,
  fallbackNow: Date = new Date(),
): PurchaseDraft | null {
  const storefront = getStorefront(sourceUrl);

  if (!storefront || !isCompletedPurchasePage(document, sourceUrl)) {
    return null;
  }

  const jsonLdOrder = findJsonLdByType(extractJsonLdObjects(document), "Order");
  const jsonLdLineItems = jsonLdOrder
    ? extractLineItemsFromJsonLdOrder(jsonLdOrder, document, sourceUrl, storefront.host)
    : [];

  if (jsonLdLineItems.length > 0) {
    const draft = buildDraft({
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
    const orderTotalPaid = extractOrderTotalPaid(document, jsonLdLineItems[0]!.pricePaid.currency, jsonLdOrder);
    if (orderTotalPaid) draft.orderTotalPaid = orderTotalPaid;
    return draft;
  }

  if (!looksLikeOrderConfirmation(document, sourceUrl)) {
    return null;
  }

  const domLineItems = extractLineItemsFromDom(document, sourceUrl, storefront.host);

  if (domLineItems.length === 0) {
    return null;
  }

  const draft = buildDraft({
    sourceUrl,
    storefront,
    purchasedAt: extractPurchaseDate(document, fallbackNow),
    orderReference: extractOrderReference(document.body?.textContent ?? ""),
    lineItems: domLineItems,
    captureMethod: "generic_dom",
    captureConfidence: domLineItems.every((item) => Boolean(item.productUrl)) ? "medium" : "low",
  });
  const orderTotalPaid = extractOrderTotalPaid(document, domLineItems[0]!.pricePaid.currency);
  if (orderTotalPaid) draft.orderTotalPaid = orderTotalPaid;
  return draft;
}

export function extractGenericProductFromDocument(
  document: Document,
  productUrl: string,
  observedAt: string = new Date().toISOString(),
  expectedProductName?: string,
): ProductPriceSnapshot | null {
  const storefront = getStorefront(productUrl);

  if (!storefront) {
    return null;
  }

  const productNodes = flattenJsonLd(extractJsonLdObjects(document))
    .filter((value) => jsonLdHasType(value, "Product"));
  const product = findProductForPage(
    productNodes,
    document,
    productUrl,
    storefront.host,
    expectedProductName,
  );
  if (productNodes.length > 0 && !product) return null;
  const offer = getPageOffer(product, productUrl);
  if (product?.offers !== undefined && !offer) return null;
  const productName =
    firstString(product?.name) ??
    document.querySelector("h1")?.textContent?.trim() ??
    document.title.trim();
  const priceCurrency = firstString(offer?.priceCurrency) ??
    document.querySelector<HTMLMetaElement>("meta[property='product:price:currency'], meta[itemprop='priceCurrency']")?.content ??
    "GBP";
  const heading = document.querySelector("h1");
  const priceRoot = heading?.closest<HTMLElement>(
    '[itemtype*="Product"], [data-product], [data-testid*="product" i], main, article',
  ) ?? document;
  const visiblePrice = findCurrentProductPrice(priceRoot, priceCurrency);
  const offerPrice = parsePrice(firstString(offer?.price) ?? String(offer?.price ?? ""), priceCurrency);
  const price =
    (new URL(productUrl).searchParams.has("variant") ? offerPrice : visiblePrice) ?? offerPrice ?? visiblePrice ??
    parsePrice(document.querySelector<HTMLMetaElement>("meta[property='product:price:amount']")?.content, priceCurrency);

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
  const externalProductId = new URL(productUrl).searchParams.get("variant") ?? firstString(product?.productID);
  const image = findProductPageImage(document, productUrl, {
    structuredImage: product?.image,
    productName,
  });

  if (sku) {
    snapshot.sku = sku;
  }
  if (externalProductId) {
    snapshot.externalProductId = externalProductId;
  }
  if (image) {
    snapshot.imageUrl = image.url;
  }

  return snapshot;
}

function findProductForPage(
  productNodes: unknown[],
  document: Document,
  productUrl: string,
  expectedHost: string,
  expectedProductName?: string,
): Record<string, unknown> | null {
  const products = productNodes
    .map(asRecord)
    .filter((value): value is Record<string, unknown> => value !== null);

  if (products.length === 0) return null;

  const requested = normalizeItemUrl(productUrl, productUrl, expectedHost)?.url;
  const urlMatches = products.filter((candidate) =>
    productJsonLdUrls(candidate).some((url) =>
      normalizeItemUrl(url, productUrl, expectedHost)?.url === requested,
    ),
  );
  if (urlMatches.length > 0) return reconcileProductRecords(urlMatches, productUrl, expectedHost);

  const names = [expectedProductName, document.querySelector("h1")?.textContent]
    .map(normalizeProductName)
    .filter(Boolean);
  const nameMatches = products.filter((candidate) => {
    const candidateName = normalizeProductName(candidate.name);
    return candidateName && names.some((name) => candidateName === name);
  });
  if (nameMatches.length === 1) return nameMatches[0] ?? null;
  if (nameMatches.length > 1) return reconcileProductRecords(nameMatches, productUrl, expectedHost);

  if (products.length === 1) {
    const onlyProduct = products[0];
    return onlyProduct && productJsonLdUrls(onlyProduct).length === 0 ? onlyProduct : null;
  }

  // Multiple product nodes with no unambiguous identity are common on pages
  // containing recommendations. Fail closed instead of monitoring a neighbor.
  return null;
}

/** Themes and SEO plugins often publish the same product independently. */
function reconcileProductRecords(
  products: Record<string, unknown>[],
  productUrl: string,
  expectedHost: string,
): Record<string, unknown> | null {
  if (products.length === 1) return products[0] ?? null;
  const requested = new URL(productUrl);
  const names = new Set(products.map((product) => normalizeProductName(product.name)));
  if (names.size !== 1 || names.has("")) return null;
  const prices = products.map((product) => {
    // A matching name alone is insufficient: each duplicate must identify this page.
    const samePage = productJsonLdUrls(product).some((raw) => {
      const normalized = normalizeItemUrl(raw, productUrl, expectedHost);
      if (!normalized) return false;
      const url = new URL(normalized.url);
      return url.origin === requested.origin && url.pathname === requested.pathname;
    });
    const offer = getPageOffer(product, productUrl);
    return samePage && offer
      ? parsePrice(String(offer.price ?? ""), firstString(offer.priceCurrency) ?? "GBP")
      : null;
  });
  if (prices.some((price) => !price)) return null;
  const values = new Set(prices.map((price) => `${price!.currency}:${price!.amountMinor}`));
  if (values.size !== 1) return null;
  return products[0] ?? null;
}

/** Select the requested offer, never the first price from a different variant. */
function getPageOffer(product: Record<string, unknown> | null, productUrl: string): Record<string, unknown> | null {
  if (!product) return null;
  const offers = (Array.isArray(product.offers) ? product.offers : [product.offers])
    .map(asRecord).filter((offer): offer is Record<string, unknown> => offer !== null);
  const requested = new URL(productUrl);
  const variant = requested.searchParams.get("variant");
  const matching = offers.filter((offer) => {
    const raw = firstString(offer.url) ?? firstString(offer["@id"]);
    if (!raw) return !variant && offers.length === 1;
    try {
      const url = new URL(raw, productUrl);
      return url.origin === requested.origin && url.pathname === requested.pathname &&
        (!variant || url.searchParams.get("variant") === variant);
    } catch { return false; }
  });
  if (!matching.length) return null;
  const prices = matching.map((offer) => parsePrice(String(offer.price ?? ""), firstString(offer.priceCurrency) ?? "GBP"));
  if (prices.some((price) => !price) ||
    new Set(prices.map((price) => `${price!.currency}:${price!.amountMinor}`)).size !== 1) return null;
  return matching[0] ?? null;
}

function productJsonLdUrls(product: Record<string, unknown>): string[] {
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

function isInstallmentPrice(value: string | undefined): boolean {
  return Boolean(value && /(per\s+month|monthly|\/\s*mo\b|finance|instalment|installment)/i.test(value));
}

function findCurrentProductPrice(root: ParentNode, currency: string): ReturnType<typeof parsePrice> {
  const selectors = [
    "[data-tracer-current-price]",
    "[data-test='product-price']",
    "[data-testid*='current-price' i]",
    "[itemprop='price']",
    "[class*='current-price' i]",
    "[class*='sale-price' i]",
    "[class*='price-current' i]",
  ];
  for (const selector of selectors) {
    const prices = Array.from(root.querySelectorAll<HTMLElement>(selector)).flatMap((element) => {
      if (element.closest("[class*='recommend' i], [class*='related' i], [data-testid*='recommend' i]")) return [];
      const text = element.getAttribute("content") ?? element.textContent?.replace(/\s+/g, " ").trim();
      if (!text || isInstallmentPrice(text) || /\b(?:from|starting at|as low as|up to)\b/i.test(text)) return [];
      const now = text.match(/\bnow\s*((?:£|\$|€|GBP|USD|EUR)\s*\d[\d.,]*)/i)?.[1];
      const candidate = now ?? text;
      const amounts = candidate.match(/(?:(?:£|\$|€|GBP|USD|EUR)\s*\d[\d.,]*|\d[\d.,]*\s*(?:GBP|USD|EUR))/gi) ?? [];
      if (!now && amounts.length > 1) return [];
      const parsed = parsePrice(amounts[0] ?? candidate, currency);
      return parsed && parsed.amountMinor > 0 ? [parsed] : [];
    });
    const unique = [...new Set(prices.map((price) => `${price.currency}:${price.amountMinor}`))];
    if (unique.length === 1) return prices[0] ?? null;
    if (unique.length > 1) return null;
  }
  return null;
}

export function looksLikeOrderConfirmation(document: Document, sourceUrl: string): boolean {
  return isCompletedPurchasePage(document, sourceUrl);
}

function extractLineItemsFromJsonLdOrder(
  order: Record<string, unknown>,
  document: Document,
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
      extractLineItemFromJsonLdEntry(
        asRecord(entry),
        document,
        sourceUrl,
        expectedHost,
        priceCurrency,
      ),
    )
    .filter((item): item is PurchaseLineItemDraft => item !== null);
}

function extractLineItemFromJsonLdEntry(
  entry: Record<string, unknown> | null,
  document: Document,
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
  const offer = asRecord(entry.acceptedOffer) ?? asRecord(entry.offers) ?? getOffer(product);
  const price = parsePrice(
    firstString(entry.orderItemPrice) ??
      firstString(entry.price) ??
      firstString(offer?.price) ??
      firstString(product?.price) ??
      String(entry.price ?? ""),
    firstString(entry.priceCurrency) ?? firstString(offer?.priceCurrency) ?? currency,
  );

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
  const image = selectProductImage(
    [
      {
        value: findOrderConfirmationImage(document, name, normalized.url, sourceUrl),
        source: "order_confirmation",
      },
      { value: product?.image, source: "json_ld" },
      { value: findOpenGraphImage(document, sourceUrl), source: "open_graph" },
    ],
    sourceUrl,
    name,
  );

  if (sku) {
    item.sku = sku;
  }
  if (productId) {
    item.externalProductId = productId;
  }
  if (image) {
    item.imageUrl = image.url;
  }

  return item;
}

function extractLineItemsFromDom(
  document: Document,
  sourceUrl: string,
  expectedHost: string,
): PurchaseLineItemDraft[] {
  const explicitCandidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      [
        "[data-tracer-line-item]",
        "[data-test*='order'][data-test*='item']",
        "[data-testid*='order'][data-testid*='item']",
        "[class*='order'][class*='item']",
        "[class*='line'][class*='item']",
        "[class*='order'][class*='product']",
        "[class*='product'][class*='item']",
        "[class*='item'][class*='detail']",
      ].join(","),
    ),
  );
  const candidates = deepestLineItemElements([
    ...new Set([...explicitCandidates, ...discoverReceiptLineItemElements(document)]),
  ]).slice(0, 20);

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
    element.dataset.tracerProductName ??
    textFromSelectors(element, [
      "[data-tracer-product-name]",
      "[data-product-name]",
      "[data-test*='name']",
      "[data-testid*='name']",
      "[itemprop='name']",
      "[class*='product'][class*='title']",
      "[class*='product'][class*='name']",
      "[class*='item'][class*='title']",
      "[class*='item'][class*='name']",
      "h1",
      "h2",
      "h3",
      "h4",
    ]) ??
    inferProductName(element);
  const quantity = extractLineItemQuantity(element);
  const sku = extractLineItemSku(element);
  const rawUrl =
    element.dataset.tracerProductUrl ??
    element.querySelector<HTMLAnchorElement>("a[href]")?.href;

  if (!name) {
    return null;
  }

  const normalized = rawUrl
    ? normalizeProductCandidateUrl(rawUrl, sourceUrl, expectedHost)
    : findMatchingProductUrl(element.ownerDocument, name, sku, sourceUrl, expectedHost);

  const pricePaid = extractLineItemPrice(element, quantity);

  if (!pricePaid) {
    return null;
  }

  const item: PurchaseLineItemDraft = {
    productName: name,
    quantity,
    pricePaid,
  };

  if (normalized) {
    item.productUrl = normalized.url;
    item.productUrlConfidence = rawUrl ? "medium" : "low";
  }

  if (sku) {
    item.sku = sku;
  }

  const image = selectProductImage(
    [
      {
        value: (() => {
          const productImage = element.querySelector<HTMLImageElement>("img");
          return [
            productImage?.getAttribute("srcset"),
            productImage?.getAttribute("data-srcset"),
            productImage?.getAttribute("data-zoom-image"),
            productImage?.currentSrc,
            productImage?.getAttribute("data-src"),
            productImage?.getAttribute("src"),
          ];
        })(),
        source: "order_confirmation",
        alt: element.querySelector<HTMLImageElement>("img")?.alt,
      },
    ],
    sourceUrl,
    name,
  );

  if (image) {
    item.imageUrl = image.url;
  }

  return item;
}

/**
 * Finds receipt-style rows used by retailers that do not expose semantic
 * order-item class names. Candidates must carry several independent product
 * signals, which keeps totals, delivery and address cards out of the result.
 */
function discoverReceiptLineItemElements(document: Document): HTMLElement[] {
  const root = document.querySelector<HTMLElement>("main, [role='main']") ?? document.body;
  if (!root) return [];
  const highSignalSeeds = Array.from(root.querySelectorAll<HTMLElement>([
    "img",
    "[class*='sku' i]",
    "[data-testid*='product' i]",
    "[data-test*='product' i]",
    "[data-sku]",
  ].join(","))).slice(0, 100);
  const broadSeeds = Array.from(root.querySelectorAll<HTMLElement>(
    "[class*='product' i], [class*='item' i]",
  )).slice(0, 100);
  const seeds = [...new Set([...highSignalSeeds, ...broadSeeds])];
  const discovered: HTMLElement[] = [];

  for (const seed of seeds) {
    let candidate: HTMLElement | null = seed;
    for (let depth = 0; candidate && depth < 10; depth += 1, candidate = candidate.parentElement) {
      if (candidate === document.body || candidate.tagName === "MAIN") break;
      if (looksLikeReceiptLineItem(candidate)) {
        discovered.push(candidate);
        break;
      }
    }
  }

  return [...new Set(discovered)];
}

function looksLikeReceiptLineItem(element: HTMLElement): boolean {
  const text = normalizedText(element);
  if (text.length < 18 || text.length > 1_500 || currencyAmounts(text).length === 0) return false;

  const hasImage = Boolean(element.querySelector("img"));
  const hasSku = /(?:sku|style\s*#?|product\s*(?:code|id))\s*[:#]?\s*[a-z0-9-]{3,}/i.test(text);
  const hasQuantity =
    /(?:qty|quantity)\s*[:x]?\s*\d+/i.test(text) ||
    Boolean(findTableCellByHeader(element, /^(?:qty|quantity)$/i)) ||
    Boolean(element.querySelector("[data-quantity], [data-label*='qty' i], [data-label*='quantity' i], [data-th*='qty' i], [data-th*='quantity' i], [aria-label*='qty' i], [aria-label*='quantity' i]"));
  const hasUnitOrTotal =
    /\b(?:each|unit\s+price|item\s+total|total)\b/i.test(text) ||
    Boolean(findTableCellByHeader(element, /^(?:each|unit\s+price|item\s+total|total)$/i)) ||
    Boolean(element.querySelector("[data-line-total], [data-label*='each' i], [data-label*='total' i], [data-th*='each' i], [data-th*='total' i], [aria-label*='each' i], [aria-label*='total' i]"));
  const signalCount = Number(hasImage) + Number(hasSku) + Number(hasQuantity) + Number(hasUnitOrTotal);

  if (signalCount < 3 || (!hasSku && !hasQuantity)) return false;
  if (
    /\b(?:billing address|shipping address|payment method|order summary)\b/i.test(text) &&
    !hasSku
  ) return false;
  return Boolean(inferProductName(element));
}

function inferProductName(element: HTMLElement): string | null {
  const candidates = Array.from(element.querySelectorAll<HTMLElement>(
    "[aria-label], strong, b, a, h1, h2, h3, h4, p, span, div",
  )).slice(0, 160);
  let best: { value: string; score: number } | null = null;

  for (const candidate of candidates) {
    if (candidate.children.length > 2) continue;
    const value = normalizedText(candidate);
    if (value.length < 6 || value.length > 180 || currencyAmounts(value).length) continue;
    if (/^(?:sku|style|color|colour|size|status|qty|quantity|each|total|subtotal|shipping|delivery|tax|ordered|order date)\b/i.test(value)) continue;
    if (/^(?:new|men'?s|women'?s|kids?|accessories)$/i.test(value)) continue;
    const words = value.split(/\s+/).filter(Boolean);
    if (words.length < 2 || !/[a-z]{3}/i.test(value)) continue;

    const metadata = `${candidate.className || ""} ${candidate.getAttribute("data-testid") || ""} ${candidate.getAttribute("data-test") || ""}`;
    const score =
      Math.min(words.length, 10) +
      (/(?:product|item)[-_ ]?(?:name|title)|(?:name|title)[-_ ]?(?:product|item)/i.test(metadata) ? 20 : 0) +
      (/^H[1-4]$/.test(candidate.tagName) ? 14 : 0) +
      (candidate.tagName === "STRONG" || candidate.tagName === "B" ? 8 : 0) +
      (candidate.tagName === "A" ? 5 : 0);

    if (!best || score > best.score) best = { value, score };
  }

  return best?.value ?? null;
}

function extractLineItemQuantity(element: HTMLElement): number {
  const explicit =
    element.dataset.tracerQuantity ??
    textFromSelectors(element, [
      "[data-tracer-quantity]",
      "[data-quantity]",
      "[data-label*='qty' i]",
      "[data-label*='quantity' i]",
      "[data-th*='qty' i]",
      "[data-th*='quantity' i]",
      "[aria-label*='qty' i]",
      "[aria-label*='quantity' i]",
      "[headers*='qty' i]",
      "[headers*='quantity' i]",
      "[data-test*='quantity']",
      "[data-testid*='quantity']",
      "[class*='quantity']",
      "[class~='qty' i]",
    ]);
  if (explicit) return parseQuantity(explicit);
  const tableQuantity = findTableCellByHeader(element, /^(?:qty|quantity)$/i);
  if (tableQuantity) return parseQuantity(tableQuantity);
  const labelled = findDescendantText(element, /^(?:qty|quantity)\s*[:x]?\s*\d+$/i);
  if (labelled) return parseQuantity(labelled);
  const match = normalizedText(element).match(/(?:qty|quantity)\s*[:x]?\s*(\d+)/i);
  return parseQuantity(match?.[1]);
}

function extractLineItemSku(element: HTMLElement): string | null {
  const explicit =
    element.dataset.tracerSku ??
    textFromSelectors(element, [
      "[data-tracer-sku]",
      "[data-sku]",
      "[data-test*='sku']",
      "[data-testid*='sku']",
      "[class*='sku' i]",
    ]);
  const labelled = findDescendantText(
    element,
    /^(?:sku|style\s*#?|product\s*(?:code|id))\s*[:#]?\s*[a-z0-9-]{3,}$/i,
  );
  const value = explicit ?? labelled ?? normalizedText(element).match(
    /(?:sku|style\s*#?|product\s*(?:code|id))\s*[:#]?\s*([a-z0-9-]{3,})/i,
  )?.[1];
  if (!value) return null;
  return value.replace(/^\s*(?:sku|style\s*#?|product\s*(?:code|id))\s*[:#]?\s*/i, "").trim() || null;
}

function findDescendantText(element: HTMLElement, pattern: RegExp): string | null {
  for (const candidate of Array.from(element.querySelectorAll<HTMLElement>("*"))) {
    if (candidate.children.length > 0) continue;
    const value = normalizedText(candidate);
    if (value && pattern.test(value)) return value;
  }
  return null;
}

function findTableCellByHeader(element: HTMLElement, headerPattern: RegExp): string | null {
  const row = element.matches("tr") ? element : element.closest<HTMLTableRowElement>("tr");
  const table = row?.closest("table");
  if (!row || !table) return null;

  const cells = Array.from(row.querySelectorAll<HTMLElement>(":scope > th, :scope > td"));
  if (cells.length === 0) return null;
  const headerRows = Array.from(table.querySelectorAll<HTMLTableRowElement>("thead tr, tr")).filter(
    (candidate) => candidate !== row && candidate.querySelector("th"),
  );

  for (const headerRow of headerRows) {
    const headers = Array.from(headerRow.querySelectorAll<HTMLElement>(":scope > th, :scope > td"));
    const index = headers.findIndex((header) => headerPattern.test(normalizedText(header)));
    if (index >= 0 && cells[index]) return normalizedText(cells[index]);
  }
  return null;
}

function findMatchingProductUrl(
  document: Document,
  productName: string,
  sku: string | null,
  sourceUrl: string,
  expectedHost: string,
): ReturnType<typeof normalizeItemUrl> | null {
  const productTokens = productName.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  let best: { normalized: NonNullable<ReturnType<typeof normalizeItemUrl>>; score: number } | null = null;

  for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).slice(0, 600)) {
    const normalized = normalizeProductCandidateUrl(link.href, sourceUrl, expectedHost);
    if (!normalized || normalized.url === sourceUrl) continue;
    const url = new URL(normalized.url);

    const linkText = `${link.textContent ?? ""} ${link.getAttribute("aria-label") ?? ""} ${link.getAttribute("title") ?? ""} ${link.querySelector("img")?.alt ?? ""}`.toLowerCase();
    const haystack = `${linkText} ${url.pathname.toLowerCase()}`;
    const tokenMatches = new Set(productTokens.filter((token) => haystack.includes(token))).size;
    const score = tokenMatches * 3 + (sku && haystack.includes(sku.toLowerCase()) ? 18 : 0);
    if (score > 0 && (!best || score > best.score)) best = { normalized, score };
  }

  return best?.normalized ?? null;
}

function normalizeProductCandidateUrl(
  rawUrl: string,
  sourceUrl: string,
  expectedHost: string,
): ReturnType<typeof normalizeItemUrl> | null {
  const normalized = normalizeItemUrl(rawUrl, sourceUrl, expectedHost);
  if (!normalized) return null;
  const url = new URL(normalized.url);
  if (
    url.pathname === "/" ||
    /(?:checkout|order|confirm|receipt|return|policy|account|cart|print)/i.test(url.pathname)
  ) return null;
  return normalized;
}

function deepestLineItemElements(elements: HTMLElement[]): HTMLElement[] {
  return elements.filter((element) => !elements.some((candidate) =>
    candidate !== element &&
    element.contains(candidate) &&
    Boolean(
      candidate.querySelector("a[href], [data-tracer-product-url]") &&
      currencyAmounts(candidate.textContent ?? "").length,
    ),
  ));
}

function extractLineItemPrice(element: HTMLElement, quantity: number): ReturnType<typeof parsePrice> {
  const tableUnitPrice = findTableCellByHeader(element, /^(?:each|unit\s+price)$/i);
  const parsedTableUnitPrice = parsePrice(
    currencyAmounts(tableUnitPrice ?? "")[0] ?? tableUnitPrice,
  );
  if (parsedTableUnitPrice) return parsedTableUnitPrice;

  const labeledUnitPrice = textFromSelectors(element, [
    "[data-label*='each' i]",
    "[data-label*='unit price' i]",
    "[data-th*='each' i]",
    "[data-th*='unit price' i]",
    "[aria-label*='each' i]",
    "[aria-label*='unit price' i]",
    "[headers*='each' i]",
    "[headers*='unit' i]",
    "[class*='each' i]",
    "[class*='unit-price' i]",
  ]);
  const parsedLabeledUnitPrice = parsePrice(currencyAmounts(labeledUnitPrice ?? "")[0] ?? labeledUnitPrice);
  if (parsedLabeledUnitPrice) return parsedLabeledUnitPrice;

  const receiptText = normalizedText(element);
  const explicitUnitAmount = receiptText.match(
    /\b(?:each|unit\s+price)\b\s*[:\-]?\s*((?:£|\$|€|\b(?:GBP|USD|EUR)\b)\s*\d[\d.,]*)/i,
  )?.[1];
  const explicitUnitPrice = parsePrice(explicitUnitAmount);
  if (explicitUnitPrice) return explicitUnitPrice;

  const priceElements = Array.from(element.querySelectorAll<HTMLElement>([
    "[data-tracer-price-paid]",
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
  const sources = [...new Set(priceElements)]
    .map((candidate) => ({
      element: candidate,
      text: candidate.textContent?.replace(/\s+/g, " ").trim() ?? "",
    }))
    .filter(({ text }) => Boolean(
      text && currencyAmounts(text).length && !/(?:saving|discount|shipping|delivery|tax|refund)/i.test(text),
    ));
  const selected = sources.at(-1);
  const source = selected?.text ?? element.textContent ?? "";
  const amount = currencyAmounts(source).at(-1);
  const price = parsePrice(amount ?? source);
  if (!price || quantity <= 1 || !selected || !isLineTotal(selected.element, source)) return price;
  return {
    amountMinor: Math.max(1, Math.round(price.amountMinor / quantity)),
    currency: price.currency,
  };
}

function extractPurchaseDate(document: Document, fallbackNow: Date): string {
  const explicit =
    attrFromSelectors(document, ["time[datetime]", "[data-tracer-purchased-at]", "[data-order-date]"], "datetime") ??
    textFromSelectors(document, ["[data-tracer-purchased-at]", "[data-order-date]", "[data-purchase-date]", "[class*='order-date' i]"]);
  const bodyMatch = normalizedText(document.body).match(
    /\border\s*date\s*[:\-]?\s*(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/i,
  )?.[1];
  return parsePurchaseDate(explicit ?? bodyMatch) ?? fallbackNow.toISOString();
}

function parsePurchaseDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const iso = value.match(
    /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/i,
  )?.[0];
  if (iso) {
    const parsedIso = new Date(iso);
    if (!Number.isNaN(parsedIso.getTime())) return parsedIso.toISOString();
  }
  const uk = value.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (uk?.[1] && uk[2] && uk[3]) {
    const year = Number(uk[3].length === 2 ? `20${uk[3]}` : uk[3]);
    const month = Number(uk[2]);
    const day = Number(uk[1]);
    const hour = Number(uk[4] ?? 12);
    const minute = Number(uk[5] ?? 0);
    const second = Number(uk[6] ?? 0);
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return date.toISOString();
    }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizedText(value: Element | null): string {
  return (value?.textContent ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function isLineTotal(element: Element, text: string): boolean {
  if (/(?:each|per\s+(?:item|unit)|unit\s+price|\/\s*(?:item|unit)|\bea\.?\b)/i.test(text)) {
    return false;
  }
  return (
    element.matches("[data-line-total], [data-order-line-total], [data-testid*='total' i], [data-test*='total' i], [class*='total' i]") ||
    /(?:line|item)\s+total|subtotal/i.test(text)
  );
}

function currencyAmounts(value: string): string[] {
  return value.match(
    /(?:(?:£|\$|€|\b(?:GBP|USD|EUR)\b)\s*-?\s*\d[\d.,]*|\d[\d.,]*\s*\b(?:GBP|USD|EUR)\b)/gi,
  ) ?? [];
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
