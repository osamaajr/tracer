import type { Money, ProductPriceSnapshot, PurchaseRecord } from "@tracer/core";

interface CachedPurchasePrice {
  identity: string;
  price: Money;
  observedAt: string;
  availability: ProductPriceSnapshot["availability"];
}

const keyFor = (id: string) => `tracerPurchasePriceCheck:${id}`;

function identity(purchase: PurchaseRecord): string {
  return JSON.stringify([
    purchase.retailerId, purchase.storeHost, purchase.productUrl,
    purchase.productName, purchase.externalProductId, purchase.pricePaid.currency,
  ]);
}

/** Separate keys avoid overwriting another purchase's concurrent check. */
export async function savePurchasePriceCheck(
  purchase: PurchaseRecord,
  result: Pick<ProductPriceSnapshot, "price" | "observedAt" | "availability">,
): Promise<void> {
  await chrome.storage.local.set({
    [keyFor(purchase.id)]: { identity: identity(purchase), ...result },
  });
}

export async function readPurchasePriceChecks(
  purchases: PurchaseRecord[],
): Promise<Map<string, CachedPurchasePrice>> {
  const stored = await chrome.storage.local.get(purchases.map((purchase) => keyFor(purchase.id)));
  const checks = new Map<string, CachedPurchasePrice>();
  for (const purchase of purchases) {
    const value = stored[keyFor(purchase.id)] as Partial<CachedPurchasePrice> | undefined;
    const time = value?.observedAt ? Date.parse(value.observedAt) : NaN;
    if (!value || value.identity !== identity(purchase) || !value.price ||
      !Number.isSafeInteger(value.price.amountMinor) || value.price.amountMinor <= 0 ||
      value.price.currency !== purchase.pricePaid.currency ||
      !Number.isFinite(time) || time > Date.now() + 60_000 ||
      !["in_stock", "out_of_stock", "unknown"].includes(value.availability ?? "")) continue;
    checks.set(purchase.id, value as CachedPurchasePrice);
  }
  return checks;
}

export async function clearPurchasePriceCheck(id: string): Promise<void> {
  await chrome.storage.local.remove(keyFor(id));
}
