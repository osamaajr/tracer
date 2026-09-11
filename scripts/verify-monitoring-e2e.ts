import { gbp } from "../packages/core/src/domain/money";
import type { PriceFetcher, ProductPriceSnapshot, PurchaseDraft } from "../packages/core/src/domain/types";
import { InMemoryAfterBuyRepository } from "../packages/core/src/repositories/inMemoryRepository";
import { runPriceMonitoringCycle } from "../packages/core/src/useCases/monitorPrices";
import { protectPurchase } from "../packages/core/src/useCases/protectPurchase";
import { buildPriceDropNotifications } from "../apps/extension/src/priceDropNotifications";

const userId = "e2e-user";
const paidAt = "2026-09-01T08:00:00.000Z";
const droppedAt = "2026-09-02T08:00:00.000Z";
const productUrl = "https://shop.example.com/products/trail-pack-24l-moss-green";
const draft: PurchaseDraft = {
  retailerId: "store_shop-example-com",
  retailerName: "Shop",
  storeHost: "shop.example.com",
  sourceUrl: "https://shop.example.com/checkout/confirmation/ACME-445566",
  orderReference: "ACME-445566",
  purchasedAt: "2026-08-30T12:30:00.000Z",
  captureMethod: "generic_schema_org",
  captureConfidence: "high",
  lineItems: [{
    productName: "Trail Pack 24L, Moss Green",
    quantity: 1,
    pricePaid: gbp(8_450),
    productUrl,
    externalProductId: "acme-pack-24-moss",
    sku: "TP24-MOSS",
  }],
};

const repository = new InMemoryAfterBuyRepository();
const protectedResult = await protectPurchase(repository, { userId, draft, now: draft.purchasedAt });
const purchase = protectedResult.accepted[0]?.purchase;
assert(purchase && protectedResult.accepted[0]?.status === "created", "purchase was not protected");

const paid = snapshot(8_450, paidAt);
const paidSummary = await runPriceMonitoringCycle({
  repository,
  priceFetcher: fixedFetcher(paid),
  now: paidAt,
});
assert(paidSummary.observationsCreated === 1, "paid observation was not stored");
assert(paidSummary.opportunitiesCreated === 0, "fixture unexpectedly created a policy opportunity");

const dropped = snapshot(6_950, droppedAt);
const dropSummary = await runPriceMonitoringCycle({
  repository,
  priceFetcher: fixedFetcher(dropped),
  now: droppedAt,
});
assert(dropSummary.activityEventsCreated === 1, "drop cycle did not create exactly one activity event");
const latest = await repository.findLatestObservationForProduct(purchase.productId);
const activity = await repository.listActivityEventsForPurchases([purchase.id], 20);
const dropEvent = activity.find((event) => event.type === "price_dropped");
assert(latest?.price.amountMinor === 6_950, "latest price is not £69.50");
assert(dropEvent?.metadata.savingAgainstPaid && typeof dropEvent.metadata.savingAgainstPaid === "object", "saving was not stored");
assert((dropEvent.metadata.savingAgainstPaid as { amountMinor: number }).amountMinor === 1_500, "saving is not £15");
assert(dropEvent.metadata.savingPercentageBps === 1_775, "saving percentage is not 17.75%");

const notifications = buildPriceDropNotifications([{
  eventId: dropEvent.id,
  purchaseId: purchase.id,
  productName: purchase.productName,
  currentPriceDisplay: "£69.50",
  savingDisplay: "£15",
  detectedAt: dropEvent.occurredAt,
}], new Set(), true);
assert(notifications.length === 1, "enabled alerts did not create one notification");
assert(buildPriceDropNotifications([{
  eventId: dropEvent.id,
  purchaseId: purchase.id,
  productName: purchase.productName,
  currentPriceDisplay: "£69.50",
  savingDisplay: "£15",
  detectedAt: dropEvent.occurredAt,
}], new Set(), false).length === 0, "disabled alerts created a notification");

const repeat = await runPriceMonitoringCycle({
  repository,
  priceFetcher: fixedFetcher(dropped),
  now: droppedAt,
});
assert(repeat.observationsCreated === 0 && repeat.activityEventsCreated === 0, "repeat drop was not deduplicated");

await repository.setMonitoringEnabled(userId, false, "2026-09-02T09:00:00.000Z");
let pausedChecks = 0;
const paused = await runPriceMonitoringCycle({
  repository,
  priceFetcher: {
    fetchCurrentPrice: async () => {
      pausedChecks += 1;
      return dropped;
    },
  },
  now: "2026-09-02T10:00:00.000Z",
});
assert(paused.checkedProducts === 0 && pausedChecks === 0, "monitoring-off still fetched a product");

await repository.setMonitoringEnabled(userId, true, "2026-09-02T11:00:00.000Z");
await repository.deletePurchaseForUser(purchase.id, userId);
const afterClear = await runPriceMonitoringCycle({
  repository,
  priceFetcher: fixedFetcher(dropped),
  now: "2026-09-02T12:00:00.000Z",
});
assert(afterClear.checkedProducts === 0, "cleared purchase was still monitored");

console.log(JSON.stringify({
  ok: true,
  protectedPrice: "£84.50",
  latestPrice: "£69.50",
  saving: "£15",
  savingPercentage: "17.75%",
  priceDropEvents: activity.filter((event) => event.type === "price_dropped").length,
  notifications: notifications.length,
  repeatEvents: repeat.activityEventsCreated,
  pausedChecks,
  checksAfterClear: afterClear.checkedProducts,
}, null, 2));

function snapshot(amountMinor: number, observedAt: string): ProductPriceSnapshot {
  return {
    retailerId: draft.retailerId,
    retailerName: draft.retailerName,
    storeHost: draft.storeHost,
    productUrl,
    productName: "Trail Pack 24L, Moss Green",
    externalProductId: "acme-pack-24-moss",
    sku: "TP24-MOSS",
    price: gbp(amountMinor),
    observedAt,
    availability: "in_stock",
  };
}

function fixedFetcher(value: ProductPriceSnapshot): PriceFetcher {
  return { fetchCurrentPrice: async () => value };
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
