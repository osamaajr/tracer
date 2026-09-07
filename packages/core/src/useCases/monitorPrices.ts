import type {
  AfterBuyRepository,
  Money,
  PriceFetcher,
  PriceObservationRecord,
  PurchaseRecord,
  RetailerPolicy,
} from "../domain/types";
import { isLessThan, subtractMoney } from "../domain/money";
import { RetailerPolicyRegistry, defaultPolicyRegistry } from "../policies/policyRegistry";
import { evaluatePriceObservationForPurchase } from "../policies/evaluateOpportunity";
import { firstUsableProductImage } from "../retailers/productImage";

export interface MonitoringSummary {
  checkedProducts: number;
  observationsCreated: number;
  opportunitiesCreated: number;
  opportunitiesUpdated: number;
  opportunitiesResolved: number;
  activityEventsCreated: number;
  failures: Array<{ productId: string; reason: string }>;
}

export interface RunPriceMonitoringOptions {
  repository: AfterBuyRepository;
  priceFetcher: PriceFetcher;
  now?: string;
  policyRegistry?: RetailerPolicyRegistry;
}

export async function runPriceMonitoringCycle(
  options: RunPriceMonitoringOptions,
): Promise<MonitoringSummary> {
  const now = options.now ?? new Date().toISOString();
  const policyRegistry = options.policyRegistry ?? defaultPolicyRegistry;
  const products = await options.repository.listProductsForMonitoring(now);
  const summary: MonitoringSummary = {
    checkedProducts: 0,
    observationsCreated: 0,
    opportunitiesCreated: 0,
    opportunitiesUpdated: 0,
    opportunitiesResolved: 0,
    activityEventsCreated: 0,
    failures: [],
  };

  for (const product of products) {
    summary.checkedProducts += 1;

    try {
      const previousObservation = await options.repository.findLatestObservationForProduct(
        product.id,
      );
      const snapshot = await options.priceFetcher.fetchCurrentPrice(product);
      validateSnapshot(product, snapshot);
      const imageUrl = firstUsableProductImage(snapshot.imageUrl);

      if (!product.imageUrl && imageUrl) {
        await options.repository.upsertProduct({
          retailerId: product.retailerId,
          retailerName: product.retailerName,
          storeHost: product.storeHost,
          name: product.name,
          canonicalUrl: product.canonicalUrl,
          seenAt: now,
          ...(product.externalProductId ? { externalProductId: product.externalProductId } : {}),
          ...(product.sku ? { sku: product.sku } : {}),
          imageUrl,
        });
      }
      let observation: PriceObservationRecord;
      if (isSameObservation(previousObservation, snapshot)) {
        observation = previousObservation;
      } else {
        observation = await options.repository.recordPriceObservation({
          productId: product.id,
          retailerId: product.retailerId,
          observedAt: snapshot.observedAt,
          price: snapshot.price,
          sourceUrl: snapshot.productUrl,
          availability: snapshot.availability,
        });
        summary.observationsCreated += 1;
      }

      const activePurchases = await options.repository.listActivePurchasesForProduct(product.id);

      for (const purchase of activePurchases) {
        summary.activityEventsCreated += await recordObservationActivity({
          repository: options.repository,
          purchase,
          observation,
          previousObservation,
          now,
        });

        const policy = policyRegistry.findPolicyForRetailer(
          purchase.retailerId,
          purchase.purchasedAt,
        );

        const opportunityResult = await syncOpportunity({
          repository: options.repository,
          purchase,
          policy,
          observation,
          now,
        });

        summary.opportunitiesCreated += opportunityResult.created;
        summary.opportunitiesUpdated += opportunityResult.updated;
        summary.opportunitiesResolved += opportunityResult.resolved;
        summary.activityEventsCreated += opportunityResult.activityEventsCreated;
      }
    } catch (error) {
      const activePurchases = await options.repository.listActivePurchasesForProduct(product.id);
      for (const purchase of activePurchases) {
        const event = await options.repository.recordActivityEvent({
          userId: purchase.userId,
          purchaseId: purchase.id,
          productId: product.id,
          type: "monitoring_error",
          occurredAt: now,
          createdAt: now,
          metadata: {
            reason: error instanceof Error ? error.message : "Unknown monitoring failure",
          },
          dedupeKey: `${purchase.id}:monitoring_error:${now.slice(0, 10)}`,
        });
        if (event.created) {
          summary.activityEventsCreated += 1;
        }
      }

      summary.failures.push({
        productId: product.id,
        reason: error instanceof Error ? error.message : "Unknown monitoring failure",
      });
    }
  }

  return summary;
}

interface OpportunitySyncResult {
  created: number;
  updated: number;
  resolved: number;
  activityEventsCreated: number;
}

async function syncOpportunity(input: {
  repository: AfterBuyRepository;
  purchase: PurchaseRecord;
  policy: RetailerPolicy | null;
  observation: PriceObservationRecord;
  now: string;
}): Promise<OpportunitySyncResult> {
  const result: OpportunitySyncResult = {
    created: 0,
    updated: 0,
    resolved: 0,
    activityEventsCreated: 0,
  };
  const existing = await input.repository.findOpenOpportunityForPurchase(input.purchase.id);

  if (!input.policy) {
    return result;
  }

  const decision = evaluatePriceObservationForPurchase(
    input.purchase,
    input.observation,
    input.policy,
    input.now,
  );

  if (!decision.eligible) {
    if (!existing) {
      if (decision.reason === "outside_policy_window") {
        result.activityEventsCreated += await recordActivity(input.repository, {
          purchase: input.purchase,
          type: "policy_window_expired",
          occurredAt: input.now,
          createdAt: input.now,
          metadata: { policyId: input.policy.id },
          dedupeKey: `${input.purchase.id}:policy_window_expired`,
        });
      }

      return result;
    }

    const status = decision.reason === "outside_policy_window" ? "expired" : "resolved";
    const updated = await input.repository.updateOpportunityStatus(
      existing.id,
      input.purchase.userId,
      status,
      input.now,
    );

    if (updated) {
      result.resolved += 1;
      const type = status === "expired" ? "opportunity_expired" : "opportunity_resolved";
      result.activityEventsCreated += await recordActivity(input.repository, {
        purchase: input.purchase,
        opportunityId: updated.id,
        type,
        occurredAt: input.now,
        createdAt: input.now,
        metadata: {
          reason: decision.reason,
          currentPrice: input.observation.price,
          claimBy: existing.claimBy,
        },
        dedupeKey: `${input.purchase.id}:${type}:${updated.id}:${input.now.slice(0, 10)}`,
      });

      if (decision.reason === "outside_policy_window") {
        result.activityEventsCreated += await recordActivity(input.repository, {
          purchase: input.purchase,
          opportunityId: updated.id,
          type: "policy_window_expired",
          occurredAt: input.now,
          createdAt: input.now,
          metadata: { policyId: input.policy.id },
          dedupeKey: `${input.purchase.id}:policy_window_expired`,
        });
      }
    }

    return result;
  }

  if (existing) {
    const changed =
      existing.currentPrice.amountMinor !== decision.opportunity.currentPrice.amountMinor ||
      existing.currentPrice.currency !== decision.opportunity.currentPrice.currency ||
      existing.potentialSaving.amountMinor !== decision.opportunity.potentialSaving.amountMinor ||
      existing.potentialSaving.currency !== decision.opportunity.potentialSaving.currency ||
      existing.claimBy !== decision.opportunity.claimBy;

    if (!changed) {
      return result;
    }

    const updated = await input.repository.updateOpportunity({
      ...decision.opportunity,
      opportunityId: existing.id,
      userId: input.purchase.userId,
      priceObservationId: input.observation.id,
      statusUpdatedAt: input.now,
    });

    if (updated) {
      result.updated += 1;
      result.activityEventsCreated += await recordActivity(input.repository, {
        purchase: input.purchase,
        opportunityId: updated.id,
        type: "opportunity_updated",
        occurredAt: input.now,
        createdAt: input.now,
        metadata: {
          currentPrice: updated.currentPrice,
          potentialSaving: updated.potentialSaving,
          claimBy: updated.claimBy,
        },
        dedupeKey: `${input.purchase.id}:opportunity_updated:${input.observation.id}`,
      });
    }

    return result;
  }

  const opportunity = await input.repository.createOpportunity({
    ...decision.opportunity,
    userId: input.purchase.userId,
    priceObservationId: input.observation.id,
    createdAt: input.now,
  });
  result.created += 1;
  result.activityEventsCreated += await recordActivity(input.repository, {
    purchase: input.purchase,
    opportunityId: opportunity.id,
    type: "opportunity_created",
    occurredAt: input.now,
    createdAt: input.now,
    metadata: {
      currentPrice: opportunity.currentPrice,
      potentialSaving: opportunity.potentialSaving,
      claimBy: opportunity.claimBy,
      claimUrl: opportunity.claimUrl,
    },
    dedupeKey: `${input.purchase.id}:opportunity_created:${opportunity.id}`,
  });

  return result;
}

async function recordObservationActivity(input: {
  repository: AfterBuyRepository;
  purchase: PurchaseRecord;
  observation: PriceObservationRecord;
  previousObservation: PriceObservationRecord | null;
  now: string;
}): Promise<number> {
  const { purchase, observation, previousObservation } = input;
  let created = 0;

  if (observation.availability === "out_of_stock") {
    created += await recordActivity(input.repository, {
      purchase,
      type: "product_unavailable",
      occurredAt: observation.observedAt,
      createdAt: input.now,
      metadata: { sourceUrl: observation.sourceUrl },
      dedupeKey: `${purchase.id}:product_unavailable:${observation.observedAt}`,
    });
    return created;
  }

  if (previousObservation?.availability === "out_of_stock") {
    created += await recordActivity(input.repository, {
      purchase,
      type: "product_available_again",
      occurredAt: observation.observedAt,
      createdAt: input.now,
      metadata: { currentPrice: observation.price },
      dedupeKey: `${purchase.id}:product_available_again:${observation.observedAt}`,
    });
  }

  if (previousObservation) {
    if (isLessThan(observation.price, previousObservation.price)) {
      created += await recordPriceMoveActivity({
        repository: input.repository,
        purchase,
        observation,
        previousPrice: previousObservation.price,
        now: input.now,
        type: "price_dropped",
      });
    } else if (isLessThan(previousObservation.price, observation.price)) {
      created += await recordPriceMoveActivity({
        repository: input.repository,
        purchase,
        observation,
        previousPrice: previousObservation.price,
        now: input.now,
        type: "price_increased",
      });
    }
  } else if (isLessThan(observation.price, purchase.pricePaid)) {
    created += await recordPriceMoveActivity({
      repository: input.repository,
      purchase,
      observation,
      previousPrice: purchase.pricePaid,
      now: input.now,
      type: "price_dropped",
    });
  } else {
    created += await recordActivity(input.repository, {
      purchase,
      type: "price_observed",
      occurredAt: observation.observedAt,
      createdAt: input.now,
      metadata: { currentPrice: observation.price },
      dedupeKey: `${purchase.id}:price_observed:${observation.observedAt}`,
    });
  }

  return created;
}

async function recordPriceMoveActivity(input: {
  repository: AfterBuyRepository;
  purchase: PurchaseRecord;
  observation: PriceObservationRecord;
  previousPrice: Money;
  now: string;
  type: "price_dropped" | "price_increased";
}): Promise<number> {
  const change =
    input.type === "price_dropped"
      ? subtractMoney(input.previousPrice, input.observation.price)
      : subtractMoney(input.observation.price, input.previousPrice);
  const savingAgainstPaid = isLessThan(input.observation.price, input.purchase.pricePaid)
    ? subtractMoney(input.purchase.pricePaid, input.observation.price)
    : undefined;

  return recordActivity(input.repository, {
    purchase: input.purchase,
    type: input.type,
    occurredAt: input.observation.observedAt,
    createdAt: input.now,
    metadata: {
      previousPrice: input.previousPrice,
      currentPrice: input.observation.price,
      change,
      savingAgainstPaid,
    },
    dedupeKey: `${input.purchase.id}:${input.type}:${input.observation.id}`,
  });
}

async function recordActivity(
  repository: AfterBuyRepository,
  input: {
    purchase: PurchaseRecord;
    opportunityId?: string;
    type: Parameters<AfterBuyRepository["recordActivityEvent"]>[0]["type"];
    occurredAt: string;
    createdAt: string;
    metadata?: Record<string, unknown>;
    dedupeKey?: string;
  },
): Promise<number> {
  const eventInput: Parameters<AfterBuyRepository["recordActivityEvent"]>[0] = {
    userId: input.purchase.userId,
    purchaseId: input.purchase.id,
    productId: input.purchase.productId,
    type: input.type,
    occurredAt: input.occurredAt,
    createdAt: input.createdAt,
  };

  if (input.opportunityId) {
    eventInput.opportunityId = input.opportunityId;
  }
  if (input.metadata) {
    eventInput.metadata = input.metadata;
  }
  if (input.dedupeKey) {
    eventInput.dedupeKey = input.dedupeKey;
  }

  const write = await repository.recordActivityEvent(eventInput);

  return write.created ? 1 : 0;
}

function validateSnapshot(
  product: Parameters<PriceFetcher["fetchCurrentPrice"]>[0],
  snapshot: Awaited<ReturnType<PriceFetcher["fetchCurrentPrice"]>>,
): void {
  if (snapshot.retailerId.trim().length === 0) {
    throw new Error(`Fetched snapshot for ${product.id} is missing a retailer`);
  }

  if (snapshot.retailerId !== product.retailerId) {
    throw new Error(
      `Fetched snapshot retailer ${snapshot.retailerId} does not match ${product.retailerId}`,
    );
  }

  if (
    snapshot.externalProductId &&
    product.externalProductId &&
    snapshot.externalProductId !== product.externalProductId
  ) {
    throw new Error("Fetched product identifier does not match the protected product");
  }

  if (snapshot.price.currency !== "GBP") {
    throw new Error(`Unsupported monitoring currency ${snapshot.price.currency}`);
  }

  if (snapshot.price.amountMinor <= 0) {
    throw new Error("Fetched product price must be positive");
  }

  if (Number.isNaN(new Date(snapshot.observedAt).getTime())) {
    throw new Error("Fetched observation timestamp is invalid");
  }

  if (!["in_stock", "out_of_stock", "unknown"].includes(snapshot.availability)) {
    throw new Error("Fetched product availability is invalid");
  }

  try {
    new URL(snapshot.productUrl);
  } catch {
    throw new Error("Fetched product URL is invalid");
  }
}

function isSameObservation(
  previous: PriceObservationRecord | null,
  snapshot: Awaited<ReturnType<PriceFetcher["fetchCurrentPrice"]>>,
): previous is PriceObservationRecord {
  return Boolean(
    previous &&
      previous.observedAt === snapshot.observedAt &&
      previous.price.amountMinor === snapshot.price.amountMinor &&
      previous.price.currency === snapshot.price.currency &&
      previous.availability === snapshot.availability &&
      previous.sourceUrl === snapshot.productUrl,
  );
}
