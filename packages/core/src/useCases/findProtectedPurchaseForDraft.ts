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
  const activePurchases = purchases.filter(
    (purchase) =>
      purchase.protectionStatus === "active" &&
      purchase.retailerId === command.draft.retailerId,
  );

  const unmatchedPurchases = [...activePurchases];
  const matchedPurchases: PurchaseRecord[] = [];

  for (const lineItem of command.draft.lineItems) {
    const matchIndex = unmatchedPurchases.findIndex((candidate) =>
      matchesLineItem(candidate, command.draft, lineItem),
    );

    if (matchIndex === -1) {
      return { protected: false, purchase: null };
    }

    const [purchase] = unmatchedPurchases.splice(matchIndex, 1);
    if (purchase) {
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
        matchedPurchases.push(updated ?? purchase);
      } else {
        matchedPurchases.push(purchase);
      }
    }
  }

  const purchase = matchedPurchases[0] ?? null;

  return {
    protected: command.draft.lineItems.length > 0 && matchedPurchases.length === command.draft.lineItems.length,
    purchase,
  };
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
