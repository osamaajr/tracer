export type ProductImageSource =
  | "order_confirmation"
  | "json_ld"
  | "open_graph"
  | "retailer_adapter";

export interface ProductImageCandidate {
  url: string;
  source: ProductImageSource;
}

/**
 * Product images are deliberately best-effort. A bad candidate is ignored so
 * that the purchase itself can still be captured and protected.
 */
export function selectProductImage(
  candidates: Array<{ value: unknown; source: ProductImageSource }>,
  baseUrl?: string,
): ProductImageCandidate | null {
  for (const candidate of candidates) {
    const url = firstUsableProductImage(candidate.value, baseUrl);

    if (url) {
      return { url, source: candidate.source };
    }
  }

  return null;
}

export function firstUsableProductImage(value: unknown, baseUrl?: string): string | null {
  if (typeof value === "string") {
    return normalizeProductImageUrl(value, baseUrl);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const url = firstUsableProductImage(item, baseUrl);

      if (url) {
        return url;
      }
    }

    return null;
  }

  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;

  for (const key of ["contentUrl", "url", "thumbnailUrl", "image"]) {
    const url = firstUsableProductImage(record[key], baseUrl);

    if (url) {
      return url;
    }
  }

  return null;
}

export function findOrderConfirmationImage(
  document: Document,
  productName: string,
  productUrl: string | undefined,
  baseUrl: string,
): string | null {
  const itemSelectors = [
    "[data-afterbuy-line-item]",
    "[data-test='order-line-item']",
    ".order-line-item",
    ".order-item",
  ];
  const elements = Array.from(document.querySelectorAll<HTMLElement>(itemSelectors.join(",")));
  const matchingElement = elements.find((element) => {
    const textMatches = (element.textContent ?? "").toLowerCase().includes(productName.toLowerCase());
    const linkMatches = productUrl
      ? Array.from(element.querySelectorAll<HTMLAnchorElement>("a[href]")).some(
          (link) => link.href === productUrl,
        )
      : false;

    return textMatches || linkMatches;
  });

  if (!matchingElement) {
    return null;
  }

  const image = matchingElement.querySelector<HTMLImageElement>("img");
  if (!image || isObviouslyTinyImage(image)) {
    return null;
  }

  return firstUsableProductImage(
    image.currentSrc || image.src || image.getAttribute("data-src") || image.getAttribute("srcset"),
    baseUrl,
  );
}

function isObviouslyTinyImage(image: HTMLImageElement): boolean {
  const width = image.naturalWidth || numericAttribute(image, "width");
  const height = image.naturalHeight || numericAttribute(image, "height");

  return Boolean(width && height && width <= 32 && height <= 32);
}

function numericAttribute(element: Element, name: string): number {
  const value = Number(element.getAttribute(name));

  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function findOpenGraphImage(document: Document, baseUrl: string): string | null {
  const image = document.querySelector<HTMLMetaElement>(
    'meta[property="og:image"], meta[property="og:image:url"], meta[name="og:image"]',
  );

  return firstUsableProductImage(image?.content, baseUrl);
}

function normalizeProductImageUrl(value: string, baseUrl?: string): string | null {
  let url: URL;

  try {
    url = new URL(value.trim(), baseUrl);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(url.protocol) || looksLikeNonProductAsset(url)) {
    return null;
  }

  return url.toString();
}

function looksLikeNonProductAsset(url: URL): boolean {
  const value = `${url.pathname} ${url.search}`.toLowerCase();

  return /(?:favicon|tracking[-_]?pixel|transparent\.gif|sprite|wordmark|(?:^|[\/_-])logo(?:[._/-]|$))/.test(
    value,
  );
}
