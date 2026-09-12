import type { SavedProduct } from "../domain/watchlist";
import type { PurchaseDraft, PurchaseLineItemDraft } from '../domain/types';
import { parsePrice } from '../domain/money';
import { asRecord, extractJsonLdObjects, flattenJsonLd, jsonLdHasType, firstString } from './jsonLd';
import { selectProductImage, findOpenGraphImage } from './productImage';
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
export function extractSavedProduct(document: Document, pageUrl: string): SavedProduct | null {
  try {
    const page = normalizePublicStoreUrl(pageUrl);
    if (/\/(?:cart|basket|checkout|account|orders?|search|collections|category)(?:\/|$)/i.test(new URL(page.url).pathname)) return null;
    const meta = (key: string) => document.querySelector(`meta[property="${key}"], meta[name="${key}"]`)?.getAttribute('content')?.trim();
    const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
    const url = normalizePublicStoreUrl(new URL(canonical || page.url, page.url).href, { expectedHost: page.host }).url;
    if (new URL(url).pathname === '/') return null;
    const objects = flattenJsonLd(extractJsonLdObjects(document));
    const entities = objects.flatMap(value => {
      const entity = asRecord(value)?.mainEntity;
      return [value, ...(Array.isArray(entity) ? entity : entity ? [entity] : [])];
    });
    const products = entities.filter(p => jsonLdHasType(p, 'Product') || jsonLdHasType(p, 'https://schema.org/Product')).map(asRecord).filter(p => p !== null);
    const product = products.length === 1 ? products[0] : products.find(p => {
      try { return typeof p.url === 'string' && normalizeSavedUrl(new URL(p.url, page.url).href) === normalizeSavedUrl(url); } catch { return false; }
    });
    if (products.length > 1 && !product) return null;
    // A lone recommended product must not turn an unrelated page into that product.
    if (typeof product?.url === 'string' && normalizeSavedUrl(new URL(product.url, page.url).href) !== normalizeSavedUrl(url)) return null;
    const scopes = document.querySelectorAll('[itemtype$="/Product"]');
    const scope = scopes.length === 1 ? scopes[0] : null;
    if (scopes.length > 1 && !product) return null;
    const ogProduct = /^(?:product|product\.item)$/i.test(meta('og:type') || '');
    const productRoute = /\/(?:products?|dp)\//i.test(new URL(url).pathname) ||
      /\/productpage\.\d+/i.test(new URL(url).pathname);
    const productForm = document.querySelector('main form[action*="/cart/add"], form[action="/cart/add"]');
    const addControl = Array.from(document.querySelectorAll('button, [role="button"]')).some((element) =>
      /^add to (?:bag|basket|cart)$/i.test(element.textContent?.trim() ?? ''),
    );
    const hasSingleProductName = document.querySelectorAll('h1').length === 1 || Boolean(meta('og:title'));
    const domProduct = productRoute && hasSingleProductName && (Boolean(productForm) || addControl);
    if (!product && !scope && !ogProduct && !domProduct) return null;
    const name = (firstString(product?.name) || scope?.querySelector('[itemprop="name"]')?.textContent || meta('og:title') || document.querySelector('h1')?.textContent)?.trim().replace(/\s+/g, ' ');
    if (!name || name.length < 2 || name.length > 300) return null;
    const retailerId = /(^|\.)johnlewis\.com$/.test(page.host) ? 'john-lewis' : createGenericRetailerIdFromHost(page.host);
    const retailer = retailerId === 'john-lewis'
      ? 'John Lewis'
      : meta('og:site_name') || deriveRetailerNameFromHost(page.host);
    const result: SavedProduct = { name, retailer, retailerId, canonicalUrl: normalizeSavedUrl(url) };
    const offers = product?.offers;
    const offer = asRecord(Array.isArray(offers) ? (offers.length === 1 ? offers[0] : null) : offers);
    const priceNode = scope?.querySelector('[itemprop="price"]');
    const rawPrice = offer?.price ?? priceNode?.getAttribute('content') ?? priceNode?.textContent ?? ((ogProduct || domProduct) ? meta('product:price:amount') : undefined);
    const currency = firstString(offer?.priceCurrency) || scope?.querySelector('[itemprop="priceCurrency"]')?.getAttribute('content') || meta('product:price:currency');
    // Do not guess currency or use range, recommended-product, or arbitrary DOM prices.
    if (currency && /^[A-Z]{3}$/.test(currency) && (typeof rawPrice === 'string' || typeof rawPrice === 'number')) {
      const price = parsePrice(rawPrice, currency);
      if (price) result.savedPrice = price;
    }
    const image = selectProductImage([{value: product?.image, source:'json_ld'}, {value: findOpenGraphImage(document, page.url), source:'open_graph'}], page.url);
    if (image) result.imageUrl = image.url;
    const sku = firstString(product?.sku);
    const productId = firstString(product?.productID) || normalizeRetailerUrl(retailerId, url).productId;
    if (sku) result.sku = sku;
    if (productId) result.externalProductId = productId;
    return result;
  } catch { return null; }
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
