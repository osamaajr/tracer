import { extractSavedProduct, extractZaraSavedProduct, normalizeSavedUrl, type SavedProduct } from "@tracer/core";
import { parseHTML } from "linkedom/worker";

const maxPageBytes = 2_000_000;

/** Read retailer data without creating, navigating, or activating browser tabs. */
export async function checkSavedProductPrice(
  item: SavedProduct,
  options: { fetchImpl?: typeof fetch; readOpenProduct?: (url: string) => Promise<SavedProduct | null> } = {},
): Promise<SavedProduct | null> {
  const url = normalizeSavedUrl(item.canonicalUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(15_000);
  try {
    const html = await requestPage(url, url, fetchImpl, signal, false);
    const product = extractSavedProduct(parseHTML(html).document as unknown as Document, url, { includeImage: false });
    if (matchesItem(item, product)) return product;
  } catch {
    // Some stores only expose product data through their application endpoint.
  }
  if (/(^|\.)zara\.com$/i.test(new URL(url).hostname)) {
    try {
      const ajaxUrl = new URL(url);
      ajaxUrl.searchParams.set("ajax", "true");
      const json = await requestPage(ajaxUrl.href, ajaxUrl.href, fetchImpl, signal, true);
      const product = extractZaraSavedProduct(JSON.parse(json), url);
      if (matchesItem(item, product)) return product;
    } catch {
      // An existing product tab may contain data rendered by the store's scripts.
    }
  }
  const product = await (options.readOpenProduct ?? readExistingProductTab)(url).catch(() => null);
  return matchesItem(item, product) ? product : null;
}

async function requestPage(url: string, expectedUrl: string, fetchImpl: typeof fetch, signal: AbortSignal, json: boolean): Promise<string> {
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const response = await fetchImpl(url, {
      credentials: "include", cache: "no-store", redirect: "manual", signal,
      headers: { accept: json ? "application/json" : "text/html,application/xhtml+xml" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Missing store redirect destination");
      url = normalizeSavedUrl(new URL(location, url).href);
      if (url !== normalizeSavedUrl(expectedUrl)) throw new Error("Store redirected away from saved product");
      continue;
    }
    if (!response.ok || (response.url && normalizeSavedUrl(response.url) !== normalizeSavedUrl(expectedUrl))) {
      throw new Error("Store did not return the saved product page");
    }
    const type = response.headers.get("content-type") ?? "";
    if (type && !(json ? /application\/(?:[\w.+-]*\+)?json/i : /text\/html|application\/xhtml\+xml/i).test(type)) {
      throw new Error("Unexpected store response format");
    }
    if (Number(response.headers.get("content-length")) > maxPageBytes || !response.body) throw new Error("Store response too large or empty");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxPageBytes) throw new Error("Store response too large");
        text += decoder.decode(value, { stream: true });
      }
      return text + decoder.decode();
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  throw new Error("Too many store redirects");
}

function matchesItem(item: SavedProduct, product: SavedProduct | null): product is SavedProduct {
  if (!product?.savedPrice || !Number.isSafeInteger(product.savedPrice.amountMinor) || product.savedPrice.amountMinor <= 0) return false;
  if (item.savedPrice && product.savedPrice.currency !== item.savedPrice.currency) return false;
  if (product.retailerId !== item.retailerId) return false;
  const expected = new URL(normalizeSavedUrl(item.canonicalUrl));
  const actual = new URL(normalizeSavedUrl(product.canonicalUrl));
  if (expected.origin !== actual.origin || expected.pathname !== actual.pathname) return false;
  if (item.sku && product.sku && item.sku !== product.sku) return false;
  if (item.externalProductId && product.externalProductId && item.externalProductId !== product.externalProductId) return false;
  const words = (name: string) => name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
  const wanted = words(item.name);
  const found = words(product.name);
  const overlap = wanted.filter((word) => found.includes(word)).length;
  return wanted.length > 0 && found.length > 0 && overlap / wanted.length >= 0.75 && overlap / found.length >= 0.65;
}

/** Only read an already loaded, matching user tab; never alter its location. */
async function readExistingProductTab(url: string): Promise<SavedProduct | null> {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (typeof tab.id !== "number" || tab.status !== "complete" || !sameUrl(tab.url, url)) continue;
    try {
      const results = await withTimeout(chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["savedMonitoringCapture.js"] }));
      const product = results.find((result) => result.frameId === 0)?.result as SavedProduct | null | undefined;
      const currentTab = await chrome.tabs.get(tab.id);
      if (sameUrl(currentTab.url, url) && product?.savedPrice) return product;
    } catch {
      // Closed or navigated user tabs are left untouched.
    }
  }
  return null;
}

function sameUrl(candidate: string | undefined, expected: string): boolean {
  try { return Boolean(candidate) && normalizeSavedUrl(candidate!) === expected; } catch { return false; }
}

async function withTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Existing tab read timed out")), 5_000);
    })]);
  } finally { clearTimeout(timer); }
}
