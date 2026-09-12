export type ProductImageSource =
  | "order_confirmation"
  | "json_ld"
  | "gallery"
  | "product_metadata"
  | "open_graph"
  | "retailer_adapter";

export interface ProductImageCandidate {
  url: string;
  source: ProductImageSource;
}

export interface ProductImageCandidateInput {
  value: unknown;
  source: ProductImageSource;
  width?: number | undefined;
  height?: number | undefined;
  alt?: string | undefined;
  context?: string | undefined;
  nearTitle?: boolean | undefined;
}

export interface ProductPageImageOptions {
  structuredImage?: unknown;
  productName?: string | undefined;
  retailerSelectors?: string[] | undefined;
}

interface RankedImageCandidate extends ProductImageCandidate {
  width: number;
  height: number;
  alt: string;
  context: string;
  nearTitle: boolean;
  ordinal: number;
}

const MAX_CANDIDATES = 48;
const SOURCE_SCORE: Record<ProductImageSource, number> = {
  retailer_adapter: 130,
  order_confirmation: 125,
  json_ld: 110,
  gallery: 92,
  open_graph: 78,
  product_metadata: 70,
};
const GALLERY_SELECTORS = [
  "[data-product-gallery] img",
  "[data-gallery] img",
  "[data-testid*='gallery' i] img",
  "[data-test*='gallery' i] img",
  "[class*='product-gallery' i] img",
  "[class*='product__media' i] img",
  "[class*='product-media' i] img",
  "main [itemprop='image']",
  "main img[data-zoom-image]",
  "main img[data-large-image]",
];
const NEGATIVE_CONTEXT = /(?:recommend|related|similar|recently|review|rating|customer|user[-_ ]?(?:photo|upload)|ugc|carousel[-_ ]?(?:recommend|related)|also[-_ ]?(?:like|bought)|sponsored)/i;
const BAD_ASSET = /(?:favicon|tracking[-_]?pixel|transparent\.gif|sprite|wordmark|placeholder|spacer|payment[-_]?icon|trust[-_]?badge|(?:^|[/_.-])logo(?:[/_.-]|$)|[/_-]icons?[/_.-])/i;

/** Ranks a small candidate set. Weak images are omitted without failing capture. */
export function selectProductImage(
  candidates: ProductImageCandidateInput[],
  baseUrl?: string,
  productName?: string,
): ProductImageCandidate | null {
  const expanded: RankedImageCandidate[] = [];
  for (const input of candidates) {
    expandCandidate(input, baseUrl, expanded);
    if (expanded.length >= MAX_CANDIDATES) break;
  }

  const grouped = new Map<string, RankedImageCandidate[]>();
  for (const candidate of expanded) {
    const group = grouped.get(candidate.url) ?? [];
    group.push(candidate);
    grouped.set(candidate.url, group);
  }

  let best: { candidate: RankedImageCandidate; score: number } | null = null;
  for (const group of grouped.values()) {
    const sourceCount = new Set(group.map((candidate) => candidate.source)).size;
    for (const candidate of group) {
      const score = scoreCandidate(candidate, productName, sourceCount);
      if (score === null) continue;
      if (!best || score > best.score || (score === best.score && candidate.ordinal < best.candidate.ordinal)) {
        best = { candidate, score };
      }
    }
  }

  return best ? { url: best.candidate.url, source: best.candidate.source } : null;
}

/** Collects product-scoped DOM images; it never scans every image on the page. */
export function findProductPageImage(
  document: Document,
  baseUrl: string,
  options: ProductPageImageOptions = {},
): ProductImageCandidate | null {
  const candidates: ProductImageCandidateInput[] = [];
  if (options.retailerSelectors?.length) {
    collectElementCandidates(document, options.retailerSelectors, "retailer_adapter", candidates);
  }
  candidates.push({ value: options.structuredImage, source: "json_ld" });
  collectElementCandidates(document, GALLERY_SELECTORS, "gallery", candidates);

  const metadata = document.querySelectorAll<HTMLElement>(
    "meta[itemprop='image'], link[itemprop='image'], [itemprop='image'][content]",
  );
  for (const element of Array.from(metadata).slice(0, 8)) {
    candidates.push({
      value: element.getAttribute("content") || element.getAttribute("href"),
      source: "product_metadata",
    });
  }

  const openGraph = document.querySelector<HTMLMetaElement>(
    'meta[property="og:image"], meta[property="og:image:url"], meta[name="og:image"]',
  );
  candidates.push({
    value: openGraph?.content,
    source: "open_graph",
    width: metaNumber(document, "og:image:width"),
    height: metaNumber(document, "og:image:height"),
    alt: document.querySelector<HTMLMetaElement>('meta[property="og:image:alt"]')?.content,
  });

  return selectProductImage(candidates, baseUrl, options.productName);
}

export function firstUsableProductImage(value: unknown, baseUrl?: string): string | null {
  return selectProductImage([{ value, source: "product_metadata" }], baseUrl)?.url ?? null;
}

export function findOrderConfirmationImage(
  document: Document,
  productName: string,
  productUrl: string | undefined,
  baseUrl: string,
): string | null {
  const elements = Array.from(document.querySelectorAll<HTMLElement>(
    "[data-afterbuy-line-item], [data-test='order-line-item'], .order-line-item, .order-item",
  )).slice(0, 20);
  const matchingElement = elements.find((element) => {
    const textMatches = (element.textContent ?? "").toLowerCase().includes(productName.toLowerCase());
    const linkMatches = productUrl
      ? Array.from(element.querySelectorAll<HTMLAnchorElement>("a[href]")).some((link) => link.href === productUrl)
      : false;
    return textMatches || linkMatches;
  });

  if (!matchingElement) return null;
  const candidates: ProductImageCandidateInput[] = [];
  for (const image of Array.from(matchingElement.querySelectorAll<HTMLImageElement>("img")).slice(0, 8)) {
    candidates.push(...imageCandidates(image, "order_confirmation"));
  }
  return selectProductImage(candidates, baseUrl, productName)?.url ?? null;
}

export function findOpenGraphImage(document: Document, baseUrl: string): string | null {
  const image = document.querySelector<HTMLMetaElement>(
    'meta[property="og:image"], meta[property="og:image:url"], meta[name="og:image"]',
  );
  return selectProductImage([{
    value: image?.content,
    source: "open_graph",
    width: metaNumber(document, "og:image:width"),
    height: metaNumber(document, "og:image:height"),
  }], baseUrl)?.url ?? null;
}

function collectElementCandidates(
  document: Document,
  selectors: string[],
  source: ProductImageSource,
  output: ProductImageCandidateInput[],
): void {
  let elements: Element[];
  try {
    elements = Array.from(document.querySelectorAll(selectors.join(","))).slice(0, 24);
  } catch {
    return;
  }
  for (const element of elements) {
    if (element.tagName.toLowerCase() === "img") {
      output.push(...imageCandidates(element as HTMLImageElement, source));
    } else {
      output.push({
        value: element.getAttribute("content") || element.getAttribute("href"),
        source,
      });
    }
  }
}

function imageCandidates(image: HTMLImageElement, source: ProductImageSource): ProductImageCandidateInput[] {
  const width = image.naturalWidth || positiveNumber(image.getAttribute("width"));
  const height = image.naturalHeight || positiveNumber(image.getAttribute("height"));
  const shared = {
    source,
    width,
    height,
    alt: image.alt || image.getAttribute("aria-label") || "",
    context: elementContext(image),
    nearTitle: isNearMainTitle(image),
  };
  const values = [
    bestFromSrcset(image.getAttribute("srcset")),
    bestFromSrcset(image.getAttribute("data-srcset")),
    image.currentSrc,
    image.getAttribute("data-zoom-image"),
    image.getAttribute("data-large-image"),
    image.getAttribute("data-original"),
    image.getAttribute("data-lazy-src"),
    image.getAttribute("data-src"),
    image.getAttribute("src"),
  ];
  return values.filter((value): value is string => Boolean(value?.trim())).map((value) => ({ ...shared, value }));
}

function expandCandidate(
  input: ProductImageCandidateInput,
  baseUrl: string | undefined,
  output: RankedImageCandidate[],
): void {
  const seen = new WeakSet<object>();
  const visit = (value: unknown, metadata: Omit<ProductImageCandidateInput, "value">, depth: number): void => {
    if (output.length >= MAX_CANDIDATES || depth > 5 || value === null || value === undefined) return;
    if (typeof value === "string") {
      const url = normalizeProductImageUrl(bestFromSrcset(value) ?? value, baseUrl);
      if (url) {
        output.push({
          url,
          source: metadata.source,
          width: metadata.width ?? 0,
          height: metadata.height ?? 0,
          alt: metadata.alt ?? "",
          context: metadata.context ?? "",
          nearTitle: metadata.nearTitle ?? false,
          ordinal: output.length,
        });
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, metadata, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    const record = value as Record<string, unknown>;
    const next = {
      ...metadata,
      width: numberFromUnknown(record.width) || metadata.width,
      height: numberFromUnknown(record.height) || metadata.height,
      alt: stringFromUnknown(record.caption) || stringFromUnknown(record.name) || metadata.alt,
    };
    for (const key of ["contentUrl", "url", "thumbnailUrl", "image"]) visit(record[key], next, depth + 1);
  };
  const { value, ...metadata } = input;
  visit(value, metadata, 0);
}

function scoreCandidate(candidate: RankedImageCandidate, productName: string | undefined, sourceCount: number): number | null {
  let score = SOURCE_SCORE[candidate.source] + Math.max(0, sourceCount - 1) * 14;
  const urlText = decodeSafe(candidate.url).toLowerCase();
  const descriptive = `${urlText} ${candidate.alt}`.toLowerCase();
  if (BAD_ASSET.test(urlText) || NEGATIVE_CONTEXT.test(candidate.context)) return null;

  if (candidate.width && candidate.height) {
    if (candidate.width <= 48 && candidate.height <= 48) return null;
    const ratio = candidate.width / candidate.height;
    if (ratio > 4.2 || ratio < 0.24) return null;
    if (candidate.width < 100 || candidate.height < 100) score -= 70;
    else if (Math.min(candidate.width, candidate.height) >= 800) score += 24;
    else if (Math.min(candidate.width, candidate.height) >= 500) score += 18;
    else if (Math.min(candidate.width, candidate.height) >= 250) score += 10;
    if (ratio > 2.4 || ratio < 0.42) score -= 28;
  }

  if (/(?:banner|promo|newsletter|hero[-_]?desktop|masthead)/i.test(urlText)) score -= 75;
  if (/(?:thumb|thumbnail|small|tiny)[-_/.]/i.test(urlText)) score -= 24;
  if (/(?:zoom|large|hi[-_]?res|original|product)/i.test(urlText)) score += 6;
  if (candidate.nearTitle) score += 8;
  const matches = productTokens(productName).filter((token) => descriptive.includes(token)).length;
  score += Math.min(matches * 6, 24);
  return score >= 40 ? score : null;
}

function productTokens(value: string | undefined): string[] {
  if (!value) return [];
  const ignored = new Set(["and", "for", "the", "with", "from", "this", "that", "black", "white"]);
  return [...new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? [])]
    .filter((token) => token.length >= 3 && !ignored.has(token))
    .slice(0, 8);
}

function bestFromSrcset(value: string | null): string | null {
  if (!value || !/(?:\s\d+(?:\.\d+)?[wx])(?:\s*,|\s*$)/i.test(value)) return null;
  const choices = value.split(",").map((entry) => {
    const match = entry.trim().match(/^(.*?)\s+(\d+(?:\.\d+)?)(w|x)$/i);
    return match ? {
      url: match[1]?.trim() ?? "",
      size: Number(match[2]) * (match[3]?.toLowerCase() === "x" ? 1000 : 1),
    } : null;
  }).filter((choice): choice is { url: string; size: number } => Boolean(choice?.url));
  choices.sort((a, b) => b.size - a.size);
  return choices[0]?.url ?? null;
}

function elementContext(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
    parts.push(
      current.id,
      typeof current.className === "string" ? current.className : "",
      current.getAttribute("data-testid") ?? "",
      current.getAttribute("aria-label") ?? "",
    );
  }
  return parts.join(" ");
}

function isNearMainTitle(image: HTMLImageElement): boolean {
  const title = image.ownerDocument?.querySelector("h1");
  if (!title) return false;
  let ancestor = image.parentElement;
  for (let depth = 0; ancestor && depth < 4; depth += 1, ancestor = ancestor.parentElement) {
    if (ancestor === title.parentElement || (ancestor.childElementCount <= 80 && ancestor.contains(title))) {
      return true;
    }
  }
  return false;
}

function metaNumber(document: Document, property: string): number {
  return positiveNumber(document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`)?.content);
}

function positiveNumber(value: string | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function numberFromUnknown(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") return positiveNumber(value) || undefined;
  const record = typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
  return record ? numberFromUnknown(record.value) : undefined;
}

function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeProductImageUrl(value: string, baseUrl?: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim(), baseUrl);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol) || BAD_ASSET.test(`${url.pathname} ${url.search}`)) return null;
  return url.toString();
}

function decodeSafe(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}
