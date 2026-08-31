import type {
  AfterBuyRepository,
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
  repository: AfterBuyRepository,
  command: FindProtectedPurchaseForDraftCommand,
): Promise<FindProtectedPurchaseForDraftResult> {
  const purchases = await repository.listPurchasesForUser(command.userId);
  const activePurchases = purchases.filter(
    (purchase) =>
      purchase.protectionStatus === "active" &&
      purchase.retailerId === command.draft.retailerId,
  );

  const purchase =
    activePurchases.find((candidate) => matchesOrderReference(candidate, command.draft)) ??
    activePurchases.find((candidate) =>
      command.draft.lineItems.some((item) => matchesLineItem(candidate, command.draft, item)),
    ) ??
    null;

  return {
    protected: Boolean(purchase),
    purchase,
  };
}

function matchesOrderReference(purchase: PurchaseRecord, draft: PurchaseDraft): boolean {
  return Boolean(
    draft.orderReference &&
      purchase.orderReference === draft.orderReference &&
      purchase.purchasedAt === draft.purchasedAt,
  );
}

function matchesLineItem(
  purchase: PurchaseRecord,
  draft: PurchaseDraft,
  lineItem: PurchaseLineItemDraft,
): boolean {
  if (purchase.purchasedAt !== draft.purchasedAt) {
    return false;
  }

  if (lineItem.productUrl && sameUrl(purchase.productUrl, lineItem.productUrl)) {
    return true;
  }

  return (
    normaliseText(purchase.productName) === normaliseText(lineItem.productName) &&
    purchase.pricePaid.currency === lineItem.pricePaid.currency &&
    purchase.pricePaid.amountMinor === lineItem.pricePaid.amountMinor
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
