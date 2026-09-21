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
  extractShopifyAccountPurchaseFromDocument,
  findProtectedPurchaseForDraft,
  gbp,
  isShopifyAccountOrderUrl,
  normalizeRetailerUrl,
  normalizePublicStoreUrl,
  parseGbpPrice,
  money,
  parsePrice,
  protectPurchase,
  runPriceMonitoringCycle,
  updateOpportunityStatus,
  validatePurchaseDraft,
} from "../index";

const orderUrl =
  "https://www.johnlewis.com/checkout/order-confirmation/JL-12345678";
const productUrl =
  "https://www.johnlewis.com/sony-wh-1000xm6-wireless-bluetooth-noise-cancelling-headphones-black/p1122334";

describe("GBP price parsing", () => {
  it("parses UK currency strings into pence", () => {
    expect(parseGbpPrice("£349.99")).toEqual(gbp(34_999));
    expect(parseGbpPrice("£349")).toEqual(gbp(34_900));
    expect(parseGbpPrice("GBP 1,299.99")).toEqual(gbp(129_999));
    expect(parsePrice("$19.99")).toEqual(money(1_999, "USD"));
    expect(parsePrice("EUR 50")).toEqual(money(5_000, "EUR"));
    expect(parseGbpPrice("not a price")).toBeNull();
    expect(parsePrice("82,00 EUR", "EUR")).toEqual({ amountMinor: 8200, currency: "EUR" });
    expect(parsePrice("€1.234,56", "EUR")).toEqual({ amountMinor: 123456, currency: "EUR" });
    expect(parseGbpPrice("-£20")).toBeNull();
    expect(parseGbpPrice(null)).toBeNull();
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
          pricePaid: gbp(34_999),
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
      price: gbp(31_999),
      availability: "in_stock",
    });
  });
});

describe("generic store extraction", () => {
  it("prefers an order-confirmation image and supports structured image objects", () => {
    const document = parseHTML(`
      <main>
        <script type="application/ld+json">
          ${JSON.stringify({
            "@type": "Order",
            orderNumber: "IMG-12345",
            orderDate: "2026-08-30T12:30:00Z",
            acceptedOffer: [{
              price: "84.50",
              priceCurrency: "GBP",
              itemOffered: {
                name: "Trail Pack 24L, Moss Green",
                url: "https://shop.example.com/products/trail-pack-24l-moss-green",
                image: { contentUrl: "https://cdn.example.com/json-ld-pack.jpg" },
              },
            }],
          })}
        </script>
        <section data-afterbuy-line-item>
          <h2 data-afterbuy-product-name>Trail Pack 24L, Moss Green</h2>
          <a href="https://shop.example.com/products/trail-pack-24l-moss-green">View product</a>
          <img src="https://cdn.example.com/order-confirmation-pack.jpg" alt="Trail Pack" />
          <span data-afterbuy-price-paid>£84.50</span>
        </section>
      </main>
    `).document;

    const draft = extractGenericPurchaseFromDocument(
      document,
      "https://shop.example.com/checkout/confirmation/IMG-12345",
    );

    expect(draft?.lineItems[0]?.imageUrl).toBe(
      "https://cdn.example.com/order-confirmation-pack.jpg",
    );
  });

  it("ignores unusable image candidates without rejecting the purchase", () => {
    const document = parseHTML(`
      <main>
        <script type="application/ld+json">
          ${JSON.stringify({
            "@type": "Order",
            orderNumber: "IMG-12346",
            acceptedOffer: [{
              price: "84.50",
              priceCurrency: "GBP",
              itemOffered: {
                name: "Trail Pack 24L, Moss Green",
                url: "https://shop.example.com/products/trail-pack-24l-moss-green",
                image: "data:image/png;base64,invalid",
              },
            }],
          })}
        </script>
      </main>
    `).document;

    const draft = extractGenericPurchaseFromDocument(
      document,
      "https://shop.example.com/checkout/confirmation/IMG-12346",
    );

    expect(draft).not.toBeNull();
    expect(draft?.lineItems[0]?.imageUrl).toBeUndefined();
  });

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

  it("ignores broad order wrappers and extracts each nested DOM item with its own price", () => {
    const document = parseHTML(`
      <html><body>
        <h1>Thank you for your order</h1><p>Order number DOM-12345</p>
        <section class="order-items">
          <article class="order-item">
            <h2>Canvas jacket</h2>
            <a href="https://shop.example.com/products/canvas-jacket">View product</a>
            <span class="old-price">£80.00</span><span class="price">£64.00</span>
          </article>
          <article class="order-item">
            <h2>Heavyweight tee</h2>
            <a href="https://shop.example.com/products/heavyweight-tee">View product</a>
            <span class="quantity">Quantity 2</span><span data-line-total>£50.00</span>
          </article>
          <article class="order-item">
            <h2>Cotton cap</h2>
            <a href="https://shop.example.com/products/cotton-cap">View product</a>
            <span class="price">£18.50</span>
          </article>
        </section>
        <section class="order-total">Order total £136.49</section>
      </body></html>
    `).document;

    const draft = extractGenericPurchaseFromDocument(
      document,
      "https://shop.example.com/orders/DOM-12345",
    );
    expect(draft?.lineItems).toMatchObject([
      { productName: "Canvas jacket", quantity: 1, pricePaid: gbp(6_400) },
      { productName: "Heavyweight tee", quantity: 2, pricePaid: gbp(2_500) },
      { productName: "Cotton cap", quantity: 1, pricePaid: gbp(1_850) },
    ]);
  });

  it("does not divide an explicitly per-item price by the quantity again", () => {
    const document = parseHTML(`
      <html><body>
        <h1>Thank you for your order</h1><p>Order number UNIT-12345</p>
        <article class="order-item">
          <h2>Miniature Mushroom Desk Lamp</h2>
          <a href="https://shop.example.com/products/mushroom-desk-lamp">View product</a>
          <span class="quantity">Quantity 2</span>
          <span class="price">£19.50 each</span>
        </article>
      </body></html>
    `).document;

    const draft = extractGenericPurchaseFromDocument(
      document,
      "https://shop.example.com/orders/UNIT-12345",
    );

    expect(draft?.lineItems).toMatchObject([
      { productName: "Miniature Mushroom Desk Lamp", quantity: 2, pricePaid: gbp(1_950) },
    ]);
  });

  it("extracts a Skechers-style receipt row without semantic order-item classes", () => {
    const document = genericFixtureDocument("skechers-order-confirmation.html");
    const draft = extractGenericPurchaseFromDocument(
      document,
      "https://www.skechers.co.uk/order-confirm/?ID=SKEC-UK102642108&token=test-token",
      new Date("2026-09-21T12:00:00.000Z"),
    );

    expect(draft).toMatchObject({
      retailerId: "store_skechers-co-uk",
      retailerName: "Skechers",
      storeHost: "www.skechers.co.uk",
      orderReference: "SKEC-UK102642108",
      purchasedAt: "2026-09-16T12:00:00.000Z",
      captureMethod: "generic_dom",
      captureConfidence: "medium",
      lineItems: [{
        productName: "Skechers Slip-ins: Arch Fit Summits - Luxe Leopard",
        quantity: 1,
        pricePaid: gbp(6_800),
        sku: "199025198875",
        productUrl: "https://www.skechers.co.uk/women/shoes/skechers-slip-ins-arch-fit-summits-luxe-leopard/150750_BRN.html",
        imageUrl: "https://www.skechers.co.uk/dw/image/v2/product-150750-brn.jpg",
      }],
    });
  });

  it("keeps a reliable receipt purchase detectable while its product link needs review", () => {
    const document = parseHTML(`
      <html><body><main>
        <h1>Thank you for your order.</h1>
        <p>Order Number: SAFE-12345</p>
        <div class="receipt-entry">
          <img src="https://shop.example.com/images/ceramic-lamp.jpg" width="220" height="220" alt="Ceramic Moon Lamp" />
          <strong>Ceramic Moon Lamp</strong>
          <p>SKU: MOON-8841</p><p>Quantity: 2</p>
          <span data-label="Each">£24.50</span><span data-label="Total">£49.00</span>
        </div>
        <aside>Subtotal £49.00 Shipping £4.00 Order Total £53.00</aside>
      </main></body></html>
    `).document;

    const draft = extractGenericPurchaseFromDocument(
      document,
      "https://shop.example.com/order-confirm/SAFE-12345",
    );

    expect(draft).toMatchObject({
      captureConfidence: "low",
      lineItems: [{
        productName: "Ceramic Moon Lamp",
        quantity: 2,
        pricePaid: gbp(2_450),
        sku: "MOON-8841",
      }],
    });
    expect(draft?.lineItems[0]?.productUrl).toBeUndefined();
  });

  it("extracts separate rows from a multi-item receipt and preserves an ISO order date", () => {
    const document = parseHTML(`
      <html><body><main>
        <h1>Order confirmed</h1><p>Order Number: MULTI-77551</p>
        <time datetime="2026-09-18">18 September 2026</time>
        <section class="receipt-products">
          <div class="receipt-entry">
            <a href="https://shop.example.com/products/travel-mug"><img src="https://shop.example.com/images/mug.jpg" alt="Stoneware Travel Mug" /></a>
            <strong>Stoneware Travel Mug</strong><span>SKU: MUG-901</span>
            <span data-label="Each">£18.00</span><span data-label="QTY">2</span><span data-label="Total">£36.00</span>
          </div>
          <div class="receipt-entry">
            <a href="https://shop.example.com/products/linen-napkins"><img src="https://shop.example.com/images/napkins.jpg" alt="Linen Napkin Set" /></a>
            <strong>Linen Napkin Set</strong><span>SKU: LIN-442</span>
            <span data-label="Each">£12.50</span><span data-label="QTY">3</span><span data-label="Total">£37.50</span>
          </div>
        </section>
        <aside>Subtotal £73.50 Delivery £4.00 Tax £12.92 Order Total £90.42</aside>
      </main></body></html>
    `).document;

    const draft = extractGenericPurchaseFromDocument(
      document,
      "https://shop.example.com/order-confirm/MULTI-77551",
    );

    expect(draft?.purchasedAt).toBe("2026-09-18T00:00:00.000Z");
    expect(draft?.lineItems).toMatchObject([
      { productName: "Stoneware Travel Mug", quantity: 2, pricePaid: gbp(1_800), sku: "MUG-901" },
      { productName: "Linen Napkin Set", quantity: 3, pricePaid: gbp(1_250), sku: "LIN-442" },
    ]);
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

  it("does not treat a monthly finance amount as the product price", () => {
    const document = parseHTML(`
      <html><body>
        <h1>Premium Telescope</h1>
        <span data-test="product-price">From £12.50 per month</span>
      </body></html>
    `).document;

    expect(
      extractGenericProductFromDocument(
        document,
        "https://shop.example.com/products/premium-telescope",
        "2026-09-01T08:00:00.000Z",
      ),
    ).toBeNull();
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

    const purchase = protectedPurchase.accepted[0]?.purchase;
    if (!purchase) {
      throw new Error("Expected purchase to be protected");
    }

    const paidSnapshot = mustExtractProduct(
      "product-headphones-paid.html",
      "2026-09-01T08:00:00.000Z",
    );

    const paidSummary = await runPriceMonitoringCycle({
      repository,
      priceFetcher: new FixturePriceFetcher([paidSnapshot]),
      now: "2026-09-01T08:00:00.000Z",
    });

    expect(paidSummary).toMatchObject({
      checkedProducts: 1,
      observationsCreated: 1,
      opportunitiesCreated: 0,
      activityEventsCreated: 1,
      failures: [],
    });

    const monitoredProducts = await repository.listProductsForMonitoring();
    expect(monitoredProducts[0]?.imageUrl).toBe(
      "https://johnlewis.scene7.com/is/image/JohnLewis/headphones",
    );

    const droppedSnapshot = mustExtractProduct(
      "product-headphones-dropped.html",
      "2026-09-02T08:00:00.000Z",
    );

    const dropSummary = await runPriceMonitoringCycle({
      repository,
      priceFetcher: new FixturePriceFetcher([droppedSnapshot]),
      now: "2026-09-02T08:00:00.000Z",
    });

    expect(dropSummary).toMatchObject({
      checkedProducts: 1,
      observationsCreated: 1,
      opportunitiesCreated: 1,
      activityEventsCreated: 2,
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

    const activityEvents = await repository.listActivityEventsForPurchases([purchase.id]);
    expect(activityEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "price_dropped",
        "opportunity_created",
        "price_observed",
        "purchase_protected",
      ]),
    );
    expect(activityEvents).toHaveLength(4);

    const repeatDropSummary = await runPriceMonitoringCycle({
      repository,
      priceFetcher: new FixturePriceFetcher([droppedSnapshot]),
      now: "2026-09-02T08:00:00.000Z",
    });

    expect(repeatDropSummary).toMatchObject({
      checkedProducts: 1,
      observationsCreated: 0,
      opportunitiesCreated: 0,
      opportunitiesUpdated: 0,
      activityEventsCreated: 0,
      failures: [],
    });
    expect(await repository.listOpportunitiesForUser("user_1")).toHaveLength(1);

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

  it("requires every line item before treating a multi-item order as protected", async () => {
    const repository = new InMemoryAfterBuyRepository();
    const baseDraft = mustExtractPurchase();
    const fullDraft = {
      ...baseDraft,
      orderReference: "MULTI-ORDER-123",
      lineItems: [
        {
          productName: "Canvas jacket",
          productUrl: "https://www.johnlewis.com/canvas-jacket/p1001",
          quantity: 1,
          pricePaid: gbp(6_400),
        },
        {
          productName: "Heavyweight tee",
          productUrl: "https://www.johnlewis.com/heavyweight-tee/p1002",
          quantity: 2,
          pricePaid: gbp(2_500),
        },
        {
          productName: "Cotton cap",
          productUrl: "https://www.johnlewis.com/cotton-cap/p1003",
          quantity: 1,
          pricePaid: gbp(1_850),
        },
      ],
    };

    await protectPurchase(repository, {
      userId: "user_1",
      draft: { ...fullDraft, lineItems: [fullDraft.lineItems[0]!] },
      now: "2026-09-16T10:00:00.000Z",
    });

    expect(await findProtectedPurchaseForDraft(repository, {
      userId: "user_1",
      draft: fullDraft,
    })).toMatchObject({ protected: false, purchase: null });

    await protectPurchase(repository, {
      userId: "user_1",
      draft: fullDraft,
      now: "2026-09-16T10:01:00.000Z",
    });

    expect(await repository.listPurchasesForUser("user_1")).toHaveLength(3);
    expect(await findProtectedPurchaseForDraft(repository, {
      userId: "user_1",
      draft: fullDraft,
    })).toMatchObject({ protected: true });
  });

  it("corrects a stale protected price when the order is scanned again", async () => {
    const repository = new InMemoryAfterBuyRepository();
    const correctDraft = mustExtractPurchase();
    const wrongDraft = {
      ...correctDraft,
      lineItems: correctDraft.lineItems.map((item) => ({
        ...item,
        pricePaid: gbp(3_499),
      })),
    };

    await protectPurchase(repository, {
      userId: "user_1",
      draft: wrongDraft,
      now: "2026-09-16T10:00:00.000Z",
    });

    expect(await findProtectedPurchaseForDraft(repository, {
      userId: "user_1",
      draft: correctDraft,
    })).toMatchObject({ protected: false, purchase: null });

    const corrected = await protectPurchase(repository, {
      userId: "user_1",
      draft: correctDraft,
      now: "2026-09-16T10:01:00.000Z",
    });

    expect(corrected.accepted[0]).toMatchObject({
      status: "duplicate",
      purchase: { pricePaid: gbp(34_999) },
    });
    expect(await repository.listPurchasesForUser("user_1")).toMatchObject([
      { pricePaid: gbp(34_999) },
    ]);
  });

  it("uses SKU before canonical URL when distinguishing product variants", async () => {
    const repository = new InMemoryAfterBuyRepository();
    const common = {
      retailerId: "store_shop-example-com",
      retailerName: "Shop",
      storeHost: "shop.example.com",
      name: "Trail Pack",
      canonicalUrl: "https://shop.example.com/products/trail-pack",
      seenAt: "2026-09-01T08:00:00.000Z",
    };
    const green = await repository.upsertProduct({ ...common, sku: "PACK-GREEN" });
    const blue = await repository.upsertProduct({ ...common, sku: "PACK-BLUE" });
    const greenFromAlternateUrl = await repository.upsertProduct({
      ...common,
      canonicalUrl: "https://shop.example.com/products/trail-pack-green",
      sku: "PACK-GREEN",
    });

    expect(blue.id).not.toBe(green.id);
    expect(greenFromAlternateUrl.id).toBe(green.id);
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

  it("records price movement without unchanged-event spam and preserves valid state on failure", async () => {
    const repository = new InMemoryAfterBuyRepository();
    const result = await protectPurchase(repository, {
      userId: "user_1",
      draft: mustExtractGenericPurchase(),
      now: "2026-08-30T13:00:00.000Z",
    });
    const purchase = result.accepted[0]?.purchase;
    if (!purchase) throw new Error("Expected protected purchase");

    const base = mustExtractGenericProduct(
      "product-pack-dropped.html",
      "2026-09-01T08:00:00.000Z",
    );
    await runPriceMonitoringCycle({
      repository,
      priceFetcher: new FixturePriceFetcher([{ ...base, price: gbp(8_450) }]),
      now: base.observedAt,
    });

    const unchanged = { ...base, price: gbp(8_450), observedAt: "2026-09-01T20:00:00.000Z" };
    const unchangedSummary = await runPriceMonitoringCycle({
      repository,
      priceFetcher: new FixturePriceFetcher([unchanged]),
      now: unchanged.observedAt,
    });
    expect(unchangedSummary).toMatchObject({ observationsCreated: 1, activityEventsCreated: 0 });

    const dropped = { ...base, price: gbp(6_950), observedAt: "2026-09-02T08:00:00.000Z" };
    await runPriceMonitoringCycle({
      repository,
      priceFetcher: new FixturePriceFetcher([dropped]),
      now: dropped.observedAt,
    });

    const increased = { ...base, price: gbp(7_450), observedAt: "2026-09-02T20:00:00.000Z" };
    await runPriceMonitoringCycle({
      repository,
      priceFetcher: new FixturePriceFetcher([increased]),
      now: increased.observedAt,
    });

    const failure = await runPriceMonitoringCycle({
      repository,
      priceFetcher: { fetchCurrentPrice: async () => { throw new Error("HTTP 503"); } },
      now: "2026-09-03T08:00:00.000Z",
    });
    expect(failure.failures).toHaveLength(1);
    expect(await repository.findLatestObservationForProduct(purchase.productId)).toMatchObject({
      price: gbp(7_450),
      observedAt: increased.observedAt,
    });

    const events = await repository.listActivityEventsForPurchases([purchase.id], 20);
    expect(events.filter((event) => event.type === "price_dropped")).toHaveLength(1);
    expect(events.filter((event) => event.type === "price_increased")).toHaveLength(1);
    expect(events.filter((event) => event.type === "price_observed")).toHaveLength(1);
    expect(events.filter((event) => event.type === "monitoring_error")).toHaveLength(1);
    expect(events.find((event) => event.type === "price_dropped")?.metadata).toMatchObject({
      change: gbp(1_500),
      savingAgainstPaid: gbp(1_500),
      savingPercentageBps: 1775,
    });
  });

  it("records availability only when it changes", async () => {
    const repository = new InMemoryAfterBuyRepository();
    const result = await protectPurchase(repository, {
      userId: "user_1",
      draft: mustExtractGenericPurchase(),
      now: "2026-08-30T13:00:00.000Z",
    });
    const purchase = result.accepted[0]?.purchase;
    if (!purchase) throw new Error("Expected protected purchase");
    const base = mustExtractGenericProduct(
      "product-pack-dropped.html",
      "2026-09-01T08:00:00.000Z",
    );

    for (const snapshot of [
      { ...base, availability: "out_of_stock" as const },
      { ...base, availability: "out_of_stock" as const, observedAt: "2026-09-01T20:00:00.000Z" },
      { ...base, availability: "in_stock" as const, observedAt: "2026-09-02T08:00:00.000Z" },
    ]) {
      await runPriceMonitoringCycle({
        repository,
        priceFetcher: new FixturePriceFetcher([snapshot]),
        now: snapshot.observedAt,
      });
    }

    const events = await repository.listActivityEventsForPurchases([purchase.id], 20);
    expect(events.filter((event) => event.type === "product_unavailable")).toHaveLength(1);
    expect(events.filter((event) => event.type === "product_available_again")).toHaveLength(1);
  });

  it("monitors matching non-GBP prices and rejects a currency change", async () => {
    const repository = new InMemoryAfterBuyRepository();
    const source = mustExtractGenericPurchase();
    const draft = {
      ...source,
      lineItems: source.lineItems.map((item) => ({
        ...item,
        pricePaid: money(item.pricePaid.amountMinor, "EUR"),
      })),
    };
    const result = await protectPurchase(repository, {
      userId: "user_eur",
      draft,
      now: "2026-08-30T13:00:00.000Z",
    });
    const purchase = result.accepted[0]?.purchase;
    if (!purchase) throw new Error("Expected protected purchase");

    const base = mustExtractGenericProduct(
      "product-pack-dropped.html",
      "2026-09-01T08:00:00.000Z",
    );
    const euroSnapshot = {
      ...base,
      price: money(6_950, "EUR"),
    };
    const euroSummary = await runPriceMonitoringCycle({
      repository,
      priceFetcher: new FixturePriceFetcher([euroSnapshot]),
      now: euroSnapshot.observedAt,
    });
    expect(euroSummary.failures).toEqual([]);
    expect(await repository.findLatestObservationForProduct(purchase.productId)).toMatchObject({
      price: money(6_950, "EUR"),
    });

    const changedCurrency = {
      ...euroSnapshot,
      observedAt: "2026-09-01T20:00:00.000Z",
      price: money(6_500, "GBP"),
    };
    const changedSummary = await runPriceMonitoringCycle({
      repository,
      priceFetcher: new FixturePriceFetcher([changedCurrency]),
      now: changedCurrency.observedAt,
    });
    expect(changedSummary.failures).toHaveLength(1);
    expect(await repository.findLatestObservationForProduct(purchase.productId)).toMatchObject({
      price: money(6_950, "EUR"),
    });
  });

  it("rejects an implausible price without overwriting the last valid observation", async () => {
    const repository = new InMemoryAfterBuyRepository();
    const result = await protectPurchase(repository, {
      userId: "user_1",
      draft: mustExtractGenericPurchase(),
      now: "2026-08-30T13:00:00.000Z",
    });
    const purchase = result.accepted[0]?.purchase;
    if (!purchase) throw new Error("Expected protected purchase");
    const suspicious = {
      ...mustExtractGenericProduct("product-pack-dropped.html", "2026-09-01T08:00:00.000Z"),
      price: gbp(349),
    };
    const summary = await runPriceMonitoringCycle({
      repository,
      priceFetcher: new FixturePriceFetcher([suspicious]),
      now: suspicious.observedAt,
    });

    expect(summary.failures[0]?.reason).toContain("sanity check");
    expect(await repository.findLatestObservationForProduct(purchase.productId)).toBeNull();
  });
});

describe("Shopify account order extraction", () => {
  const shopifyOrderUrl =
    "https://shopify.com/83196445016/account/orders/83db5bea386dc55f4246f1df8e3c5c74?buyer_token_attempted=1&locale=en-GB";

  it("extracts the merchant product from Shopify's hosted account order table", () => {
    const document = parseHTML(`
      <html>
        <head><title>Order #5042 - Seven Gates - Account</title></head>
        <body>
          <header><a href="https://sevengatesjewellery.com"><img alt="Seven Gates logo"></a></header>
          <main>
            <h1>Order #5042</h1>
            <p>Confirmed 28 Jul</p>
            <section aria-label="Order summary">
              <table aria-label="Order items">
                <tr>
                  <td>
                    <a
                      aria-label="Clover Bracelet Full Silver Charms"
                      href="https://sevengatesjewellery.com/products/clover-bracelet-full-silver-charm-bracelet?variant=54776061722968"
                    ><img src="https://sevengatesjewellery.com/cdn/shop/bracelet.jpg"></a>
                  </td>
                  <td>Clover Bracelet Full Silver Charms</td>
                  <td>£35.00</td>
                </tr>
              </table>
            </section>
          </main>
        </body>
      </html>
    `).document;

    const draft = extractShopifyAccountPurchaseFromDocument(
      document,
      shopifyOrderUrl,
      "2026-09-09T03:56:47.000Z",
    );

    expect(draft).toMatchObject({
      retailerId: "store_sevengatesjewellery-com",
      retailerName: "Seven Gates",
      storeHost: "sevengatesjewellery.com",
      sourceUrl: shopifyOrderUrl,
      purchasedAt: "2026-07-28T00:00:00.000Z",
      orderReference: "5042",
      captureMethod: "generic_dom",
      captureConfidence: "high",
      lineItems: [{
        productName: "Clover Bracelet Full Silver Charms",
        quantity: 1,
        pricePaid: gbp(3_500),
        productUrl:
          "https://sevengatesjewellery.com/products/clover-bracelet-full-silver-charm-bracelet?variant=54776061722968",
        externalProductId: "54776061722968",
      }],
    });
    expect(draft && validatePurchaseDraft(draft)).toEqual([]);
  });

  it("extracts every Shopify order row with its final per-item price", async () => {
    const document = parseHTML(`
      <html>
        <head><title>Order #9001 - Example Shop - Account</title></head>
        <body>
          <p>Confirmed 15 Sep 2026</p>
          <table aria-label="Order items">
            <tr>
              <td><a aria-label="Canvas jacket" href="https://example-shop.com/products/canvas-jacket?variant=101"></a></td>
              <td><span class="old-price">£80.00</span><span class="sale-price">£64.00</span></td>
            </tr>
            <tr>
              <td><a aria-label="Heavyweight tee" href="https://example-shop.com/products/heavyweight-tee?variant=202"></a></td>
              <td><span aria-label="Quantity 2">2</span></td>
              <td data-line-total>£50.00</td>
            </tr>
            <tr>
              <td><a aria-label="Cotton cap" href="https://example-shop.com/products/cotton-cap?variant=303"></a></td>
              <td>£18.50</td>
            </tr>
          </table>
          <section aria-label="Order totals"><p>Subtotal £132.50</p><p>Total £136.49</p></section>
        </body>
      </html>
    `).document;

    const draft = extractShopifyAccountPurchaseFromDocument(document, shopifyOrderUrl);
    expect(draft?.lineItems).toMatchObject([
      { productName: "Canvas jacket", quantity: 1, pricePaid: gbp(6_400) },
      { productName: "Heavyweight tee", quantity: 2, pricePaid: gbp(2_500) },
      { productName: "Cotton cap", quantity: 1, pricePaid: gbp(1_850) },
    ]);

    const result = await protectPurchase(new InMemoryAfterBuyRepository(), {
      userId: "user-multi-order",
      draft: draft!,
      now: "2026-09-16T12:00:00.000Z",
    });
    expect(result.accepted).toHaveLength(3);
    expect(result.accepted.map(({ purchase }) => purchase.pricePaid.amountMinor)).toEqual([6_400, 2_500, 1_850]);
  });

  it("only treats Shopify's strict account order route as a hosted order source", () => {
    expect(isShopifyAccountOrderUrl(shopifyOrderUrl)).toBe(true);
    expect(isShopifyAccountOrderUrl("https://shopify.com/blog/order-confirmation-design")).toBe(false);
    expect(isShopifyAccountOrderUrl("https://example.com/831/account/orders/fake")).toBe(false);
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
        "https://shop.example.com/products/trail-pack-24l-moss-green?utm_source=email&variant=green&gclid=123#reviews",
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
