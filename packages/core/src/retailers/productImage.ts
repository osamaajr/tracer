import { asRecord, extractJsonLdObjects, flattenJsonLd, jsonLdHasType } from "./jsonLd";

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
  productIdentifiers?: Array<string | null | undefined> | undefined;
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

const MAX_CANDIDATES = 192;
const MAX_PRODUCT_IMAGES = 24;
const IMAGE_PRESENTATION_PARAMS = new Set([
  "auto", "bg", "background", "cache", "cb", "crop", "dpr", "fit", "fm", "fmt", "format",
  "h", "height", "hei", "imheight", "imwidth", "ixlib", "maxheight", "maxwidth", "q", "quality",
  "rect", "sh", "sw", "tr", "transformation", "v", "ver", "version", "w", "wid", "width",
]);
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
  "[data-testid*='product-media' i] img",
  "[data-testid*='product-image' i] img",
  "[data-test*='product-media' i] img",
  "[data-test*='product-image' i] img",
  "[data-product-image] img",
  "img[data-product-image]",
  "[class*='product-gallery' i] img",
  "[class*='product-images' i] img",
  "[class*='product__media' i] img",
  "[class*='product-media' i] img",
  "[class*='image-gallery' i] img",
  "[class*='media-gallery' i] img",
  "[aria-label*='product image' i] img",
  "[aria-label*='product photo' i] img",
  "main [itemprop='image']",
  "main img[data-zoom-image]",
  "main img[data-large-image]",
];
const NEGATIVE_CONTEXT = /(?:recommend|related|similar|recently|review|rating|customer|user[-_ ]?(?:photo|upload)|ugc|carousel[-_ ]?(?:recommend|related)|also[-_ ]?(?:like|bought)|sponsored)/i;
const BAD_ASSET = /(?:favicon|tracking[-_]?pixel|transparent\.gif|sprite|wordmark|placeholder|spacer|payment[-_]?icon|trust[-_]?badge|(?:^|[/_.-])logo(?:[/_.-]|$)|[/_-]icons?[/_.-])/i;
const SELECTED_IMAGE = /(?:aria[-_ ]?(?:current|selected)[-_ ]?true|data[-_ ]?(?:active|selected)[-_ ]?true|(?:^|[\s_-])(?:active|selected|current)(?:[\s_-]|$)|primary[-_ ]?(?:image|media)|main[-_ ]?(?:image|media))/i;
const PRODUCT_ONLY_IMAGE = /(?:pack[-_ ]?shot|product[-_ ]?(?:only|front|back|side|detail|image)|flat[-_ ]?lay|still[-_ ]?life|isolated|cut[-_ ]?out|ghost[-_ ]?mannequin)/i;
const LIFESTYLE_IMAGE = /(?:life[-_ ]?style|lookbook|editorial|campaign|on[-_ ]?model|model[-_ ]?(?:shot|image|view)|worn[-_ ]?by)/i;

/** Ranks a small candidate set. Weak images are omitted without failing capture. */
export function selectProductImage(
  candidates: ProductImageCandidateInput[],
  baseUrl?: string,
  productName?: string,
): ProductImageCandidate | null {
  return selectProductImages(candidates, baseUrl, productName)[0] ?? null;
}

export function selectProductImages(
  candidates: ProductImageCandidateInput[],
  baseUrl?: string,
  productName?: string,
): ProductImageCandidate[] {
  const expanded: RankedImageCandidate[] = [];
  for (const input of candidates) {
    expandCandidate(input, baseUrl, expanded);
    if (expanded.length >= MAX_CANDIDATES) break;
  }

  const grouped = new Map<string, RankedImageCandidate[]>();
  for (const candidate of expanded) {
    const identity = productImageIdentity(candidate.url);
    const group = grouped.get(identity) ?? [];
    group.push(candidate);
    grouped.set(identity, group);
  }

  const ranked: Array<{ candidate: RankedImageCandidate; score: number }> = [];
  for (const group of grouped.values()) {
    const sourceCount = new Set(group.map((candidate) => candidate.source)).size;
    let groupBest: { candidate: RankedImageCandidate; score: number } | null = null;
    for (const candidate of group) {
      const score = scoreCandidate(candidate, productName, sourceCount);
      if (score === null) continue;
      if (!groupBest || score > groupBest.score || (score === groupBest.score && candidate.ordinal < groupBest.candidate.ordinal)) {
        groupBest = { candidate, score };
      }
    }
    if (groupBest) ranked.push(groupBest);
  }

  return ranked
    .sort((left, right) => right.score - left.score || left.candidate.ordinal - right.candidate.ordinal)
    .map(({ candidate }) => ({ url: candidate.url, source: candidate.source }));
}

/** Collects product-scoped DOM images; it never scans every image on the page. */
export function findProductPageImage(
  document: Document,
  baseUrl: string,
  options: ProductPageImageOptions = {},
): ProductImageCandidate | null {
  return findProductPageImages(document, baseUrl, options)[0] ?? null;
}

export function findProductPageImages(
  document: Document,
  baseUrl: string,
  options: ProductPageImageOptions = {},
): ProductImageCandidate[] {
  const candidates: ProductImageCandidateInput[] = [];
  const structuredImages = findStructuredProductImages(document, options.productName);
  const openGraph = document.querySelector<HTMLMetaElement>(
    'meta[property="og:image"], meta[property="og:image:url"], meta[name="og:image"]',
  );
  const trustedPrimaryValues = [options.structuredImage, ...structuredImages, openGraph?.content];
  const hasTrustedPrimary = Boolean(selectProductImage(
    [{ value: trustedPrimaryValues, source: "json_ld" }],
    baseUrl,
    options.productName,
  ));
  if (options.retailerSelectors?.length) {
    collectElementCandidates(document, options.retailerSelectors, "retailer_adapter", candidates);
  }
  candidates.push({
    value: [options.structuredImage, ...structuredImages],
    source: "json_ld",
  });
  // When the page identifies its primary product image, use it to anchor the
  // gallery instead of sweeping every gallery-like block. Retailers often use
  // the same carousel markup for recommendations lower on the page.
  if (!hasTrustedPrimary) {
    collectElementCandidates(document, GALLERY_SELECTORS, "gallery", candidates);
  }

  const metadata = document.querySelectorAll<HTMLElement>(
    "meta[itemprop='image'], link[itemprop='image'], [itemprop='image'][content]",
  );
  for (const element of Array.from(metadata).slice(0, 8)) {
    candidates.push({
      value: element.getAttribute("content") || element.getAttribute("href"),
      source: "product_metadata",
    });
  }

  candidates.push({
    value: openGraph?.content,
    source: "open_graph",
    width: metaNumber(document, "og:image:width"),
    height: metaNumber(document, "og:image:height"),
    alt: document.querySelector<HTMLMetaElement>('meta[property="og:image:alt"]')?.content,
  });
  collectGalleryAroundPrimaryImage(
    document,
    baseUrl,
    trustedPrimaryValues,
    candidates,
  );
  collectImagesMatchingProductIdentity(
    document,
    baseUrl,
    options.productIdentifiers ?? [],
    candidates,
  );
  collectEmbeddedProductImages(
    document,
    baseUrl,
    options.productName,
    options.productIdentifiers ?? [],
    candidates,
  );

  const ranked = selectProductImages(candidates, baseUrl, options.productName);
  const identityTokens = productIdentityTokens(baseUrl, options.productIdentifiers ?? []);
  const identityMatches = ranked.filter((candidate) =>
    identityTokens.some((identifier) => normalizeIdentityText(candidate.url).includes(identifier)),
  );
  // Two matching assets are strong evidence of the current product's own
  // gallery. Prefer that set so an incorrect OG/JSON-LD image from a related
  // product cannot become the initially selected image or a picker option.
  const scoped = identityMatches.length >= 2 ? identityMatches : ranked;
  return scoped.slice(0, MAX_PRODUCT_IMAGES);
}

function findStructuredProductImages(document: Document, productName: string | undefined): unknown[] {
  const products = flattenJsonLd(extractJsonLdObjects(document))
    .filter((value) => jsonLdHasType(value, "Product") || jsonLdHasType(value, "ProductGroup"))
    .map(asRecord)
    .filter((value): value is Record<string, unknown> => value !== null);
  if (products.length === 0) return [];

  const normalizedName = normalizeComparableText(productName);
  const product = normalizedName
    ? products.find((candidate) => normalizeComparableText(candidate.name) === normalizedName)
    : products.length === 1 ? products[0] : undefined;
  if (!product) return [];

  const variants = Array.isArray(product.hasVariant)
    ? product.hasVariant.map(asRecord).filter((value): value is Record<string, unknown> => value !== null)
    : [];
  return [product.image, ...variants.map((variant) => variant.image)];
}

function normalizeComparableText(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replace(/\s+/g, " ").trim() : "";
}

function collectGalleryAroundPrimaryImage(
  document: Document,
  baseUrl: string,
  trustedPrimaryValues: unknown[],
  output: ProductImageCandidateInput[],
): void {
  const trustedPrimary = selectProductImage(
    [{ value: trustedPrimaryValues, source: "json_ld" }],
    baseUrl,
  )?.url;
  const root = document.querySelector("main") ?? document.body;
  if (!trustedPrimary || !root) return;

  const anchor = Array.from(root.querySelectorAll<HTMLImageElement>("img")).slice(0, 160).find((image) =>
    imageCandidateUrls(image, baseUrl).some((candidate) => sameImageResource(candidate, trustedPrimary)),
  );
  if (!anchor) return;

  let scope: Element | null = anchor.parentElement;
  for (let depth = 0; scope && depth < 7; depth += 1, scope = scope.parentElement) {
    const images = Array.from(scope.querySelectorAll<HTMLImageElement>("img"));
    if (images.length < 2) continue;
    if (images.length > 48 || NEGATIVE_CONTEXT.test(elementContext(scope))) break;
    for (const image of images) output.push(...imageCandidates(image, "gallery"));
    return;
  }
}

function collectImagesMatchingProductIdentity(
  document: Document,
  baseUrl: string,
  providedIdentifiers: Array<string | null | undefined>,
  output: ProductImageCandidateInput[],
): void {
  const identifiers = productIdentityTokens(baseUrl, providedIdentifiers);
  const root = document.querySelector("main") ?? document.body;
  if (!root || identifiers.length === 0) return;

  for (const image of Array.from(root.querySelectorAll<HTMLImageElement>("img")).slice(0, 1_000)) {
    const urls = imageCandidateUrls(image, baseUrl);
    const haystack = normalizeIdentityText([
      ...urls,
      image.alt,
      image.getAttribute("aria-label"),
      elementContext(image),
    ].filter(Boolean).join(" "));
    if (!identifiers.some((identifier) => haystack.includes(identifier))) continue;
    if (NEGATIVE_CONTEXT.test(elementContext(image))) continue;
    output.push(...imageCandidates(image, "gallery"));
  }
}

function collectEmbeddedProductImages(
  document: Document,
  baseUrl: string,
  productName: string | undefined,
  providedIdentifiers: Array<string | null | undefined>,
  output: ProductImageCandidateInput[],
): void {
  const identifiers = productIdentityTokens(baseUrl, providedIdentifiers);
  const normalizedName = normalizeComparableText(productName);
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/json"], script#__NEXT_DATA__',
  )).slice(0, 24);

  for (const script of scripts) {
    const text = script.textContent?.trim();
    if (!text || text.length > 3_000_000) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }

    let visited = 0;
    const walk = (value: unknown, depth: number): void => {
      if (depth > 12 || visited >= 20_000 || !value || typeof value !== "object") return;
      visited += 1;
      if (Array.isArray(value)) {
        for (const item of value) walk(item, depth + 1);
        return;
      }
      const record = value as Record<string, unknown>;
      if (embeddedRecordMatchesProduct(record, normalizedName, identifiers)) {
        const images: string[] = [];
        collectEmbeddedImageValues(record, images, 0);
        if (images.length) {
          output.push({ value: images, source: "gallery" });
        }
      }
      for (const [key, child] of Object.entries(record)) {
        if (NEGATIVE_CONTEXT.test(key)) continue;
        walk(child, depth + 1);
      }
    };
    walk(parsed, 0);
  }
}

function embeddedRecordMatchesProduct(
  record: Record<string, unknown>,
  normalizedName: string,
  identifiers: string[],
): boolean {
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== "string" && typeof value !== "number") continue;
    const raw = String(value);
    if (/^(?:name|title|productName)$/i.test(key) && normalizedName && normalizeComparableText(raw) === normalizedName) {
      return true;
    }
    if (!/(?:id|sku|code|product|article|style|variant)/i.test(key)) continue;
    const normalized = normalizeIdentityText(raw);
    if (identifiers.some((identifier) => normalized.includes(identifier))) return true;
  }
  return false;
}

function collectEmbeddedImageValues(value: unknown, output: string[], depth: number): void {
  if (depth > 10 || output.length >= MAX_PRODUCT_IMAGES * 2 || value === null || value === undefined) return;
  if (typeof value === "string") return;
  if (Array.isArray(value)) {
    for (const item of value) collectEmbeddedImageValues(item, output, depth + 1);
    return;
  }
  if (typeof value !== "object") return;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (NEGATIVE_CONTEXT.test(key)) continue;
    const imageField = /(?:image|media|gallery|picture|photo|asset)/i.test(key);
    if (imageField) {
      collectImageReferences(child, output, depth + 1);
      continue;
    }
    if (typeof child === "object" && child !== null) {
      collectEmbeddedImageValues(child, output, depth + 1);
    }
  }
}

function collectImageReferences(value: unknown, output: string[], depth: number): void {
  if (depth > 12 || output.length >= MAX_PRODUCT_IMAGES * 2 || value === null || value === undefined) return;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^(?:https?:)?\/\//i.test(trimmed) || trimmed.startsWith("/")) output.push(trimmed);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImageReferences(item, output, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (NEGATIVE_CONTEXT.test(key)) continue;
    collectImageReferences(child, output, depth + 1);
  }
}

function productIdentityTokens(
  baseUrl: string,
  providedIdentifiers: Array<string | null | undefined>,
): string[] {
  const values = providedIdentifiers.flatMap((value) => value ? [value] : []);
  try {
    const url = new URL(baseUrl);
    values.push(...decodeSafe(url.pathname).match(/[a-z0-9_-]{6,}/gi) ?? []);
    for (const key of ["id", "pid", "product", "productId", "sku", "style", "variant"]) {
      const value = url.searchParams.get(key);
      if (value) values.push(value);
    }
  } catch {
    // Invalid base URLs are rejected elsewhere; no identity fallback is used.
  }
  return [...new Set(values.map(normalizeIdentityText).filter((value) =>
    value.length >= 6 && /\d/.test(value),
  ))];
}

function normalizeIdentityText(value: string): string {
  return decodeSafe(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function imageCandidateUrls(image: HTMLImageElement, baseUrl: string): string[] {
  return imageCandidates(image, "gallery").flatMap((candidate) => {
    const values = Array.isArray(candidate.value) ? candidate.value : [candidate.value];
    return values.flatMap((value) => {
      if (typeof value !== "string") return [];
      const normalized = normalizeProductImageUrl(bestFromSrcset(value) ?? value, baseUrl);
      return normalized ? [normalized] : [];
    });
  });
}

function sameImageResource(left: string, right: string): boolean {
  if (left === right) return true;
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    if (leftUrl.hostname.toLowerCase() !== rightUrl.hostname.toLowerCase() || leftUrl.pathname !== rightUrl.pathname) {
      return false;
    }
    return stripPresentationSearch(leftUrl) === stripPresentationSearch(rightUrl);
  } catch {
    return false;
  }
}

function stripPresentationSearch(url: URL): string {
  const copy = new URL(url);
  for (const key of [...copy.searchParams.keys()]) {
    if (/^(?:w|width|h|height|q|quality|fit|crop|format|fm|dpr)$/i.test(key)) {
      copy.searchParams.delete(key);
    }
  }
  copy.searchParams.sort();
  return copy.search;
}

export function firstUsableProductImage(value: unknown, baseUrl?: string): string | null {
  return selectProductImage([{ value, source: "product_metadata" }], baseUrl)?.url ?? null;
}

/** Stable identity for gallery photos served through different size/format URLs. */
export function productImageIdentity(value: string, depth = 0): string {
  if (depth > 4) return value;
  try {
    const url = new URL(value);
    // H&M wraps the original photo path inside `set` and changes `call` for
    // each crop/size. The source path identifies the actual photograph.
    if (/^(?:www2\.)?hm\.com$|^lp2\.hm\.com$/i.test(url.hostname)) {
      const sourcePath = url.searchParams.get("set")?.match(/source\[([^\]]+)\]/i)?.[1];
      if (sourcePath) return `hm:${decodeSafe(sourcePath).toLowerCase()}`;
    }
    // Some storefronts proxy one image URL through another. Collapse it when
    // the wrapped value is recognisably an image URL.
    for (const key of ["url", "src", "image", "asset"]) {
      const nested = url.searchParams.get(key);
      if (!nested) continue;
      try {
        const nestedUrl = new URL(nested, url);
        if (/\.(?:avif|gif|jpe?g|png|webp)(?:$|\?)/i.test(nestedUrl.href)) {
          return productImageIdentity(nestedUrl.href, depth + 1);
        }
      } catch { /* Ignore non-URL transformation values. */ }
    }
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      const normalizedKey = key.toLowerCase();
      if (
        IMAGE_PRESENTATION_PARAMS.has(normalizedKey) ||
        normalizedKey.startsWith("utm_") ||
        /^\$.*\$$/.test(normalizedKey)
      ) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    const port = url.port && !((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80"))
      ? `:${url.port}`
      : "";
    return `${url.hostname.toLowerCase()}${port}${url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

export function findOrderConfirmationImage(
  document: Document,
  productName: string,
  productUrl: string | undefined,
  baseUrl: string,
): string | null {
  const elements = Array.from(document.querySelectorAll<HTMLElement>(
    "[data-tracer-line-item], [data-test='order-line-item'], .order-line-item, .order-item",
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
    elements = Array.from(document.querySelectorAll(selectors.join(","))).slice(0, 96);
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
  const value = [
    bestFromSrcset(image.getAttribute("srcset")),
    bestFromSrcset(image.getAttribute("data-srcset")),
    ...Array.from(image.closest("picture")?.querySelectorAll("source") ?? []).flatMap((source) => [
      bestFromSrcset(source.getAttribute("srcset")),
      bestFromSrcset(source.getAttribute("data-srcset")),
    ]),
    image.getAttribute("data-zoom-image"),
    image.getAttribute("data-large-image"),
    image.getAttribute("data-original"),
    image.getAttribute("data-original-src"),
    image.getAttribute("data-image"),
    image.getAttribute("data-image-url"),
    image.getAttribute("data-src-large"),
    image.getAttribute("data-hi-res"),
    image.getAttribute("data-master"),
    image.currentSrc,
    image.getAttribute("data-lazy-src"),
    image.getAttribute("data-src"),
    image.getAttribute("src"),
  ].find((candidate): candidate is string => Boolean(candidate?.trim()));
  return value ? [{ ...shared, value }] : [];
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
  if (SELECTED_IMAGE.test(candidate.context)) score += 32;
  if (PRODUCT_ONLY_IMAGE.test(`${descriptive} ${candidate.context}`)) score += 30;
  if (LIFESTYLE_IMAGE.test(`${descriptive} ${candidate.context}`)) score -= 24;
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
      current.getAttribute("aria-current") === "true" ? "aria-current-true" : "",
      current.getAttribute("aria-selected") === "true" ? "aria-selected-true" : "",
      current.getAttribute("data-active") === "true" ? "data-active-true" : "",
      current.getAttribute("data-selected") === "true" ? "data-selected-true" : "",
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
