import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom/worker';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import process from 'node:process';
const { URL, URLSearchParams, atob, btoa, AbortSignal, TextDecoder, TextEncoder, Event, Response, setTimeout, clearTimeout, console, performance, structuredClone } = globalThis;
import { webcrypto } from 'node:crypto';

// Exercise the actual release worker and its alarm/message entry points without
// giving it any API capable of creating or navigating a browser tab.
const source = await readFile(new URL('../apps/extension/release/background.js', import.meta.url), 'utf8');
const listeners = {};
const event = (name) => ({ addListener: (fn) => (listeners[name] ??= []).push(fn) });
const price = (amountMinor) => ({ amountMinor, currency: 'GBP' });
const saved = Array.from({ length: 8 }, (_, n) => ({ id: `saved-${n}`, name: `Silver Bracelet ${n}`, retailer: 'Example', retailerId: 'store_shop-example-com', canonicalUrl: `https://shop.example.com/products/bracelet-${n}`, savedAt: '2026-10-08T09:00:00.000Z', savedPrice: price(3500), currentPrice: price(3500), monitoringStatus: 'watching', status: 'saved' }));
const local = { tracerWatchlistV1: saved };
const session = { tracerSavedMonitorReadyAt: Date.now() - 1 };
const storage = (data) => ({ get: async () => structuredClone(data), set: async (update) => Object.assign(data, structuredClone(update)), setAccessLevel: async () => {} });
const changes = [];
const alerts = [];
const calls = [];
const forbidden = (name) => async (...args) => { changes.push({ name, args }); throw new Error(`Unexpected browser mutation: ${name}`); };
let failure = false;
const chrome = {
  storage: { local: storage(local), session: storage(session), sync: storage({ monitoringEnabled: true, priceDropAlertsEnabled: true }), onChanged: event('storage') },
  runtime: { onInstalled: event('installed'), onStartup: event('startup'), onMessage: event('message'), getURL: (path) => `chrome-extension://test/${path}` },
  alarms: { onAlarm: event('alarm'), get: async () => undefined, create: async () => {} },
  notifications: { onClicked: event('notificationClick'), create: async (...args) => alerts.push(args) },
  tabs: { onRemoved: event('removed'), onUpdated: event('updated'), onActivated: event('activated'), query: async () => [],
    create: forbidden('tabs.create'), update: forbidden('tabs.update'), remove: forbidden('tabs.remove') },
  windows: { create: forbidden('windows.create'), update: forbidden('windows.update') },
  action: { openPopup: async () => {}, setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
};
const context = vm.createContext({ chrome, URL, URLSearchParams, atob, btoa, AbortSignal, TextDecoder, TextEncoder, Event, Response, setTimeout, clearTimeout, console, crypto: webcrypto, performance,
  fetch: async (url) => {
    calls.push(url);
    if (failure) throw new Error('offline');
    const n = Number(new URL(url).pathname.match(/bracelet-(\d+)/)?.[1]);
    return new Response(`<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: `Silver Bracelet ${n}`, url, offers: { price: '25.00', priceCurrency: 'GBP' } })}</script></head><body></body></html>`, { headers: { 'content-type': 'text/html' } });
  },
});
try { new vm.Script(source, { filename: 'release/background.js' }).runInContext(context); }
catch (error) { console.error(error.message); process.exit(1); }
const settle = async (predicate) => {
  const deadline = Date.now() + 3_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Worker check did not complete');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};
const request = () => new Promise((resolve, reject) => {
  const handler = listeners.message.find((fn) => fn({ type: 'TRACER_WATCHLIST_LIST' }, { url: chrome.runtime.getURL('popup.html') }, () => {}));
  if (!handler) return reject(new Error('Missing watchlist message listener'));
  handler({ type: 'TRACER_WATCHLIST_MONITOR' }, { url: chrome.runtime.getURL('popup.html') }, resolve);
});
listeners.alarm[0]({ name: 'TRACER_SAVED_ITEM_MONITOR', scheduledTime: Date.now() });
await settle(() => local.tracerWatchlistV1.every((item) => item.lastNotifiedPrice?.amountMinor === 2500));
assert.equal(calls.length, 8);
assert.equal(alerts.length, 8);
assert.equal(local.tracerWatchlistV1.length, 8);
assert.deepEqual(changes, []);
await request();
assert.equal(alerts.length, 8, 'Repeated popup checks must not duplicate alerts');
failure = true;
await request();
assert.ok(local.tracerWatchlistV1.every((item) => item.currentPrice.amountMinor === 2500), 'Offline checks must retain verified prices');
assert.deepEqual(changes, []);
const beforeStartup = calls.length;
listeners.startup[0]();
await new Promise((resolve) => setTimeout(resolve, 5));
assert.equal(calls.length, beforeStartup, 'Startup must not immediately check all items');
listeners.alarm[0]({ name: 'TRACER_SAVED_ITEM_MONITOR', scheduledTime: Date.now() - 3_600_000 });
await new Promise((resolve) => setTimeout(resolve, 5));
assert.equal(calls.length, beforeStartup, 'A stale restored alarm must not run');
assert.deepEqual(changes, []);
console.log(JSON.stringify({ bundle: 'release/background.js', savedItems: 8, alarmChecks: 8, alerts: 8, duplicateAlerts: 0, browserMutations: changes.length, offlinePricesPreserved: true, startupAndStaleAlarmSkipped: true }));

const captureSource = await readFile(new URL('../apps/extension/release/savedMonitoringCapture.js', import.meta.url), 'utf8');
const { document } = parseHTML('<html><head><meta property="og:type" content="product"><meta property="og:title" content="Silver Bracelet 0"><meta property="product:price:currency" content="GBP"></head><body><main><h1>Silver Bracelet 0</h1><span data-product-price="25.00">£25</span></main></body></html>');
const beforeCapture = document.toString();
const captured = await new vm.Script(captureSource).runInNewContext({ document, location: { href: saved[0].canonicalUrl, hostname: 'shop.example.com' }, URL, performance, AbortSignal });
assert.equal(captured.savedPrice.amountMinor, 2500);
assert.equal(document.toString(), beforeCapture, 'Existing tab capture must not change the page');
console.log(JSON.stringify({ existingTabCaptureBundle: true, capturedPriceMinor: captured.savedPrice.amountMinor, pageUnchanged: true, runtimeListenersRequired: false }));
