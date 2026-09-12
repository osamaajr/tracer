import { describe, expect, it } from "vitest";
import { buildPriceDropNotifications, type SyncedPriceDrop } from "../src/priceDropNotifications";

const drop: SyncedPriceDrop = {
  eventId: "evt_drop_1",
  purchaseId: "pur_1",
  productName: "Trail Pack 24L",
  currentPriceDisplay: "£69.50",
  savingDisplay: "£15",
  detectedAt: "2026-09-02T08:00:00.000Z",
};

describe("price-drop notifications", () => {
  it("deduplicates repeated events in the same sync without mutating delivered IDs", () => {
    const delivered = new Set<string>();
    expect(buildPriceDropNotifications([drop, { ...drop }], delivered, true)).toHaveLength(1);
    expect(delivered.size).toBe(0);
  });
  it("creates one notification for a new real drop when alerts are enabled", () => {
    expect(buildPriceDropNotifications([drop], new Set(), true)).toEqual([
      {
        eventId: "evt_drop_1",
        title: "Price drop detected",
        message: "Trail Pack 24L is now £69.50 — £15 less than you paid.",
      },
    ]);
  });

  it("suppresses notifications when alerts are disabled or the event was delivered", () => {
    expect(buildPriceDropNotifications([drop], new Set(), false)).toEqual([]);
    expect(buildPriceDropNotifications([drop], new Set([drop.eventId]), true)).toEqual([]);
  });
});
