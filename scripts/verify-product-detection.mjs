import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom/worker';
import vm from 'node:vm';
import process from 'node:process';
const { URL, performance, console } = globalThis;

const fixtures = [
  { name:'category', url:'https://www.decathlon.co.uk/accessories/sunglasses/f-color_green', price:null,
    html:'<html><head><script type="application/ld+json">{"@type":"Product","url":"https://www.decathlon.co.uk/accessories/sunglasses/f-color_green","name":"Sunglasses","offers":{"@type":"AggregateOffer","highPrice":178.9,"lowPrice":6.99,"priceCurrency":"GBP"}}</script></head><body><main><h1>Green Sunglasses</h1><button role="combobox" aria-label="Most relevant (Sort by)"></button><article><a href="/p/glasses/123">Glasses</a><button>Add to basket</button></article></main></body></html>' },
  { name:'product', url:'https://www.decathlon.co.uk/p/perf-100-light/181317/c227m8936759', price:1499,
    html:'<html><head><script type="application/ld+json">{"@graph":[{"@type":"ProductGroup","name":"Perf 100 light","productGroupID":"181317"},{"@type":"Product","name":"Perf 100 light","offers":{"@type":"Offer","url":"https://www.decathlon.co.uk/p/perf-100-light/181317/c227m8936759","priceSpecification":{"@type":"UnitPriceSpecification","price":14.99,"priceCurrency":"GBP"}}},{"@type":"Product","name":"Black glasses","offers":{"url":"https://www.decathlon.co.uk/p/black/181317","price":19.99,"priceCurrency":"GBP"}}]}</script></head><body><main><h1>Perf 100 light</h1><button>Add to basket</button></main></body></html>' },
];
// Optional captured DOM files exercise the same packaged scripts on live markup.
if (process.argv.length === 4) {
  fixtures[0].html = await readFile(process.argv[2], 'utf8');
  fixtures[1].html = await readFile(process.argv[3], 'utf8');
}
const checks = [];
for (const bundle of ['watchlistCapture.js', 'savedMonitoringCapture.js']) {
  const source = await readFile(new URL(`../apps/extension/release/${bundle}`, import.meta.url), 'utf8');
  for (const fixture of fixtures) {
    const { document } = parseHTML(fixture.html);
    const original = document.toString();
    let listener;
    const context = vm.createContext({ document, location:{href:fixture.url}, URL, performance, console,
      window:{setTimeout:() => 0},
      chrome:{runtime:{onMessage:{addListener:fn => {listener=fn;},removeListener:() => {}}}},
      fetch:async () => {throw new Error('Unexpected network request');},
    });
    const result = new vm.Script(source).runInContext(context);
    const product = bundle === 'watchlistCapture.js'
      ? (await new Promise(resolve => listener({type:'TRACER_EXTRACT_SAVED_PRODUCT'},{},resolve))).product
      : await result;
    if (fixture.price === null) assert.equal(product,null);
    else {
      assert.equal(product.name,'Perf 100 light');
      assert.equal(product.savedPrice.amountMinor,fixture.price);
      assert.equal(product.savedPrice.currency,'GBP');
    }
    assert.equal(document.toString(),original);
    checks.push({bundle,page:fixture.name,detected:Boolean(product),priceMinor:product?.savedPrice?.amountMinor ?? null,pageUnchanged:true});
  }
}
console.log(JSON.stringify({ok:true,liveDom:process.argv.length===4,checks},null,2));
