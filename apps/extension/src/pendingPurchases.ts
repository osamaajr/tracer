import type { Money, PurchaseDraft } from "@tracer/core";

export const pendingPurchasesStorageKey = "tracerPendingPurchases";

export interface PendingProtectedPurchase {
  id: string;
  draft: PurchaseDraft;
  queuedAt: string;
  priceChecks?: Record<string, { price: Money; observedAt: string; productName: string; productUrl?: string }>;
}

export async function getPendingPurchases(): Promise<PendingProtectedPurchase[]> {
  const stored = await chrome.storage.local.get(pendingPurchasesStorageKey);
  const value = stored[pendingPurchasesStorageKey];
  return Array.isArray(value) ? value.filter(isPendingPurchase) : [];
}

export async function queuePendingPurchase(
  draft: PurchaseDraft,
): Promise<{ purchase: PendingProtectedPurchase; created: boolean }> {
  const pending = await getPendingPurchases();
  const existing = pending.find((purchase) => samePurchaseDraft(purchase.draft, draft));
  if (existing) {
    if (draft.orderTotalPaid && (
      existing.draft.orderTotalPaid?.amountMinor !== draft.orderTotalPaid.amountMinor ||
      existing.draft.orderTotalPaid?.currency !== draft.orderTotalPaid.currency
    )) {
      existing.draft = { ...existing.draft, orderTotalPaid: draft.orderTotalPaid };
      await setPendingPurchases(pending);
    }
    return { purchase: existing, created: false };
  }

  const purchase: PendingProtectedPurchase = {
    id: buildPendingPurchaseId(draft),
    draft,
    queuedAt: new Date().toISOString(),
  };
  await setPendingPurchases([...pending, purchase]);
  return { purchase, created: true };
}

export async function setPendingPurchases(
  pending: PendingProtectedPurchase[],
): Promise<void> {
  await chrome.storage.local.set({ [pendingPurchasesStorageKey]: pending });
}

export async function savePendingPriceCheck(
  pendingId: string,
  lineIndex: number,
  price: Money,
  observedAt: string,
): Promise<void> {
  const pending = await getPendingPurchases();
  const purchase = pending.find((item) => item.id === pendingId);
  if (!purchase) return;
  const lineItem = purchase.draft.lineItems[lineIndex];
  if (!lineItem || lineItem.pricePaid.currency !== price.currency) return;
  purchase.priceChecks = {
    ...purchase.priceChecks,
    [lineIndex]: {
      price,
      observedAt,
      productName: lineItem.productName,
      ...(lineItem.productUrl ? { productUrl: lineItem.productUrl } : {}),
    },
  };
  await setPendingPurchases(pending);
}

export function samePurchaseDraft(left: PurchaseDraft, right: PurchaseDraft): boolean {
  if (
    left.retailerId !== right.retailerId ||
    left.purchasedAt !== right.purchasedAt ||
    left.orderReference !== right.orderReference ||
    left.lineItems.length !== right.lineItems.length
  ) {
    return false;
  }

  const unmatchedItems = [...right.lineItems];
  return left.lineItems.every((leftItem) => {
    const matchIndex = unmatchedItems.findIndex((rightItem) =>
      samePurchaseLineItem(leftItem, rightItem),
    );
    if (matchIndex === -1) return false;
    unmatchedItems.splice(matchIndex, 1);
    return true;
  });
}

function isPendingPurchase(value: unknown): value is PendingProtectedPurchase {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PendingProtectedPurchase>;
  return typeof candidate.id === "string" && Boolean(candidate.draft) && typeof candidate.queuedAt === "string";
}

function samePurchaseLineItem(
  left: PurchaseDraft["lineItems"][number],
  right: PurchaseDraft["lineItems"][number],
): boolean {
  return (
    left.productName.trim().toLowerCase() === right.productName.trim().toLowerCase() &&
    left.pricePaid.currency === right.pricePaid.currency &&
    left.pricePaid.amountMinor === right.pricePaid.amountMinor &&
    left.quantity === right.quantity
  );
}

function buildPendingPurchaseId(draft: PurchaseDraft): string {
  const itemFingerprint = draft.lineItems
    .map((item) => `${item.productName.trim().toLowerCase()}|${item.pricePaid.currency}|${item.pricePaid.amountMinor}|${item.quantity}`)
    .join("||");
  const input = `${draft.retailerId}|${draft.orderReference ?? ""}|${draft.purchasedAt}|${itemFingerprint}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `local_${(hash >>> 0).toString(36)}`;
}
