import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { extractSavedProduct, normalizeSavedUrl, savedMatchesPurchase, InMemoryAfterBuyRepository, protectPurchase, runPriceMonitoringCycle, type SavedProduct, type PurchaseDraft, type PurchaseRecord } from '@afterbuy/core';
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
  const purchases=new InMemoryAfterBuyRepository();
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
