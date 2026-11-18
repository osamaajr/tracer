import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gbp, type PurchaseRecord } from "@tracer/core";
import { clearPurchasePriceCheck, readPurchasePriceChecks, savePurchasePriceCheck } from "../src/purchasePriceCache";

const purchase: PurchaseRecord = {
  id: "purchase-1", userId: "user-1", retailerId: "store_shop-example-com",
  retailerName: "Shop", storeHost: "shop.example.com", productId: "product-1",
  productName: "Green pack", productUrl: "https://shop.example.com/products/green-pack?variant=123",
  pricePaid: gbp(3500), quantity: 1, purchasedAt: "2026-11-01T09:00:00Z",
  sourceUrl: "https://shop.example.com/orders/123", createdAt: "2026-11-01T09:00:00Z",
  protectionStatus: "active", captureMethod: "generic_dom", captureConfidence: "medium",
};
const result = { price: gbp(3000), observedAt: "2026-11-18T10:00:00Z", availability: "in_stock" as const };
let stored: Record<string, unknown>;

beforeEach(() => {
  stored = {};
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-18T10:01:00Z"));
  vi.stubGlobal("chrome", { storage: { local: {
    get: async (keys: string[]) => Object.fromEntries(keys.map((key) => [key, stored[key]])),
    set: async (values: Record<string, unknown>) => { Object.assign(stored, values); },
    remove: async (key: string) => { delete stored[key]; },
  } } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("browser-verified purchase price persistence", () => {
  it("retains concurrent checks for different purchases and removes only the deleted purchase", async () => {
    const other = { ...purchase, id: "purchase-2" };
    await Promise.all([savePurchasePriceCheck(purchase, result), savePurchasePriceCheck(other, result)]);
    expect((await readPurchasePriceChecks([purchase, other])).size).toBe(2);
    await clearPurchasePriceCheck(purchase.id);
    expect([...(await readPurchasePriceChecks([purchase, other])).keys()]).toEqual([other.id]);
  });

  it.each([
    { productUrl: "https://shop.example.com/products/green-pack?variant=999" },
    { retailerId: "another-store" },
    { pricePaid: { amountMinor: 3500, currency: "EUR" } },
  ])("does not reuse a price after the purchase identity changes %j", async (changes) => {
    await savePurchasePriceCheck(purchase, result);
    expect((await readPurchasePriceChecks([{ ...purchase, ...changes }])).size).toBe(0);
  });

  it.each([
    { price: { amountMinor: -1, currency: "GBP" } }, { price: { amountMinor: 3000, currency: "USD" } },
    { observedAt: "invalid" }, { observedAt: "2099-01-01T00:00:00Z" }, { availability: "invalid" },
  ])("rejects corrupt cached evidence %j", async (changes) => {
    await savePurchasePriceCheck(purchase, result);
    const key = Object.keys(stored)[0]!;
    stored[key] = { ...(stored[key] as object), ...changes };
    expect((await readPurchasePriceChecks([purchase])).size).toBe(0);
  });
});
