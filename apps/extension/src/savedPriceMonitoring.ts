import type { Money, SavedItem } from "@afterbuy/core";

const internalMonitorHash = "tracer-internal-price-monitor";

export function buildInternalMonitoringUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = internalMonitorHash;
  return url.toString();
}

export function isInternalMonitoringUrl(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).hash === `#${internalMonitorHash}`;
  } catch {
    return false;
  }
}

export interface SavedPriceDecision {
  currentPrice: Money;
  priceDropAmount?: Money | undefined;
  priceDropPercent?: number | undefined;
  monitoringStatus: "watching" | "price_dropped";
  lastCheckedAt: string;
  lastNotifiedPrice?: Money | undefined;
  shouldNotify: boolean;
}

export function evaluateSavedPrice(item: SavedItem, latest: Money, checkedAt: string): SavedPriceDecision {
  if (!item.savedPrice || latest.currency !== item.savedPrice.currency || latest.amountMinor <= 0) {
    throw new Error("monitor_price_unavailable");
  }

  const amountMinor = item.savedPrice.amountMinor - latest.amountMinor;
  const dropped = amountMinor > 0;
  const priceDropPercent = dropped
    ? Math.round((amountMinor * 10_000) / item.savedPrice.amountMinor) / 100
    : undefined;
  const meaningfulDrop = dropped && (amountMinor >= 100 || (priceDropPercent ?? 0) >= 1);
  const sameNotifiedPrice = item.lastNotifiedPrice?.currency === latest.currency
    && item.lastNotifiedPrice.amountMinor === latest.amountMinor;
  const decision: SavedPriceDecision = {
    currentPrice: latest,
    monitoringStatus: dropped ? "price_dropped" : "watching",
    lastCheckedAt: checkedAt,
    lastNotifiedPrice: undefined,
    shouldNotify: meaningfulDrop && !sameNotifiedPrice,
  };

  if (dropped) {
    decision.priceDropAmount = { amountMinor, currency: latest.currency };
    decision.priceDropPercent = priceDropPercent;
  }
  if (meaningfulDrop) {
    decision.lastNotifiedPrice = sameNotifiedPrice ? item.lastNotifiedPrice : latest;
  }
  return decision;
}
