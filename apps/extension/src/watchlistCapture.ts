import { extractSavedProduct, extractZaraSavedProduct, findProductPageImages } from '@afterbuy/core';
type WatchlistCaptureListener = (
  message: { type?: string },
  sender: chrome.runtime.MessageSender,
  respond: (response?: unknown) => void,
) => boolean;

declare global {
  interface Window {
    __tracerWatchlistCaptureListener?: WatchlistCaptureListener;
  }
}

const previousListener = window.__tracerWatchlistCaptureListener;
if (previousListener) chrome.runtime.onMessage.removeListener(previousListener);

const watchlistCaptureListener: WatchlistCaptureListener = (message, _sender, respond) => {
  if (message.type !== 'TRACER_EXTRACT_SAVED_PRODUCT') return false;
  void extractCurrentSavedProduct().then((product) => {
    const rankedImages = product
      ? findProductPageImages(document, location.href, { productName: product.name })
      : [];
    const imageCandidates = [...new Set([
      product?.imageUrl,
      ...rankedImages.map((candidate) => candidate.url),
    ].filter((url): url is string => Boolean(url)))];
    respond({product, imageCandidates});
  });
  return true;
};

window.__tracerWatchlistCaptureListener = watchlistCaptureListener;
chrome.runtime.onMessage.addListener(watchlistCaptureListener);

async function extractCurrentSavedProduct() {
  const standard = extractSavedProduct(document, location.href);
  if (standard?.savedPrice || !/(^|\.)zara\.com$/i.test(location.hostname)) return standard;
  try {
    const ajaxUrl = new URL(location.href);
    ajaxUrl.searchParams.set('ajax', 'true');
    const response = await fetch(ajaxUrl, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return standard;
    return extractZaraSavedProduct(await response.json(), location.href) ?? standard;
  } catch {
    return standard;
  }
}
