import { parseHTML } from 'linkedom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractSavedProduct, type SavedProduct } from '@tracer/core';
import { checkSavedProductPrice } from '../src/savedProductPriceCheck';

const productId = '123456';
const black = `${productId}01`;
const blue = `${productId}02`;
const origin = 'https://www.flannels.com';
const oldUrl = `${origin}/original-shirt-${productId}`;
const newUrl = `${origin}/renamed-cotton-top-${productId}`;
const item: SavedProduct = {
  name: 'Original Shirt', retailer: 'Flannels', retailerId: 'store_flannels-com',
  canonicalUrl: oldUrl, externalProductId: productId, sku: blue,
  savedPrice: { amountMinor: 2600, currency: 'GBP' },
};

function fixture(options: { canonical?: string; blueOfferUrl?: string; blueSoldOut?: boolean; blueCurrency?: string; host?: string } = {}) {
  const pageUrl = options.host ? newUrl.replace(origin, options.host) : newUrl;
  const group = {
    '@type': 'ProductGroup', productGroupID: productId, url: pageUrl, name: 'Renamed Cotton Top',
    hasVariant: [
      { '@type': 'Product', sku: black, offers: { '@type': 'Offer', sku: black, url: `${pageUrl}#colcode=${black}`, price: 20, priceCurrency: 'GBP', availability: 'https://schema.org/InStock' } },
      { '@type': 'Product', sku: blue, offers: { '@type': 'Offer', sku: blue, url: options.blueOfferUrl ?? `${pageUrl}#colcode=${blue}`, price: options.blueSoldOut ? undefined : 24, priceCurrency: options.blueCurrency ?? 'GBP', availability: options.blueSoldOut ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock' } },
    ],
  };
  return `<html><head><link rel="canonical" href="${options.canonical ?? pageUrl}"><script type="application/ld+json">${JSON.stringify(group)}</script></head><body>
    <div data-testid="buy-zone"><div data-testid="product-info"><h1>Renamed Cotton Top</h1><p data-testid="price">£20<span data-testid="ticket-price">£28</span></p></div>
    <button class="swatch_isActive" aria-labelledby="selected-variant-text" value="${black}"></button><button aria-labelledby="selected-variant-text" value="${blue}"></button></div></body></html>`;
}

const capture = (html: string, url: string) => extractSavedProduct(parseHTML(html).document as unknown as Document, url, { includeImage: false });
const check = (saved: SavedProduct, html = fixture()) => checkSavedProductPrice(saved, {
  fetchImpl: vi.fn().mockResolvedValue(new Response(html, { headers: { 'content-type': 'text/html' } })),
  readOpenProduct: vi.fn().mockResolvedValue(null),
});

afterEach(() => vi.unstubAllGlobals());

describe('Flannels and Sports Direct saved prices', () => {
  it('checks the exact saved colour after a same-product URL and title rename', async () => {
    expect(await check(item)).toMatchObject({ canonicalUrl: newUrl, sku: blue, savedPrice: { amountMinor: 2400, currency: 'GBP' } });
  });

  it('checks the displayed colour of a legacy group-level Sports Direct entry', async () => {
    const host = 'https://www.sportsdirect.com';
    const saved = { ...item, retailerId: 'store_sportsdirect-com', sku: productId, canonicalUrl: oldUrl.replace(origin, host) };
    expect(await check(saved, fixture({ host }))).toMatchObject({ sku: black, savedPrice: { amountMinor: 2000, currency: 'GBP' } });
  });

  it('captures a selected colour from the store URL, including different colour prices', () => {
    expect(capture(fixture(), `${newUrl}#colcode=${blue}`)).toMatchObject({ sku: blue, savedPrice: { amountMinor: 2400, currency: 'GBP' } });
  });

  it('does not substitute the default colour when the saved colour is missing', async () => {
    expect(await check({ ...item, sku: `${productId}99` })).toBeNull();
  });

  it('accepts verified sold-out stock for the saved colour without borrowing the available colour price', async () => {
    const result = await check(item, fixture({ blueSoldOut: true }));
    expect(result).toMatchObject({ sku: blue, availability: 'out_of_stock' });
    expect(result).not.toHaveProperty('savedPrice');
  });

  it('rejects conflicting product identity, offer colour and currency', async () => {
    expect(await check(item, fixture({ canonical: `${origin}/different-shirt-654321` }))).toBeNull();
    expect(await check(item, fixture({ blueOfferUrl: `${newUrl}#colcode=${black}` }))).toBeNull();
    expect(await check(item, fixture({ blueCurrency: 'USD' }))).toBeNull();
  });

  it('finds a matching colour in existing tabs after a blocked request without mutating tabs', async () => {
    const wrong = capture(fixture(), `${newUrl}#colcode=${black}`);
    const right = capture(fixture(), `${newUrl}#colcode=${blue}`);
    const tabs = [black, blue].map((sku, index) => ({ id: index + 1, status: 'complete', url: `${newUrl}#colcode=${sku}` }));
    const mutate = vi.fn(() => { throw new Error('Unexpected tab change'); });
    vi.stubGlobal('chrome', {
      tabs: { query: vi.fn().mockResolvedValue(tabs), get: vi.fn(async (id: number) => tabs[id - 1]), create: mutate, update: mutate, remove: mutate },
      scripting: { executeScript: vi.fn().mockResolvedValueOnce([{ frameId: 0, result: wrong }]).mockResolvedValueOnce([{ frameId: 0, result: right }]) },
    });
    expect(await checkSavedProductPrice(item, { fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 403 })) })).toMatchObject({ sku: blue });
    expect(mutate).not.toHaveBeenCalled();
  });
});
