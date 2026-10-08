import type {
  TracerRepository,
  PurchaseDraft,
  PurchaseLineItemDraft,
  PurchaseRecord,
} from "../domain/types";

export interface FindProtectedPurchaseForDraftCommand {
  userId: string;
  draft: PurchaseDraft;
}

export interface FindProtectedPurchaseForDraftResult {
  protected: boolean;
  purchase: PurchaseRecord | null;
}

export async function findProtectedPurchaseForDraft(
  repository: TracerRepository,
  command: FindProtectedPurchaseForDraftCommand,
): Promise<FindProtectedPurchaseForDraftResult> {
  const purchases = await repository.listPurchasesForUser(command.userId);
  const matchedPurchases = matchProtectedPurchasesForDraft(purchases, command.draft);
  if (!matchedPurchases.length) return { protected: false, purchase: null };

  const updatedPurchases: PurchaseRecord[] = [];
  for (const purchase of matchedPurchases) {
    const total = command.draft.orderTotalPaid;
    if (total && (purchase.orderTotalPaid?.amountMinor !== total.amountMinor ||
      purchase.orderTotalPaid?.currency !== total.currency)) {
      const updated = await repository.updatePurchaseDetailsForUser(purchase.id, command.userId, {
        pricePaid: purchase.pricePaid,
        orderTotalPaid: total,
        quantity: purchase.quantity,
        productName: purchase.productName,
        productUrl: purchase.productUrl,
        captureMethod: purchase.captureMethod,
        captureConfidence: purchase.captureConfidence,
      });
      updatedPurchases.push(updated ?? purchase);
    } else {
      updatedPurchases.push(purchase);
    }
  }
  return { protected: true, purchase: updatedPurchases[0] ?? null };
}

/** Match in memory so detection can check existing protections without uploading a new order. */
export function matchProtectedPurchasesForDraft(
  purchases: PurchaseRecord[],
  draft: PurchaseDraft,
): PurchaseRecord[] {
  const activePurchases = purchases.filter(
    (purchase) =>
      purchase.protectionStatus === "active" &&
      purchase.retailerId === draft.retailerId,
  );

  const unmatchedPurchases = [...activePurchases];
  const matchedPurchases: PurchaseRecord[] = [];

  for (const lineItem of draft.lineItems) {
    const matchIndex = unmatchedPurchases.findIndex((candidate) =>
      matchesLineItem(candidate, draft, lineItem),
    );

    if (matchIndex === -1) {
      return [];
    }

    const [purchase] = unmatchedPurchases.splice(matchIndex, 1);
    if (purchase) matchedPurchases.push(purchase);
  }

  return matchedPurchases;
}

function matchesLineItem(
  purchase: PurchaseRecord,
  draft: PurchaseDraft,
  lineItem: PurchaseLineItemDraft,
): boolean {
  if (purchase.purchasedAt !== draft.purchasedAt) {
    return false;
  }

  if (draft.orderReference && purchase.orderReference !== draft.orderReference) {
    return false;
  }

  if (
    purchase.pricePaid.currency !== lineItem.pricePaid.currency ||
    purchase.pricePaid.amountMinor !== lineItem.pricePaid.amountMinor ||
    purchase.quantity !== lineItem.quantity
  ) {
    return false;
  }

  if (lineItem.productUrl && sameUrl(purchase.productUrl, lineItem.productUrl)) {
    return true;
  }

  return (
    normaliseText(purchase.productName) === normaliseText(lineItem.productName)
  );
}

function sameUrl(left: string, right: string): boolean {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);

    return (
      leftUrl.hostname.toLowerCase() === rightUrl.hostname.toLowerCase() &&
      leftUrl.pathname.replace(/\/$/, "") === rightUrl.pathname.replace(/\/$/, "")
    );
  } catch {
    return left === right;
  }
}

function normaliseText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
