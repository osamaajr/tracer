import { describe, expect, it } from "vitest";
import type { SavedItem } from "@afterbuy/core";
import {
  buildInternalMonitoringUrl,
  evaluateSavedPrice,
  isInternalMonitoringUrl,
} from "../src/savedPriceMonitoring";

const savedItem: SavedItem = {
  id: "saved-1",
  name: "Headphones",
  retailer: "Shop",
  retailerId: "store_shop-example-com",
  canonicalUrl: "https://shop.example.com/products/headphones",
  savedAt: "2026-09-13T00:00:00.000Z",
  savedPrice: { amountMinor: 12_999, currency: "GBP" },
  currentPrice: { amountMinor: 12_999, currency: "GBP" },
  monitoringStatus: "watching",
  status: "saved",
};

describe("saved price monitoring", () => {
  it("marks internal monitoring tabs so browser startup can remove only those tabs", () => {
    const monitoringUrl = buildInternalMonitoringUrl("https://shop.example.com/products/headphones?variant=black#reviews");

    expect(monitoringUrl).toBe("https://shop.example.com/products/headphones?variant=black#tracer-internal-price-monitor");
    expect(isInternalMonitoringUrl(monitoringUrl)).toBe(true);
    expect(isInternalMonitoringUrl("https://shop.example.com/products/headphones?variant=black#reviews")).toBe(false);
  });

  it("calculates a drop against the saved price", () => {
    expect(evaluateSavedPrice(savedItem, { amountMinor: 9_999, currency: "GBP" }, "2026-09-13T06:00:00.000Z")).toMatchObject({
      monitoringStatus: "price_dropped",
      priceDropAmount: { amountMinor: 3_000, currency: "GBP" },
      priceDropPercent: 23.08,
      shouldNotify: true,
    });
  });

  it("does not notify repeatedly for the same unchanged drop", () => {
    const latest = { amountMinor: 9_999, currency: "GBP" };
    const decision = evaluateSavedPrice({ ...savedItem, lastNotifiedPrice: latest }, latest, "2026-09-13T12:00:00.000Z");
    expect(decision.shouldNotify).toBe(false);
    expect(decision.lastNotifiedPrice).toEqual(latest);
  });

  it("returns to watching when the price is no longer below the saved price", () => {
    expect(evaluateSavedPrice({ ...savedItem, lastNotifiedPrice: { amountMinor: 9_999, currency: "GBP" } }, { amountMinor: 12_999, currency: "GBP" }, "2026-09-13T18:00:00.000Z")).toMatchObject({
      monitoringStatus: "watching",
      shouldNotify: false,
      lastNotifiedPrice: undefined,
    });
  });

  it("rejects invalid or mismatched prices so the caller can preserve the last value", () => {
    expect(() => evaluateSavedPrice(savedItem, { amountMinor: 0, currency: "GBP" }, "2026-09-13T18:00:00.000Z")).toThrow();
    expect(() => evaluateSavedPrice(savedItem, { amountMinor: 9_999, currency: "USD" }, "2026-09-13T18:00:00.000Z")).toThrow();
  });
});
