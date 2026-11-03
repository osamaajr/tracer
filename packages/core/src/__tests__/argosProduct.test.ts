import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { extractSavedProduct } from '../retailers/watchlistExtractor';

const url = 'https://www.argos.co.uk/product/3100110';
const html = readFileSync(new URL('./fixtures/argos-product.html', import.meta.url), 'utf8');
const extract = (source = html, pageUrl = url) => extractSavedProduct(parseHTML(source).document as unknown as Document, pageUrl);

describe('Argos product detection', () => {
  it('extracts the main product despite review sorts and a recommended product link', () => {
    expect(extract(html, `${url}?clickPR=plp:2:49`)).toMatchObject({
      name: 'HoMedics Novo Mini Massage Gun', retailer: 'Argos', canonicalUrl: url, sku: '3100110',
      savedPrice: { amountMinor: 2999, currency: 'GBP' }, imageUrl: 'https://media.4rgos.it/i/Argos/3100110_R_Z001A',
    });
  });

  it('supports other product IDs and current prices without item-specific rules', () => {
    expect(extract(html.replaceAll('3100110', '8203809').replaceAll('HoMedics Novo Mini Massage Gun', 'Neo G Airflow Knee Support').replace('29.99', '14.50'), 'https://www.argos.co.uk/product/8203809'))
      .toMatchObject({ name: 'Neo G Airflow Knee Support', sku: '8203809', savedPrice: { amountMinor: 1450, currency: 'GBP' } });
  });

  it.each(['Add to trolley', 'Add  to trolley', 'Add\n to\t trolley'])('recognises the main %j control without structured product data', label => {
    const source = html.replace(/<script[\s\S]*?<\/script>/, '').replace(/<button data-test="add-to-trolley-button-button"[\s\S]*?<\/button>/, `<button>${label}</button>`);
    expect(extract(source)).toMatchObject({ name: 'HoMedics Novo Mini Massage Gun', canonicalUrl: url });
  });

  it('keeps a verified sold-out product with no purchase control checkable', () => {
    const source = html.replace('"price":"29.99"', '"availability":"https://schema.org/OutOfStock","price":"29.99"')
      .replace(/<button data-test="add-to-trolley-button-button"[\s\S]*?<\/button>/, '');
    expect(extract(source)).toMatchObject({ availability: 'out_of_stock', savedPrice: { amountMinor: 2999, currency: 'GBP' } });
  });

  it('still rejects real product-list sorting with recommendation quick-add controls', () => {
    const page = 'https://www.argos.co.uk/browse/health-and-beauty';
    const source = html.replaceAll(url, page).replace(/<button data-test="add-to-trolley-button-button"[\s\S]*?<\/button>/, '<select aria-label="Sort by"><option>Price low to high</option></select>');
    expect(extract(source, page)).toBeNull();
  });

  it('still rejects explicit collection pages and stale canonical metadata', () => {
    expect(extract(html.replace('"@type":"BreadcrumbList"', '"@type":"CollectionPage"'))).toBeNull();
    expect(extract(html, 'https://www.argos.co.uk/product/9999999')).toBeNull();
  });

  it('does not use a recommendation trolley control to establish the main product', () => {
    const source = html.replace(/<script[\s\S]*?<\/script>/, '').replace('content="product"', 'content="website"')
      .replace(/<button data-test="add-to-trolley-button-button"[\s\S]*?<\/button>/, '').replace('Add all items to trolley', 'Add to trolley');
    expect(extract(source)).toBeNull();
  });
});
