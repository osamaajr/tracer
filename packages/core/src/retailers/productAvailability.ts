import type { ProductPriceSnapshot } from '../domain/types';
import { asRecord } from './jsonLd';

type Availability = ProductPriceSnapshot['availability'];

/** Only explicit stock evidence counts; a price alone says nothing about stock. */
export function stockFromValue(value: unknown): Availability {
  if (value && typeof value === 'object') return stockFromValue(asRecord(value)?.['@id']);
  if (typeof value !== 'string') return 'unknown';
  const state = value.trim().replace(/^https?:\/\/schema\.org\//i, '').replace(/[\s_-]+/g, '').toLowerCase();
  if (['outofstock', 'soldout', 'discontinued'].includes(state)) return 'out_of_stock';
  if (['instock', 'limitedavailability'].includes(state)) return 'in_stock';
  return 'unknown';
}

/** Unselected sizes/variants are sold out only when every offer says so. */
export function stockFromOffers(offers: Record<string, unknown>[]): Availability {
  const states = offers.map(offer => stockFromValue(offer.availability));
  if (states.includes('in_stock')) return 'in_stock';
  return states.length > 0 && states.every(state => state === 'out_of_stock') ? 'out_of_stock' : 'unknown';
}

export function stockFromProductDom(document: Document, scope: Element | null): Availability {
  const root = scope ?? document.querySelector('main') ?? document.body;
  const signals: Availability[] = [];
  const visible = (element: Element): boolean => !element.closest('[hidden], [aria-hidden="true"], [style*="display:none" i], [style*="display: none" i], [style*="visibility:hidden" i], [style*="visibility: hidden" i]');
  const belongsToProduct = (element: Element): boolean => {
    const card = element.closest('li, article, aside, [class*="product-card" i], [class*="product-tile" i], [class*="recommend" i], [id*="recentlyViewed" i]');
    return !card || card.contains(document.querySelector('h1'));
  };
  for (const meta of document.querySelectorAll('meta[property="product:availability"], meta[property="og:availability"]')) {
    signals.push(stockFromValue(meta.getAttribute('content')));
  }
  if (root) {
    for (const element of root.querySelectorAll('[itemprop="availability"], [data-stock-status], [data-testid*="stock" i], h2, h3, p, button')) {
      if (!visible(element) || !belongsToProduct(element)) continue;
      const value = element.getAttribute('content') ?? element.getAttribute('href') ?? element.getAttribute('data-stock-status') ?? element.textContent;
      if (value && value.length <= 40) signals.push(stockFromValue(value));
    }
  }
  const known = new Set(signals.filter(state => state !== 'unknown'));
  return known.size === 1 ? [...known][0]! : 'unknown';
}
