import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { extractSavedProduct, extractZaraSavedProduct, findProductPageImages, normalizeSavedUrl, savedMatchesPurchase, InMemoryTracerRepository, protectPurchase, runPriceMonitoringCycle, type SavedProduct, type PurchaseDraft, type PurchaseRecord } from '@tracer/core';
import { WatchlistRepository, watchlistKey, connectAcceptedSavedItems } from '../src/watchlistRepository';

const url = 'https://shop.example.com/products/headphones';
const saved: SavedProduct = {name:'Headphones', retailer:'Shop', retailerId:'store_shop-example-com', canonicalUrl:url};
const draft: PurchaseDraft = {retailerId:saved.retailerId, retailerName:'Shop', storeHost:'shop.example.com', sourceUrl:'https://shop.example.com/orders/123', purchasedAt:'2026-09-12T10:00:00Z', captureMethod:'generic_schema_org', captureConfidence:'high', lineItems:[{productName:'Headphones', productUrl:url, quantity:1, pricePaid:{amountMinor:34999,currency:'GBP'}}]};
const productDoc = (product: Record<string, unknown>, extra = '') => parseHTML(`<html><head>${extra}<script type="application/ld+json">${JSON.stringify({'@type':'Product',name:'Headphones',...product})}</script></head><body></body></html>`).document;
function storageHarness() {
  const data: Record<string, unknown> = {tracerPendingPurchases:[{id:'existing-purchase'}], notifiedPriceDropEventIds:['drop-1']};
  const storage = {get:async (key:string) => ({[key]:structuredClone(data[key])}), set:async (value:Record<string, unknown>) => {Object.assign(data,structuredClone(value));}};
  return {data, storage, repository:new WatchlistRepository(storage)};
}

describe('watchlist extraction', () => {
  it.each(['https://www.decathlon.co.uk/accessories/sunglasses/f-color_green', 'https://shop.example.com/accessories/sunglasses'])('rejects a category mislabeled Product with AggregateOffer at %s', page => {
    const {document} = parseHTML(`<h1>Green Sunglasses</h1><script type="application/ld+json">${JSON.stringify({
      '@context':'https://schema.org','@type':'Product',url:page,name:'Sunglasses',
      aggregateRating:{'@type':'AggregateRating',ratingValue:4.6,ratingCount:9239},
      offers:{'@type':'AggregateOffer',highPrice:178.9,lowPrice:6.99,priceCurrency:'GBP'},
    })}</script>`);
    expect(extractSavedProduct(document,page)).toBeNull();
  });
  it.each(['CollectionPage','SearchResultsPage'])('rejects explicit %s even with a matching Product and quick-add control', type => {
    const {document} = parseHTML(`<script type="application/ld+json">${JSON.stringify([
      {'@type':type,url}, {'@type':'Product',url,name:'All headphones',offers:{price:10,priceCurrency:'GBP'}},
    ])}</script><main><h1>All headphones</h1><button>Add to cart</button></main>`);
    expect(extractSavedProduct(document,url)).toBeNull();
  });
  it.each(['categories','collection','search-results','catalog'])('rejects a %s route with misleading Product metadata', route => {
    expect(extractSavedProduct(productDoc({}),`https://shop.example.com/${route}/audio`)).toBeNull();
  });
  it('rejects an ItemList declared as the page main entity even on a product-like URL', () => {
    const document=productDoc({url},`<script type="application/ld+json">${JSON.stringify({'@type':'WebPage',url,mainEntity:{'@type':'ItemList',itemListElement:[{'@type':'Product',name:'Speaker'}]}})}</script>`);
    expect(extractSavedProduct(document,url)).toBeNull();
  });
  it('preserves a real product with review sorting and recommendation links', () => {
    const document=productDoc({url,offers:{price:10,priceCurrency:'GBP'}},'<main><h1>Headphones</h1><button>Add to basket</button><section><h2>Reviews</h2><select aria-label="Sort reviews"><option>Newest</option></select></section><a href="/products/speaker">Recommended speaker</a></main>');
    expect(extractSavedProduct(document,url)).toMatchObject({name:'Headphones',savedPrice:{amountMinor:1000,currency:'GBP'}});
  });
  it('rejects a sorted grid despite matching Product data, fixed pricing, and quick-add buttons', () => {
    const page = 'https://shop.example.com/accessories/sunglasses';
    const {document} = parseHTML(`<script type="application/ld+json">${JSON.stringify({'@type':'Product',url:page,name:'Sunglasses',offers:{price:20,priceCurrency:'GBP'}})}</script>
      <main><h1>Sunglasses</h1><button role="combobox" aria-label="Most relevant (Sort by)"></button>
      <article><h2><a href="/products/glasses">Glasses</a></h2><button>Add to cart</button></article></main>`);
    expect(extractSavedProduct(document,page)).toBeNull();
  });
  it('rejects an unscoped OpenGraph product label on an arbitrary category route', () => {
    const {document} = parseHTML('<meta property="og:type" content="product"><meta property="og:title" content="Sunglasses"><main><h1>Sunglasses</h1></main>');
    expect(extractSavedProduct(document,'https://shop.example.com/accessories/sunglasses')).toBeNull();
  });
  it('does not accept category AggregateOffer data because a recommended card has a Shopify quick-add form', () => {
    const page = 'https://shop.example.com/accessories/sunglasses';
    const document = productDoc({url:page,offers:{'@type':'AggregateOffer',lowPrice:5,highPrice:50,priceCurrency:'GBP'}},
      '<main><h1>Sunglasses</h1><article><a href="/products/glasses">Glasses</a><form action="/cart/add"><button>Add to cart</button></form></article></main>');
    expect(extractSavedProduct(document,page)).toBeNull();
  });
  it('preserves a product detail purchase control inside an article with shipping links', () => {
    const {document}=parseHTML('<meta property="og:type" content="product"><meta property="og:title" content="Desk lamp"><main><article><h1>Desk lamp</h1><a href="/delivery">Shipping</a><button>Add to basket</button></article></main>');
    expect(extractSavedProduct(document,'https://shop.example.com/desk-lamp')?.name).toBe('Desk lamp');
  });
  it('rejects stale canonical metadata after navigation, including another product', () => {
    const document = productDoc({url}, `<link rel="canonical" href="${url}">`);
    expect(extractSavedProduct(document,'https://shop.example.com/accessories/audio')).toBeNull();
    expect(extractSavedProduct(document,'https://shop.example.com/products/speaker')).toBeNull();
  });
  it('rejects a lone recommended microdata product on an ordinary page', () => {
    const {document} = parseHTML('<main><h1>Audio accessories</h1><article itemtype="https://schema.org/Product"><a itemprop="url" href="/products/headphones"><span itemprop="name">Headphones</span></a><button>Add to cart</button></article></main>');
    expect(extractSavedProduct(document,'https://shop.example.com/audio')).toBeNull();
  });
  it('preserves an OpenGraph product with an opaque route and main purchase control', () => {
    const {document} = parseHTML('<meta property="og:type" content="product"><meta property="og:title" content="Desk lamp"><main><h1>Desk lamp</h1><button>Add to basket</button></main>');
    expect(extractSavedProduct(document,'https://shop.example.com/desk-lamp')?.name).toBe('Desk lamp');
  });
  it('preserves a real product with recommendations and an aggregate variant range without claiming its lowest price', () => {
    const {document} = parseHTML(`<script type="application/ld+json">${JSON.stringify([
      {'@type':'Product',url,name:'Headphones',offers:{'@type':'AggregateOffer',lowPrice:10,highPrice:20,priceCurrency:'GBP'}},
      {'@type':'ItemList',itemListElement:[{'@type':'Product',name:'Speaker',url:'https://shop.example.com/products/speaker'}]},
    ])}</script><main><h1>Headphones</h1><button>Add to cart</button><span class="product-price">£10–£20</span></main>`);
    expect(extractSavedProduct(document,url)).toMatchObject(saved);
    expect(extractSavedProduct(document,url)?.savedPrice).toBeUndefined();
  });
  it('selects the current ProductGroup variant by its offer URL', () => {
    const {document} = parseHTML(`<script type="application/ld+json">${JSON.stringify({'@graph':[
      {'@type':'ProductGroup',name:'Glasses',productGroupID:'181317'},
      {'@type':'Product',name:'White glasses',image:'https://shop.example.com/white.jpg',offers:{url,priceSpecification:{'@type':'UnitPriceSpecification',price:14.99,priceCurrency:'GBP'}}},
      {'@type':'Product',name:'Black glasses',offers:{url:'https://shop.example.com/products/black',price:19.99,priceCurrency:'GBP'}},
    ]})}</script>`);
    expect(extractSavedProduct(document,url)).toMatchObject({name:'White glasses',savedPrice:{amountMinor:1499,currency:'GBP'}});
  });
  it('does not treat an original list price specification as the current price', () => {
    expect(extractSavedProduct(productDoc({offers:{priceSpecification:{'@type':'UnitPriceSpecification',price:100,priceCurrency:'GBP',priceType:'https://schema.org/ListPrice'}}}),url)?.savedPrice).toBeUndefined();
  });
  it('rejects a lone recommended product identified only by an unrelated offer URL', () => {
    expect(extractSavedProduct(productDoc({offers:{url:'https://shop.example.com/products/speaker',price:10,priceCurrency:'GBP'}}),url)).toBeNull();
  });
  it('ignores an unrelated microdata recommendation when extracting the main structured product', () => {
    const document=productDoc({offers:{price:20,priceCurrency:'GBP'}},'<article itemtype="https://schema.org/Product"><a itemprop="url" href="/products/speaker"></a><span itemprop="name">Speaker</span><meta itemprop="price" content="5"></article>');
    expect(extractSavedProduct(document,url)).toMatchObject({name:'Headphones',savedPrice:{amountMinor:2000,currency:'GBP'}});
  });
  it('extracts JSON-LD product metadata and strips tracking', () => {
    const result = extractSavedProduct(productDoc({sku:'S1',offers:{price:'349.99',priceCurrency:'GBP'},image:'https://shop.example.com/headphones.jpg'}), `${url}?utm_source=mail#details`);
    expect(result).toMatchObject({...saved, sku:'S1', savedPrice:{amountMinor:34999,currency:'GBP'},imageUrl:'https://shop.example.com/headphones.jpg'});
  });
  it('allows name and URL without optional metadata', () => {
    expect(extractSavedProduct(productDoc({}),url)).toEqual(saved);
  });
  it('uses a same-store canonical URL', () => {
    expect(extractSavedProduct(productDoc({},'<link rel="canonical" href="/products/headphones">'),`${url}?variant=blue`)?.canonicalUrl).toBe(url);
  });
  it('supports OpenGraph product pages without inventing prices', () => {
    const {document} = parseHTML('<meta property="og:type" content="product"><meta property="og:title" content="A nice chair"><div class="price">£15</div>');
    expect(extractSavedProduct(document,url)).toMatchObject({name:'A nice chair'});
    expect(extractSavedProduct(document,url)?.savedPrice).toBeUndefined();
  });
  it('reads Shopify OpenGraph prices and European decimal formatting', () => {
    const {document} = parseHTML(`
      <meta property="og:type" content="product">
      <meta property="og:title" content="Animal Blue Hoodie">
      <meta property="og:price:amount" content="82,00">
      <meta property="og:price:currency" content="EUR">
    `);
    expect(extractSavedProduct(document, 'https://scuffers.com/products/animal-navy-hoodie')).toMatchObject({
      name: 'Animal Blue Hoodie',
      savedPrice: {amountMinor:8200,currency:'EUR'},
    });
  });
  it('recognizes a product nested beneath a collection route through its canonical URL', () => {
    const {document} = parseHTML(`
      <link rel="canonical" href="https://shop.example.com/products/baggy-denim">
      <meta property="og:type" content="product">
      <meta property="og:title" content="White Baggy Denim">
      <meta property="og:price:amount" content="58.00">
      <meta property="og:price:currency" content="GBP">
      <main>
        <h1>White Baggy Denim</h1>
        <form action="/cart/add"><button>Add to cart</button></form>
      </main>
    `);
    expect(extractSavedProduct(
      document,
      'https://shop.example.com/collections/frontpage/products/baggy-denim?variant=123',
    )).toMatchObject({
      name: 'White Baggy Denim',
      canonicalUrl: 'https://shop.example.com/products/baggy-denim',
      savedPrice: {amountMinor:5800,currency:'GBP'},
    });
  });
  it('accepts multiple variant offers when every variant has the same price', () => {
    expect(extractSavedProduct(productDoc({
      sku:'XS',
      offers:[
        {sku:'XS',price:82,priceCurrency:'EUR'},
        {sku:'S',price:82,priceCurrency:'EUR'},
      ],
    }),url)).toMatchObject({savedPrice:{amountMinor:8200,currency:'EUR'},sku:'XS'});
  });
  it('reads ProductGroup variant prices used by newer Shopify themes', () => {
    const {document} = parseHTML(`<script type="application/ld+json">${JSON.stringify({
      '@type':'ProductGroup',
      name:'Cream selvedge denim jeans',
      productGroupID:'10394364018820',
      url,
      hasVariant:[
        {'@type':'Product',sku:'JEAN-28',image:'https://shop.example.com/jeans.jpg',offers:{'@type':'Offer',price:'188.00',priceCurrency:'AED'}},
        {'@type':'Product',sku:'JEAN-30',offers:{'@type':'Offer',price:'188.00',priceCurrency:'AED'}},
      ],
    })}</script>`);
    expect(extractSavedProduct(document,url)).toMatchObject({
      name:'Cream selvedge denim jeans',
      savedPrice:{amountMinor:18800,currency:'AED'},
      externalProductId:'10394364018820',
      imageUrl:'https://shop.example.com/jeans.jpg',
    });
  });
  it('uses a product-scoped current-price element when structured price data is absent', () => {
    const {document} = parseHTML(`
      <meta property="og:type" content="product">
      <meta property="og:title" content="Basic denim jacket">
      <main><h1>Basic denim jacket</h1><span class="price-current__amount">£29.99</span></main>
    `);
    expect(extractSavedProduct(document,'https://www.zara.com/uk/en/basic-denim-jacket-p06987314.html')).toMatchObject({
      savedPrice:{amountMinor:2999,currency:'GBP'},
    });
  });
  it('recognizes /p/ product routes and selects the current value from sale pricing', () => {
    const {document} = parseHTML(`
      <meta property="og:title" content="Camo Skater Jacket">
      <main>
        <h1>Camo Skater Jacket</h1>
        <div class="product-price">Was £85, now £34.99</div>
        <button>Add To Bag</button>
      </main>
    `);
    expect(extractSavedProduct(document,'https://www.hollisterco.com/shop/uk/p/camo-skater-jacket-61980822-1005')).toMatchObject({
      name:'Camo Skater Jacket',
      savedPrice:{amountMinor:3499,currency:'GBP'},
    });
  });
  it('reads the narrowly scoped Zara product payload when its rendered markup has no price', () => {
    expect(extractZaraSavedProduct({
      product: {
        id: 549615578,
        name: 'BASIC DENIM JACKET',
        detail: {
          reference: '06987314-V2026',
          colors: [
            {pricing:{price:{value:4599,currency:{code:'GBP',exponent:-2}}}},
            {pricing:{price:{value:4599,currency:{code:'GBP',exponent:-2}}}},
          ],
        },
      },
    }, 'https://www.zara.com/uk/en/basic-denim-jacket-p06987314.html')).toMatchObject({
      name:'BASIC DENIM JACKET',
      retailer:'Zara',
      savedPrice:{amountMinor:4599,currency:'GBP'},
      externalProductId:'06987314-V2026',
    });
  });
  it('rejects ambiguous or unscoped Zara payload prices', () => {
    const product = {product:{name:'Jacket',detail:{colors:[
      {pricing:{price:{value:4599,currency:{code:'GBP'}}}},
      {pricing:{price:{value:5599,currency:{code:'GBP'}}}},
    ]}}};
    expect(extractZaraSavedProduct(product,'https://www.zara.com/uk/en/jacket-p1.html')).toBeNull();
    expect(extractZaraSavedProduct(product,'https://example.com/products/jacket')).toBeNull();
  });
  it('supports product-scoped microdata', () => {
    const {document} = parseHTML('<main itemscope itemtype="https://schema.org/Product"><h1 itemprop="name">Desk lamp</h1><meta itemprop="price" content="24.99"><meta itemprop="priceCurrency" content="GBP"></main>');
    expect(extractSavedProduct(document,url)).toMatchObject({name:'Desk lamp',savedPrice:{amountMinor:2499,currency:'GBP'}});
  });
  it('supports H&M-style product routes with an add-to-bag control', () => {
    const {document} = parseHTML(`
      <meta property="og:title" content="Oversized flannel shirt">
      <meta property="og:site_name" content="H&amp;M">
      <meta property="og:image" content="https://www2.hm.com/shirt.jpg">
      <meta property="product:price:amount" content="37.99">
      <meta property="product:price:currency" content="GBP">
      <button>Add to bag</button>
    `);
    expect(extractSavedProduct(document, 'https://www2.hm.com/en_gb/productpage.1360951001.html')).toMatchObject({
      name: 'Oversized flannel shirt',
      retailer: 'H&M',
      savedPrice: {amountMinor:3799,currency:'GBP'},
      imageUrl: 'https://www2.hm.com/shirt.jpg',
    });
  });
  it('returns multiple unique product images for the save-image arrows', () => {
    const {document} = parseHTML(`
      <script type="application/ld+json">${JSON.stringify({
        '@type':'Product',
        name:'Oversized flannel shirt',
        image:[
          'https://www2.hm.com/shirt-front.jpg?width=1200',
          'https://www2.hm.com/shirt-side.jpg?width=1200',
          'https://www2.hm.com/shirt-back.jpg?width=1200',
        ],
      })}</script>
      <main><div class="product-carousel"><picture><img src="https://www2.hm.com/shirt-front.jpg?width=400" alt="Oversized flannel shirt"></picture></div></main>
    `);
    expect(findProductPageImages(
      document,
      'https://www2.hm.com/en_gb/productpage.1360951001.html',
      {productName:'Oversized flannel shirt'},
    ).map((image) => image.url)).toEqual([
      'https://www2.hm.com/shirt-front.jpg?width=1200',
      'https://www2.hm.com/shirt-side.jpg?width=1200',
      'https://www2.hm.com/shirt-back.jpg?width=1200',
    ]);
  });
  it('keeps recommended-product images out of the current product picker', () => {
    const {document} = parseHTML(`
      <script type="application/ld+json">${JSON.stringify({
        '@type':'Product',
        name:'Relaxed Fit Printed T-shirt',
        image:'https://lp2.hm.com/current-shirt-front.jpg?width=1200',
      })}</script>
      <main>
        <section class="x9f3-media">
          <picture><img src="https://lp2.hm.com/current-shirt-front.jpg?width=400" alt="Relaxed Fit Printed T-shirt front"></picture>
          <picture><img src="https://lp2.hm.com/current-shirt-back.jpg?width=400" alt="Relaxed Fit Printed T-shirt back"></picture>
        </section>
        <section class="recommendations"><h2>You may also like</h2>
          <picture><img src="https://lp2.hm.com/white-secondary-shirt.jpg?width=400" alt="Another T-shirt"></picture>
        </section>
      </main>
    `);
    const images = findProductPageImages(
      document,
      'https://www2.hm.com/en_gb/productpage.0967955204.html',
      {productName:'Relaxed Fit Printed T-shirt'},
    ).map((image) => image.url);
    expect(images).toContain('https://lp2.hm.com/current-shirt-front.jpg?width=1200');
    expect(images).toContain('https://lp2.hm.com/current-shirt-back.jpg?width=400');
    expect(images).not.toContain('https://lp2.hm.com/white-secondary-shirt.jpg?width=400');
  });
  it('keeps image arrows when a retailer rewrites gallery URLs but preserves the product ID', () => {
    const {document} = parseHTML(`
      <meta property="og:image" content="https://lp2.hm.com/hmgoepprod?set=source[/model/1234567890/recommended.jpg]&amp;call=url[file:/product/main]">
      <main>
        <section class="product-media">
          <picture><source srcset="https://image.hm.com/assets/hm/0967955204/black-front.avif?width=1200 1200w"><img src="https://image.hm.com/assets/hm/0967955204/black-front.avif?width=400" alt="Relaxed Fit Printed T-shirt front"></picture>
          <picture><img src="https://image.hm.com/assets/hm/0967955204/black-back.avif?width=800" alt="Relaxed Fit Printed T-shirt back"></picture>
          <picture><img src="https://image.hm.com/assets/hm/0967955204/black-detail.avif?width=800" alt="Relaxed Fit Printed T-shirt detail"></picture>
        </section>
        <section class="recommendations"><h2>You may also like</h2>
          <picture><img src="https://image.hm.com/assets/hm/1234567890/white-shirt.avif?width=800" alt="Another T-shirt"></picture>
        </section>
      </main>
    `);
    const images = findProductPageImages(
      document,
      'https://www2.hm.com/en_gb/productpage.0967955204.html',
      {
        productName:'Relaxed Fit Printed T-shirt',
        productIdentifiers:['0967955204'],
      },
    ).map((image) => image.url);
    expect(images).toContain('https://image.hm.com/assets/hm/0967955204/black-front.avif?width=1200');
    expect(images).toContain('https://image.hm.com/assets/hm/0967955204/black-back.avif?width=800');
    expect(images).toContain('https://image.hm.com/assets/hm/0967955204/black-detail.avif?width=800');
    expect(images.some((image) => image.includes('1234567890'))).toBe(false);
    expect(images).toHaveLength(3);
  });
  it('ignores ambiguous offers and unknown currencies', () => {
    expect(extractSavedProduct(productDoc({offers:[{price:10,priceCurrency:'GBP'},{price:20,priceCurrency:'GBP'}]}),url)?.savedPrice).toBeUndefined();
    expect(extractSavedProduct(productDoc({offers:{price:10}}),url)?.savedPrice).toBeUndefined();
  });
  it('rejects ambiguous product lists', () => {
    const {document}=parseHTML('<script type="application/ld+json">[{"@type":"Product","name":"A"},{"@type":"Product","name":"B"}]</script>');
    expect(extractSavedProduct(document,url)).toBeNull();
  });
  it('rejects malformed data, ordinary pages, incomplete products, and failed extraction', () => {
    for (const html of ['<h1>News</h1><p>£10</p>','<script type="application/ld+json">{broken</script>','<meta property="og:type" content="product">']) {
      expect(extractSavedProduct(parseHTML(html).document,url)).toBeNull();
    }
    expect(extractSavedProduct({querySelector:() => {throw new Error('unreadable');}} as unknown as Document,url)).toBeNull();
  });
  it.each(['chrome://extensions','file:///tmp/a.html','http://shop.example.com/products/a','https://localhost/products/a','https://shop.example.com/cart','https://shop.example.com/orders/1'])('rejects unsupported or non-product URL %s', page => {
    expect(extractSavedProduct(productDoc({}),page)).toBeNull();
  });
  it('rejects cross-store canonical links', () => {
    expect(extractSavedProduct(productDoc({},'<link rel="canonical" href="https://other.example/products/a">'),url)).toBeNull();
  });
  it('normalizes tracking, hashes, query order and trailing slashes while preserving identity queries', () => {
    expect(normalizeSavedUrl(`${url}/?utm_campaign=a&ref=b#details`)).toBe(url);
    expect(normalizeSavedUrl(`${url}?z=2&a=1`)).toBe(`${url}?a=1&z=2`);
    expect(normalizeSavedUrl(`${url}?id=2`)).not.toBe(normalizeSavedUrl(`${url}?id=3`));
  });
  it('uses the existing John Lewis identifier normalization', () => {
    expect(extractSavedProduct(productDoc({}), 'https://www.johnlewis.com/headphones/p1234567?colour=black')).toMatchObject({retailerId:'john-lewis',externalProductId:'p1234567',canonicalUrl:'https://www.johnlewis.com/headphones/p1234567'});
  });
});

describe('watchlist persistence and isolation', () => {
  it('saves minimal products and survives repository reload', async () => {
    const {repository,storage}=storageHarness();
    const result=await repository.save(saved);
    expect(result.duplicate).toBe(false);
    expect(result.item).toMatchObject({...saved,status:'saved'});
    expect(new Date(result.item.savedAt).toISOString()).toBe(result.item.savedAt);
    expect(await new WatchlistRepository(storage).list()).toEqual([result.item]);
  });
  it('serializes concurrent saves and prevents canonical duplicates', async () => {
    const {repository}=storageHarness();
    const results=await Promise.all([repository.save(saved),repository.save({...saved,canonicalUrl:`${url}?utm_source=test`}),repository.save({...saved,name:'Chair',canonicalUrl:'https://shop.example.com/products/chair'})]);
    expect(results[1]?.duplicate).toBe(true);
    expect(await repository.list()).toHaveLength(2);
  });
  it('backfills a missing baseline price without replacing an existing saved baseline', async () => {
    const {repository}=storageHarness();
    const first=await repository.save(saved);
    const backfilled=await repository.save({...saved,savedPrice:{amountMinor:12999,currency:'GBP'}});
    expect(backfilled.item.savedPrice).toEqual({amountMinor:12999,currency:'GBP'});
    await repository.save({...saved,savedPrice:{amountMinor:9999,currency:'GBP'}});
    expect((await repository.list())[0]?.savedPrice).toEqual({amountMinor:12999,currency:'GBP'});
    expect(first.item.id).toBe(backfilled.item.id);
  });
  it('updates monitoring fields without touching unrelated saved metadata', async () => {
    const {repository}=storageHarness();
    const {item}=await repository.save({...saved,savedPrice:{amountMinor:12999,currency:'GBP'}});
    const updated=await repository.updateMonitoring(item.id,{currentPrice:{amountMinor:9999,currency:'GBP'},priceDropAmount:{amountMinor:3000,currency:'GBP'},priceDropPercent:23.08,monitoringStatus:'price_dropped',lastCheckedAt:'2026-09-13T06:00:00.000Z'});
    expect(updated).toMatchObject({id:item.id,name:saved.name,savedPrice:{amountMinor:12999,currency:'GBP'},currentPrice:{amountMinor:9999,currency:'GBP'},monitoringStatus:'price_dropped'});
  });
  it('removes only saved entries and preserves protection storage and notification history', async () => {
    const {repository,data}=storageHarness();
    const before=structuredClone(data);
    const {item}=await repository.save(saved);
    await repository.remove(item.id);
    expect(await repository.list()).toEqual([]);
    expect(data.tracerPendingPurchases).toEqual(before.tracerPendingPurchases);
    expect(data.notifiedPriceDropEventIds).toEqual(before.notifiedPriceDropEventIds);
    expect(Object.keys(data).sort()).toEqual([...Object.keys(before),watchlistKey].sort());
  });
  it('clears every saved item while preserving linked protected items', async () => {
    const {repository}=storageHarness();
    const {item}=await repository.save(saved);
    await repository.save({...saved,name:'Chair',canonicalUrl:'https://shop.example.com/products/chair'});
    await repository.connect(draft,'pur_123');
    await repository.clearSaved();
    expect(await repository.list()).toEqual([]);
    expect(await repository.all()).toEqual([expect.objectContaining({id:item.id,status:'protected',protectionId:'pur_123'})]);
  });
  it('links a purchased item without deleting original metadata or unrelated saved items', async () => {
    const {repository,data}=storageHarness();
    const {item}=await repository.save(saved);
    await repository.save({...saved,name:'Chair',canonicalUrl:'https://shop.example.com/products/chair'});
    await repository.connect(draft,'pur_123');
    expect(await repository.list()).toHaveLength(1);
    expect((await repository.all()).find(entry=>entry.id===item.id)).toMatchObject({...item,status:'protected',protectionId:'pur_123'});
    await repository.remove(item.id);
    expect(await repository.all()).toHaveLength(2);
    expect(data.tracerPendingPurchases).toEqual([{id:'existing-purchase'}]);
  });
  it('does not convert unrelated products or different retailers', async () => {
    const {repository}=storageHarness();
    await repository.save(saved);
    await repository.connect({...draft,retailerId:'other',storeHost:'other.example',lineItems:[{...draft.lineItems[0]!,productUrl:'https://other.example/products/headphones'}]},'pur_other');
    expect(await repository.list()).toHaveLength(1);
  });
  it('matches scoped IDs and SKU, while rejecting conflicting stronger identities', () => {
    const line = {...draft.lineItems[0]!, productUrl:'https://shop.example.com/new-slug', externalProductId:'123',sku:'S1'};
    expect(savedMatchesPurchase({...saved,externalProductId:'123'},draft,line)).toBe(true);
    expect(savedMatchesPurchase({...saved,sku:'S1'},draft,line)).toBe(true);
    expect(savedMatchesPurchase({...saved,externalProductId:'456'},draft,{...line,productUrl:url})).toBe(false);
    expect(savedMatchesPurchase({...saved,sku:'S2'},draft,{...line,productUrl:url})).toBe(false);
  });
  it('recovers after a failed write without losing later saves', async () => {
    const {storage}=storageHarness();
    let fail=true;
    const repository=new WatchlistRepository({...storage,set:async value=>{if(fail){fail=false;throw new Error('Storage failed');}await storage.set(value);}});
    await expect(repository.save(saved)).rejects.toThrow('Storage failed');
    expect(await repository.list()).toEqual([]);
    await repository.save(saved);
    expect(await repository.list()).toHaveLength(1);
  });
});


describe('protection reconciliation', () => {
  const purchase = {id:'pur_123',retailerId:draft.retailerId,storeHost:draft.storeHost,productUrl:url,productName:saved.name,pricePaid:draft.lineItems[0]!.pricePaid,quantity:1} as PurchaseRecord;
  it('converts only accepted products, retaining rejected and pending saved items', async () => {
    const {repository}=storageHarness();
    await repository.save(saved);
    await repository.save({...saved,name:'Chair',canonicalUrl:'https://shop.example.com/products/chair'});
    await connectAcceptedSavedItems(repository,{accepted:[]});
    expect(await repository.list()).toHaveLength(2);
    await connectAcceptedSavedItems(repository,{accepted:[{purchase}]});
    expect((await repository.list()).map(item=>item.name)).toEqual(['Chair']);
    await connectAcceptedSavedItems(repository,{accepted:[{purchase}]});
    expect(await repository.all()).toHaveLength(2);
  });
  it('does not let watchlist storage failure fail a successful protection', async () => {
    const {repository,storage}=storageHarness();
    await repository.save(saved);
    const broken=new WatchlistRepository({...storage,set:async()=>{throw new Error('disk full');}});
    await expect(connectAcceptedSavedItems(broken,{accepted:[{purchase}]})).resolves.toBeUndefined();
    expect(await repository.list()).toHaveLength(1);
  });
});


it('keeps saved-only items out of real monitoring before and after purchase conversion', async () => {
  const {repository: watchlist}=storageHarness();
  const purchases=new InMemoryTracerRepository();
  await watchlist.save(saved);
  await watchlist.save({...saved,name:'Chair',canonicalUrl:'https://shop.example.com/products/chair'});
  const checked: string[]=[];
  const priceFetcher={fetchCurrentPrice:async (product: {canonicalUrl:string}) => {
    checked.push(product.canonicalUrl);
    return {retailerId:draft.retailerId,retailerName:'Shop',storeHost:draft.storeHost,productUrl:url,productName:saved.name,price:{amountMinor:31999,currency:'GBP'},observedAt:'2026-09-13T10:00:00Z',availability:'in_stock' as const};
  }};
  await runPriceMonitoringCycle({repository:purchases,priceFetcher,now:'2026-09-13T10:00:00Z'});
  expect(checked).toEqual([]);
  const protectedResult=await protectPurchase(purchases,{userId:'watchlist-test',draft,now:draft.purchasedAt});
  expect(protectedResult.accepted).toHaveLength(1);
  await connectAcceptedSavedItems(watchlist,protectedResult);
  expect((await watchlist.list()).map(item=>item.name)).toEqual(['Chair']);
  await runPriceMonitoringCycle({repository:purchases,priceFetcher,now:'2026-09-13T10:00:00Z'});
  expect(checked).toEqual([url]);
  expect(await purchases.listPurchasesForUser('watchlist-test')).toHaveLength(1);
});
