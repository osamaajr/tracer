import {
  formatMoney,
  isLessThan,
  subtractMoney,
  type ActivityEventRecord,
  type Money,
  type OpportunityRecord,
  type PriceObservationRecord,
  type PurchaseRecord,
} from "@afterbuy/core";

export function serializeOpportunity(opportunity: OpportunityRecord) {
  return {
    ...opportunity,
    potentialSavingDisplay: formatMoney(opportunity.potentialSaving),
    originalPriceDisplay: formatMoney(opportunity.originalPrice),
    currentPriceDisplay: formatMoney(opportunity.currentPrice),
  };
}

export function derivePurchaseMonitoringState(input: {
  purchase: PurchaseRecord;
  latest: PriceObservationRecord | undefined;
  activity: ActivityEventRecord[];
  monitoringEnabled: boolean;
}): {
  status: "watching" | "price_dropped" | "monitoring_paused" | "unable_to_check" | "unavailable";
  saving: Money | null;
  savingPercentageBps: number | null;
  priceDropDetectedAt: string | null;
} {
  if (!input.monitoringEnabled) {
    return { status: "monitoring_paused", saving: null, savingPercentageBps: null, priceDropDetectedAt: null };
  }

  const latestError = input.activity
    .filter((event) => event.type === "monitoring_error")
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0];
  if (latestError && (!input.latest || latestError.occurredAt >= input.latest.observedAt)) {
    return { status: "unable_to_check", saving: null, savingPercentageBps: null, priceDropDetectedAt: null };
  }

  if (input.latest?.availability === "out_of_stock") {
    return { status: "unavailable", saving: null, savingPercentageBps: null, priceDropDetectedAt: null };
  }

  if (input.latest && isLessThan(input.latest.price, input.purchase.pricePaid)) {
    const saving = subtractMoney(input.purchase.pricePaid, input.latest.price);
    const priceDropEvent = input.activity
      .filter((event) => event.type === "price_dropped" && Boolean(readMoney(event.metadata.savingAgainstPaid)))
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0];
    return {
      status: "price_dropped",
      saving,
      savingPercentageBps: Math.round((saving.amountMinor * 10_000) / input.purchase.pricePaid.amountMinor),
      priceDropDetectedAt: priceDropEvent?.occurredAt ?? input.latest.observedAt,
    };
  }

  return { status: "watching", saving: null, savingPercentageBps: null, priceDropDetectedAt: null };
}

export function serializeActivityEvent(event: ActivityEventRecord, retailerName: string) {
  const currentPrice = readMoney(event.metadata.currentPrice);
  const potentialSaving = readMoney(event.metadata.potentialSaving);
  const change = readMoney(event.metadata.change);
  const claimBy = typeof event.metadata.claimBy === "string" ? event.metadata.claimBy : undefined;
  const formattedPrice = currentPrice ? formatMoney(currentPrice) : null;
  const formattedSaving = potentialSaving ? formatMoney(potentialSaving) : change ? formatMoney(change) : null;

  return {
    ...event,
    title: activityTitle(event.type),
    description: activityDescription({
      type: event.type,
      retailerName,
      formattedPrice,
      formattedSaving,
      claimBy,
      reason: typeof event.metadata.reason === "string" ? event.metadata.reason : undefined,
    }),
  };
}

function activityTitle(type: ActivityEventRecord["type"]): string {
  const titles: Record<ActivityEventRecord["type"], string> = {
    purchase_protected: "Purchase protected",
    monitoring_paused: "Monitoring paused",
    monitoring_resumed: "Monitoring resumed",
    price_observed: "Price unchanged",
    price_dropped: "Price dropped",
    price_increased: "Price increased",
    product_unavailable: "Temporarily unavailable",
    product_available_again: "Back in stock",
    policy_window_expired: "Protection window ended",
    opportunity_created: "Opportunity found",
    opportunity_updated: "Opportunity updated",
    opportunity_resolved: "Opportunity resolved",
    opportunity_expired: "Opportunity expired",
    monitoring_error: "Unable to check",
  };
  return titles[type];
}

function activityDescription(input: {
  type: ActivityEventRecord["type"];
  retailerName: string;
  formattedPrice: string | null;
  formattedSaving: string | null;
  claimBy: string | undefined;
  reason: string | undefined;
}): string {
  switch (input.type) {
    case "purchase_protected": return "We're now monitoring this item.";
    case "monitoring_paused": return "Automatic price checks are paused.";
    case "monitoring_resumed": return "Automatic price checks have resumed.";
    case "price_observed": return input.formattedPrice ? `Still ${input.formattedPrice} at ${input.retailerName}.` : `Checked at ${input.retailerName}.`;
    case "price_dropped": return input.formattedPrice ? `Now ${input.formattedPrice} at ${input.retailerName}.` : "The price moved lower.";
    case "price_increased": return input.formattedPrice ? `Now ${input.formattedPrice} at ${input.retailerName}.` : "The price moved higher.";
    case "product_unavailable": return `We could not confirm current availability at ${input.retailerName}.`;
    case "product_available_again": return `The item is available again at ${input.retailerName}.`;
    case "policy_window_expired": return "This purchase is outside the retailer protection window.";
    case "opportunity_created": return input.formattedSaving ? `${input.formattedSaving} potential saving found.` : "A claim opportunity is ready to review.";
    case "opportunity_updated": return input.formattedSaving ? `Updated to ${input.formattedSaving} potential saving.` : "The opportunity has been refreshed.";
    case "opportunity_resolved": return "The current price no longer creates a claim opportunity.";
    case "opportunity_expired": return input.claimBy ? `The claim window ended on ${input.claimBy}.` : "The claim window has ended.";
    case "monitoring_error": return input.reason ?? "The latest price check did not complete.";
  }
}

export function readMoney(value: unknown): Money | null {
  if (typeof value !== "object" || value === null || !("amountMinor" in value) || !("currency" in value)) return null;
  if (typeof value.amountMinor !== "number" || typeof value.currency !== "string") return null;
  return { amountMinor: value.amountMinor, currency: value.currency };
}

export function isActionableOpportunityStatus(status: OpportunityRecord["status"]): boolean {
  return status === "open" || status === "viewed";
}
