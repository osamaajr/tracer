declare global {
  interface Window {
    __tracerPurchaseCandidateWatcher?: boolean;
  }
}

interface PurchasePageCandidateMessage {
  type: "TRACER_PURCHASE_PAGE_CANDIDATE";
  url: string;
}

interface PurchasePageCandidateResponse {
  detected?: boolean;
}

if (!window.__tracerPurchaseCandidateWatcher) {
  window.__tracerPurchaseCandidateWatcher = true;

  let scheduled: number | undefined;
  let documentRevision = 0;
  let lastSentRevision = -1;
  let detectionComplete = false;

  const checkPage = (): void => {
    scheduled = undefined;
    if (detectionComplete || !isLikelyPurchasePage(document, window.location.href)) {
      return;
    }

    if (documentRevision === lastSentRevision) {
      return;
    }

    lastSentRevision = documentRevision;
    const message: PurchasePageCandidateMessage = {
      type: "TRACER_PURCHASE_PAGE_CANDIDATE",
      url: window.location.href,
    };
    void chrome.runtime.sendMessage(message).then((response: PurchasePageCandidateResponse) => {
      if (response?.detected) {
        detectionComplete = true;
        observer.disconnect();
        if (scheduled !== undefined) {
          window.clearTimeout(scheduled);
          scheduled = undefined;
        }
      }
    }).catch(() => undefined);
  };

  const scheduleCheck = (delay = 450): void => {
    if (scheduled !== undefined) {
      window.clearTimeout(scheduled);
    }
    scheduled = window.setTimeout(checkPage, delay);
  };

  const observer = new MutationObserver(() => {
    documentRevision += 1;
    scheduleCheck(120);
  });
  observer.observe(document.querySelector("main") ?? document.body ?? document.documentElement, {
    childList: true,
    subtree: true,
  });

  checkPage();
  window.setTimeout(checkPage, 750);
  window.setTimeout(checkPage, 2_000);

  window.addEventListener("popstate", () => scheduleCheck(100));
  window.addEventListener("hashchange", () => scheduleCheck(100));
}

function isLikelyPurchasePage(page: Document, rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "https:" || isKnownContentHost(url.hostname)) {
    return false;
  }

  if (
    url.hostname.toLowerCase() === "shopify.com" &&
    /^\/\d+\/account\/orders\/[a-z0-9_-]+\/?$/i.test(url.pathname)
  ) {
    return true;
  }

  const routeLooksRelevant = /(?:checkout|order|confirmation|thank[-_]?you)/i.test(url.pathname);
  if (!routeLooksRelevant) {
    return false;
  }

  const text = `${page.title} ${page.body?.textContent ?? ""}`.toLowerCase();
  return (
    text.includes("order confirmation") ||
    text.includes("thank you for your order") ||
    text.includes("thanks for your order") ||
    text.includes("order number") ||
    text.includes("order reference") ||
    (/\border\s*#[a-z0-9-]+/i.test(text) && /\bconfirmed\b/i.test(text))
  );
}

function isKnownContentHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  const contentHosts = [
    "behance.net",
    "canva.com",
    "dribbble.com",
    "facebook.com",
    "figma.com",
    "google.com",
    "imgur.com",
    "instagram.com",
    "pexels.com",
    "pinterest.com",
    "reddit.com",
    "shutterstock.com",
    "twitter.com",
    "unsplash.com",
    "vecteezy.com",
    "vectorstock.com",
    "x.com",
  ];
  return contentHosts.some((contentHost) => host === contentHost || host.endsWith(`.${contentHost}`));
}

export {};
