import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

async function captureHarness(html: string, pageUrl: string, fetchImpl = vi.fn()) {
  vi.resetModules();
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  const location = { href: pageUrl };
  const timers: Array<() => void> = [];
  const sendMessage = vi.fn();
  let listener!: (message: unknown, sender: unknown, respond: (response: unknown) => void) => boolean;
  vi.stubGlobal('document', parseHTML(html).document);
  vi.stubGlobal('location', location);
  vi.stubGlobal('fetch', fetchImpl);
  vi.stubGlobal('window', { setTimeout: (fn: () => void) => { timers.push(fn); return 0; } });
  vi.stubGlobal('chrome', { runtime: {
    sendMessage,
    onMessage: { addListener: (fn: typeof listener) => { listener = fn; }, removeListener: vi.fn() },
  } });
  await import('../src/watchlistCapture');
  const respond = vi.fn();
  const read = () => listener({ type:'TRACER_EXTRACT_SAVED_PRODUCT' }, {}, respond);
  return { location, timers, sendMessage, respond, read };
}

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('watchlist capture page identity', () => {
  it('returns no save candidate or image scan for category AggregateOffer data', async () => {
    const url = 'https://shop.example.com/accessories/sunglasses';
    const h = await captureHarness(`<script type="application/ld+json">${JSON.stringify({
      '@type':'Product',url,name:'Sunglasses',offers:{'@type':'AggregateOffer',lowPrice:6.99,highPrice:178.9,priceCurrency:'GBP'},
    })}</script>`, url);
    expect(h.read()).toBe(true);
    await flush();
    expect(h.respond).toHaveBeenCalledWith({ product:null,pageUrl:url,imageCandidates:[],imageCandidatesPending:false });
    expect(h.timers).toHaveLength(0);
  });

  it('discards a Zara ajax result if navigation occurred while fetching', async () => {
    let finish!: (value: unknown) => void;
    const fetchImpl = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const url = 'https://www.zara.com/uk/en/jacket-p123.html';
    const h = await captureHarness('<h1>Jacket</h1>', url, fetchImpl);
    h.read();
    h.location.href = 'https://www.zara.com/uk/en/woman-jackets-l1114.html';
    finish({ok:true,json:async () => ({product:{name:'Jacket',detail:{colors:[{pricing:{price:{value:2999,currency:{code:'GBP'}}}}]}}})});
    await flush();
    expect(h.respond).toHaveBeenCalledWith({ product:null,pageUrl:url,imageCandidates:[],imageCandidatesPending:false });
    expect(h.timers).toHaveLength(0);
  });

  it('does not attach the next page’s images to the previously detected product', async () => {
    const url = 'https://shop.example.com/products/lamp';
    const h = await captureHarness('<script type="application/ld+json">{"@type":"Product","name":"Lamp"}</script>', url);
    h.read();
    await flush();
    expect(h.respond.mock.calls[0]?.[0]).toMatchObject({product:{name:'Lamp'},pageUrl:url});
    expect(h.timers).toHaveLength(1);
    h.location.href = 'https://shop.example.com/products/chair';
    h.timers[0]!();
    expect(h.sendMessage).not.toHaveBeenCalled();
  });
});
