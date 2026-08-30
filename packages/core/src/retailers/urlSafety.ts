import type { RetailerId } from "../domain/types";

const knownRetailerHosts: Record<string, string[]> = {
  "john-lewis": ["johnlewis.com", "www.johnlewis.com"],
  jysk: ["jysk.co.uk", "www.jysk.co.uk"],
};

export interface NormalizedRetailerUrl {
  url: string;
  host: string;
  productId?: string;
}

export function normalizeRetailerUrl(
  retailerId: RetailerId,
  rawUrl: string,
  options: { requireProductUrl?: boolean; expectedHost?: string } = {},
): NormalizedRetailerUrl {
  if (!isKnownRetailerId(retailerId)) {
    return options.expectedHost
      ? normalizePublicStoreUrl(rawUrl, { expectedHost: options.expectedHost })
      : normalizePublicStoreUrl(rawUrl);
  }

  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Retailer URL is not a valid absolute URL");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Retailer URL must use HTTPS");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Retailer URL must not contain credentials");
  }

  if (parsed.port) {
    throw new Error("Retailer URL must not use an explicit port");
  }

  const host = parsed.hostname.toLowerCase();
  if (!knownRetailerHosts[retailerId]?.includes(host)) {
    throw new Error(`URL host ${host} is not allowed for retailer ${retailerId}`);
  }

  parsed.hash = "";
  parsed.search = "";
  parsed.hostname = host;

  const canonicalUrl = parsed.toString().replace(/\/$/, "");
  const productId = extractRetailerProductId(retailerId, canonicalUrl);

  if (options.requireProductUrl && !productId) {
    throw new Error("Retailer URL does not contain a supported product identifier");
  }

  const normalized: NormalizedRetailerUrl = { url: canonicalUrl, host };
  if (productId) {
    normalized.productId = productId;
  }

  return normalized;
}

export function isAllowedRetailerUrl(
  retailerId: RetailerId,
  rawUrl: string,
  options: { requireProductUrl?: boolean; expectedHost?: string } = {},
): boolean {
  try {
    normalizeRetailerUrl(retailerId, rawUrl, options);
    return true;
  } catch {
    return false;
  }
}

export function extractRetailerProductId(
  retailerId: RetailerId,
  rawUrl: string,
): string | null {
  if (retailerId === "john-lewis") {
    return extractJohnLewisProductId(rawUrl);
  }

  if (retailerId === "jysk") {
    return extractJyskProductId(rawUrl);
  }

  return null;
}

export function normalizePublicStoreUrl(
  rawUrl: string,
  options: { expectedHost?: string } = {},
): NormalizedRetailerUrl {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Store URL is not a valid absolute URL");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Store URL must use HTTPS");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Store URL must not contain credentials");
  }

  if (parsed.port) {
    throw new Error("Store URL must not use an explicit port");
  }

  const host = parsed.hostname.toLowerCase();

  if (isPrivateOrLocalHost(host)) {
    throw new Error("Store URL host must be public");
  }

  if (options.expectedHost && host !== options.expectedHost.toLowerCase()) {
    throw new Error(`Store URL host ${host} does not match ${options.expectedHost}`);
  }

  parsed.hash = "";
  parsed.hostname = host;

  return {
    host,
    url: parsed.toString().replace(/\/$/, ""),
  };
}

export function createGenericRetailerIdFromHost(host: string): RetailerId {
  return `store_${host.toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9]+/g, "-")}`;
}

export function deriveRetailerNameFromHost(host: string): string {
  const withoutWww = host.toLowerCase().replace(/^www\./, "");
  const label = withoutWww.split(".")[0] ?? withoutWww;

  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function isKnownRetailerId(retailerId: RetailerId): retailerId is "john-lewis" | "jysk" {
  return Object.hasOwn(knownRetailerHosts, retailerId);
}

export function extractJohnLewisProductId(rawUrl: string): string | null {
  const match = rawUrl.match(/\/p(\d{4,})(?:$|[/?#])/i);
  return match?.[1] ? `p${match[1]}` : null;
}

function extractJyskProductId(rawUrl: string): string | null {
  const match = rawUrl.match(/\/(\d{7,})(?:$|[/?#])/);
  return match?.[1] ? match[1] : null;
}

function isPrivateOrLocalHost(host: string): boolean {
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "0.0.0.0"
  ) {
    return true;
  }

  if (host.includes(":")) {
    return true;
  }

  const octets = host.split(".").map((part) => Number.parseInt(part, 10));

  if (octets.length === 4 && octets.every((part) => Number.isInteger(part))) {
    const a = octets[0] ?? -1;
    const b = octets[1] ?? -1;

    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }

  return false;
}
