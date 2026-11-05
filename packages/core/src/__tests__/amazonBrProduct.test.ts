import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { extractSavedProduct } from '../retailers/watchlistExtractor';

const first = 'B0H3WHDZK2';
const fixture = (asin = first) => readFileSync(new URL(`./fixtures/amazon-br-${asin.toLowerCase()}.html`, import.meta.url), 'utf8');
const extract = (html = fixture(), url = `https://www.amazon.com.br/dp/${first}`, includeImage = true) =>
  extractSavedProduct(parseHTML(html).document as unknown as Document, url, { includeImage });

describe('Amazon Brasil product capture', () => {
  it.each([[first, 589863, 'unknown'], ['B0H4HYLQ71', 582245, 'in_stock']])('captures reported %s with Portuguese input controls and multiple headings', (asin, amountMinor, availability) => {
    expect(extract(fixture(String(asin)), `https://www.amazon.com.br/dp/${asin}`)).toMatchObject({
      retailer: 'Amazon Brasil', retailerId: 'store_amazon-com-br', sku: asin, externalProductId: asin,
      savedPrice: { amountMinor, currency: 'BRL' }, availability,
      imageUrl: expect.stringMatching(/^https:\/\/m\.media-amazon\.com\/images\//),
      canonicalUrl: expect.stringContaining(`/dp/${asin}`),
    });
  });

  it('supports SEO, gp/product and other ASINs without item-specific rules', () => {
    const html = fixture().replaceAll(first, 'B012345678');
    for (const path of ['/dp/B012345678?th=1', '/Notebook/dp/B012345678/ref=test', '/gp/product/B012345678']) {
      expect(extract(html, `https://www.amazon.com.br${path}`, false)).toMatchObject({ sku: 'B012345678', savedPrice: { amountMinor: 589863, currency: 'BRL' } });
      expect(extract(html, `https://www.amazon.com.br${path}`, false)).not.toHaveProperty('imageUrl');
    }
  });

  it('uses the displayed main offer, never the strike price, installments, fees or ads', () => {
    const html = fixture().replace('</body>', '<aside><span class="a-price">R$1,00</span><input id="ad-ASIN" value="B000000000"></aside></body>');
    expect(extract(html)?.savedPrice).toEqual({ amountMinor: 589863, currency: 'BRL' });
  });

  it('reconstructs split BRL prices when accessibility text is empty', () => {
    const html = fixture().replace(/R\$\s*5\.898,63/g, '');
    expect(extract(html)?.savedPrice).toEqual({ amountMinor: 589863, currency: 'BRL' });
  });

  it('omits conflicting main prices instead of guessing the cheapest', () => {
    const { document } = parseHTML(fixture());
    document.querySelector('#corePrice_feature_div')!.innerHTML = '<span class="a-price apex-pricetopay-value"><span class="a-offscreen">R$4.999,00</span></span>';
    expect(extract(document.toString())).not.toHaveProperty('savedPrice');
  });

  it.each(['Atualmente indisponível', 'Não disponível', 'Fora de estoque', 'Esgotado'])('recognises %s without a price or buy control', text => {
    const { document } = parseHTML(fixture());
    document.querySelector('#availability')!.textContent = text;
    document.querySelector('#add-to-cart-button')!.remove();
    for (const e of document.querySelectorAll('#corePrice_feature_div, #corePriceDisplay_desktop_feature_div')) e.remove();
    expect(extract(document.toString())).toMatchObject({ availability: 'out_of_stock', sku: first });
    expect(extract(document.toString())).not.toHaveProperty('savedPrice');
  });

  it.each([
    ['another canonical ASIN', (s: string) => s.replace(`dp/${first}`, 'dp/B000000000')],
    ['another main widget ASIN', (s: string) => s.replace(`data-csa-c-asin="${first}"`, 'data-csa-c-asin="B000000000"')],
    ['another selected ASIN', (s: string) => s.replace('id="ASIN"', 'id="ASIN" value="B000000000"')],
    ['off-site canonical', (s: string) => s.replace('https://www.amazon.com.br/', 'https://evil.example/')],
    ['hidden main product', (s: string) => s.replace('id="ppd"', 'id="ppd" hidden')],
    ['missing product title', (s: string) => s.replace('id="productTitle"', 'id="not-productTitle"')],
  ])('rejects %s', (_name, mutate) => { expect(extract(mutate(fixture()))).toBeNull(); });

  it('does not detect a category, search, checkout, another product or lookalike domain', () => {
    for (const url of ['https://www.amazon.com.br/s?k=notebook', 'https://www.amazon.com.br/', `https://www.amazon.com.br/dp/B000000000`, `https://www.amazon.com.br/checkout/dp/${first}`, `https://amazon.com.br.evil.example/dp/${first}`]) {
      expect(extract(fixture(), url)).toBeNull();
    }
  });

  it('never takes USD or hidden prices as Brazilian reais', () => {
    expect(extract(fixture().replaceAll('R$', '$'))).not.toHaveProperty('savedPrice');
    const { document } = parseHTML(fixture());
    for (const e of document.querySelectorAll('#corePrice_feature_div, #corePriceDisplay_desktop_feature_div')) e.setAttribute('hidden', '');
    expect(extract(document.toString())).not.toHaveProperty('savedPrice');
  });

  it('preserves structured-data capture for other Amazon layouts and countries', () => {
    for (const host of ['www.amazon.com.br', 'www.amazon.co.uk', 'www.amazon.com']) {
      const url = `https://${host}/dp/${first}`;
      const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Notebook', url, sku: first, offers: { price: '100.50', priceCurrency: host.endsWith('.br') ? 'BRL' : 'GBP' } })}</script>`;
      expect(extract(html, url)).toMatchObject({ name: 'Notebook', sku: first, savedPrice: { amountMinor: 10050 } });
    }
  });
});
