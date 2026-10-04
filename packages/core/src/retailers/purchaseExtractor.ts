import type { PurchaseDraft } from "../domain/types";
import { extractGenericPurchaseFromDocument } from "./genericStoreExtractor";
import { extractJohnLewisPurchaseFromDocument } from "./johnLewisPurchaseExtractor";
import { extractShopifyAccountPurchaseFromDocument } from "./shopifyAccountPurchaseExtractor";
import { isCompletedPurchasePage } from "./purchasePage";

export function extractPurchaseFromDocument(
  document: Document,
  sourceUrl: string,
  fallbackNow: Date = new Date(),
): PurchaseDraft | null {
  if (!isCompletedPurchasePage(document, sourceUrl)) return null;
  return (
    extractJohnLewisPurchaseFromDocument(document, sourceUrl, fallbackNow) ??
    extractShopifyAccountPurchaseFromDocument(document, sourceUrl, fallbackNow) ??
    extractGenericPurchaseFromDocument(document, sourceUrl, fallbackNow)
  );
}
