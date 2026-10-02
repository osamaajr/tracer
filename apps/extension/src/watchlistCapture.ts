import { extractSavedProduct, extractZaraSavedProduct, findProductPageImages, productImageIdentity } from '@tracer/core';
const traceEnabled = import.meta.env.MODE !== 'production' || import.meta.env.VITE_TRACER_STARTUP_TRACE === true;
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
  const extractionStartedAt = performance.now();
  void extractCurrentSavedProduct().then((product) => {
    const extractionEndedAt = performance.now();
    if (traceEnabled) console.debug(`[Tracer startup] product metadata extraction: ${(extractionEndedAt - extractionStartedAt).toFixed(1)}ms`);
    respond({product, imageCandidates: product?.imageUrl ? [product.imageUrl] : [], imageCandidatesPending: Boolean(product)});
    if (!product) return;

    // Return the product before scanning and ranking every gallery image. The
    // popup can show the item immediately, then receive the richer image list.
    window.setTimeout(() => {
      const imageStartedAt = performance.now();
      let rankedImages: ReturnType<typeof findProductPageImages> = [];
      try {
        rankedImages = findProductPageImages(document, location.href, {
          productName: product.name,
          productIdentifiers: [product.externalProductId, product.sku],
        });
      } catch {
        // The metadata result remains usable if optional gallery ranking fails.
      }
      if (traceEnabled) console.debug(`[Tracer startup] image candidate extraction + ranking: ${(performance.now() - imageStartedAt).toFixed(1)}ms`);
      const imageCandidates: string[] = [];
      const seenImages = new Set<string>();
      for (const url of [product.imageUrl, ...rankedImages.map((candidate) => candidate.url)]) {
        if (!url) continue;
        const identity = productImageIdentity(url);
        if (seenImages.has(identity)) continue;
        seenImages.add(identity);
        imageCandidates.push(url);
      }
      try {
        chrome.runtime.sendMessage({
          type: 'TRACER_PRODUCT_IMAGES_READY',
          pageUrl: location.href,
          imageCandidates,
          imageExtractionMs: performance.now() - imageStartedAt,
        }, () => void chrome.runtime.lastError);
      } catch {
        // The popup may have closed while the optional image pass was running.
      }
    }, 0);
  });
  return true;
};

window.__tracerWatchlistCaptureListener = watchlistCaptureListener;
chrome.runtime.onMessage.addListener(watchlistCaptureListener);

async function extractCurrentSavedProduct() {
  const standardStartedAt = performance.now();
  const standard = extractSavedProduct(document, location.href, {
    includeImage: false,
    ...(traceEnabled ? {
      onTiming: (name: string, durationMs: number) => console.debug(`[Tracer startup] ${name}: ${durationMs.toFixed(1)}ms`),
    } : {}),
  });
  if (traceEnabled) console.debug(`[Tracer startup] extractSavedProduct metadata: ${(performance.now() - standardStartedAt).toFixed(1)}ms`);
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
