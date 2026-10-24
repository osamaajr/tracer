import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { extractSavedProduct } from '../retailers/watchlistExtractor';

const url = 'https://www.asos.com/bershka/bershka-zoo-york-x-bershka-beanie-in-denim-blue/prd/211870859';
const name = 'Bershka Zoo york x bershka beanie in denim blue';
function extract(offers: unknown, body = '', extra: Record<string, unknown> = {}) {
  const { document } = parseHTML(`<html><head><link rel="canonical" href="${url}"><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name, url, offers, ...extra })}</script></head><body><main><h1>${name}</h1>${body}</main></body></html>`);
  return extractSavedProduct(document as unknown as Document, url, { includeImage: false });
}
const offer = (availability?: string) => ({ '@type': 'Offer', price: 19.99, priceCurrency: 'GBP', ...(availability ? { availability } : {}) });

describe('saved-product stock evidence', () => {
  it('captures the live ASOS structured sold-out signal alongside its listed price', () => {
    expect(extract([offer('https://schema.org/OutOfStock')])).toMatchObject({ name, savedPrice: { amountMinor: 1999, currency: 'GBP' }, availability: 'out_of_stock' });
  });
  it.each(['https://schema.org/InStock', 'http://schema.org/InStock', 'InStock'])('reads %s', (stock) => {
    expect(extract(offer(stock))?.availability).toBe('in_stock');
  });
  it.each(['SoldOut', 'Discontinued', 'OutOfStock'])('treats %s as out of stock', (stock) => {
    expect(extract(offer(stock))?.availability).toBe('out_of_stock');
  });
  it('does not mistake missing or unrecognised availability for in stock', () => {
    expect(extract(offer())?.availability).toBe('unknown');
    expect(extract(offer('https://schema.org/PreOrder'))?.availability).toBe('unknown');
  });
  it('keeps identity and stock when a sold-out product omits its price', () => {
    expect(extract({ availability: 'https://schema.org/OutOfStock' })).toMatchObject({ name, availability: 'out_of_stock' });
    expect(extract({ availability: 'https://schema.org/OutOfStock' })?.savedPrice).toBeUndefined();
  });
  it('does not mistake a recommendation price for a sold-out product price', () => {
    const body = '<article class="product-card"><h2>Other product</h2><span data-product-price="1">£1</span></article>';
    expect(extract({ availability: 'OutOfStock', priceCurrency: 'GBP' }, body)?.savedPrice).toBeUndefined();
    expect(extract({ priceCurrency: 'GBP' }, `${body}<span data-product-price="19.99">£19.99</span>`)?.savedPrice?.amountMinor).toBe(1999);
  });
  it('does not use recommendation or hidden sold-out text', () => {
    expect(extract(offer(), '<article class="product-card"><h2>Other item</h2><p>Out of stock</p></article><p hidden>Sold out</p>')?.availability).toBe('unknown');
  });
  it('uses a product stock heading when structured availability is absent', () => {
    expect(extract(offer(), '<h3>OUT OF STOCK</h3>')?.availability).toBe('out_of_stock');
  });
  it('does not pick the first stock state from equally priced variants', () => {
    expect(extract([offer('OutOfStock'), offer('InStock')])?.availability).toBe('in_stock');
    expect(extract([offer('OutOfStock'), offer('OutOfStock')])?.availability).toBe('out_of_stock');
    expect(extract([offer('OutOfStock'), offer()])?.availability).toBe('unknown');
  });
  it('does not report a lower price belonging only to a sold-out size', () => {
    expect(extract([{ ...offer('OutOfStock'), url, price: 10 }, { ...offer('InStock'), url, price: 19.99 }])).toMatchObject({ availability: 'in_stock', savedPrice: { amountMinor: 1999, currency: 'GBP' } });
  });
  it('uses the requested variant for both its price and stock instead of the default offer', () => {
    const selectedUrl = `${url}?variant=blue`;
    const { document } = parseHTML(`<html><head><link rel="canonical" href="${url}"><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name, url, offers: [
      { ...offer('InStock'), url: `${url}?variant=green`, price: 10 },
      { ...offer('OutOfStock'), url: selectedUrl, price: 19.99 },
    ] })}</script></head><body></body></html>`);
    expect(extractSavedProduct(document as unknown as Document, selectedUrl, { includeImage: false })).toMatchObject({ canonicalUrl: selectedUrl, savedPrice: { amountMinor: 1999, currency: 'GBP' }, availability: 'out_of_stock' });
  });
  it('reads product-scoped microdata and ignores unavailable recommendation offers', () => {
    const { document } = parseHTML(`<html><body><main><article itemscope itemtype="https://schema.org/Product"><h1>${name}</h1><span itemprop="name">${name}</span><link itemprop="availability" href="https://schema.org/OutOfStock"><meta itemprop="price" content="19.99"><meta itemprop="priceCurrency" content="GBP"></article><article class="product-card"><h2>Other item</h2><p>In stock</p></article></main></body></html>`);
    expect(extractSavedProduct(document as unknown as Document, url, { includeImage: false })?.availability).toBe('out_of_stock');
  });
});
