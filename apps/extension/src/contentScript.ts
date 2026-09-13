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
  let scheduledForceCheck = false;
  let documentRevision = 0;
  let lastSentRevision = -1;
  let lastSentUrl = "";
  let retryCount = 0;
  let detectionComplete = false;
  const maxRetries = 6;

  const checkPage = (force = false): void => {
    scheduled = undefined;
    scheduledForceCheck = false;
    if (detectionComplete || !isLikelyPurchasePage(document, window.location.href)) {
      return;
    }

    if (!force && documentRevision === lastSentRevision && window.location.href === lastSentUrl) {
      return;
    }

    lastSentRevision = documentRevision;
    lastSentUrl = window.location.href;
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
        return;
      }

      if (retryCount < maxRetries) {
        retryCount += 1;
        scheduleCheck(Math.min(2_000, 300 * 2 ** retryCount), true);
      }
    }).catch(() => {
      if (retryCount < maxRetries) {
        retryCount += 1;
        scheduleCheck(Math.min(2_000, 300 * 2 ** retryCount), true);
      }
    });
  };

  const scheduleCheck = (delay = 450, force = false): void => {
    if (scheduled !== undefined) {
      if (force) {
        scheduledForceCheck = true;
      }
      window.clearTimeout(scheduled);
    }
    scheduledForceCheck ||= force;
    scheduled = window.setTimeout(() => checkPage(scheduledForceCheck), delay);
  };

  const observer = new MutationObserver(() => {
    documentRevision += 1;
    scheduleCheck(120);
  });
  observer.observe(document.documentElement, {
    childList: true,
    characterData: true,
    subtree: true,
  });

  checkPage();
  window.setTimeout(() => checkPage(true), 750);
  window.setTimeout(() => checkPage(true), 2_000);

  window.addEventListener("popstate", () => scheduleCheck(100, true));
  window.addEventListener("hashchange", () => scheduleCheck(100, true));
  window.addEventListener("focus", () => scheduleCheck(100, true));
  window.addEventListener("pageshow", () => scheduleCheck(100, true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      scheduleCheck(100, true);
    }
  });
}

function isLikelyPurchasePage(page: Document, rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  const isLocalDevelopmentPage =
    (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
    (url.protocol === "http:" || url.protocol === "https:");

  if ((url.protocol !== "https:" && !isLocalDevelopmentPage) || isKnownContentHost(url.hostname)) {
    return false;
  }

  if (isLocalDevelopmentPage) {
    return Boolean(page.querySelector("meta[name='tracer-demo-order'][content='true']"));
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
