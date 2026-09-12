export interface SyncedPriceDrop {
  eventId: string;
  purchaseId: string;
  productName: string;
  currentPriceDisplay: string;
  savingDisplay: string;
  detectedAt: string;
}

export interface PriceDropNotification {
  eventId: string;
  title: string;
  message: string;
}

export function buildPriceDropNotifications(
  priceDrops: SyncedPriceDrop[],
  notifiedEventIds: ReadonlySet<string>,
  alertsEnabled: boolean,
): PriceDropNotification[] {
  if (!alertsEnabled) {
    return [];
  }

  const seen = new Set(notifiedEventIds);
  return priceDrops
    .filter((drop) => {
      if (seen.has(drop.eventId)) return false;
      seen.add(drop.eventId);
      return true;
    })
    .sort((left, right) => left.detectedAt.localeCompare(right.detectedAt))
    .map((drop) => ({
      eventId: drop.eventId,
      title: "Price drop detected",
      message: `${drop.productName} is now ${drop.currentPriceDisplay} — ${drop.savingDisplay} less than you paid.`,
    }));
}
