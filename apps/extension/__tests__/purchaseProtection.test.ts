import { describe, expect, it, vi } from "vitest";
import { gbp, InMemoryTracerRepository, protectPurchase, type PurchaseDraft } from "@tracer/core";
import { purchaseDraftForUpload, readPurchaseProtection } from "../src/purchaseProtection";

const draft: PurchaseDraft = {
  retailerId: "store_shop-example-com",
  retailerName: "Shop",
  storeHost: "shop.example.com",
  sourceUrl: "https://shop.example.com/orders/123?access_token=private#receipt",
  purchasedAt: "2026-10-01T12:00:00.000Z",
  orderReference: "123",
  captureMethod: "generic_schema_org",
  captureConfidence: "high",
  lineItems: [{ productName: "Lamp", quantity: 1, pricePaid: gbp(3_500), productUrl: "https://shop.example.com/products/lamp?variant=42" }],
};

async function existingPurchase() {
  const repository = new InMemoryTracerRepository();
  const result = await protectPurchase(repository, { userId: "user", draft });
  return result.accepted[0]!.purchase;
}

describe("protection lookup privacy", () => {
  it("does not upload a newly detected order", async () => {
    const fetchApi = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ purchases: [] }));
    expect(await readPurchaseProtection(draft, "https://api.example.com", "token", fetchApi))
      .toEqual({ protected: false, purchase: null });
    expect(fetchApi).toHaveBeenCalledExactlyOnceWith("https://api.example.com/api/dashboard", {
      headers: { "x-tracer-user-id": "token" },
    });
  });

  it("recognises an existing protection without uploading the detected page", async () => {
    const purchase = await existingPurchase();
    const fetchApi = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ purchases: [purchase] }));
    expect(await readPurchaseProtection(draft, "https://api.example.com", "token", fetchApi))
      .toMatchObject({ protected: true, purchase: { id: purchase.id, pricePaidDisplay: "£35" } });
    expect(fetchApi).toHaveBeenCalledTimes(1);
  });

  it.each(["partial", "different_order", "different_amount", "inactive"])("does not upload a %s match", async (scenario) => {
    const purchase = await existingPurchase();
    const changed = structuredClone(draft);
    if (scenario === "partial") changed.lineItems.push({ ...draft.lineItems[0]!, productName: "Chair", productUrl: "https://shop.example.com/products/chair" });
    if (scenario === "different_order") changed.orderReference = "other";
    if (scenario === "different_amount") changed.lineItems[0]!.pricePaid = gbp(2_000);
    if (scenario === "inactive") purchase.protectionStatus = "expired";
    const fetchApi = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ purchases: [purchase] }));
    expect(await readPurchaseProtection(changed, "https://api.example.com", "token", fetchApi))
      .toEqual({ protected: false, purchase: null });
    expect(fetchApi).toHaveBeenCalledTimes(1);
  });

  it("only corrects totals after every item has an existing protection", async () => {
    const purchase = await existingPurchase();
    const correctedDraft = { ...draft, orderTotalPaid: gbp(3_274) };
    const corrected = { protected: true, purchase: { ...purchase, orderTotalPaid: gbp(3_274) } };
    const fetchApi = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ purchases: [purchase] }))
      .mockResolvedValueOnce(Response.json(corrected));
    expect(await readPurchaseProtection(correctedDraft, "https://api.example.com", "token", fetchApi)).toEqual(corrected);
    const uploaded = JSON.parse(String(fetchApi.mock.calls[1]![1]!.body));
    expect(uploaded.purchaseDraft.sourceUrl).toBe("https://shop.example.com/orders/123");
    expect(uploaded.purchaseDraft.orderTotalPaid).toEqual(gbp(3_274));
    expect(uploaded.purchaseDraft.lineItems[0].productUrl).toBe(draft.lineItems[0]!.productUrl);
  });

  it("retains an existing protection if a total correction is offline", async () => {
    const purchase = await existingPurchase();
    const fetchApi = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ purchases: [purchase] }))
      .mockRejectedValueOnce(new TypeError("Offline"));
    expect(await readPurchaseProtection({ ...draft, orderTotalPaid: gbp(3_274) }, "https://api.example.com", "token", fetchApi))
      .toMatchObject({ protected: true, purchase: { id: purchase.id, pricePaidDisplay: "£32.74" } });
  });

  it("does not post a draft when the dashboard rejects the request", async () => {
    const fetchApi = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
    expect(await readPurchaseProtection(draft, "https://api.example.com", "token", fetchApi))
      .toEqual({ protected: false, purchase: null });
    expect(fetchApi).toHaveBeenCalledTimes(1);
  });

  it("strips receipt access credentials without changing product variants or the local draft", () => {
    const uploaded = purchaseDraftForUpload(draft);
    expect(uploaded.sourceUrl).toBe("https://shop.example.com/orders/123");
    expect(uploaded.lineItems[0]!.productUrl).toBe(draft.lineItems[0]!.productUrl);
    expect(draft.sourceUrl).toContain("access_token=private");
  });
});
