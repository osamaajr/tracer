import type { PurchaseDraft } from "../domain/types";
import { extractGenericPurchaseFromDocument } from "./genericStoreExtractor";
import { extractJohnLewisPurchaseFromDocument } from "./johnLewisPurchaseExtractor";

export function extractPurchaseFromDocument(
  document: Document,
  sourceUrl: string,
  fallbackNow: Date = new Date(),
): PurchaseDraft | null {
  return (
    extractJohnLewisPurchaseFromDocument(document, sourceUrl, fallbackNow) ??
    extractGenericPurchaseFromDocument(document, sourceUrl, fallbackNow)
  );
}
