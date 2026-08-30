import type {
  AfterBuyRepository,
  ProductRecord,
  ProductUpsertInput,
  PurchaseDraft,
  PurchaseFingerprint,
  PurchaseLineItemDraft,
  PurchaseCreateInput,
  PurchaseRecord,
} from "../domain/types";
import {
  isKnownRetailerId,
  normalizePublicStoreUrl,
  normalizeRetailerUrl,
} from "../retailers/urlSafety";

export interface ProtectPurchaseCommand {
  userId: string;
  draft: PurchaseDraft;
  now?: string;
}

export interface ProtectPurchaseResult {
  accepted: Array<{
    product: ProductRecord;
    purchase: PurchaseRecord;
    status: "created" | "duplicate";
  }>;
  rejected: Array<{
    productName: string;
    reason: string;
  }>;
}

export async function protectPurchase(
  repository: AfterBuyRepository,
  command: ProtectPurchaseCommand,
): Promise<ProtectPurchaseResult> {
  const now = command.now ?? new Date().toISOString();
  const accepted: ProtectPurchaseResult["accepted"] = [];
  const rejected: ProtectPurchaseResult["rejected"] = [];

  for (const lineItem of command.draft.lineItems) {
    try {
      const productIdentity = buildProductIdentity(command.draft, lineItem);
      const productInput: ProductUpsertInput = {
        retailerId: command.draft.retailerId,
        retailerName: command.draft.retailerName,
        storeHost: command.draft.storeHost,
        name: lineItem.productName,
        canonicalUrl: productIdentity.canonicalUrl,
        seenAt: now,
      };

      if (productIdentity.externalProductId) {
        productInput.externalProductId = productIdentity.externalProductId;
      }

      if (lineItem.sku) {
        productInput.sku = lineItem.sku;
      }

      if (lineItem.imageUrl) {
        productInput.imageUrl = lineItem.imageUrl;
      }

      const product = await repository.upsertProduct(productInput);
      const fingerprint: PurchaseFingerprint = {
        userId: command.userId,
        retailerId: command.draft.retailerId,
        productId: product.id,
        purchasedAt: command.draft.purchasedAt,
      };

      if (command.draft.orderReference) {
        fingerprint.orderReference = command.draft.orderReference;
      }

      const duplicate = await repository.findPurchaseByFingerprint(fingerprint);

      if (duplicate) {
        accepted.push({ product, purchase: duplicate, status: "duplicate" });
        continue;
      }

      const purchaseInput: PurchaseCreateInput = {
        userId: command.userId,
        retailerId: command.draft.retailerId,
        retailerName: command.draft.retailerName,
        storeHost: command.draft.storeHost,
        productId: product.id,
        productName: lineItem.productName,
        productUrl: product.canonicalUrl,
        pricePaid: lineItem.pricePaid,
        quantity: lineItem.quantity,
        purchasedAt: command.draft.purchasedAt,
        sourceUrl: command.draft.sourceUrl,
        createdAt: now,
        captureMethod: command.draft.captureMethod,
        captureConfidence: command.draft.captureConfidence,
      };

      if (command.draft.orderReference) {
        purchaseInput.orderReference = command.draft.orderReference;
      }

      if (product.externalProductId) {
        purchaseInput.externalProductId = product.externalProductId;
      }

      const purchase = await repository.createPurchase(purchaseInput);

      accepted.push({ product, purchase, status: "created" });
    } catch (error) {
      rejected.push({
        productName: lineItem.productName,
        reason: error instanceof Error ? error.message : "Unable to protect purchase",
      });
    }
  }

  return { accepted, rejected };
}

export function validatePurchaseDraft(draft: PurchaseDraft): string[] {
  const errors: string[] = [];

  if (!/^[a-z0-9][a-z0-9_-]{1,90}$/.test(draft.retailerId)) {
    errors.push("Retailer ID is invalid");
  }

  if (!draft.retailerName.trim()) {
    errors.push("Retailer name is required");
  }

  if (!/^[a-z0-9.-]+$/i.test(draft.storeHost)) {
    errors.push("Store host is invalid");
  }

  if (!draft.sourceUrl) {
    errors.push("Purchase source URL is required");
  } else {
    try {
      if (isKnownRetailerId(draft.retailerId)) {
        normalizeRetailerUrl(draft.retailerId, draft.sourceUrl);
      } else {
        normalizePublicStoreUrl(draft.sourceUrl, { expectedHost: draft.storeHost });
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Purchase source URL is invalid");
    }
  }

  if (Number.isNaN(new Date(draft.purchasedAt).getTime())) {
    errors.push("Purchase date is invalid");
  }

  if (draft.lineItems.length === 0) {
    errors.push("At least one line item is required");
  }

  for (const item of draft.lineItems) {
    if (!item.productName.trim()) {
      errors.push("Line item product name is required");
    }

    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      errors.push(`Quantity for ${item.productName || "line item"} must be at least 1`);
    }

    if (!/^[A-Z]{3}$/.test(item.pricePaid.currency) || item.pricePaid.amountMinor <= 0) {
      errors.push(
        `Price paid for ${item.productName || "line item"} must be a positive currency amount`,
      );
    }

    if (!item.productUrl) {
      errors.push(`A product URL is required for ${item.productName || "line item"}`);
      continue;
    }

    try {
      if (isKnownRetailerId(draft.retailerId)) {
        normalizeRetailerUrl(draft.retailerId, item.productUrl, {
          requireProductUrl: true,
        });
      } else {
        normalizePublicStoreUrl(item.productUrl, { expectedHost: draft.storeHost });
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Product URL is invalid");
    }
  }

  return errors;
}

function buildProductIdentity(draft: PurchaseDraft, lineItem: PurchaseLineItemDraft): {
  canonicalUrl: string;
  externalProductId?: string;
} {
  if (!lineItem.productUrl) {
    throw new Error("A reliable product URL is required");
  }

  const normalized = normalizeRetailerUrl(draft.retailerId, lineItem.productUrl, {
    requireProductUrl: isKnownRetailerId(draft.retailerId),
    expectedHost: draft.storeHost,
  });

  const identity: { canonicalUrl: string; externalProductId?: string } = {
    canonicalUrl: normalized.url,
  };

  const externalProductId = lineItem.externalProductId ?? normalized.productId;

  if (externalProductId) {
    identity.externalProductId = externalProductId;
  }

  return identity;
}
