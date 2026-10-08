import type { Money } from "../domain/types";
import type { SavedProduct } from "../domain/watchlist";
import type { PurchaseDraft, PurchaseLineItemDraft } from '../domain/types';
import { parsePrice } from '../domain/money';
import { asRecord, extractJsonLdObjects, flattenJsonLd, jsonLdHasType, firstString } from './jsonLd';
import { findProductPageImage } from './productImage';
import {
  createGenericRetailerIdFromHost,
  deriveRetailerNameFromHost,
  normalizePublicStoreUrl,
  normalizeRetailerUrl,
} from './urlSafety';

export function normalizeSavedUrl(raw: string): string {
  const safe = normalizePublicStoreUrl(raw);
  if (/(^|\.)johnlewis\.com$/.test(safe.host)) return normalizeRetailerUrl('john-lewis', raw).url;
  return safe.url;
}

/** Product evidence is required; a title or an unrelated price alone is never enough. */
export function extractSavedProduct(
  document: Document,
  pageUrl: string,
  options: { includeImage?: boolean; onTiming?: (name: string, durationMs: number) => void } = {},
): SavedProduct | null {
  try {
    const measure = <T>(name: string, operation: () => T): T => {
      if (!options.onTiming) return operation();
      const startedAt = performance.now();
      const value = operation();
      options.onTiming?.(name, performance.now() - startedAt);
      return value;
    };
    const page = measure('input URL normalization', () => normalizePublicStoreUrl(pageUrl));
    const requestedPath = new URL(page.url).pathname;
    if (/\/(?:cart|basket|checkout|account|orders?)(?:\/|$)/i.test(requestedPath)) return null;
    const isListingRoute = /\/(?:search(?:[-_]results)?|collections?|categor(?:y|ies)|catalog(?:ue)?)(?:\/|$)/i.test(requestedPath);
    const hasNestedProductRoute = /\/products?\//i.test(requestedPath);
    if (isListingRoute && !hasNestedProductRoute) return null;
    const metaValues = measure('meta and OpenGraph collection', () => {
      const values = new Map<string, string>();
      for (const element of Array.from(document.querySelectorAll<HTMLMetaElement>('meta[property], meta[name]'))) {
        const value = element.getAttribute('content')?.trim();
        if (!value) continue;
        for (const attribute of ['property', 'name']) {
          const key = element.getAttribute(attribute);
          if (key && !values.has(key)) values.set(key, value);
        }
      }
      return values;
    });
    const meta = (key: string) => metaValues.get(key);
    const url = measure('canonical URL normalization', () => {
      const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
      return normalizePublicStoreUrl(new URL(canonical || page.url, page.url).href, { expectedHost: page.host }).url;
    });
    if (new URL(url).pathname === '/') return null;
    // SPA metadata can lag behind navigation. A canonical from another page
    // cannot establish the identity of the page currently being scanned.
    const canonicalPath = new URL(url).pathname.replace(/\/$/, '');
    const currentPath = requestedPath.replace(/\/$/, '');
    if (canonicalPath !== currentPath && !(hasNestedProductRoute && currentPath.endsWith(canonicalPath))) return null;
    const objects = measure('JSON-LD parse + traversal', () => flattenJsonLd(extractJsonLdObjects(document)));
    const entities = objects.flatMap(value => {
      const entity = asRecord(value)?.mainEntity;
      return [value, ...(Array.isArray(entity) ? entity : entity ? [entity] : [])];
    });
    const products = entities.filter(p => jsonLdHasType(p, 'Product') || jsonLdHasType(p, 'https://schema.org/Product')).map(asRecord).filter(p => p !== null);
    const groups = entities.filter(p => jsonLdHasType(p, 'ProductGroup') || jsonLdHasType(p, 'https://schema.org/ProductGroup')).map(asRecord).filter(p => p !== null);
    const matchesPage = (raw: unknown) => {
      try { return typeof raw === 'string' && normalizeSavedUrl(new URL(raw, page.url).href) === normalizeSavedUrl(url); } catch { return false; }
    };
    let product = products.length === 1 ? products[0] : products.find(p =>
      matchesPage(p.url) || asRecords(p.offers).some(offer => matchesPage(offer.url)),
    );
    if (!product && groups.length === 1) product = groups[0];
    if ((products.length > 1 || groups.length > 1) && !product) return null;
    // A lone recommended product must not turn an unrelated page into that product.
    if (typeof product?.url === 'string' && normalizeSavedUrl(new URL(product.url, page.url).href) !== normalizeSavedUrl(url)) return null;
    const offerUrls = asRecords(product?.offers).map(offer => offer.url).filter(raw => typeof raw === 'string');
    if (!product?.url && offerUrls.length && !offerUrls.some(matchesPage)) return null;
    const scopes = measure('itemprop product scope scan', () => document.querySelectorAll('[itemtype$="/Product"]'));
    let scope = scopes.length === 1 ? scopes[0] : null;
    if (scopes.length > 1 && !product) return null;
    const ogProduct = /^(?:product|product\.item)$/i.test(meta('og:type') || '');
    const productRoute = isProductDetailPath(canonicalPath);
    const { productForm, addControl, headings } = measure('product DOM evidence scan', () => {
      const belongsToAnotherCard = (element: Element) => {
        const card = element.closest('li, article, [class*="product-card" i], [class*="product-tile" i], [class*="product-item" i], [data-testid*="product-card" i]');
        return Boolean(card && !card.querySelector('h1') && Array.from(card.querySelectorAll('a[href]')).some(link => !matchesPage(link.getAttribute('href'))));
      };
      const form = Array.from(document.querySelectorAll('main form[action*="/cart/add"], form[action="/cart/add"]'))
        .find(element => !belongsToAnotherCard(element));
      let hasAddControl = false;
      for (const element of (document.querySelector('main') ?? document).querySelectorAll('button, [role="button"]')) {
        if (/^add to (?:bag|basket|cart)$/i.test(element.textContent?.trim() ?? '')) {
          // Quick-add controls in recommendation/listing cards are not the
          // purchase control for the page's main product.
          if (belongsToAnotherCard(element)) continue;
          hasAddControl = true;
          break;
        }
      }
      return { productForm: form, addControl: hasAddControl, headings: document.querySelectorAll('h1') };
    });
    const hasSingleProductName = headings.length === 1 || Boolean(meta('og:title'));
    const detailControl = Boolean(productForm) || addControl;
    const domProduct = productRoute && hasSingleProductName && detailControl;
    const hasPageType = (type: string) => objects.some(value =>
      jsonLdHasType(value, type) || jsonLdHasType(value, `https://schema.org/${type}`),
    );
    // Some stores publish Product + AggregateOffer for an entire category.
    // Explicit listing evidence wins over even a matching Product URL.
    if (hasPageType('CollectionPage') || hasPageType('SearchResultsPage')) return null;
    if (objects.some(value => asRecords(asRecord(value)?.mainEntity).some(entity =>
      jsonLdHasType(entity, 'ItemList') || jsonLdHasType(entity, 'https://schema.org/ItemList'),
    ))) return null;
    if (hasProductListingControls(document, page.url) && !(productRoute && detailControl)) return null;
    if (!productRoute && !detailControl && hasPageType('ItemList')) return null;
    const aggregateOffers = asRecords(product?.offers).filter(offer =>
      jsonLdHasType(offer, 'AggregateOffer') || jsonLdHasType(offer, 'https://schema.org/AggregateOffer'),
    );
    if (aggregateOffers.length && !productRoute && !detailControl) return null;
    // OpenGraph alone describes categories too. Require a detail route or a
    // real purchase control before allowing it to establish product identity.
    const ogDetail = ogProduct && (productRoute || headings.length === 1 && detailControl);
    let scopeDetail = Boolean(scope && (productRoute || detailControl || headings.length === 1 && scope.contains(headings[0]!)));
    if (scopeDetail && scope) {
      const scopeUrl = scope.querySelector('[itemprop="url"]');
      const rawScopeUrl = scopeUrl?.getAttribute('href') ?? scopeUrl?.getAttribute('content');
      if (rawScopeUrl && !matchesPage(rawScopeUrl)) scopeDetail = false;
    }
    if (!scopeDetail) scope = null;
    if (!product && !scopeDetail && !ogDetail && !domProduct) return null;
    if (product && !productRoute && !detailControl && !matchesPage(product.url)) return null;
    const name = (firstString(product?.name) || scope?.querySelector('[itemprop="name"]')?.textContent || meta('og:title') || headings[0]?.textContent)?.trim().replace(/\s+/g, ' ');
    if (!name || name.length < 2 || name.length > 300) return null;
    const retailerId = /(^|\.)johnlewis\.com$/.test(page.host) ? 'john-lewis' : createGenericRetailerIdFromHost(page.host);
    const retailer = retailerId === 'john-lewis'
      ? 'John Lewis'
      : meta('og:site_name') || deriveRetailerNameFromHost(page.host);
    const result: SavedProduct = { name, retailer, retailerId, canonicalUrl: normalizeSavedUrl(url) };
    const variants = Array.isArray(product?.hasVariant)
      ? product.hasVariant.map(asRecord).filter((variant) => variant !== null)
      : [];
    const productSku = firstString(product?.sku);
    const offer = selectOffer([
      ...asRecords(product?.offers),
      ...variants.flatMap((variant) => asRecords(variant.offers)),
    ], productSku, url, page.url);
    const priceNode = scope?.querySelector('[itemprop="price"]');
    const metaPrice = meta('product:price:amount') ?? meta('og:price:amount');
    const metaCurrency = meta('product:price:currency') ?? meta('og:price:currency');
    const priceSpecification = currentPriceSpecification(offer);
    const isPriceRange = offer?.lowPrice !== undefined && offer?.highPrice !== undefined && String(offer.lowPrice) !== String(offer.highPrice);
    const rawPrice = offer?.price ?? priceSpecification?.price ?? (!isPriceRange ? offer?.lowPrice : undefined) ?? priceNode?.getAttribute('content') ?? priceNode?.textContent ?? ((ogProduct || domProduct) ? metaPrice : undefined);
    const currency = firstString(offer?.priceCurrency) || firstString(priceSpecification?.priceCurrency) || scope?.querySelector('[itemprop="priceCurrency"]')?.getAttribute('content') || metaCurrency;
    // Do not guess currency or use range, recommended-product, or arbitrary DOM prices.
    if (currency && /^[A-Z]{3}$/.test(currency) && (typeof rawPrice === 'string' || typeof rawPrice === 'number')) {
      const price = parsePrice(typeof rawPrice === 'string' || typeof rawPrice === 'number' ? rawPrice : undefined, currency);
      if (price) result.savedPrice = price;
    }
    if (!result.savedPrice && !isPriceRange && (product || scopeDetail || ogDetail || domProduct)) {
      const domPrice = findScopedDomPrice(document, currency ?? inferPageCurrency(page.url));
      if (domPrice) result.savedPrice = domPrice;
    }
    if (options.includeImage !== false) {
      const image = findProductPageImage(document, page.url, {
        structuredImage: product?.image ?? variants[0]?.image,
        productName: name,
        retailerSelectors: retailerId === 'john-lewis'
          ? ["[data-test*='product-image' i] img", "[data-testid*='product-image' i] img"]
          : undefined,
      });
      if (image) result.imageUrl = image.url;
    }
    const sku = productSku || firstString(offer?.sku) || firstString(variants[0]?.sku);
    const productId = firstString(product?.productID) || firstString(product?.productGroupID) || normalizeRetailerUrl(retailerId, url).productId;
    if (sku) result.sku = sku;
    if (productId) result.externalProductId = productId;
    return result;
  } catch { return null; }
}

function isProductDetailPath(path: string): boolean {
  return /\/(?:products?|dp|p)\//i.test(path) || /\/productpage\.\d+/i.test(path) ||
    /\/p\d+(?:\/|$)/i.test(path) || /-p\d+\.html$/i.test(path);
}

function hasProductListingControls(document: Document, pageUrl: string): boolean {
  const main = document.querySelector('main') ?? document.body;
  if (!main) return false;
  const sortControl = Array.from(main.querySelectorAll('select, [role="combobox"], button[aria-label]')).some(element =>
    /sort(?:\s|[-_]|$)|most relevant/i.test([
      element.getAttribute('aria-label'), element.getAttribute('name'), element.id,
      element.tagName === 'SELECT' ? element.textContent : '',
    ].join(' ')),
  );
  if (!sortControl) return false;
  return Array.from(main.querySelectorAll('a[href]')).some(link => {
    try {
      const target = new URL(link.getAttribute('href')!, pageUrl);
      return target.origin === new URL(pageUrl).origin && isProductDetailPath(target.pathname) && normalizeSavedUrl(target.href) !== normalizeSavedUrl(pageUrl);
    } catch { return false; }
  });
}

/**
 * Zara's product application exposes its current product data through the
 * same-origin `?ajax=true` response rather than dependable price markup. Keep
 * this adapter deliberately narrow so arbitrary application numbers can never
 * be mistaken for a product price.
 */
export function extractZaraSavedProduct(payload: unknown, pageUrl: string): SavedProduct | null {
  try {
    const page = normalizePublicStoreUrl(pageUrl);
    if (!/(^|\.)zara\.com$/.test(page.host)) return null;
    const root = asRecord(payload);
    const product = asRecord(root?.product);
    const detail = asRecord(product?.detail);
    const name = firstString(product?.name)?.trim().replace(/\s+/g, ' ');
    if (!root || !product || !detail || !name || name.length > 300) return null;

    const colors = asRecords(detail.colors);
    const prices = colors.map((color) => {
      const price = asRecord(asRecord(color.pricing)?.price);
      const currency = asRecord(price?.currency);
      const amountMinor = price?.value;
      const currencyCode = firstString(currency?.code);
      if (typeof amountMinor !== 'number' || !Number.isInteger(amountMinor) || amountMinor <= 0) return null;
      if (!currencyCode || !/^[A-Z]{3}$/.test(currencyCode)) return null;
      return { amountMinor, currency: currencyCode } satisfies Money;
    }).filter((price): price is Money => price !== null);
    if (!prices.length) return null;
    const signatures = new Set(prices.map((price) => `${price.currency}:${price.amountMinor}`));
    if (signatures.size !== 1) return null;

    const result: SavedProduct = {
      name,
      retailer: 'Zara',
      retailerId: createGenericRetailerIdFromHost(page.host),
      canonicalUrl: normalizeSavedUrl(page.url),
      savedPrice: prices[0]!,
    };
    const reference = firstString(detail.reference) || firstString(detail.displayReference);
    if (reference) result.externalProductId = reference;
    return result;
  } catch {
    return null;
  }
}

function asRecords(value: unknown): Record<string, unknown>[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map(asRecord).filter((record) => record !== null);
}

function selectOffer(
  offers: Record<string, unknown>[],
  productSku: string | null,
  canonicalUrl: string,
  pageUrl: string,
): Record<string, unknown> | null {
  if (!offers.length) return null;
  if (productSku) {
    const skuMatch = offers.find((offer) => firstString(offer.sku) === productSku);
    if (skuMatch) return skuMatch;
  }
  const urlMatch = offers.find((offer) => {
    const offerUrl = firstString(offer.url);
    if (!offerUrl) return false;
    try { return normalizeSavedUrl(new URL(offerUrl, pageUrl).href) === normalizeSavedUrl(canonicalUrl); } catch { return false; }
  });
  if (urlMatch) return urlMatch;

  const signatures = offers.map(offerSignature).filter((signature): signature is string => Boolean(signature));
  if (signatures.length === offers.length && new Set(signatures).size === 1) return offers[0] ?? null;
  if (offers.length === 1) return offers[0] ?? null;
  return null;
}

function offerSignature(offer: Record<string, unknown>): string | null {
  const specification = currentPriceSpecification(offer);
  const currency = firstString(offer.priceCurrency) || firstString(specification?.priceCurrency);
  const rawPrice = offer.price ?? specification?.price ?? offer.lowPrice;
  if (!currency || !/^[A-Z]{3}$/.test(currency) || (typeof rawPrice !== 'string' && typeof rawPrice !== 'number')) return null;
  const price = parsePrice(rawPrice, currency);
  return price ? `${price.currency}:${price.amountMinor}` : null;
}

function currentPriceSpecification(offer: Record<string, unknown> | null): Record<string, unknown> | null {
  const specifications = asRecords(offer?.priceSpecification).filter(specification =>
    (jsonLdHasType(specification, 'UnitPriceSpecification') || jsonLdHasType(specification, 'https://schema.org/UnitPriceSpecification')) &&
    (!specification.priceType || specification.priceType === 'https://schema.org/SalePrice'),
  );
  return specifications.length === 1 ? specifications[0]! : null;
}

function inferPageCurrency(pageUrl: string): string | null {
  try {
    const url = new URL(pageUrl);
    if (url.hostname.endsWith('.co.uk') || /\/(?:uk|en-gb)(?:\/|$)/i.test(url.pathname)) return 'GBP';
    return null;
  } catch { return null; }
}

function findScopedDomPrice(document: Document, currency: string | null): Money | null {
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return null;
  const selectors = [
    '[itemprop="price"]',
    '[data-product-price]',
    '[data-price]',
    '[data-testid*="price" i]',
    '[data-qa*="price" i]',
    '[class*="price-current" i]',
    '[class*="current-price" i]',
    '[class*="sale-price" i]',
    '[class*="product-price" i]',
  ];
  const root = document.querySelector('main') ?? document.body;
  if (!root) return null;
  for (const element of Array.from(root.querySelectorAll(selectors.join(','))).slice(0, 30)) {
    const value = element.getAttribute('content') ?? element.getAttribute('data-product-price') ?? element.getAttribute('data-price') ?? element.textContent;
    if (!value || value.trim().length > 80) continue;
    const price = parseDisplayedCurrentPrice(value.trim(), currency);
    if (price && price.amountMinor > 0) return price;
  }
  return null;
}

function parseDisplayedCurrentPrice(value: string, currency: string): Money | null {
  // Sale components often expose a single accessible string such as
  // "Was £85, now £34.99". Prefer the explicitly current value instead of
  // accidentally recording the crossed-out original price.
  const labelledCurrent = value.match(/(?:now|current(?:\s+price)?|sale(?:\s+price)?)\s*[:-]?\s*((?:£|\$|€|GBP|USD|EUR)\s*[0-9][0-9.,\s]*|[0-9][0-9.,\s]*\s*(?:£|\$|€|GBP|USD|EUR))/i)?.[1];
  if (labelledCurrent) return parsePrice(labelledCurrent.trim(), currency);
  return parsePrice(value, currency);
}

export function savedMatchesPurchase(saved: SavedProduct, draft: Pick<PurchaseDraft, 'retailerId' | 'storeHost'>, item: PurchaseLineItemDraft): boolean {
  try {
    const sameStore = new URL(saved.canonicalUrl).hostname.replace(/^www\./, '') === draft.storeHost.toLowerCase().replace(/^www\./, '');
    if (!sameStore) return false;
    if (saved.externalProductId && item.externalProductId) return saved.externalProductId === item.externalProductId;
    if (saved.sku && item.sku) return saved.sku === item.sku;
    return !!item.productUrl && normalizeSavedUrl(saved.canonicalUrl) === normalizeSavedUrl(item.productUrl);
  } catch {
    return false;
  }
}
