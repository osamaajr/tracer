import type {
  CaptureConfidence,
  CaptureMethod,
  Money,
  PurchaseDraft,
  PurchaseLineItemDraft,
} from "@afterbuy/core";

declare global {
  interface Window {
    __afterbuyGenericCaptureReady?: boolean;
  }
}

interface ScanRequest {
  type: "AFTERBUY_SCAN_PAGE";
}

interface ScanResponse {
  ok: boolean;
  draft?: PurchaseDraft;
  summary?: {
    retailerName: string;
    productName: string;
    itemCount: number;
    totalDisplay: string;
    confidence: string;
  };
  error?: string;
}

interface Storefront {
  retailerId: string;
  retailerName: string;
  host: string;
}

if (!window.__afterbuyGenericCaptureReady) {
  window.__afterbuyGenericCaptureReady = true;

  chrome.runtime.onMessage.addListener(
    (message: ScanRequest, _sender, sendResponse: (response: ScanResponse) => void) => {
      if (message.type !== "AFTERBUY_SCAN_PAGE") {
        return false;
      }

      const draft = extractPurchaseFromPage(document, window.location.href);

      if (!draft) {
        sendResponse({
          ok: false,
          error: "No order confirmation data found on this page.",
        });
        return false;
      }

      const firstItem = draft.lineItems[0];
      const total = draft.lineItems.reduce(
        (sum, item) => sum + item.pricePaid.amountMinor * item.quantity,
        0,
      );
      const currency = firstItem?.pricePaid.currency;

      sendResponse({
        ok: true,
        draft,
        summary: {
          retailerName: draft.retailerName,
          productName: firstItem?.productName ?? "Detected purchase",
          itemCount: draft.lineItems.length,
          totalDisplay: currency ? formatMoney({ amountMinor: total, currency }) : "Captured",
          confidence: draft.captureConfidence,
        },
      });

      return false;
    },
  );
}

function extractPurchaseFromPage(page: Document, sourceUrl: string): PurchaseDraft | null {
  const demoDraft = extractLocalDemoDraft(page, sourceUrl);
  if (demoDraft) {
    return demoDraft;
  }

  const storefront = storefrontFromUrl(sourceUrl);

  if (!storefront) {
    return null;
  }

  const schemaDraft = extractFromJsonLd(page, sourceUrl, storefront);
  if (schemaDraft) {
    return schemaDraft;
  }

  if (!looksLikeOrderConfirmation(page, sourceUrl)) {
    return null;
  }

  const items = extractDomItems(page, sourceUrl, storefront.host);

  if (items.length === 0) {
    return null;
  }

  return buildDraft({
    storefront,
    sourceUrl,
    purchasedAt: firstText(page, [
      "[data-afterbuy-purchased-at]",
      "[data-order-date]",
      "time[datetime]",
    ]) ?? new Date().toISOString(),
    orderReference: firstText(page, [
      "[data-afterbuy-order-reference]",
      "[data-order-number]",
      "[data-order-id]",
    ]),
    lineItems: items,
    captureMethod: "generic_dom",
    captureConfidence: "medium",
  });
}

function extractFromJsonLd(
  page: Document,
  sourceUrl: string,
  storefront: Storefront,
): PurchaseDraft | null {
  for (const script of Array.from(page.querySelectorAll("script[type='application/ld+json']"))) {
    const parsed = parseJson(script.textContent ?? "");
    const order = findTypedNode(parsed, "Order");

    if (!order) {
      continue;
    }

    const items = asArray(
      order.acceptedOffer ?? order.orderedItem ?? order.itemListElement,
    ).flatMap((entry) => schemaItemFromEntry(entry, sourceUrl, storefront.host));

    if (items.length === 0) {
      continue;
    }

    return buildDraft({
      storefront,
      sourceUrl,
      purchasedAt:
        firstString(order.orderDate) ??
        firstString(order.dateCreated) ??
        firstString(order.datePublished) ??
        new Date().toISOString(),
      orderReference: firstString(order.orderNumber) ?? firstString(order.identifier),
      lineItems: items,
      captureMethod: "generic_schema_org",
      captureConfidence: "high",
    });
  }

  return null;
}

function schemaItemFromEntry(
  entry: unknown,
  sourceUrl: string,
  expectedHost: string,
): PurchaseLineItemDraft[] {
  const record = asRecord(entry);
  if (!record) {
    return [];
  }

  const item = asRecord(record.itemOffered ?? record.orderedItem ?? record.item ?? entry);
  const offer = asRecord(record.acceptedOffer ?? record.offers ?? record);
  const productName = firstString(record.name) ?? firstString(item?.name);
  const productUrl = normalizeSameHostUrl(
    firstString(record.url) ?? firstString(item?.url),
    sourceUrl,
    expectedHost,
  );
  const price = parsePrice(
    firstString(record.price) ?? firstString(offer?.price),
    firstString(record.priceCurrency) ?? firstString(offer?.priceCurrency) ?? "GBP",
  );

  if (!productName || !productUrl || !price) {
    return [];
  }

  const draft: PurchaseLineItemDraft = {
    productName,
    quantity: numberFromUnknown(record.orderQuantity ?? record.quantity) ?? 1,
    pricePaid: price,
    productUrl,
    productUrlConfidence: "high",
  };
  const sku = firstString(record.sku) ?? firstString(item?.sku);
  const imageUrl = firstString(record.image) ?? firstString(item?.image);

  if (sku) {
    draft.sku = sku;
  }
  if (imageUrl) {
    draft.imageUrl = imageUrl;
  }

  return [draft];
}

function extractDomItems(
  page: Document,
  sourceUrl: string,
  expectedHost: string,
): PurchaseLineItemDraft[] {
  const nodes = Array.from(
    page.querySelectorAll(
      [
        "[data-afterbuy-line-item]",
        "[data-test*='order'][data-test*='item']",
        "[class*='order'][class*='item']",
        "[class*='line'][class*='item']",
      ].join(","),
    ),
  );

  return nodes.flatMap((node) => {
    const productName =
      firstText(node, [
        "[data-afterbuy-product-name]",
        "[data-product-name]",
        "[class*='product'][class*='name']",
        "h2",
        "h3",
      ]) ?? "";
    const priceText = firstText(node, [
      "[data-afterbuy-price-paid]",
      "[data-price]",
      "[class*='price']",
    ]);
    const productUrl = normalizeSameHostUrl(
      firstHref(node, [
        "[data-afterbuy-product-url]",
        "a[href*='/products/']",
        "a[href*='/product/']",
        "a[href]",
      ]),
      sourceUrl,
      expectedHost,
    );
    const price = parsePrice(priceText, "GBP");

    if (!productName || !price || !productUrl) {
      return [];
    }

    return [
      {
        productName,
        quantity: numberFromUnknown(firstText(node, ["[data-afterbuy-quantity]", "[data-quantity]"])) ?? 1,
        pricePaid: price,
        productUrl,
        productUrlConfidence: "medium" as CaptureConfidence,
      },
    ];
  });
}

function buildDraft(input: {
  storefront: Storefront;
  sourceUrl: string;
  purchasedAt: string;
  lineItems: PurchaseLineItemDraft[];
  captureMethod: CaptureMethod;
  captureConfidence: CaptureConfidence;
  orderReference?: string | undefined;
}): PurchaseDraft {
  const draft: PurchaseDraft = {
    retailerId: input.storefront.retailerId,
    retailerName: input.storefront.retailerName,
    storeHost: input.storefront.host,
    sourceUrl: input.sourceUrl,
    purchasedAt: normalizeDate(input.purchasedAt),
    lineItems: input.lineItems,
    captureMethod: input.captureMethod,
    captureConfidence: input.captureConfidence,
  };

  if (input.orderReference) {
    draft.orderReference = input.orderReference;
  }

  return draft;
}

function extractLocalDemoDraft(page: Document, sourceUrl: string): PurchaseDraft | null {
  if (!isLocalDevelopmentUrl(sourceUrl)) {
    return null;
  }

  if (!page.querySelector("meta[name='tracer-demo-order'][content='true']")) {
    return null;
  }

  const parsed = parseJson(page.getElementById("tracer-demo-purchase")?.textContent ?? "");
  const draft = asRecord(parsed);

  if (!draft) {
    return null;
  }

  const lineItems = asArray(draft.lineItems)
    .map(demoLineItemFromRecord)
    .filter((item): item is PurchaseLineItemDraft => item !== null);
  const purchasedAt = firstString(draft.purchasedAt);

  if (lineItems.length === 0 || !purchasedAt) {
    return null;
  }

  return buildDraft({
    storefront: {
      retailerId: firstString(draft.retailerId) ?? "store_store-example-com",
      retailerName: firstString(draft.retailerName) ?? "Example Store",
      host: firstString(draft.storeHost) ?? "store.example.com",
    },
    sourceUrl: firstString(draft.sourceUrl) ?? "https://store.example.com/orders/TR-DEMO-1001",
    purchasedAt,
    orderReference: firstString(draft.orderReference),
    lineItems,
    captureMethod: "generic_schema_org",
    captureConfidence: "high",
  });
}

function demoLineItemFromRecord(value: unknown): PurchaseLineItemDraft | null {
  const record = asRecord(value);

  if (!record) {
    return null;
  }

  const productName = firstString(record.productName);
  const pricePaid = asRecord(record.pricePaid);
  const amountMinor = typeof pricePaid?.amountMinor === "number" ? pricePaid.amountMinor : null;
  const currency = firstString(pricePaid?.currency);
  const productUrl = firstString(record.productUrl);

  if (
    !productName ||
    typeof amountMinor !== "number" ||
    !Number.isInteger(amountMinor) ||
    !currency ||
    !productUrl
  ) {
    return null;
  }

  const item: PurchaseLineItemDraft = {
    productName,
    quantity: numberFromUnknown(record.quantity) ?? 1,
    pricePaid: {
      amountMinor,
      currency,
    },
    productUrl,
    productUrlConfidence: "high",
  };
  const externalProductId = firstString(record.externalProductId);
  const sku = firstString(record.sku);
  const imageUrl = firstString(record.imageUrl);

  if (externalProductId) {
    item.externalProductId = externalProductId;
  }
  if (sku) {
    item.sku = sku;
  }
  if (imageUrl) {
    item.imageUrl = imageUrl;
  }

  return item;
}

function isLocalDevelopmentUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      (url.protocol === "http:" || url.protocol === "https:")
    );
  } catch {
    return false;
  }
}

function storefrontFromUrl(rawUrl: string): Storefront | null {
  try {
    const url = new URL(rawUrl);

    if (url.protocol !== "https:" || url.username || url.password || url.port) {
      return null;
    }

    const host = url.hostname.toLowerCase();

    if (host === "localhost" || host.endsWith(".local") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      return null;
    }

    if (host === "www.johnlewis.com" || host === "johnlewis.com") {
      return {
        retailerId: "john-lewis",
        retailerName: "John Lewis",
        host,
      };
    }

    return {
      retailerId: `store_${host.replace(/^www\./, "").replace(/[^a-z0-9]+/g, "-")}`,
      retailerName: deriveName(host),
      host,
    };
  } catch {
    return null;
  }
}

function looksLikeOrderConfirmation(page: Document, sourceUrl: string): boolean {
  const haystack = `${page.title} ${sourceUrl} ${page.body?.textContent ?? ""}`.toLowerCase();
  return (
    haystack.includes("order confirmation") ||
    haystack.includes("thank you for your order") ||
    haystack.includes("thanks for your order") ||
    haystack.includes("order number") ||
    haystack.includes("order reference")
  );
}

function normalizeSameHostUrl(
  rawUrl: string | undefined,
  sourceUrl: string,
  expectedHost: string,
): string | undefined {
  if (!rawUrl) {
    return undefined;
  }

  try {
    const url = new URL(rawUrl, sourceUrl);

    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hostname.toLowerCase() !== expectedHost
    ) {
      return undefined;
    }

    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function firstText(root: ParentNode, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const element = root.querySelector(selector);
    const text =
      element instanceof HTMLTimeElement
        ? element.dateTime || element.textContent
        : element?.textContent;

    if (text?.trim()) {
      return text.trim();
    }
  }

  return undefined;
}

function firstHref(root: ParentNode, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const element = root.querySelector(selector);
    const href = element instanceof HTMLAnchorElement ? element.href : element?.getAttribute("href");

    if (href) {
      return href;
    }
  }

  return undefined;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function findTypedNode(value: unknown, type: string): Record<string, unknown> | null {
  const record = asRecord(value);

  if (record && hasType(record, type)) {
    return record;
  }

  for (const child of asArray(value)) {
    const match = findTypedNode(child, type);
    if (match) {
      return match;
    }
  }

  if (record) {
    for (const child of Object.values(record)) {
      const match = findTypedNode(child, type);
      if (match) {
        return match;
      }
    }
  }

  return null;
}

function hasType(record: Record<string, unknown>, type: string): boolean {
  return asArray(record["@type"]).some(
    (candidate) => typeof candidate === "string" && candidate.toLowerCase() === type.toLowerCase(),
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  return value === undefined || value === null ? [] : [value];
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value.map(firstString).find(Boolean);
  }

  return undefined;
}

function numberFromUnknown(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  return undefined;
}

function parsePrice(value: string | undefined, fallbackCurrency: string): Money | null {
  if (!value) {
    return null;
  }

  const match = value
    .replace(/\u00a0/g, " ")
    .match(/(?:£|\$|€|GBP|USD|EUR)?\s*([0-9]+(?:,[0-9]{3})*|[0-9]+)(?:\.([0-9]{1,2}))?/i);

  if (!match?.[1]) {
    return null;
  }

  const major = Number.parseInt(match[1].replace(/,/g, ""), 10);
  const minor = Number.parseInt((match[2] ?? "0").padEnd(2, "0"), 10);

  return {
    amountMinor: major * 100 + minor,
    currency: inferCurrency(value, fallbackCurrency),
  };
}

function inferCurrency(value: string, fallbackCurrency: string): string {
  if (value.includes("$") || /\bUSD\b/i.test(value)) {
    return "USD";
  }

  if (value.includes("€") || /\bEUR\b/i.test(value)) {
    return "EUR";
  }

  if (value.includes("£") || /\bGBP\b/i.test(value)) {
    return "GBP";
  }

  return fallbackCurrency.toUpperCase();
}

function formatMoney(value: Money): string {
  const major = value.amountMinor / 100;

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: value.currency,
    maximumFractionDigits: Number.isInteger(major) ? 0 : 2,
  }).format(major);
}

function normalizeDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function deriveName(host: string): string {
  const label = host.toLowerCase().replace(/^www\./, "").split(".")[0] ?? host;

  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
