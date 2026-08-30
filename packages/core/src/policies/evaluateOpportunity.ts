import { addCalendarDays, isOnOrBeforeDate } from "../domain/dates";
import { formatMoney, isLessThan, subtractMoney } from "../domain/money";
import type {
  OpportunityCreateInput,
  PriceObservationRecord,
  PurchaseRecord,
  RetailerPolicy,
} from "../domain/types";

export type OpportunityDecision =
  | {
      eligible: true;
      opportunity: Omit<OpportunityCreateInput, "userId" | "priceObservationId" | "createdAt">;
    }
  | {
      eligible: false;
      reason:
        | "policy_not_applicable"
        | "outside_policy_window"
        | "price_not_lower"
        | "product_unavailable";
    };

export function evaluatePriceObservationForPurchase(
  purchase: PurchaseRecord,
  observation: PriceObservationRecord,
  policy: RetailerPolicy,
  now: string,
): OpportunityDecision {
  if (purchase.retailerId !== policy.retailerId) {
    return { eligible: false, reason: "policy_not_applicable" };
  }

  if (observation.availability === "out_of_stock") {
    return { eligible: false, reason: "product_unavailable" };
  }

  if (!isLessThan(observation.price, purchase.pricePaid)) {
    return { eligible: false, reason: "price_not_lower" };
  }

  const claimBy = addCalendarDays(purchase.purchasedAt, policy.eligibilityWindowDays);

  if (!isOnOrBeforeDate(now, claimBy)) {
    return { eligible: false, reason: "outside_policy_window" };
  }

  const potentialSaving = subtractMoney(purchase.pricePaid, observation.price);
  const formattedSaving = formatMoney(potentialSaving);

  return {
    eligible: true,
    opportunity: {
      retailerId: purchase.retailerId,
      purchaseId: purchase.id,
      productId: purchase.productId,
      policyId: policy.id,
      claimBy,
      originalPrice: purchase.pricePaid,
      currentPrice: observation.price,
      potentialSaving,
      title: `Tracer found you ${formattedSaving}`,
      guidance: buildGuidance(policy),
      claimUrl: policy.claimRoute.url,
    },
  };
}

function buildGuidance(policy: RetailerPolicy): string {
  const evidence =
    policy.evidenceRequirements.length > 0
      ? `Keep ${policy.evidenceRequirements.join(", ")} ready.`
      : "Keep a copy of your order and the lower price ready.";
  const exclusions =
    policy.exclusions.length > 0
      ? `Check exclusions such as ${policy.exclusions.join(", ")}.`
      : "Check the retailer's current exclusions before claiming.";

  return `${policy.consumerSummary} ${evidence} ${exclusions}`;
}
