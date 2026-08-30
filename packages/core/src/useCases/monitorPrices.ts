import type {
  AfterBuyRepository,
  PriceFetcher,
  PurchaseRecord,
  RetailerPolicy,
} from "../domain/types";
import { RetailerPolicyRegistry, defaultPolicyRegistry } from "../policies/policyRegistry";
import { evaluatePriceObservationForPurchase } from "../policies/evaluateOpportunity";

export interface MonitoringSummary {
  checkedProducts: number;
  observationsCreated: number;
  opportunitiesCreated: number;
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
    failures: [],
  };

  for (const product of products) {
    summary.checkedProducts += 1;

    try {
      const snapshot = await options.priceFetcher.fetchCurrentPrice(product);
      const observation = await options.repository.recordPriceObservation({
        productId: product.id,
        retailerId: product.retailerId,
        observedAt: snapshot.observedAt,
        price: snapshot.price,
        sourceUrl: snapshot.productUrl,
        availability: snapshot.availability,
      });
      summary.observationsCreated += 1;

      const activePurchases = await options.repository.listActivePurchasesForProduct(product.id);

      for (const purchase of activePurchases) {
        const policy = policyRegistry.findPolicyForRetailer(
          purchase.retailerId,
          purchase.purchasedAt,
        );

        if (!policy) {
          continue;
        }

        const created = await maybeCreateOpportunity({
          repository: options.repository,
          purchase,
          policy,
          observation,
          now,
        });

        if (created) {
          summary.opportunitiesCreated += 1;
        }
      }
    } catch (error) {
      summary.failures.push({
        productId: product.id,
        reason: error instanceof Error ? error.message : "Unknown monitoring failure",
      });
    }
  }

  return summary;
}

async function maybeCreateOpportunity(input: {
  repository: AfterBuyRepository;
  purchase: PurchaseRecord;
  policy: RetailerPolicy;
  observation: Awaited<ReturnType<AfterBuyRepository["recordPriceObservation"]>>;
  now: string;
}): Promise<boolean> {
  const decision = evaluatePriceObservationForPurchase(
    input.purchase,
    input.observation,
    input.policy,
    input.now,
  );

  if (!decision.eligible) {
    return false;
  }

  const existing = await input.repository.findOpenOpportunityForPurchase(input.purchase.id);

  if (existing) {
    return false;
  }

  await input.repository.createOpportunity({
    ...decision.opportunity,
    userId: input.purchase.userId,
    priceObservationId: input.observation.id,
    createdAt: input.now,
  });

  return true;
}
