import { parsePrice } from '../domain/money';
import type { Money } from '../domain/types';
import type { SavedProduct } from '../domain/watchlist';
import { findProductPageImage } from './productImage';
import { createGenericRetailerIdFromHost, normalizePublicStoreUrl } from './urlSafety';

export function isAmazonBrHost(host: string): boolean {
  return host === 'amazon.com.br' || host === 'www.amazon.com.br';
}

function productAsin(url: string): string | undefined {
  const path = new URL(url).pathname;
  return path.match(/^\/(?:[^/]+\/)?dp\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase()
    ?? path.match(/^\/gp\/product\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase();
}

// Do not use layout geometry: this also runs on fetched HTML. Amazon's visual
// price fragments are aria-hidden, so check the enclosing offer before reading
// its accessibility text or reconstructing those fragments.
function isHidden(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true'
      || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important)?\s*(?:;|$)/i.test(node.getAttribute('style') ?? '')) return true;
  }
  return false;
}

function brlPrice(text: string | null | undefined): Money | undefined {
  const value = text?.replace(/\s+/g, ' ').trim();
  // R$ must be explicit. Passing it to the generic parser would infer USD
  // from "$"; validate and remove it before parsing the localized BRL amount.
  if (!value || !/^R\$\s*(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}$/.test(value)) return undefined;
  const price = parsePrice(value.replace(/^R\$\s*/, ''), 'BRL');
  return price && Number.isSafeInteger(price.amountMinor) && price.amountMinor > 0 ? price : undefined;
}

/** Amazon Brasil lacks dependable Product JSON-LD/OG in its current desktop DOM. */
export function extractAmazonBrSavedProduct(
  document: Document,
  pageUrl: string,
  options: { includeImage?: boolean } = {},
): SavedProduct | null {
  const page = normalizePublicStoreUrl(pageUrl);
  if (!isAmazonBrHost(page.host)) return null;
  const asin = productAsin(page.url);
  if (!asin) return null;
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
  const url = normalizePublicStoreUrl(new URL(canonical || page.url, page.url).href, { expectedHost: page.host }).url;
  // Short /dp links and SEO aliases are the same product only when ASINs agree.
  if (productAsin(url) !== asin) return null;
  const root = document.querySelector('#dp-container #ppd') ?? document.querySelector('#dp-container');
  const title = root?.querySelector('#productTitle');
  const name = title?.textContent?.trim().replace(/\s+/g, ' ');
  if (!root || !title || isHidden(title) || !name || name.length < 2 || name.length > 300) return null;
  const asinInput = root.querySelector<HTMLInputElement>('#ASIN');
  const selectedAsin = (asinInput?.value || asinInput?.getAttribute('value'))?.trim();
  if (selectedAsin && selectedAsin.toUpperCase() !== asin) return null;

  const priceRoots = Array.from(root.querySelectorAll('#centerCol #corePriceDisplay_desktop_feature_div, #rightCol #corePrice_feature_div, #centerCol #corePrice_desktop_feature_div'))
    .filter(element => !isHidden(element));
  for (const element of priceRoots) {
    const widgetAsin = element.getAttribute('data-csa-c-asin')?.trim();
    if (widgetAsin && widgetAsin.toUpperCase() !== asin) return null;
  }
  const availability = root.querySelector('#rightCol #availability');
  const stockText = availability && !isHidden(availability) ? availability.textContent?.trim().toLowerCase() ?? '' : '';
  const stock = /atualmente indispon[ií]vel|n[aã]o dispon[ií]vel|fora de estoque|esgotad[oa]/.test(stockText) ? 'out_of_stock'
    : /\bem estoque\b/.test(stockText) ? 'in_stock' : 'unknown';
  const buyControl = Array.from(root.querySelectorAll('#rightCol #add-to-cart-button, #rightCol #buy-now-button'))
    .some(element => !isHidden(element));
  if (!buyControl && !priceRoots.length && stock !== 'out_of_stock') return null;

  const prices: Money[] = [];
  for (const element of priceRoots) {
    const label = element.querySelector('#apex-pricetopay-accessibility-label');
    const labelPrice = label && !isHidden(label) ? brlPrice(label.textContent) : undefined;
    if (labelPrice) prices.push(labelPrice);
    for (const node of element.querySelectorAll('.a-price.apex-pricetopay-value, .a-price.priceToPay')) {
      if (isHidden(node) || node.closest('.a-text-price, [data-a-strike="true"]')) continue;
      const offscreenPrice = brlPrice(node.querySelector('.a-offscreen')?.textContent);
      const symbol = node.querySelector('.a-price-symbol')?.textContent?.trim();
      const whole = node.querySelector('.a-price-whole')?.textContent?.trim().replace(/,$/, '');
      const fraction = node.querySelector('.a-price-fraction')?.textContent?.trim();
      const splitPrice = brlPrice(`${symbol ?? ''}${whole ?? ''},${fraction ?? ''}`);
      if (offscreenPrice) prices.push(offscreenPrice);
      if (splitPrice) prices.push(splitPrice);
    }
  }
  const result: SavedProduct = {
    name, retailer: 'Amazon Brasil', retailerId: createGenericRetailerIdFromHost(page.host),
    canonicalUrl: url, sku: asin, externalProductId: asin, availability: stock,
  };
  // Conflicting offers or partially updated SPA data must not create a false
  // price drop. Never scan installment totals, shipping, warranties or ads.
  const firstPrice = prices[0];
  if (firstPrice && new Set(prices.map(price => price.amountMinor)).size === 1) result.savedPrice = firstPrice;
  if (options.includeImage !== false) {
    const image = findProductPageImage(document, page.url, { productName: name, retailerSelectors: ['#dp-container #landingImage'] });
    if (image) result.imageUrl = image.url;
  }
  return result;
}
