import { lookup } from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";
import { parseHTML } from "linkedom";
import {
  extractGenericProductFromDocument,
  extractJohnLewisProductFromDocument,
  isKnownRetailerId,
  normalizePublicStoreUrl,
  normalizeRetailerUrl,
  type PriceFetcher,
  type ProductPriceSnapshot,
  type ProductRecord,
} from "@afterbuy/core";

const maxHtmlBytes = 2_000_000;
const requestTimeoutMs = 10_000;
const maxRedirects = 5;

export class HttpPriceFetcher implements PriceFetcher {
  async fetchCurrentPrice(product: ProductRecord): Promise<ProductPriceSnapshot> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await fetchWithValidatedRedirects(product, controller.signal);

      if (!response.ok) {
        throw new Error(`Product page returned ${response.status}`);
      }

      const html = (await response.text()).slice(0, maxHtmlBytes);
      const document = parseHTML(html).document;
      const observedAt = new Date().toISOString();
      const snapshot =
        extractJohnLewisProductFromDocument(document, product.canonicalUrl, observedAt) ??
        extractGenericProductFromDocument(document, product.canonicalUrl, observedAt);

      if (!snapshot) {
        throw new Error("No product price could be extracted");
      }

      return {
        ...snapshot,
        retailerId: product.retailerId,
        retailerName: snapshot.retailerName ?? product.retailerName,
        storeHost: snapshot.storeHost ?? product.storeHost,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function fetchWithValidatedRedirects(
  product: ProductRecord,
  signal: AbortSignal,
): Promise<Response> {
  let currentUrl = normalizeProductFetchUrl(product, product.canonicalUrl);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    await assertPublicDnsTarget(currentUrl.host);

    const response = await fetch(currentUrl.url, {
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

async function assertPublicDnsTarget(host: string): Promise<void> {
  const addresses = await lookup(host, { all: true });

  if (addresses.some(({ address }) => isPrivateOrLocalAddress(address))) {
    throw new Error(`Product page host ${host} resolved to a private address`);
  }
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
