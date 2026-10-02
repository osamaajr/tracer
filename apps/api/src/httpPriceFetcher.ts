import { lookup } from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";
import { parseHTML } from "linkedom";
import {
  extractGenericProductFromDocument,
  extractJohnLewisProductFromDocument,
  extractSavedProduct,
  isKnownRetailerId,
  normalizePublicStoreUrl,
  normalizeRetailerUrl,
  type PriceFetcher,
  type ProductPriceSnapshot,
  type ProductRecord,
} from "@tracer/core";

const maxHtmlBytes = 2_000_000;
const requestTimeoutMs = 10_000;
const maxRedirects = 5;

export interface HttpPriceFetcherOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
  resolveHost?: (host: string) => Promise<Array<{ address: string }>>;
  sleep?: (milliseconds: number) => Promise<void>;
}

export class HttpPriceFetcher implements PriceFetcher {
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly resolveHost: (host: string) => Promise<Array<{ address: string }>>;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: HttpPriceFetcherOptions = {}) {
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 2);
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 500);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolveHost = options.resolveHost ?? (async (host) => lookup(host, { all: true }));
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    }));
  }

  async fetchCurrentPrice(product: ProductRecord): Promise<ProductPriceSnapshot> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

      try {
        const response = await fetchWithValidatedRedirects(
          product,
          controller.signal,
          this.fetchImpl,
          this.resolveHost,
        );

        if (!response.ok) {
          throw new ProductPageHttpError(response.status);
        }

        const html = await readLimitedHtml(response, maxHtmlBytes);
        const document = parseHTML(html).document;
        const observedAt = new Date().toISOString();
        const extractedSnapshot = product.retailerId === "john-lewis"
          ? extractJohnLewisProductFromDocument(document, product.canonicalUrl, observedAt, product.name)
          : extractGenericProductFromDocument(document, product.canonicalUrl, observedAt, product.name);
        const savedProduct = !extractedSnapshot && product.retailerId !== "john-lewis"
          ? extractSavedProduct(document, product.canonicalUrl)
          : null;
        const snapshot: ProductPriceSnapshot | null = extractedSnapshot ?? (
          savedProduct?.savedPrice
            ? {
                retailerId: savedProduct.retailerId,
                retailerName: savedProduct.retailer,
                storeHost: product.storeHost,
                productUrl: savedProduct.canonicalUrl,
                productName: savedProduct.name,
                price: savedProduct.savedPrice,
                observedAt,
                availability: "unknown",
                ...(savedProduct.externalProductId
                  ? { externalProductId: savedProduct.externalProductId }
                  : {}),
                ...(savedProduct.sku ? { sku: savedProduct.sku } : {}),
                ...(savedProduct.imageUrl ? { imageUrl: savedProduct.imageUrl } : {}),
              }
            : null
        );

        if (!snapshot) {
          throw new Error("No product price could be extracted");
        }

        return {
          ...snapshot,
          retailerId: product.retailerId,
          retailerName: snapshot.retailerName ?? product.retailerName,
          storeHost: snapshot.storeHost ?? product.storeHost,
        };
      } catch (error) {
        lastError = error;
        if (attempt >= this.maxAttempts || !isRetryableFetchError(error)) {
          throw error;
        }
        await this.sleep(this.retryDelayMs * 2 ** (attempt - 1));
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError;
  }
}

async function readLimitedHtml(response: Response, byteLimit: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > byteLimit) {
    throw new Error("Product page response exceeded the size limit");
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let html = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > byteLimit) {
      await reader.cancel();
      throw new Error("Product page response exceeded the size limit");
    }
    html += decoder.decode(value, { stream: true });
  }

  return html + decoder.decode();
}

async function fetchWithValidatedRedirects(
  product: ProductRecord,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
  resolveHost: (host: string) => Promise<Array<{ address: string }>>,
): Promise<Response> {
  let currentUrl = normalizeProductFetchUrl(product, product.canonicalUrl);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    await assertPublicDnsTarget(currentUrl.host, resolveHost);

    const response = await fetchImpl(currentUrl.url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent":
          "TracerPriceMonitor/0.1 (+https://tracer.local; price-drop monitoring)",
      },
      redirect: "manual",
      signal,
    });

    if (!isRedirectResponse(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      throw new Error(`Product page redirect ${response.status} omitted Location`);
    }

    const redirectedUrl = new URL(location, currentUrl.url).toString();
    currentUrl = normalizeProductFetchUrl(product, redirectedUrl);
  }

  throw new Error("Product page redirected too many times");
}

function normalizeProductFetchUrl(product: ProductRecord, rawUrl: string) {
  if (isKnownRetailerId(product.retailerId)) {
    return normalizeRetailerUrl(product.retailerId, rawUrl, {
      requireProductUrl: true,
    });
  }

  return normalizePublicStoreUrl(rawUrl, { expectedHost: product.storeHost });
}

function isRedirectResponse(status: number): boolean {
  return status >= 300 && status < 400;
}

async function assertPublicDnsTarget(
  host: string,
  resolveHost: (host: string) => Promise<Array<{ address: string }>>,
): Promise<void> {
  const addresses = await resolveHost(host);

  if (addresses.some(({ address }) => isPrivateOrLocalAddress(address))) {
    throw new Error(`Product page host ${host} resolved to a private address`);
  }
}

class ProductPageHttpError extends Error {
  constructor(readonly status: number) {
    super(`Product page returned ${status}`);
  }
}

function isRetryableFetchError(error: unknown): boolean {
  if (error instanceof ProductPageHttpError) {
    return error.status === 429 || error.status >= 500;
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }

  if (error instanceof TypeError) {
    return true;
  }

  return Boolean(
    typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string",
  );
}

function isPrivateOrLocalAddress(address: string): boolean {
  if (isIPv4(address)) {
    const octets = address.split(".").map((part) => Number.parseInt(part, 10));
    const first = octets[0] ?? -1;
    const second = octets[1] ?? -1;

    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 100 && second >= 64 && second <= 127) ||
      first >= 224
    );
  }

  if (isIPv6(address)) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }

  return true;
}
