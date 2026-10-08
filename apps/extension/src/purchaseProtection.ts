import { formatMoney, matchProtectedPurchasesForDraft, type PurchaseDraft, type PurchaseRecord } from "@tracer/core";

/** Only previously protected orders may be sent for a total correction. New detections stay local. */
export async function readPurchaseProtection(
  draft: PurchaseDraft,
  apiBaseUrl: string,
  userId: string,
  fetchApi: (url: string, options: RequestInit) => Promise<Response>,
): Promise<unknown> {
  const headers = { "x-tracer-user-id": userId };
  const response = await fetchApi(`${apiBaseUrl}/api/dashboard`, { headers });
  if (!response.ok) return { protected: false, purchase: null };
  const dashboard = await response.json() as { purchases: PurchaseRecord[] };
  const matched = matchProtectedPurchasesForDraft(dashboard.purchases, draft);
  const purchase = matched[0];
  if (!purchase) return { protected: false, purchase: null };

  const total = draft.orderTotalPaid;
  if (total && matched.some((item) =>
    item.orderTotalPaid?.amountMinor !== total.amountMinor || item.orderTotalPaid?.currency !== total.currency)) {
    // Every line has already been protected. Preserve correction of old captured totals,
    // while avoiding transmitting a newly visited order page or its query credentials.
    const correction = await fetchApi(`${apiBaseUrl}/api/purchases/protection-status`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ purchaseDraft: purchaseDraftForUpload({ ...draft, sourceUrl: purchase.sourceUrl }) }),
    }).catch(() => null);
    if (correction?.ok) return correction.json();
  }

  return {
    protected: true,
    purchase: {
      ...purchase,
      ...(total ? { orderTotalPaid: total } : {}),
      pricePaidDisplay: formatMoney(total ?? purchase.orderTotalPaid ?? purchase.pricePaid),
    },
  };
}

/** Receipt query strings and fragments can contain access tokens; they are not needed for monitoring. */
export function purchaseDraftForUpload(draft: PurchaseDraft): PurchaseDraft {
  const source = new URL(draft.sourceUrl);
  source.search = "";
  source.hash = "";
  source.username = "";
  source.password = "";
  return { ...draft, sourceUrl: source.href };
}
