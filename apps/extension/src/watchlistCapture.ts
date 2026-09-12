import { extractSavedProduct } from '@afterbuy/core';
declare global { interface Window { __tracerWatchlistCapture?: boolean } }
if (!window.__tracerWatchlistCapture) {
  window.__tracerWatchlistCapture = true;
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type !== 'TRACER_EXTRACT_SAVED_PRODUCT') return false;
    respond({product: extractSavedProduct(document, location.href)});
    return false;
  });
}
