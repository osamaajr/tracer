import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import {
  FixturePriceFetcher,
  InMemoryAfterBuyRepository,
  extractJohnLewisProductFromDocument,
  extractJohnLewisProductId,
  extractJohnLewisPurchaseFromDocument,
  extractGenericProductFromDocument,
  extractGenericPurchaseFromDocument,
  extractPurchaseFromDocument,
  gbp,
  normalizeRetailerUrl,
  normalizePublicStoreUrl,
  parseGbpPrice,
  money,
  parsePrice,
  protectPurchase,
  runPriceMonitoringCycle,
  updateOpportunityStatus,
} from "../index";

const orderUrl =
  "https://www.johnlewis.com/checkout/order-confirmation/JL-12345678";
const productUrl =
  "https://www.johnlewis.com/sony-wh-1000xm6-wireless-bluetooth-noise-cancelling-headphones-black/p1122334";

describe("GBP price parsing", () => {
  it("parses UK currency strings into pence", () => {
    expect(parseGbpPrice("£349")).toEqual(gbp(34_900));
    expect(parseGbpPrice("GBP 1,299.99")).toEqual(gbp(129_999));
    expect(parsePrice("$19.99")).toEqual(money(1_999, "USD"));
    expect(parsePrice("EUR 50")).toEqual(money(5_000, "EUR"));
    expect(parseGbpPrice("not a price")).toBeNull();
  });
});

describe("John Lewis extraction", () => {
  it("extracts a structured purchase draft from a supported confirmation page", () => {
    const document = fixtureDocument("order-confirmation.html");
    const draft = extractJohnLewisPurchaseFromDocument(document, orderUrl);

    expect(draft).toMatchObject({
      retailerId: "john-lewis",
      retailerName: "John Lewis",
      storeHost: "www.johnlewis.com",
      captureMethod: "retailer_adapter",
      captureConfidence: "high",
      orderReference: "JL-12345678",
      lineItems: [
        {
          productName:
            "Sony WH-1000XM6 Wireless Bluetooth Noise Cancelling Headphones, Black",
          quantity: 1,
          pricePaid: gbp(34_900),
          externalProductId: "p1122334",
          sku: "JL-SNY-XM6-BLK",
        },
      ],
    });
  });

  it("does not extract purchases from unsupported pages", () => {
    const document = fixtureDocument("unsupported-page.html");

    expect(
      extractJohnLewisPurchaseFromDocument(
        document,
        "https://www.johnlewis.com/browse/home-garden/kitchenware/_/N-8ew",
      ),
    ).toBeNull();
  });

  it("fails closed when there is no reliable product identifier", () => {
    const document = fixtureDocument("order-without-product-identifier.html");

    expect(extractJohnLewisPurchaseFromDocument(document, orderUrl)).toBeNull();
  });

  it("extracts product identifiers and current prices from product pages", () => {
    const document = fixtureDocument("product-headphones-dropped.html");
    const snapshot = extractJohnLewisProductFromDocument(
      document,
      productUrl,
      "2026-09-01T08:00:00.000Z",
    );

    expect(extractJohnLewisProductId(productUrl)).toBe("p1122334");
    expect(snapshot).toMatchObject({
      retailerId: "john-lewis",
      externalProductId: "p1122334",
      price: gbp(31_900),
      availability: "in_stock",
    });
  });
});

describe("generic store extraction", () => {
  it("extracts a purchase from a schema.org order on an arbitrary public store", () => {
    const document = genericFixtureDocument("order-confirmation.html");
    const draft = extractGenericPurchaseFromDocument(
      document,
      "https://shop.example.com/checkout/confirmation/ACME-445566",
    );

    expect(draft).toMatchObject({
      retailerId: "store_shop-example-com",
      retailerName: "Shop",
      storeHost: "shop.example.com",
      orderReference: "ACME-445566",
      captureMethod: "generic_schema_org",
      captureConfidence: "high",
      lineItems: [
        {
          productName: "Trail Pack 24L, Moss Green",
          pricePaid: gbp(8_450),
          productUrl: "https://shop.example.com/products/trail-pack-24l-moss-green",
          externalProductId: "acme-pack-24-moss",
          productUrlConfidence: "high",
        },
      ],
    });
  });

  it("fails closed when a generic order points to a different store host", () => {
    const document = genericFixtureDocument("order-with-cross-store-product.html");

    expect(
      extractGenericPurchaseFromDocument(
        document,
        "https://shop.example.com/checkout/confirmation/ACME-445566",
      ),
    ).toBeNull();
  });

  it("uses the retailer-specific extractor before generic fallback", () => {
    const document = fixtureDocument("order-confirmation.html");
    const draft = extractPurchaseFromDocument(document, orderUrl);

    expect(draft?.retailerId).toBe("john-lewis");
    expect(draft?.captureMethod).toBe("retailer_adapter");
  });

  it("extracts current price snapshots for arbitrary product pages", () => {
    const snapshot = extractGenericProductFromDocument(
      genericFixtureDocument("product-pack-dropped.html"),
      "https://shop.example.com/products/trail-pack-24l-moss-green",
      "2026-09-01T08:00:00.000Z",
    );

    expect(snapshot).toMatchObject({
      retailerId: "store_shop-example-com",
      retailerName: "Shop",
      storeHost: "shop.example.com",
      price: gbp(7_200),
      availability: "in_stock",
    });
  });
});

describe("product protection and monitoring", () => {
  it("persists a protected purchase, records an observation, and creates a genuine opportunity", async () => {
    const repository = new InMemoryAfterBuyRepository();
    const draft = mustExtractPurchase();

    const protectedPurchase = await protectPurchase(repository, {
      userId: "user_1",
      draft,
      now: "2026-08-30T10:00:00.000Z",
    });

    expect(protectedPurchase.accepted).toHaveLength(1);
    expect(protectedPurchase.accepted[0]?.status).toBe("created");

    const droppedSnapshot = mustExtractProduct(
      "product-headphones-dropped.html",
      "2026-09-01T08:00:00.000Z",
    );

    const summary = await runPriceMonitoringCycle({
      repository,
      priceFetcher: new FixturePriceFetcher([droppedSnapshot]),
      now: "2026-09-01T08:00:00.000Z",
    });

    expect(summary).toMatchObject({
      checkedProducts: 1,
      observationsCreated: 1,
      opportunitiesCreated: 1,
      failures: [],
    });

    const opportunities = await repository.listOpportunitiesForUser("user_1");
    expect(opportunities).toHaveLength(1);
    const opportunity = opportunities[0];

    expect(opportunity).toMatchObject({
      title: "Tracer found you £30",
      potentialSaving: gbp(3_000),
      claimBy: "2026-09-06",
      status: "open",
    });

    if (!opportunity) {
      throw new Error("Expected opportunity to be created");
    }

    const statusResult = await updateOpportunityStatus({
      repository,
      userId: "user_1",
      opportunityId: opportunity.id,
      status: "claim_clicked",
      now: "2026-09-01T08:05:00.000Z",
    });

    expect(statusResult.changed).toBe(true);
    expect(statusResult.opportunity).toMatchObject({
      status: "claim_clicked",
      statusUpdatedAt: "2026-09-01T08:05:00.000Z",
    });
  });

  it("deduplicates products and exact purchase submissions", async () => {
    const repository = new InMemoryAfterBuyRepository();
    const draft = mustExtractPurchase();

    const first = await protectPurchase(repository, {
      userId: "user_1",
      draft,
      now: "2026-08-30T10:00:00.000Z",
    });
    const second = await protectPurchase(repository, {
      userId: "user_1",
      draft,
      now: "2026-08-30T10:01:00.000Z",
    });

    expect(first.accepted[0]?.product.id).toBe(second.accepted[0]?.product.id);
    expect(second.accepted[0]?.status).toBe("duplicate");
    expect(await repository.listPurchasesForUser("user_1")).toHaveLength(1);
  });

  it("does not create an opportunity when the current price has not fallen", async () => {
    const repository = new InMemoryAfterBuyRepository();
    await protectPurchase(repository, {
      userId: "user_1",
      draft: mustExtractPurchase(),
      now: "2026-08-30T10:00:00.000Z",
    });

    const summary = await runPriceMonitoringCycle({
      repository,
      priceFetcher: new FixturePriceFetcher([
        mustExtractProduct("product-headphones-paid.html", "2026-09-01T08:00:00.000Z"),
      ]),
      now: "2026-09-01T08:00:00.000Z",
    });

    expect(summary.opportunitiesCreated).toBe(0);
    expect(await repository.listOpportunitiesForUser("user_1")).toHaveLength(0);
  });

  it("does not create an opportunity outside the John Lewis 7-day window", async () => {
    const repository = new InMemoryAfterBuyRepository();
    const draft = {
      ...mustExtractPurchase(),
      purchasedAt: "2026-08-01T09:15:00.000Z",
    };

    await protectPurchase(repository, {
      userId: "user_1",
      draft,
      now: "2026-08-01T10:00:00.000Z",
    });

    const summary = await runPriceMonitoringCycle({
      repository,
      priceFetcher: new FixturePriceFetcher([
        mustExtractProduct("product-headphones-dropped.html", "2026-08-15T08:00:00.000Z"),
      ]),
      now: "2026-08-15T08:00:00.000Z",
    });

    expect(summary.opportunitiesCreated).toBe(0);
  });

  it("keeps user-owned purchase data scoped by user", async () => {
    const repository = new InMemoryAfterBuyRepository();
    await protectPurchase(repository, {
      userId: "user_1",
      draft: mustExtractPurchase(),
      now: "2026-08-30T10:00:00.000Z",
    });

    expect(await repository.listPurchasesForUser("user_1")).toHaveLength(1);
    expect(await repository.listPurchasesForUser("user_2")).toHaveLength(0);
  });

  it("persists generic store purchases but does not invent a policy opportunity", async () => {
    const repository = new InMemoryAfterBuyRepository();
    const draft = mustExtractGenericPurchase();

    const result = await protectPurchase(repository, {
      userId: "user_1",
      draft,
      now: "2026-08-30T13:00:00.000Z",
    });

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.purchase).toMatchObject({
      retailerId: "store_shop-example-com",
      retailerName: "Shop",
      storeHost: "shop.example.com",
      captureMethod: "generic_schema_org",
    });

    const summary = await runPriceMonitoringCycle({
      repository,
      priceFetcher: new FixturePriceFetcher([
        mustExtractGenericProduct("product-pack-dropped.html", "2026-09-01T08:00:00.000Z"),
      ]),
      now: "2026-09-01T08:00:00.000Z",
    });

    expect(summary).toMatchObject({
      checkedProducts: 1,
      observationsCreated: 1,
      opportunitiesCreated: 0,
      failures: [],
    });
    expect(await repository.listOpportunitiesForUser("user_1")).toHaveLength(0);
  });
});

describe("retailer URL safety", () => {
  it("allows canonical John Lewis product URLs", () => {
    expect(
      normalizeRetailerUrl("john-lewis", `${productUrl}?tmad=c&foo=bar#reviews`, {
        requireProductUrl: true,
      }),
    ).toEqual({
      host: "www.johnlewis.com",
      productId: "p1122334",
      url: productUrl,
    });
  });

  it("rejects unsafe or unsupported URLs before backend fetching", () => {
    expect(() =>
      normalizeRetailerUrl("john-lewis", "http://www.johnlewis.com/a-product/p1122334"),
    ).toThrow("HTTPS");
    expect(() =>
      normalizeRetailerUrl("john-lewis", "https://127.0.0.1/a-product/p1122334"),
    ).toThrow("not allowed");
    expect(() =>
      normalizeRetailerUrl("john-lewis", "https://example.com/a-product/p1122334"),
    ).toThrow("not allowed");
    expect(() =>
      normalizeRetailerUrl("john-lewis", "https://www.johnlewis.com/customer-services", {
        requireProductUrl: true,
      }),
    ).toThrow("product identifier");
  });

  it("normalizes public arbitrary-store URLs while blocking local and cross-store URLs", () => {
    expect(
      normalizePublicStoreUrl(
        "https://shop.example.com/products/trail-pack-24l-moss-green?variant=green#reviews",
        { expectedHost: "shop.example.com" },
      ),
    ).toEqual({
      host: "shop.example.com",
      url: "https://shop.example.com/products/trail-pack-24l-moss-green?variant=green",
    });

    expect(() => normalizePublicStoreUrl("http://shop.example.com/products/1")).toThrow(
      "HTTPS",
    );
    expect(() => normalizePublicStoreUrl("https://localhost/products/1")).toThrow(
      "public",
    );
    expect(() =>
      normalizePublicStoreUrl("https://192.168.0.10/products/1"),
    ).toThrow("public");
    expect(() =>
      normalizePublicStoreUrl("https://cdn.example.com/products/1", {
        expectedHost: "shop.example.com",
      }),
    ).toThrow("does not match");
  });
});

function mustExtractPurchase() {
  const draft = extractJohnLewisPurchaseFromDocument(
    fixtureDocument("order-confirmation.html"),
    orderUrl,
  );

  if (!draft) {
    throw new Error("Expected fixture purchase to extract");
  }

  return draft;
}

function mustExtractProduct(fixtureName: string, observedAt: string) {
  const snapshot = extractJohnLewisProductFromDocument(
    fixtureDocument(fixtureName),
    productUrl,
    observedAt,
  );

  if (!snapshot) {
    throw new Error("Expected fixture product to extract");
  }

  return snapshot;
}

function mustExtractGenericPurchase() {
  const draft = extractGenericPurchaseFromDocument(
    genericFixtureDocument("order-confirmation.html"),
    "https://shop.example.com/checkout/confirmation/ACME-445566",
  );

  if (!draft) {
    throw new Error("Expected generic fixture purchase to extract");
  }

  return draft;
}

function mustExtractGenericProduct(fixtureName: string, observedAt: string) {
  const snapshot = extractGenericProductFromDocument(
    genericFixtureDocument(fixtureName),
    "https://shop.example.com/products/trail-pack-24l-moss-green",
    observedAt,
  );

  if (!snapshot) {
    throw new Error("Expected generic fixture product to extract");
  }

  return snapshot;
}

function fixtureDocument(name: string): Document {
  const html = readFileSync(
    new URL(`../../fixtures/john-lewis/${name}`, import.meta.url),
    "utf8",
  );

  return parseHTML(html).document;
}

function genericFixtureDocument(name: string): Document {
  const html = readFileSync(
    new URL(`../../fixtures/generic-store/${name}`, import.meta.url),
    "utf8",
  );

  return parseHTML(html).document;
}
