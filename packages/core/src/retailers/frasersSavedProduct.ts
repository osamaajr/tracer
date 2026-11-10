import { parsePrice } from '../domain/money';
import type { SavedProduct } from '../domain/watchlist';
import { asRecord, extractJsonLdObjects, firstString, flattenJsonLd, jsonLdHasType } from './jsonLd';
import { stockFromValue } from './productAvailability';
import { findProductPageImage } from './productImage';
import { createGenericRetailerIdFromHost, normalizePublicStoreUrl } from './urlSafety';

const retailers = new Map([['flannels.com', 'Flannels'], ['sportsdirect.com', 'Sports Direct']]);

export function frasersProductId(url: URL): string | undefined {
  if (!retailers.has(url.hostname.replace(/^www\./, ''))) return undefined;
  return url.pathname.match(/^\/[\w%-]+-(\d{6})\/?$/)?.[1];
}

export function extractFrasersSavedProduct(
  document: Document,
  pageUrl: string,
  options: { includeImage?: boolean; savedSku?: string | undefined },
): SavedProduct | null | undefined {
  const page = normalizePublicStoreUrl(pageUrl);
  const pageIdentity = new URL(page.url);
  const productId = frasersProductId(pageIdentity);
  if (!productId) return null;

  const groups = flattenJsonLd(extractJsonLdObjects(document)).map(asRecord).filter(group =>
    group && jsonLdHasType(group, 'ProductGroup'),
  );
  // Leave older page layouts to the existing generic extractor.
  if (!groups.length) return undefined;
  const matchingGroups = groups.filter(group => firstString(group?.productGroupID) === productId);
  if (matchingGroups.length !== 1) return null;
  const group = matchingGroups[0]!;

  const mainProduct = document.querySelector('[data-testid="buy-zone"] [data-testid="product-info"]');
  if (!mainProduct?.querySelector('h1') || mainProduct.closest('[hidden], [aria-hidden="true"]')) return null;

  const belongsToProduct = (raw: string) => {
    const candidate = normalizePublicStoreUrl(new URL(raw, page.url).href, { expectedHost: page.host });
    return frasersProductId(new URL(candidate.url)) === productId;
  };
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
  if (canonical && !belongsToProduct(canonical)) return null;

  const groupUrl = firstString(group.url);
  const name = firstString(group.name)?.replace(/\s+/g, ' ').trim();
  if (!groupUrl || !belongsToProduct(groupUrl) || !name || name.length > 300) return null;

  const variants = Array.isArray(group.hasVariant) ? group.hasVariant.map(asRecord) : [];
  const selectedSwatches = mainProduct.closest('[data-testid="buy-zone"]')?.querySelectorAll(
    'button[aria-labelledby="selected-variant-text"][class*="_isActive"]',
  );
  const selectedSku = selectedSwatches?.length === 1 ? selectedSwatches[0]?.getAttribute('value') : null;
  const matchingImage = typeof group.image === 'string' ? variants.filter(variant => variant?.image === group.image) : [];
  const imageSku = matchingImage.length === 1 ? firstString(matchingImage[0]?.sku) : null;
  const colourCode = new URLSearchParams(new URL(pageUrl).hash.slice(1)).get('colcode');
  // Older entries can have a six-digit group SKU. An eight-digit saved SKU
  // identifies the exact colour, even when the fetched page defaults to another.
  const sku = (options.savedSku && options.savedSku !== productId ? options.savedSku : null)
    ?? colourCode ?? selectedSku ?? imageSku;
  if (!sku || !/^\d{8}$/.test(sku) || !sku.startsWith(productId)) return null;
  const matchingVariants = variants.filter(variant => firstString(variant?.sku) === sku);
  if (matchingVariants.length !== 1) return null;
  const variant = matchingVariants[0]!;
  const offer = asRecord(variant.offers);
  const offerUrl = firstString(offer?.url);
  if (!offer || firstString(offer.sku) !== sku || !offerUrl || !belongsToProduct(offerUrl)) return null;
  const offerColourCode = new URLSearchParams(new URL(offerUrl, page.url).hash.slice(1)).get('colcode');
  if (offerColourCode !== sku) return null;

  const result: SavedProduct = {
    name,
    retailer: retailers.get(page.host.replace(/^www\./, ''))!,
    retailerId: createGenericRetailerIdFromHost(page.host),
    canonicalUrl: normalizePublicStoreUrl(new URL(canonical || groupUrl, page.url).href).url,
    externalProductId: productId,
    sku,
    availability: stockFromValue(offer.availability),
  };
  const currency = firstString(offer.priceCurrency);
  const amount = offer.price;
  if (currency && /^[A-Z]{3}$/.test(currency) && (typeof amount === 'number' || typeof amount === 'string' && /^\d+(?:\.\d{1,2})?$/.test(amount))) {
    const price = parsePrice(amount, currency);
    if (price?.currency === currency && Number.isSafeInteger(price.amountMinor) && price.amountMinor > 0) result.savedPrice = price;
  }
  if (options.includeImage !== false) {
    const image = findProductPageImage(document, page.url, { structuredImage: variant.image, productName: name });
    if (image) result.imageUrl = image.url;
  }
  return result;
}
