import {
  extractGenericProductFromDocument,
  extractJohnLewisProductFromDocument,
  isKnownRetailerId,
  normalizePublicStoreUrl,
  normalizeRetailerUrl,
  type SavedProduct,
  type Money,
  type ProductPriceSnapshot,
} from "@tracer/core";
import { readExistingProductTab } from "./savedProductPriceCheck";

interface StorePriceTarget {
  retailerId: string;
  storeHost: string;
  productName: string;
  productUrl: string;
  sourceUrl?: string;
  pricePaid: Money;
  externalProductId?: string;
}

const maxRedirects = 4;
const maxHtmlBytes = 2_000_000;

/** A browser-side check lets locally saved purchases show a price before API sync. */
export async function checkStorePrice(
  target: StorePriceTarget,
  options: {
    fetchImpl?: typeof fetch;
    parseHtml?: (html: string) => Document;
    readOpenProduct?: (url: string, item: SavedProduct) => Promise<SavedProduct | null>;
  } = {},
): Promise<ProductPriceSnapshot> {
  const original = normalizeTargetUrl(target, target.productUrl);
  if (target.sourceUrl) {
    const source = new URL(target.sourceUrl);
    const product = new URL(original.url);
    if (source.hostname === product.hostname && source.pathname === product.pathname) {
      throw new Error("Purchase page is not a product page");
    }
  }
  if (/\/(?:checkout|orders?)(?:\/|$)/i.test(new URL(original.url).pathname)) {
    throw new Error("Purchase page is not a product page");
  }
  try {
    return await fetchStorePrice(target, original, options);
  } catch (error) {
    if (error instanceof Error && /404|no longer available|different product|does not match/.test(error.message)) throw error;
    const item: SavedProduct = {
      name: cleanPurchaseProductName(target.productName),
      retailer: target.storeHost,
      retailerId: target.retailerId,
      canonicalUrl: original.url,
      savedPrice: target.pricePaid,
      ...(target.externalProductId ? { externalProductId: target.externalProductId } : {}),
    };
    const product = await (options.readOpenProduct
      ? options.readOpenProduct(original.url, item)
      : readExistingProductTab(original.url, item, { allowWwwAlias: true })).catch(() => null);
    if (product?.savedPrice) {
      const productUrl = new URL(product.canonicalUrl);
      const requested = new URL(original.url);
      // Stores commonly omit colour queries from their canonical tag. The
      // existing-tab reader has already verified the loaded URL and navigation.
      const samePage = productUrl.origin === requested.origin && productUrl.pathname === requested.pathname;
      const sameSelection = [...productUrl.searchParams].every(([key, value]) => requested.searchParams.get(key) === value);
      // Explicit variant IDs require variant-specific price evidence.
      const variant = requested.searchParams.get("variant");
      if (samePage && sameSelection && (!variant || productUrl.searchParams.get("variant") === variant)) {
        const snapshot: ProductPriceSnapshot = {
          retailerId: product.retailerId,
          productName: product.name,
          productUrl: original.url,
          price: product.savedPrice,
          observedAt: new Date().toISOString(),
          availability: product.availability ?? "unknown",
          ...(product.externalProductId ? { externalProductId: product.externalProductId } : {}),
        };
        if (isMatchingProduct(target, snapshot)) return snapshot;
      }
    }
    throw error;
  }
}

async function fetchStorePrice(
  target: StorePriceTarget,
  original: ReturnType<typeof normalizeTargetUrl>,
  options: { fetchImpl?: typeof fetch; parseHtml?: (html: string) => Document },
): Promise<ProductPriceSnapshot> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const parseHtml = options.parseHtml ?? ((html: string) => new DOMParser().parseFromString(html, "text/html"));
  let url = original.url;
  const signal = AbortSignal.timeout(15_000);

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const response = await fetchImpl(url, {
      redirect: "manual",
      credentials: "include",
      cache: "no-store",
      headers: { accept: "text/html,application/xhtml+xml" },
      signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Store redirect omitted its destination");
      const next = normalizeTargetUrl(target, new URL(location, url).toString());
      if (original.productId && next.productId !== original.productId) {
        throw new Error("Store redirected to a different product");
      }
      const destination = new URL(next.url);
      if (destination.pathname === "/" || /\/(?:collections?|categories|search)(?:\/|$)/i.test(destination.pathname)) {
        throw new Error("Store product page is no longer available");
      }
      url = next.url;
      continue;
    }
    if (!response.ok) throw new Error(`Store returned ${response.status}`);
    if (response.url && normalizeTargetUrl(target, response.url).url !== normalizeTargetUrl(target, url).url) {
      throw new Error("Store redirected to a different product");
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new Error("Store did not return a product page");
    }
    const html = await readLimitedHtml(response);
    const page = parseHtml(html);
    const observedAt = new Date().toISOString();
    const snapshot = target.retailerId === "john-lewis"
      ? extractJohnLewisProductFromDocument(page, url, observedAt, cleanPurchaseProductName(target.productName))
      : extractGenericProductFromDocument(page, url, observedAt, cleanPurchaseProductName(target.productName));
    if (!snapshot || normalizeTargetUrl(target, snapshot.productUrl).url !==
      normalizeTargetUrl(target, url).url || !isMatchingProduct(target, snapshot)) {
      throw new Error("Store page did not verify this product and price");
    }
    return snapshot;
  }
  throw new Error("Store redirected too many times");
}

function normalizeTargetUrl(target: StorePriceTarget, url: string) {
  if (isKnownRetailerId(target.retailerId)) {
    return normalizeRetailerUrl(target.retailerId, url, { requireProductUrl: true });
  }
  const normalized = normalizePublicStoreUrl(url);
  if (normalized.host.replace(/^www\./, "") !== target.storeHost.toLowerCase().replace(/^www\./, "")) {
    throw new Error("Store URL host does not match the protected store");
  }
  return normalized;
}

function isMatchingProduct(target: StorePriceTarget, snapshot: ProductPriceSnapshot): boolean {
  if (snapshot.retailerId !== target.retailerId ||
    snapshot.price.currency !== target.pricePaid.currency ||
    !Number.isSafeInteger(snapshot.price.amountMinor) || snapshot.price.amountMinor <= 0) return false;
  if (target.pricePaid.amountMinor - snapshot.price.amountMinor >= 2_000 &&
    snapshot.price.amountMinor * 10 < target.pricePaid.amountMinor) return false;
  if (target.externalProductId && snapshot.externalProductId &&
    target.externalProductId !== snapshot.externalProductId) return false;
  const expected = normalizedWords(target.productName);
  const actual = normalizedWords(snapshot.productName);
  if (expected.length === 0 || actual.length === 0) return false;
  const overlap = expected.filter((word) => actual.includes(word)).length;
  return overlap / expected.length >= 0.75 && overlap / actual.length >= 0.65;
}

function normalizedWords(value: string): string[] {
  return cleanPurchaseProductName(value).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim().split(/\s+/).filter(Boolean);
}

function cleanPurchaseProductName(value: string): string {
  return value.replace(/\s+product\s+page\s*$/i, "").trim();
}

async function readLimitedHtml(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > maxHtmlBytes) throw new Error("Store page is too large");
  if (!response.body) throw new Error("Store returned an empty page");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let html = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxHtmlBytes) {
      await reader.cancel();
      throw new Error("Store page is too large");
    }
    html += decoder.decode(value, { stream: true });
  }
  return html + decoder.decode();
}
