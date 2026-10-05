const checkoutStep = /\/(?:delivery|shipping|address|payment|billing|review|contact|details)(?:\/|$)/i;
const completedPath = /(?:^|\/)(?:(?:[^/]*order[-_])?(?:confirmation|confirmed|complete(?:d)?|receipt|thank[-_]?you)|[^/]*order[-_]confirm)(?:\/|$)/i;
const orderHistoryPath = /\/(?:account\/)?orders\/[^/]+\/?$/i;
const completedHeading = /(?:thank(?:s)?\s+you.{0,60}(?:order|purchase)|(?:your|the)\s+order\s+(?:(?:is|has been)\s+)?(?:confirmed|placed|complete)|order\s+(?:(?:#[a-z0-9-]+)\s+)?(?:confirmed|placed|complete)|payment\s+(?:successful|confirmed))/i;

/** A cart or checkout summary can contain full Order data before payment. */
export function isPrePurchaseCheckoutUrl(sourceUrl: string): boolean {
  try {
    return isPrePurchaseCheckoutPath(new URL(sourceUrl).pathname);
  } catch {
    return false;
  }
}

export function isCompletedPurchasePage(document: Document, sourceUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return false;
  }

  if (isPrePurchaseCheckoutPath(url.pathname)) return false;
  if (completedPath.test(url.pathname) ||
    (!/\/checkout(?:\/|$)/i.test(url.pathname) && orderHistoryPath.test(url.pathname))) return true;

  // Checkout sites may keep the same URL after payment. Require a completed
  // order heading, rather than trusting an Order schema or a cart total.
  const headings = Array.from(document.querySelectorAll("h1, h2, [role='heading']"));
  return headings.some((heading) => completedHeading.test(heading.textContent ?? ""));
}

function isPrePurchaseCheckoutPath(pathname: string): boolean {
  return /\/checkout(?:\/|$)/i.test(pathname) && checkoutStep.test(pathname);
}
