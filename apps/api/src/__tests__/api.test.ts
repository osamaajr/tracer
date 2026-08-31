import { describe, expect, it } from "vitest";
import {
  FixturePriceFetcher,
  InMemoryAfterBuyRepository,
  gbp,
  type PurchaseDraft,
  type ProductPriceSnapshot,
} from "@afterbuy/core";
import { createAfterBuyServer } from "../server";

const purchaseDraft: PurchaseDraft = {
  retailerId: "john-lewis",
  retailerName: "John Lewis",
  storeHost: "www.johnlewis.com",
  sourceUrl: "https://www.johnlewis.com/checkout/order-confirmation/JL-12345678",
  orderReference: "JL-12345678",
  purchasedAt: "2026-08-30T09:15:00.000Z",
  captureMethod: "retailer_adapter",
  captureConfidence: "high",
  lineItems: [
    {
      productName:
        "Sony WH-1000XM6 Wireless Bluetooth Noise Cancelling Headphones, Black",
      quantity: 1,
      pricePaid: gbp(34_900),
      productUrl:
        "https://www.johnlewis.com/sony-wh-1000xm6-wireless-bluetooth-noise-cancelling-headphones-black/p1122334",
      productUrlConfidence: "high",
      externalProductId: "p1122334",
      sku: "JL-SNY-XM6-BLK",
    },
  ],
};

const genericPurchaseDraft: PurchaseDraft = {
  retailerId: "store_shop-example-com",
  retailerName: "Shop",
  storeHost: "shop.example.com",
  sourceUrl: "https://shop.example.com/checkout/confirmation/ACME-445566",
  orderReference: "ACME-445566",
  purchasedAt: "2026-08-30T12:30:00.000Z",
  captureMethod: "generic_schema_org",
  captureConfidence: "high",
  lineItems: [
    {
      productName: "Trail Pack 24L, Moss Green",
      quantity: 1,
      pricePaid: gbp(8_450),
      productUrl: "https://shop.example.com/products/trail-pack-24l-moss-green",
      productUrlConfidence: "high",
      externalProductId: "acme-pack-24-moss",
      sku: "TP24-MOSS",
    },
  ],
};

const droppedSnapshot: ProductPriceSnapshot = {
  retailerId: "john-lewis",
  productUrl:
    "https://www.johnlewis.com/sony-wh-1000xm6-wireless-bluetooth-noise-cancelling-headphones-black/p1122334",
  productName:
    "Sony WH-1000XM6 Wireless Bluetooth Noise Cancelling Headphones, Black",
  externalProductId: "p1122334",
  observedAt: "2026-09-01T08:00:00.000Z",
  price: gbp(31_900),
  availability: "in_stock",
};

describe("AfterBuy API", () => {
  it("protects a purchase and exposes the generated opportunity on the dashboard", async () => {
    const app = await createAfterBuyServer({
      config: {
        port: 0,
        dataFile: ":memory:",
        devUserId: "user_1",
        enableDevAuth: true,
        enableDevEndpoints: true,
      },
      repository: new InMemoryAfterBuyRepository(),
      priceFetcher: new FixturePriceFetcher([droppedSnapshot]),
    });

    const protectResponse = await app.inject({
      method: "POST",
      url: "/api/purchases/protect",
      headers: { "x-afterbuy-user-id": "user_1" },
      payload: { purchaseDraft },
    });

    expect(protectResponse.statusCode).toBe(201);
    expect(protectResponse.json().accepted).toHaveLength(1);

    const monitorResponse = await app.inject({
      method: "POST",
      url: "/api/dev/run-monitoring",
      headers: { "x-afterbuy-user-id": "user_1" },
    });

    expect(monitorResponse.statusCode).toBe(200);
    expect(monitorResponse.json().summary.opportunitiesCreated).toBe(1);

    const dashboardResponse = await app.inject({
      method: "GET",
      url: "/api/dashboard",
      headers: { "x-afterbuy-user-id": "user_1" },
    });
    const dashboard = dashboardResponse.json();

    expect(dashboard.purchases).toHaveLength(1);
    expect(dashboard.purchases[0].currentPriceDisplay).toBe("£319");
    expect(dashboard.opportunities).toHaveLength(1);
    expect(dashboard.opportunities[0]).toMatchObject({
      potentialSavingDisplay: "£30",
      claimBy: "2026-09-06",
    });

    const syncResponse = await app.inject({
      method: "GET",
      url: "/api/extension/sync",
      headers: { "x-afterbuy-user-id": "user_1" },
    });
    const sync = syncResponse.json();

    expect(syncResponse.statusCode).toBe(200);
    expect(sync).toMatchObject({
      protectedPurchaseCount: 1,
      openOpportunityCount: 1,
    });
    expect(sync.opportunities[0]).toMatchObject({
      id: dashboard.opportunities[0].id,
      status: "open",
      potentialSavingDisplay: "£30",
    });

    const claimResponse = await app.inject({
      method: "POST",
      url: `/api/opportunities/${dashboard.opportunities[0].id}/claim-clicked`,
      headers: { "x-afterbuy-user-id": "user_1" },
    });

    expect(claimResponse.statusCode).toBe(200);
    expect(claimResponse.json().opportunity).toMatchObject({
      status: "claim_clicked",
    });

    const otherUserDashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard",
      headers: { "x-afterbuy-user-id": "user_2" },
    });

    expect(otherUserDashboard.json().purchases).toHaveLength(0);
    expect(otherUserDashboard.json().opportunities).toHaveLength(0);

    await app.close();
  });

  it("rejects malformed purchase submissions", async () => {
    const app = await createAfterBuyServer({
      config: {
        port: 0,
        dataFile: ":memory:",
        devUserId: "user_1",
        enableDevAuth: true,
        enableDevEndpoints: true,
      },
      repository: new InMemoryAfterBuyRepository(),
      priceFetcher: new FixturePriceFetcher([droppedSnapshot]),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/purchases/protect",
      payload: {
        purchaseDraft: {
          ...purchaseDraft,
          lineItems: [],
        },
      },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("accepts generic store purchases without requiring a retailer-specific adapter", async () => {
    const app = await createAfterBuyServer({
      config: {
        port: 0,
        dataFile: ":memory:",
        devUserId: "user_1",
        enableDevAuth: true,
        enableDevEndpoints: true,
      },
      repository: new InMemoryAfterBuyRepository(),
      priceFetcher: new FixturePriceFetcher([droppedSnapshot]),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/purchases/protect",
      headers: { "x-afterbuy-user-id": "user_1" },
      payload: { purchaseDraft: genericPurchaseDraft },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().accepted[0].purchase).toMatchObject({
      retailerId: "store_shop-example-com",
      retailerName: "Shop",
      storeHost: "shop.example.com",
    });

    await app.close();
  });

  it("reports when a scanned purchase is already protected", async () => {
    const app = await createAfterBuyServer({
      config: {
        port: 0,
        dataFile: ":memory:",
        devUserId: "user_1",
        enableDevAuth: true,
        enableDevEndpoints: true,
      },
      repository: new InMemoryAfterBuyRepository(),
    });

    const beforeProtection = await app.inject({
      method: "POST",
      url: "/api/purchases/protection-status",
      headers: { "x-afterbuy-user-id": "user_1" },
      payload: { purchaseDraft },
    });

    expect(beforeProtection.statusCode).toBe(200);
    expect(beforeProtection.json()).toMatchObject({
      protected: false,
      purchase: null,
    });

    await app.inject({
      method: "POST",
      url: "/api/purchases/protect",
      headers: { "x-afterbuy-user-id": "user_1" },
      payload: { purchaseDraft },
    });

    const afterProtection = await app.inject({
      method: "POST",
      url: "/api/purchases/protection-status",
      headers: { "x-afterbuy-user-id": "user_1" },
      payload: { purchaseDraft },
    });
    const body = afterProtection.json();

    expect(afterProtection.statusCode).toBe(200);
    expect(body).toMatchObject({
      protected: true,
      purchase: {
        productName:
          "Sony WH-1000XM6 Wireless Bluetooth Noise Cancelling Headphones, Black",
        pricePaidDisplay: "£349",
      },
    });
    expect(body.purchase.id).toMatch(/^pur_/);

    await app.close();
  });

  it("returns a clear auth error when development auth is disabled", async () => {
    const app = await createAfterBuyServer({
      config: {
        port: 0,
        dataFile: ":memory:",
        devUserId: "user_1",
        enableDevAuth: false,
        enableDevEndpoints: false,
      },
      repository: new InMemoryAfterBuyRepository(),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/dashboard",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: "authentication_required",
    });

    await app.close();
  });
});
